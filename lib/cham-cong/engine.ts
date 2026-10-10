// lib/cham-cong/engine.ts — ENGINE BẢNG CÔNG NGÀY (L2). THUẦN: không DB, không giờ máy.
//
// Đầu vào là ca đã xếp của ngày (segments đã resolve), các lượt quét ĐÃ CHẤP NHẬN (phút VN
// trong ngày), tham số `shift.*` và ngữ cảnh (lễ, miễn công). Đầu ra là mọi cột của
// StaffAttendanceDay + `ruleSnapshot`. Luật theo kế hoạch v3.3 §4 và BA §6.3-bis GC-01..08:
//
//  1. Chống trùng 2′ (GC-08) chạy TRƯỚC ghép cặp.
//  2. Ghép cặp tuần tự theo thời gian, không xét ca (GC-01..05): VÀO mở cặp; RA đóng cặp
//     gần nhất; VÀO khi đang có cặp mở ⇒ cặp cũ THIEU_LUOT_RA; RA lẻ ⇒ RA_KHONG_CO_VAO.
//  3. Giờ công = GIAO(cặp, hợp các đoạn WORK ∪ PAID_BREAK đã gộp), khử trùng lặp (GC-06).
//     CG lỗ trưa KHÔNG tính; CS 16:30–17:00 TÍNH; CT liền 13:45–21:00 = 7h15.
//  4. Muộn/sớm theo đoạn: DI_MUON khi VÀO đầu tiên của đoạn > start + lateGrace (T-12: 30′);
//     DEN_SAT_GIO (chỉ nhắc) khi VÀO > start − earlyArrival; VE_SOM khi RA cuối < end − grace.
//  5. CÔNG ĐẾM THEO KẾ HOẠCH (T-01): dayCreditEarned = dayCreditExpected. Engine KHÔNG tự
//     trừ — thiếu lượt / thiếu buổi / muộn chỉ sinh cờ cho hộp cờ QLCS.
//  6. Lễ (T-04): holidayPaidUnits = dayCreditExpected × coefficient, cột riêng, không cờ thiếu.
//  7. Không sinh SAI_NOI_LAM cho ANY_CENTER / OFFSITE / ANYWHERE (§4.10) — cờ đó đặt ở lượt.
//  8. Miễn công (T-02): trả `exempt: true`, không sinh dòng.
import type { NguCanhDon } from "./don-trong-ngay";
import { KHONG_TANG_CA, tinhTangCa } from "./tang-ca";
import { cumSauNghi, giaiKhungNghi } from "./nghi-trong-ca";
import { giao, tong } from "./khoang-gio";
import { coThieuCum, cumQuetKyVong, khongQuetGiuaCa } from "./cum-quet";
import type { ShiftSegment } from "./catalog";
import { toMinutes } from "./catalog";

export type EngineLog = {
  id: string;
  /** Phút kể từ 00:00 giờ VN của ngày công. */
  minute: number;
  direction: "CHECK_IN" | "CHECK_OUT";
  /** Cờ đã gắn lúc ghi lượt (NGOAI_VUNG, THIEU_GPS, SAI_NOI_LAM…) — chỉ chuyển tiếp. */
  flags?: string[];
};

export type EngineAssignment = {
  templateCode: string;
  segments: ShiftSegment[];
  attendanceMode: "REQUIRED" | "OPTIONAL" | "NONE";
  /**
   * Số CẶP QUÉT kỳ vọng — bản chụp từ mã ca lúc xếp (`ShiftAssignment.soCapQuetKyVong`).
   *
   * BẮT BUỘC, không mặc định: luật 7. Mặc định ở đây là cách chắc chắn để một đường gọi
   * mới tính công bằng con số không ai chọn cho nó — và con số này quyết định có gắn cờ
   * thiếu lượt hay không.
   */
  soCapQuetKyVong: 0 | 1 | 2;
  dayCredit: number;
  isLeave: boolean;
  nominalMinutes: number | null;
  placeMode: "AT_UNITS" | "ANY_CENTER" | "OFFSITE" | "ANYWHERE";
  /** Mã nghỉ tuần (X) — không có giờ, không phải nghỉ phép. */
  isOff?: boolean;
};

export type EngineRules = {
  lateGraceMinutes: number;
  earlyArrivalMinutes: number;
  duplicateTapMinutes: number;
  maxLogsPerDay: number;
  pairingMaxGapMinutes: number;
  /** Làm tròn XUỐNG phút OT được trả (bội số). 0 = không làm tròn (đợt 4, mặc định an toàn). */
  otRoundingMinutes: number;
  /**
   * Đợt 6 — ngày ĐI CÔNG TÁC theo đơn đã duyệt: true = đủ công theo ca, không đòi quét
   * (`shift.congTacCheDo = DU_CONG`, QĐ-3); false = vẫn đòi chấm như ngày thường (chỉ bỏ ràng buộc nơi).
   */
  congTacDuCong: boolean;
};

export const DEFAULT_RULES: EngineRules = {
  lateGraceMinutes: 30,
  earlyArrivalMinutes: 10,
  duplicateTapMinutes: 2,
  maxLogsPerDay: 10,
  pairingMaxGapMinutes: 60,
  otRoundingMinutes: 0,
  congTacDuCong: true,
};

export type EngineInput = {
  assignment: EngineAssignment | null;
  logs: EngineLog[];
  rules: EngineRules;
  holiday?: { coefficient: number; effect: "PAID_LEAVE" | "UNPAID_OFF" | "INFO_ONLY" | null } | null;
  exempt?: boolean;
  /** Ngày nghỉ tuần theo setting (không có ca) — chỉ để gắn dayType khi không có assignment. */
  isWeeklyOff?: boolean;
  /**
   * NGỮ CẢNH ĐƠN đã duyệt của ngày (BA §10) — khung đi muộn/về sớm (đợt 2), khung OT (đợt 4)… —
   * `recompute.ts` đọc bằng MỘT câu (`docDonHieuLucNgay`) rồi gom qua `dungNguCanhDon`.
   *
   * BẮT BUỘC (luật 7): có mặc định là một đường gọi mới quên truyền và đơn đã duyệt bị bỏ qua im
   * lặng — không lỗi nào báo. Không có đơn ⇒ `KHONG_CO_DON`.
   */
  nguCanhDon: NguCanhDon;
};

export type Pair = { inId: string | null; outId: string | null; start: number; end: number; open: boolean };

export type DayResult = {
  exempt: boolean;
  dayType: "WORK" | "WEEKLY_OFF" | "LEAVE" | "HOLIDAY" | "UNSCHEDULED";
  expectedMinutes: number;
  workedMinutes: number;
  paidBreakMinutes: number;
  rawPairedMinutes: number;
  amExpected: number;
  amWorked: number;
  pmExpected: number;
  pmWorked: number;
  lateMinutes: number;
  /** Phút đến muộn THÔ ở đoạn đầu ca (0 = đúng giờ hoặc sớm). Không chịu dung sai. */
  arrivalDeltaMinutes: number;
  earlyLeaveMinutes: number;
  /**
   * Phần đến muộn (tính từ giờ bắt đầu ca, THÔ như `arrivalDeltaMinutes`) nằm TRONG khung đơn đi
   * muộn đã duyệt. `arrivalDeltaMinutes − lateApprovedMinutes` là phần muộn KHÔNG được miễn.
   */
  lateApprovedMinutes: number;
  /** Phần về sớm (so với giờ kết thúc ca) nằm TRONG khung đơn về sớm đã duyệt. */
  earlyLeaveApprovedMinutes: number;
  /** OT (đợt 4): phút trong khung đã duyệt (ngoài giờ ca) · làm thật trong khung · được trả. */
  otApprovedMinutes: number;
  otActualMinutes: number;
  otPayableMinutes: number;
  /**
   * Phút cộng QUỸ NGHỈ BÙ từ OT của ngày — chỉ các đơn OT mà LÚC DUYỆT chính sách là quy đổi nghỉ bù
   * (tỉ lệ chụp trên đơn). Không lưu cột; `recompute` đối chiếu sổ quỹ theo số này.
   */
  otCompMinutes: number;
  /**
   * Đợt 9 — phút làm thật (cặp đã đóng) trong khung đơn LÀM NGÀY LỄ / NGÀY NGHỈ đã duyệt, cột riêng
   * (không cộng công thường / OT), và phần cộng quỹ nghỉ bù theo tỉ lệ chụp lúc duyệt.
   */
  holidayWorkMinutes: number;
  restDayWorkMinutes: number;
  lamNgayNghiCompMinutes: number;
  missedEarlyArrival: boolean;
  dayCreditExpected: number;
  dayCreditEarned: number;
  hourCredit: number;
  leaveUnits: number;
  holidayPaidUnits: number;
  pairs: Pair[];
  flags: string[];
  ruleSnapshot: Record<string, unknown>;
};

type Interval = { start: number; end: number };

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** GC-08: hai lượt cùng chiều cách nhau < N phút ⇒ lượt sau là bấm trùng (bỏ khỏi ghép, gắn cờ). */
export function dedupeTaps(logs: EngineLog[], minutes: number): { kept: EngineLog[]; dupIds: string[] } {
  const sorted = [...logs].sort((a, b) => a.minute - b.minute);
  const kept: EngineLog[] = [];
  const dupIds: string[] = [];
  for (const l of sorted) {
    const prev = kept[kept.length - 1];
    if (prev && prev.direction === l.direction && l.minute - prev.minute < minutes) {
      dupIds.push(l.id);
      continue;
    }
    kept.push(l);
  }
  return { kept, dupIds };
}

/** GC-01..05: ghép cặp tuần tự theo thời gian, không xét ca. */
export function pairLogs(logs: EngineLog[]): { pairs: Pair[]; flags: string[] } {
  const sorted = [...logs].sort((a, b) => a.minute - b.minute);
  const pairs: Pair[] = [];
  const flags = new Set<string>();
  let open: Pair | null = null;
  for (const l of sorted) {
    if (l.direction === "CHECK_IN") {
      if (open) {
        flags.add("THIEU_LUOT_RA");
        pairs.push(open); // vào không có ra — giữ, open=true
      }
      open = { inId: l.id, outId: null, start: l.minute, end: l.minute, open: true };
    } else {
      if (!open) {
        flags.add("RA_KHONG_CO_VAO");
        continue;
      }
      open.outId = l.id;
      open.end = l.minute;
      open.open = false;
      pairs.push(open);
      open = null;
    }
  }
  if (open) {
    flags.add("THIEU_LUOT_RA");
    pairs.push(open);
  }
  return { pairs, flags: [...flags] };
}

function isAm(seg: ShiftSegment): boolean {
  return toMinutes(seg.start) < 12 * 60;
}

/**
 * Biến kết quả của một ngày CHƯA DIỄN RA về đúng nghĩa của nó: **giữ KẾ HOẠCH, xoá mọi vế
 * ĐÃ XẢY RA**.
 *
 * ── Vì sao hàm này tồn tại (sự cố 16/09/2026) ──────────────────────────────────────────
 *
 * `recomputeRange` lặp mọi ngày của kỳ, kể cả kỳ ĐANG CHẠY, nên bấm "Tính lại" giữa tháng
 * là sinh dòng ngày công cho những ngày chưa tới. `computeDay` xử chúng y như ngày đã khép:
 * không có lượt quét nào ⇒ gắn `KHONG_CO_LUOT`, và vẫn ghi đủ `dayCreditEarned` (công tính
 * theo KẾ HOẠCH CA chứ không theo lượt quét). Đo prod hôm ấy: **250 dòng ngày chưa diễn ra,
 * 196 cờ oan, 185 công**.
 *
 * Hậu quả nhìn thấy được: màn in "Không có lượt" cho 17/09 → 30/09 kèm đường dẫn "Nộp đơn
 * chỉnh công" — bảo người ta đi xin bổ sung giờ cho NGÀY MAI.
 *
 * ── Xoá những vế nào, và vì sao đúng những vế đó ───────────────────────────────────────
 *
 * Chủ dự án chốt 16/09: *"vẫn tạo dòng để giữ kế hoạch, nhưng không gắn cờ và không ghi
 * công thực nhận."* Nên:
 *
 *   GIỮ  `dayType` · `templateCode` · `dayCreditExpected` · `expectedMinutes` · `amExpected`
 *        · `pmExpected` — đây là KẾ HOẠCH, và màn Kỳ công cần nó để chốt sổ.
 *   XOÁ  `flags` (mọi cờ đều là lời kể về việc ĐÃ xảy ra — rỗng hết chứ không lọc riêng
 *        nhóm thiếu-quét, vì lọc từng cái là để ngỏ chỗ cho cái tiếp theo lọt)
 *        `dayCreditEarned` · `hourCredit` · `leaveUnits` · `holidayPaidUnits` — cả bốn là
 *        vế ĐÃ NHẬN. Chưa tới ngày thì chưa nhận gì.
 *
 * ⚠️ Xoá `leaveUnits`/`holidayPaidUnits` KHÔNG phải tiện tay: `buildPeriodSummary` của màn
 * Kỳ công cộng thẳng hai cột ấy. Bỏ sót chúng là vá được màn cá nhân mà màn Kỳ công vẫn
 * cộng ngày chưa tới — cùng một bug, chỗ khác. Ngược lại, xoá đủ bốn vế ở ĐÂY làm màn Kỳ
 * công tự đúng mà không phải sửa một dòng nào bên đó.
 *
 * Các vế "đã làm" còn lại (`workedMinutes`, `lateMinutes`, `pairs`…) vốn đã bằng 0/rỗng vì
 * ngày chưa tới thì không có lượt quét nào — không đụng, để nếu một ngày nào đó chúng KHÁC 0
 * thì đó là tín hiệu thật (ai đó quét cho ngày tương lai) chứ không bị hàm này giấu đi.
 */
export function ketQuaNgayChuaDienRa(r: DayResult): DayResult {
  return {
    ...r,
    flags: [],
    dayCreditEarned: 0,
    hourCredit: 0,
    leaveUnits: 0,
    holidayPaidUnits: 0,
    // Đợt 4: OT "đã làm"/"được trả" là vế ĐÃ XẢY RA. Khung đã duyệt là kế hoạch — giữ.
    otActualMinutes: 0,
    otPayableMinutes: 0,
    otCompMinutes: 0,
    holidayWorkMinutes: 0,
    restDayWorkMinutes: 0,
    lamNgayNghiCompMinutes: 0,
  };
}

export function computeDay(input: EngineInput): DayResult {
  const { assignment: a, rules } = input;
  const flags = new Set<string>();
  const snapshot: Record<string, unknown> = { rules, templateCode: a?.templateCode ?? null, placeMode: a?.placeMode ?? null };

  const base: DayResult = {
    exempt: false,
    dayType: "UNSCHEDULED",
    expectedMinutes: 0,
    workedMinutes: 0,
    paidBreakMinutes: 0,
    rawPairedMinutes: 0,
    amExpected: 0,
    amWorked: 0,
    pmExpected: 0,
    pmWorked: 0,
    lateMinutes: 0,
    arrivalDeltaMinutes: 0,
    earlyLeaveMinutes: 0,
    lateApprovedMinutes: 0,
    earlyLeaveApprovedMinutes: 0,
    ...KHONG_TANG_CA,
    otCompMinutes: 0,
    holidayWorkMinutes: 0,
    restDayWorkMinutes: 0,
    lamNgayNghiCompMinutes: 0,
    missedEarlyArrival: false,
    dayCreditExpected: 0,
    dayCreditEarned: 0,
    hourCredit: 0,
    leaveUnits: 0,
    holidayPaidUnits: 0,
    pairs: [],
    flags: [],
    ruleSnapshot: snapshot,
  };

  if (input.exempt) return { ...base, exempt: true, dayType: a ? "WORK" : "UNSCHEDULED", ruleSnapshot: { ...snapshot, exempt: true } };

  // ── Lượt: chống trùng + trần + ghép cặp (không phụ thuộc ca) ─────────────
  const { kept, dupIds } = dedupeTaps(input.logs, rules.duplicateTapMinutes);
  if (dupIds.length) flags.add("TRUNG_2_PHUT");
  if (input.logs.length > rules.maxLogsPerDay) flags.add("VUOT_TRAN");
  // Ngày có LỊCH theo đơn đã duyệt (công tác / làm ngày nghỉ) ⇒ cờ "chấm ngoài lịch" đã gắn trên lượt
  // quét (thường vì quét TRƯỚC khi đơn được duyệt) không còn đúng — bỏ ở mức ngày.
  const coLichDon = input.nguCanhDon.congTac || input.nguCanhDon.lamNgayNghi.length > 0;
  for (const l of input.logs) for (const f of l.flags ?? []) if (!(coLichDon && f === "CHAM_NGOAI_LICH")) flags.add(f);
  const paired = pairLogs(kept);
  paired.flags.forEach((f) => flags.add(f));
  const closed = paired.pairs.filter((p) => !p.open);
  const pairedIntervals = mergeIntervals(closed.map((p) => ({ start: p.start, end: p.end })));
  const rawPairedMinutes = pairedIntervals.reduce((s, x) => s + (x.end - x.start), 0);
  snapshot.dupIds = dupIds;

  // Đợt 5–6: ngày có đơn làm từ xa / công tác đã duyệt ⇒ cờ THÔNG TIN để màn hiện "Làm từ xa — Đã
  // duyệt" cạnh giờ quét thật. Không đổi công.
  const congTac = input.nguCanhDon.congTac;
  if (input.nguCanhDon.lamTuXa.length > 0) flags.add("LAM_TU_XA_DUYET");
  if (congTac) flags.add("CONG_TAC_DUYET");

  // Đợt 9 — LÀM NGÀY NGHỈ / LỄ theo đơn đã duyệt: phút làm thật trong khung ⇒ cột riêng. Tính một lần ở
  // đây và gắn vào `base` để MỌI nhánh trả về (không ca · lễ · ô nghỉ) mang theo. Đơn chỉ duyệt được ở
  // ngày lễ hoặc ngày không có ca làm (`lam-ngay-nghi.ts`), nên không chồng lên công thường / OT.
  const lamNgayNghi = input.nguCanhDon.lamNgayNghi;
  if (lamNgayNghi.length > 0) {
    flags.add("LAM_NGAY_NGHI_DUYET");
    const lamTron = (p: number) => (rules.otRoundingMinutes > 0 ? Math.floor(p / rules.otRoundingMinutes) * rules.otRoundingMinutes : p);
    for (const x of lamNgayNghi) {
      const p = lamTron(tong(giao(pairedIntervals, [x.khung])));
      if (x.loai === "LE") base.holidayWorkMinutes += p;
      else base.restDayWorkMinutes += p;
      if (x.tyLe !== null) base.lamNgayNghiCompMinutes += Math.round(p * x.tyLe);
    }
  }

  // ── Ngày không có ca ──────────────────────────────────────────────────────
  if (!a) {
    // Công tác theo đơn mà không có ca: lượt quét KHÔNG phải "chấm ngoài lịch" — có lịch, là lịch
    // công tác. Công vẫn 0 (Q-9 chưa chốt: ngày công tác không ca tính theo ca nào) — mặc định bảo thủ.
    // Làm ngày nghỉ theo đơn đã duyệt cũng vậy — có lịch, là lịch của đơn.
    if (input.logs.length > 0 && !congTac && lamNgayNghi.length === 0) flags.add("CHAM_NGOAI_LICH");
    return {
      ...base,
      dayType: input.isWeeklyOff ? "WEEKLY_OFF" : "UNSCHEDULED",
      rawPairedMinutes,
      pairs: paired.pairs,
      flags: [...flags].sort(),
    };
  }

  const dayCreditExpected = a.dayCredit;
  const leaveUnits = a.isLeave ? 1 : 0;

  // ── Lễ (T-04): cột riêng, không cờ thiếu ─────────────────────────────────
  if (input.holiday && input.holiday.effect !== "INFO_ONLY") {
    const coef = input.holiday.effect === "UNPAID_OFF" ? 0 : input.holiday.coefficient;
    if (input.logs.length > 0) flags.add("LAM_NGAY_LE");
    return {
      ...base,
      dayType: "HOLIDAY",
      rawPairedMinutes,
      dayCreditExpected,
      dayCreditEarned: 0,
      holidayPaidUnits: Math.round(dayCreditExpected * coef * 100) / 100,
      pairs: paired.pairs,
      flags: [...flags].sort(),
      ruleSnapshot: { ...snapshot, holiday: input.holiday },
    };
  }

  // ── Nghỉ / nghỉ phép ──────────────────────────────────────────────────────
  if (a.isLeave || a.isOff || a.attendanceMode === "NONE") {
    if (input.logs.length > 0 && lamNgayNghi.length === 0) flags.add("CHAM_NGOAI_LICH");
    return {
      ...base,
      dayType: a.isLeave ? "LEAVE" : "WEEKLY_OFF",
      rawPairedMinutes,
      dayCreditExpected,
      dayCreditEarned: dayCreditExpected,
      leaveUnits,
      pairs: paired.pairs,
      flags: [...flags].sort(),
    };
  }

  // ── Ca làm việc ───────────────────────────────────────────────────────────
  const segs = a.segments.map((s) => ({ ...s, s: toMinutes(s.start), e: toMinutes(s.end) }));
  const work = segs.filter((s) => s.kind === "WORK");
  const paidBreak = segs.filter((s) => s.kind === "PAID_BREAK");
  const planned = mergeIntervals(segs.map((s) => ({ start: s.s, end: s.e })));
  const expectedMinutesCa = segs.length ? segs.reduce((s, x) => s + (x.e - x.s), 0) : (a.nominalMinutes ?? 0);

  // ── NGHỈ MỘT PHẦN CA (đợt 7 nửa buổi / theo giờ · đợt 8 nghỉ bù) ───────────────────────────
  // Ca GIỮ NGUYÊN; phần nghỉ được trừ khỏi kế hoạch của ngày: không đòi quét trong đó, công thường
  // chỉ tính phần còn lại, phần nghỉ có lương vào `leaveUnits` (`nghi-trong-ca.ts`).
  const cumGoc = cumQuetKyVong(planned, a.soCapQuetKyVong);
  const nghi = giaiKhungNghi(input.nguCanhDon.nghi, cumGoc, planned);
  const phutCa = tong(planned);
  const phutNghi = tong(giao(planned, nghi.khung));
  const tiLeNghi = nghi.tiLe;
  if (nghi.khongAp) flags.add("NGHI_KHONG_AP_DUOC");
  for (const n of input.nguCanhDon.nghi) flags.add(n.nguon === "COMP_LEAVE" ? "NGHI_BU_DUYET" : "NGHI_MOT_PHAN_DUYET");
  const expectedMinutes = Math.max(0, expectedMinutesCa - phutNghi);
  const amExpected = segs.filter((s) => isAm(s)).reduce((s, x) => s + (x.e - x.s), 0);
  const pmExpected = expectedMinutesCa - amExpected;

  // GC-06: giao(cặp, ca đã gộp), khử trùng lặp
  let workedMinutes = 0;
  let paidBreakMinutes = 0;
  let amWorked = 0;
  let pmWorked = 0;
  for (const p of pairedIntervals) {
    for (const pl of planned) workedMinutes += overlap(p, pl);
    for (const b of paidBreak) paidBreakMinutes += overlap(p, { start: b.s, end: b.e });
    for (const s of segs) {
      const o = overlap(p, { start: s.s, end: s.e });
      if (isAm(s)) amWorked += o;
      else pmWorked += o;
    }
  }

  // Muộn / sớm / thiếu buổi theo từng đoạn WORK (cửa sổ ± pairingMaxGap)
  let lateMinutes = 0;
  let arrivalDeltaMinutes = 0;
  let earlyLeaveMinutes = 0;
  let lateApprovedMinutes = 0;
  let earlyLeaveApprovedMinutes = 0;
  const { denLuc, veLuc } = input.nguCanhDon.muonSom;
  let missedEarlyArrival = false;
  const ins = kept.filter((l) => l.direction === "CHECK_IN").map((l) => l.minute);
  const outs = kept.filter((l) => l.direction === "CHECK_OUT").map((l) => l.minute);
  const hasAnyLog = kept.length > 0;
  // ── CỤM QUÉT KỲ VỌNG ──────────────────────────────────────────────────────────────
  //
  // Trước 15/09/2026 chỗ này lặp trên `planned` = `mergeIntervals(segs)`, tức nhóm cụm theo
  // TÍNH LIỀN KỀ của đoạn WORK. Nó ra đúng kết quả nhưng VÌ LÝ DO KHÁC: khoảng nghỉ-không-
  // tính không thuộc đoạn nào nên hai bên tự rời ra. Thêm `UNPAID_BREAK` (đợt sau) là khoảng
  // ấy thành đoạn thật, `mergeIntervals` nối liền, và `ST` tụt từ 2 cụm xuống 1 mà không ca
  // test nào đỏ. Nay số cụm do DANH MỤC KHAI (`soCapQuetKyVong`), không do hình dạng dữ liệu.
  //
  // `attendanceMode === "REQUIRED"` VẪN là cổng ngoài: nó nói "ngày này có đòi chấm không".
  // `soCapQuetKyVong` nói "đòi MẤY cụm". Hai câu khác nhau — mã `NG` hôm nay OPTIONAL/0,
  // và phần A đổi vế thứ hai trước, vế thứ nhất sau.
  const cumKyVong = cumSauNghi(cumGoc, nghi.khung);
  // Công tác chế độ ĐỦ CÔNG (QĐ-3): không đòi quét ⇒ bỏ cả khối cờ thiếu lượt / muộn / sớm.
  const duCongCongTac = congTac && rules.congTacDuCong;
  if (duCongCongTac) flags.add("CONG_TAC_DU_CONG");
  if (a.attendanceMode === "REQUIRED" && cumKyVong.length > 0 && !duCongCongTac) {
    if (!hasAnyLog) flags.add("KHONG_CO_LUOT");
    // Làm thẳng qua nghỉ giữa ca, không quét ra/vào. Cổng `covered` bên dưới CỐ Ý tha ca
    // này (một cặp dài phủ chồng cả hai cụm), nên nếu không hỏi riêng ở đây thì mã khai 2
    // cặp vẫn không đòi được 4 lượt — xem đầy đủ lý do ở `khongQuetGiuaCa`.
    //
    // Cờ RIÊNG, không mượn `THIEU_BUOI_*`: hai cờ ấy bị `noi-quy.ts thieuNuaNgay()` dùng để
    // loại ngày khỏi `caThucTe`, và người làm trọn ngày không được chịu hình phạt đó.
    if (khongQuetGiuaCa(pairedIntervals, cumKyVong)) flags.add("THIEU_LUOT_GIUA_CA");
    for (const [iCum, blk] of cumKyVong.entries()) {
      const gap = rules.pairingMaxGapMinutes;
      const firstIn = ins.filter((m) => m >= blk.start - gap && m <= blk.end).sort((x, y) => x - y)[0];
      const covered = pairedIntervals.some((p) => overlap(p, blk) > 0);
      if (firstIn === undefined && !covered) {
        // "Thiếu CỤM THỨ N", không phải "thiếu buổi sáng/chiều theo mốc 12h". Ca `T`
        // (17:15–21:00) chỉ có một cụm và nó nằm sau 12h — mốc cũ gắn `THIEU_BUOI_CHIEU`
        // cho cụm DUY NHẤT của ca, đọc thành "thiếu buổi chiều" cho một ca không có buổi
        // sáng nào. Tên cờ giữ nguyên (dữ liệu prod đang mang chúng) — xem `coThieuCum`.
        // CHỈ gắn cờ khi ca có TỪ HAI CỤM. Bảng chốt nói thẳng: cờ này "chỉ có nghĩa khi
        // soCapQuetKyVong ≥ 2". Ca một cụm mà không ai phủ thì đó KHÔNG phải "thiếu một
        // buổi" — nó là về sớm / thiếu giờ / không có lượt, và ba cờ ấy đã nói đúng rồi.
        // Bắn `THIEU_BUOI_SANG` cho ca `T` (17:15–21:00) là in ra một câu vô nghĩa.
        if (hasAnyLog && cumKyVong.length >= 2) flags.add(coThieuCum(iCum));
        continue;
      }
      // Đơn đi muộn chỉ áp cho CỤM ĐẦU (đến muộn đầu ca), đơn về sớm chỉ cho CỤM CUỐI — đúng
      // nghĩa người nộp khai ("giờ dự kiến đến" / "giờ dự kiến về").
      //
      // Giờ đã xin là MỐC MỚI, và dung sai `lateGraceMinutes` tính từ mốc đó — y như từ giờ vào ca
      // khi không có đơn. Bỏ dung sai ở đây thì người XIN PHÉP bị phạt nặng hơn người không xin:
      // không đơn, đến 08:14 (ca 07:45, muộn 29′) ⇒ không cờ; có đơn đến 08:30 mà tới 08:32 ⇒ cờ đỏ.
      const muonDuocDuyet =
        iCum === 0 && denLuc !== null && firstIn !== undefined && firstIn <= denLuc + rules.lateGraceMinutes;
      if (iCum === 0 && denLuc !== null && firstIn !== undefined && firstIn > blk.start) {
        lateApprovedMinutes = Math.max(0, Math.min(firstIn, denLuc) - blk.start);
      }
      if (firstIn !== undefined) {
        // Độ trễ THÔ của đoạn ĐẦU ca — ghi bất kể dung sai. `lateMinutes` bên dưới chỉ cộng
        // khi đã vượt `lateGraceMinutes` (mặc định 30′), nên tự nó không trả lời được câu
        // "trễ quá 15 phút mấy lần" mà nội quy hỏi. Chỉ tính đoạn đầu: về trễ sau nghỉ trưa
        // là chuyện khác, gộp vào là đổi nghĩa của "đi trễ".
        if (iCum === 0 && firstIn > blk.start) {
          arrivalDeltaMinutes = firstIn - blk.start;
        }
        if (firstIn > blk.start + rules.lateGraceMinutes) {
          // Đến trong khung đã xin ⇒ cờ RIÊNG (thông tin), không phải `DI_MUON` — mọi chỗ đếm vi
          // phạm (màu ô, cột "số lần đi muộn") đọc `DI_MUON` nên tự miễn, không phải sửa từng nơi.
          // `lateMinutes` vẫn ghi đủ: BA 4.6 "không xoá dữ liệu đi muộn".
          flags.add(muonDuocDuyet ? "DI_MUON_DA_DUYET" : "DI_MUON");
          lateMinutes += firstIn - blk.start;
        } else if (muonDuocDuyet) {
          // Trong dung sai VÀ có đơn: không nhắc "đến sát giờ" — người ta đã báo trước.
        } else if (firstIn > blk.start) {
          // Đến SAU giờ bắt đầu nhưng trong dung sai: chỉ nhắc, không tính muộn. Đến trước
          // giờ (kể cả sát 1–2′) không gắn cờ — "có mặt trước ca 10′" là lời nhắc trong tin
          // 19:00 (`shift.earlyArrivalMinutes`), không phải tiêu chí phạt.
          flags.add("DEN_SAT_GIO");
          missedEarlyArrival = true;
        }
      }
      const lastOut = outs.filter((m) => m >= blk.start && m <= blk.end + gap).sort((x, y) => y - x)[0];
      const laCumCuoi = iCum === cumKyVong.length - 1;
      // Đối xứng với đi muộn: dung sai tính từ giờ đã xin về.
      const somDuocDuyet =
        laCumCuoi && veLuc !== null && lastOut !== undefined && lastOut >= veLuc - rules.lateGraceMinutes;
      if (laCumCuoi && veLuc !== null && lastOut !== undefined && lastOut < blk.end) {
        earlyLeaveApprovedMinutes = Math.max(0, blk.end - Math.max(lastOut, veLuc));
      }
      if (lastOut !== undefined && lastOut < blk.end - rules.lateGraceMinutes) {
        flags.add(somDuocDuyet ? "VE_SOM_DA_DUYET" : "VE_SOM");
        earlyLeaveMinutes += blk.end - lastOut;
      }
    }
    // Thiếu quá 60′ so với kế hoạch (có lượt mà giờ thật hụt hẳn) — chỉ cờ, không trừ công.
    if (hasAnyLog && expectedMinutes > 0 && workedMinutes < expectedMinutes - 60) flags.add("THIEU_GIO");
  }

  // OT (đợt 4): khung đã duyệt × cặp vào–ra đã đóng, bỏ phần trùng giờ ca (`tang-ca.ts`). Chỉ ở
  // nhánh CA LÀM VIỆC: đơn OT bị chặn ở ngày không ca / ngày lễ (những ngày đó là "làm ngày nghỉ").
  const tangCa = tinhTangCa({
    khungDuyet: input.nguCanhDon.tangCa,
    capDaDong: pairedIntervals,
    gioCa: planned,
    lamTronPhut: rules.otRoundingMinutes,
  });
  if (tangCa.otApprovedMinutes > 0) flags.add("TANG_CA_DUYET");
  // Quỹ nghỉ bù: tính RIÊNG từng khung OT mang tỉ lệ quy đổi chụp lúc duyệt (đơn duyệt khi chính sách
  // là trả tiền thì không có mặt ở đây — đổi chính sách về sau KHÔNG biến OT đã trả tiền thành nghỉ bù).
  const otCompMinutes = input.nguCanhDon.tangCaNghiBu.reduce((s, x) => {
    const r = tinhTangCa({ khungDuyet: [x.khung], capDaDong: pairedIntervals, gioCa: planned, lamTronPhut: rules.otRoundingMinutes });
    return s + Math.round(r.otPayableMinutes * x.tyLe);
  }, 0);

  // Công theo ca — đếm theo kế hoạch (T-01); giờ chỉ để đối chiếu. Nghỉ một phần ca: công thường
  // là phần KHÔNG nghỉ; phần nghỉ có lương đi vào `leaveUnits` (giống ô P của nghỉ cả ngày).
  const lam2 = (x: number) => Math.round(x * 100) / 100;
  const dayCreditEarned = tiLeNghi > 0 ? lam2(dayCreditExpected * (1 - tiLeNghi)) : dayCreditExpected;
  const leaveUnitsCa = lam2(dayCreditExpected * nghi.tiLeCoLuong);
  const hourCredit = Math.round((workedMinutes / 60) * 100) / 100;
  void work;

  return {
    exempt: false,
    // Nghỉ phủ trọn ca (nghỉ bù cả ngày) ⇒ ngày nghỉ, như ô P.
    dayType: phutCa > 0 && phutNghi >= phutCa ? "LEAVE" : "WORK",
    expectedMinutes,
    workedMinutes,
    paidBreakMinutes,
    rawPairedMinutes,
    amExpected,
    amWorked,
    pmExpected,
    pmWorked,
    lateMinutes,
    arrivalDeltaMinutes,
    earlyLeaveMinutes,
    lateApprovedMinutes,
    earlyLeaveApprovedMinutes,
    ...tangCa,
    otCompMinutes,
    // Ngày lễ CÓ ca đã trả ở nhánh lễ phía trên; tới đây là ngày làm bình thường — đơn làm ngày nghỉ
    // không duyệt được cho ngày này, nhưng đơn cũ / dữ liệu lạ vẫn mang số đã tính, không nuốt.
    holidayWorkMinutes: base.holidayWorkMinutes,
    restDayWorkMinutes: base.restDayWorkMinutes,
    lamNgayNghiCompMinutes: base.lamNgayNghiCompMinutes,
    missedEarlyArrival,
    dayCreditExpected,
    dayCreditEarned,
    hourCredit,
    leaveUnits: leaveUnits + leaveUnitsCa,
    holidayPaidUnits: 0,
    pairs: paired.pairs,
    flags: [...flags].sort(),
    ruleSnapshot: { ...snapshot, planned, expectedMinutes, khungNghi: nghi.khung },
  };
}

/** Tiện ích: "HH:mm" → phút (để test viết cho dễ đọc). */
export const m = toMinutes;
