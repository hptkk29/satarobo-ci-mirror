// lib/cham-cong/request-effect.ts — "Duyệt đơn này sẽ đổi cái gì" nói bằng SỐ LIỆU thật.
//
// Vì sao file này tồn tại: `/don-tu` chỉ in một câu chung chung ("đổi mã ca trên lưới phân
// ca và tính lại công") nên người duyệt phải mở lưới ở tab khác mới biết đơn này biến ca
// nào thành ca nào. Ở đây tách làm hai tầng: `effectHint` giữ NGUYÊN VĂN câu cũ (5 nhánh,
// `WorkRequestReview` vẫn nhận prop đó), còn `describeEffect` dựng cột "Thay đổi" dạng
// `S → CG` từ dữ liệu đã đọc sẵn.
//
// THUẦN — KHÔNG truy vấn DB. `effectQueryPlan` nói cho màn `/don-tu` biết phải nạp gì
// (WU-12 đọc qua `scopedDb`), `effectSummaries` nhận kết quả đã nạp rồi ánh xạ về từng đơn.
// Tách vậy để cột này test được mà không cần Postgres, và để lib không kéo Prisma vào.
import { vnParts, vnYmd } from "@/lib/time/vn";
import { WORK_REQUEST_KINDS } from "@/lib/work-request";
import { cheDoChoDon, chuanHoaMoc, kiemDanhSachMoc, moTaMoc, soMocCuaCa } from "./sua-gio-quet";

/** Chỗ thiếu dữ liệu in dấu hỏi chứ không in "—": người duyệt phải thấy là CHƯA BIẾT. */
const UNKNOWN = "?";

/** Ô lưới còn trống. KHÁC "chưa biết": đây là trạng thái BÌNH THƯỜNG — duyệt vẫn ghi được ca
 *  vào ô trống. In "?" cho nó là nói dối theo hướng xấu: cả cột hoá `? → ?` và người duyệt
 *  đọc ra "trang hỏng" thay vì "người này chưa có ca ngày đó". */
const NO_SHIFT = "chưa xếp";

/** Lượt quét chưa có trong ngày. Cũng là trạng thái thật, không phải lỗi đọc. */
const NO_TAP = "chưa quét";

/** Số ngày của đơn khoảng (bao gồm cả hai đầu). Thiếu mốc ⇒ 1 ngày. */
export function leaveDayCount(fromDate: Date | null, toDate: Date | null): number {
  if (!fromDate || !toDate) return 1;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
}

// ─── Tầng 1: câu mô tả hệ quả (giữ nguyên văn bản cũ) ────────────────────────────────

export type EffectHintRow = {
  kind: string;
  targetUserId: string | null;
  toDate: Date | null;
  fromDate: Date | null;
};

/**
 * Nguyên văn 5 nhánh của `effectHint` cũ trong `app/(admin)/admin/don-tu/page.tsx`.
 *
 * @deprecated 06/10/2026 — màn `/don-tu` nay in câu "Khi duyệt sẽ: …" từ `khiDuyetSe`
 * (`lib/cham-cong/tom-tat-don.ts`), nói bằng dữ liệu của chính đơn (mã ca, người, số lượt quét)
 * và đúng nhánh người-nhận-không-chọn-ca. Giữ hàm vì bộ test ghim nguyên văn; đừng dùng mới.
 */
export function effectHint(r: EffectHintRow): string | null {
  switch (r.kind) {
    case "CLASS_OFF":
      return "huỷ buổi học của lớp trong ngày (sinh buổi bù theo luật lớp)";
    case "SUB_TEACH":
      return "gán giáo viên dạy thay cho buổi đó";
    case "SHIFT_SWAP":
      return `đổi mã ca trên lưới phân ca${r.targetUserId ? " cho cả hai người" : ""} và tính lại công`;
    case "LEAVE":
      return `ghi mã nghỉ lên lưới cho ${leaveDayCount(r.fromDate, r.toDate)} ngày${r.targetUserId ? ", xếp ca người làm thay" : ""}`;
    case "TIMESHEET_FIX":
      return "ghi mốc giờ chỉnh tay (đủ bộ mốc của ca thì thay hẳn lượt quét cũ) và tính lại công ngày đó";
    default:
      return null;
  }
}

// ─── Tầng 2: cột "Thay đổi" ──────────────────────────────────────────────────────────

/** `warning` = đơn KHUYẾT tới mức bấm Duyệt sẽ ném lỗi (`lib/cham-cong/requests.ts` chặn ở
 *  transaction). Nói trước ở cột "Thay đổi" rẻ hơn nhiều so với để người duyệt bấm rồi ăn
 *  một hộp lỗi đỏ và không hiểu vì sao. */
export type EffectTone = "default" | "muted" | "warning";

/** `code` = mã ghi lên lưới nếu duyệt — hộp xác nhận in "Ghi {code} cho …". Không phải
 *  loại đơn nào cũng ghi một mã (chỉnh công ghi mốc giờ) nên nó tuỳ chọn. */
export type EffectSummary = {
  text: string;
  code?: string;
  tone: EffectTone;
  /**
   * Lý do bấm Duyệt sẽ NÉM LỖI (`decide()` chặn trong transaction). Chỉ đặt cho đơn chắc chắn
   * hỏng, KHÔNG đặt cho đơn chỉ đáng ngờ: nghỉ thiếu loại nghỉ vẫn áp được (ghi mã không lương),
   * nên nó mang tone `warning` mà `blocked` rỗng.
   *
   * Panel chi tiết dùng nó để thay câu "Duyệt đơn này sẽ: …" — không có nó thì màn vừa cảnh báo
   * "duyệt sẽ báo lỗi" vừa hứa việc duyệt sẽ làm, ngay cạnh một nút Duyệt đậm mời bấm.
   */
  blocked?: string;
};

/** Dữ liệu đã nạp sẵn cho MỘT đơn. Mọi trường nullable: đơn cũ/dữ liệu khuyết vẫn phải in được. */
export type EffectInput = {
  kind: string;
  fromDate: Date | null;
  toDate: Date | null;
  /** Tên người nhận (đổi ca hai chiều / dạy thay). */
  targetUserName: string | null;
  /** Mã ca ACTIVE của NGƯỜI NỘP trên lưới ngày `fromDate` (null = chưa xếp ca). */
  currentCode: string | null;
  /** Mã ca ACTIVE của NGƯỜI NHẬN cùng ngày. */
  targetCurrentCode: string | null;
  /** Mã ca mới người nộp xin — `WorkRequest.requesterNewTemplateId` → `ShiftTemplate.code`. */
  requesterNewCode: string | null;
  /** Mã ca người nhận sẽ giữ — `targetNewTemplateId`; bỏ trống = đổi thẳng lấy ca người nộp. */
  targetNewCode: string | null;
  /** Mã loại nghỉ — `leaveTypeId` → `LeaveType.code`. */
  leaveCode: string | null;
  /** Lượt quét ĐẦU/CUỐI CÒN TÍNH trong ngày (`LUOT_CON_TINH` — không đếm lượt đã bị thay). */
  currentIn: Date | null;
  currentOut: Date | null;
  /**
   * Giờ đề nghị trên đơn, vốn đã là "HH:mm": `requestedInAt`/`requestedOutAt` (Vào 1 / Ra 1) và
   * `requestedIn2At`/`requestedOut2At` (Vào 2 / Ra 2 — 06/10/2026).
   */
  requestedIn: string | null;
  requestedOut: string | null;
  requestedIn2: string | null;
  requestedOut2: string | null;
  /**
   * `ShiftAssignment.soCapQuetKyVong` của người nộp ngày đó (null = chưa xếp ca). Quyết đơn
   * chỉnh công sẽ GHI ĐÈ hay GHI THÊM khi duyệt — cột phải nói trước, đúng luật `requests.ts`
   * dùng (`cheDoChoDon`), không đoán lại ở đây.
   */
  soCapQuetKyVong: number | null;
  className: string | null;
  /** Giờ trên đơn (OT · đi muộn/về sớm · làm từ xa · nghỉ theo giờ). */
  startTime: string | null;
  endTime: string | null;
  /** `WorkRequest.detail` — "Đi muộn" / "Về sớm"… */
  detail: string | null;
  /** Nghỉ / nghỉ bù (đợt 7–8). NULL = cả ngày. */
  leaveDurationType: string | null;
};

const PHAN_NGHI: Record<string, string> = {
  HALF_DAY_AM: "nửa buổi sáng",
  HALF_DAY_PM: "nửa buổi chiều",
};
function phanNghi(i: Pick<EffectInput, "leaveDurationType" | "startTime" | "endTime">): string | null {
  if (i.leaveDurationType === "HOURLY") return `${i.startTime ?? "?"}–${i.endTime ?? "?"}`;
  return PHAN_NGHI[i.leaveDurationType ?? ""] ?? null;
}

function hhmm(d: Date | null): string {
  if (!d) return NO_TAP;
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function trimmed(v: string | null): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/**
 * Cột "Thay đổi". Trả `null` khi `kind` không thuộc 10 loại đơn đang có (dữ liệu lạ —
 * để chỗ gọi tự quyết in gì), còn loại hợp lệ mà không đổi lịch thì nói thẳng
 * "Chỉ đổi trạng thái" với tông xám.
 */
export function describeEffect(input: EffectInput): EffectSummary | null {
  switch (input.kind) {
    case "SHIFT_SWAP": {
      const from = trimmed(input.currentCode) ?? NO_SHIFT;
      const newCode = trimmed(input.requesterNewCode);
      // Không có mã ca mới thì `templateCode()` trả null và `decide()` ném "Mã ca mới không
      // còn trong danh mục" — đơn này KHÔNG duyệt được, nói thẳng thay vì vẽ "? → ?".
      if (!newCode) {
        return {
          text: "Thiếu mã ca mới — duyệt sẽ báo lỗi",
          tone: "warning",
          blocked: "đơn không ghi mã ca mới, nên không có gì để ghi lên lưới",
        };
      }
      let text = `${from} → ${newCode}`;
      const who = trimmed(input.targetUserName);
      if (who) {
        const tFrom = trimmed(input.targetCurrentCode) ?? NO_SHIFT;
        const tTo = trimmed(input.targetNewCode);
        // ĐẢO 06/10/2026 (luật 12): bản cũ in "đổi thẳng — người nhận lấy ca người nộp" khi đơn
        // không khai ca cho người nhận. Đường duyệt KHÔNG làm vậy: `decideRequest` chỉ ghi ca cho
        // người nhận khi có `targetNewTemplateId` — thiếu là lịch họ GIỮ NGUYÊN. Cột nói đúng điều đó.
        text += tTo ? ` · ${who}: ${tFrom} → ${tTo}` : ` · ${who}: giữ ${tFrom}`;
      }
      return { text, code: newCode, tone: "default" };
    }
    case "LEAVE": {
      const from = trimmed(input.currentCode) ?? NO_SHIFT;
      const leave = trimmed(input.leaveCode);
      const days = leaveDayCount(input.fromDate, input.toDate);
      // Đợt 7 — nghỉ một phần ca KHÔNG ghi ô P/X: ca giữ nguyên, chỉ khung nghỉ được miễn chấm.
      const phan = phanNghi(input);
      if (phan) {
        if (!leave) return { text: `Thiếu loại nghỉ · ${phan}`, tone: "warning" };
        return { text: `${from} giữ nguyên · nghỉ ${phan} (${leave})`, tone: "default" };
      }
      // Nghỉ KHÔNG chọn loại vẫn duyệt được — `decide()` ghi mã "X" (không lương). Nó không
      // ném lỗi, nhưng rơi vào nhánh bất lợi cho người nộp mà không ai bấm chọn ⇒ cảnh báo.
      // CỐ Ý không đoán "P"/"X" ở đây: luật trả lương nằm ở `requests.ts`, chép sang lớp
      // hiển thị là hai nơi cùng giữ một luật rồi trôi ra khỏi nhau.
      if (!leave) return { text: `Thiếu loại nghỉ · ${days} ngày`, tone: "warning" };
      return { text: `${from} → ${leave} · ${days} ngày`, code: leave, tone: "default" };
    }
    case "TIMESHEET_FIX": {
      const moc = chuanHoaMoc([input.requestedIn, input.requestedOut, input.requestedIn2, input.requestedOut2]);
      // Không có giờ nào để ghi ⇒ `decide()` ném "Đơn không có giờ vào/ra để ghi".
      if (moc.length === 0) {
        return {
          text: "Thiếu giờ vào/ra — duyệt sẽ báo lỗi",
          tone: "warning",
          blocked: "đơn không ghi giờ vào lẫn giờ ra, nên không có mốc giờ nào để ghi",
        };
      }
      // Chế độ do ĐÚNG hàm `requests.ts` dùng lúc duyệt quyết — người duyệt phải biết trước
      // bấm Duyệt sẽ THAY lượt quét cũ hay chỉ THÊM mốc (06/10/2026).
      const cheDo = cheDoChoDon(moc, soMocCuaCa(input.soCapQuetKyVong));
      // Đơn cũ (trước khi nộp có kiểm thứ tự) có thể mang mốc lộn — `decide()` sẽ ném. Ngày nào
      // cũng được: phép kiểm chỉ so thứ tự trong cùng một ngày.
      const kiem = kiemDanhSachMoc(input.fromDate ?? new Date(0), moc, cheDo);
      if (!kiem.ok) {
        return { text: "Mốc giờ sai thứ tự — duyệt sẽ báo lỗi", tone: "warning", blocked: kiem.error };
      }
      const cur = `${hhmm(input.currentIn)}→${hhmm(input.currentOut)}`;
      if (cheDo === "GHI_DE") {
        const cap: string[] = [];
        for (let i = 0; i < moc.length; i += 2) cap.push(`${moc[i]}→${moc[i + 1] ?? UNKNOWN}`);
        return { text: `${cur} ⇒ ghi đè ${cap.join(" · ")}`, tone: "default" };
      }
      return { text: `${cur} ⇒ thêm ${moTaMoc(moc)}`, tone: "default" };
    }
    case "CLASS_OFF": {
      const cls = trimmed(input.className);
      return { text: cls ? `Huỷ buổi · ${cls}` : "Huỷ buổi dạy", tone: "default" };
    }
    case "SUB_TEACH": {
      const who = trimmed(input.targetUserName);
      const cls = trimmed(input.className);
      // Thiếu người dạy thay ⇒ handler `duyetDayThay` NÉM ⇒ `decideRequest` rollback
      // ⇒ đơn quay về chờ duyệt (06/10/2026: trước đây cột vẫn in "Dạy thay" như đơn lành).
      if (!who) {
        return {
          text: cls ? `Thiếu người dạy thay · ${cls}` : "Thiếu người dạy thay — duyệt sẽ báo lỗi",
          tone: "warning",
          blocked: "đơn chưa chọn người dạy thay, nên không có ai để gán vào buổi học",
        };
      }
      const parts = [`Dạy thay: ${who}`];
      if (cls) parts.push(cls);
      return { text: parts.join(" · "), tone: "default" };
    }
    // ── Đợt 2, 4–8: các loại nay CÓ hệ quả — không được rơi vào "Chỉ đổi trạng thái" (luật 12). ──
    case "LATE_EARLY": {
      const gio = trimmed(input.startTime);
      return { text: `Miễn trừ ${(trimmed(input.detail) ?? "đi muộn / về sớm").toLowerCase()}${gio ? ` tới ${gio}` : ""} trong khung đã xin`, tone: "default" };
    }
    case "OT": {
      const tu = trimmed(input.startTime);
      const den = trimmed(input.endTime);
      if (!tu || !den) {
        return { text: "Thiếu giờ tăng ca — duyệt sẽ báo lỗi", tone: "warning", blocked: "đơn không có đủ giờ bắt đầu / kết thúc" };
      }
      return { text: `OT ${tu}–${den} · trả theo chấm công thực tế`, tone: "default" };
    }
    case "REMOTE": {
      const days = leaveDayCount(input.fromDate, input.toDate);
      const khung = trimmed(input.startTime) && trimmed(input.endTime) ? ` (${input.startTime}–${input.endTime})` : "";
      return { text: `Làm từ xa ${days} ngày${khung} · ca giữ nguyên`, tone: "default" };
    }
    case "BUSINESS_TRIP":
      return { text: `Lịch công tác ${leaveDayCount(input.fromDate, input.toDate)} ngày · không cần xếp ca`, tone: "default" };
    case "COMP_LEAVE":
      return { text: `Trừ quỹ nghỉ bù · ${phanNghi(input) ?? "cả ngày"} · ca ${trimmed(input.currentCode) ?? NO_SHIFT}`, tone: "default" };
    case "HOLIDAY_WORK":
    case "OUTSIDE_ATTENDANCE": {
      const tu = trimmed(input.startTime);
      const den = trimmed(input.endTime);
      if (!tu || !den) {
        return { text: "Thiếu khung giờ — duyệt sẽ báo lỗi", tone: "warning", blocked: "đơn không có đủ giờ bắt đầu / kết thúc" };
      }
      return input.kind === "HOLIDAY_WORK"
        ? { text: `Làm ngày nghỉ / lễ ${tu}–${den} · tính theo chấm công thực tế`, tone: "default" }
        : { text: `Chấm ngoài địa điểm ${tu}–${den} · ca giữ nguyên`, tone: "default" };
    }
    default:
      return (WORK_REQUEST_KINDS as readonly string[]).includes(input.kind)
        ? { text: "Chỉ đổi trạng thái", tone: "muted" }
        : null;
  }
}

// ─── Nạp dữ liệu: kế hoạch đọc + ánh xạ kết quả ──────────────────────────────────────

/** Khoá tra cứu (người × ngày). Dùng chung cho lưới ca và lượt quét để hai bản đồ không lệch. */
export function effectKey(userId: string, workDate: Date): string {
  return `${userId}|${vnYmd(workDate)}`;
}

/** Trường tối thiểu của một dòng `WorkRequest` để lập kế hoạch đọc. */
export type EffectQueryRow = {
  id: string;
  kind: string;
  requesterId: string;
  targetUserId: string | null;
  fromDate: Date | null;
  requesterNewTemplateId: string | null;
  targetNewTemplateId: string | null;
  leaveTypeId: string | null;
};

export type EffectQueryPlan = {
  /** `user.findMany({ id: { in } })` — tên người nhận. */
  userIds: string[];
  /** `shiftTemplate.findMany({ id: { in } })` — mã ca mới. */
  templateIds: string[];
  /** `leaveType.findMany({ id: { in } })` — mã loại nghỉ. */
  leaveTypeIds: string[];
  /** `shiftAssignment` status ACTIVE — mã ca ĐANG có của cặp (người, ngày). */
  shiftKeys: { userId: string; workDate: Date }[];
  /** `staffTimeLog` CÒN TÍNH (`LUOT_CON_TINH`) — lượt đầu/cuối của cặp (người, ngày). Chỉ đơn chỉnh công. */
  timeLogKeys: { userId: string; workDate: Date }[];
};

/**
 * Cần biết ca đang xếp: đổi ca (cả hai người), nghỉ phép (người nộp), và chỉnh công (người nộp —
 * số cặp quét của ca quyết ghi đè hay ghi thêm, 06/10/2026).
 */
const NEEDS_SHIFT = new Set(["SHIFT_SWAP", "LEAVE", "TIMESHEET_FIX", "COMP_LEAVE"]);

export function effectQueryPlan(rows: readonly EffectQueryRow[]): EffectQueryPlan {
  const userIds = new Set<string>();
  const templateIds = new Set<string>();
  const leaveTypeIds = new Set<string>();
  const shift = new Map<string, { userId: string; workDate: Date }>();
  const taps = new Map<string, { userId: string; workDate: Date }>();

  for (const r of rows) {
    if (r.targetUserId) userIds.add(r.targetUserId);
    if (r.requesterNewTemplateId) templateIds.add(r.requesterNewTemplateId);
    if (r.targetNewTemplateId) templateIds.add(r.targetNewTemplateId);
    if (r.leaveTypeId) leaveTypeIds.add(r.leaveTypeId);
    if (!r.fromDate) continue;
    if (NEEDS_SHIFT.has(r.kind)) {
      shift.set(effectKey(r.requesterId, r.fromDate), { userId: r.requesterId, workDate: r.fromDate });
      if (r.kind === "SHIFT_SWAP" && r.targetUserId) {
        shift.set(effectKey(r.targetUserId, r.fromDate), { userId: r.targetUserId, workDate: r.fromDate });
      }
    }
    if (r.kind === "TIMESHEET_FIX") {
      taps.set(effectKey(r.requesterId, r.fromDate), { userId: r.requesterId, workDate: r.fromDate });
    }
  }

  return {
    userIds: [...userIds],
    templateIds: [...templateIds],
    leaveTypeIds: [...leaveTypeIds],
    shiftKeys: [...shift.values()],
    timeLogKeys: [...taps.values()],
  };
}

/** Kết quả đã nạp. Khoá của 2 bản đồ theo ngày phải dựng bằng `effectKey`. */
export type EffectLookups = {
  userNameById: ReadonlyMap<string, string>;
  templateCodeById: ReadonlyMap<string, string>;
  leaveCodeById: ReadonlyMap<string, string>;
  shiftCodeByUserDay: ReadonlyMap<string, string>;
  /** `ShiftAssignment.soCapQuetKyVong` theo (người, ngày) — cùng câu đọc với `shiftCodeByUserDay`. */
  soCapByUserDay: ReadonlyMap<string, number>;
  tapsByUserDay: ReadonlyMap<string, { first: Date | null; last: Date | null }>;
};

/** Dòng đơn đủ để dựng `EffectInput` (kế hoạch đọc + phần chỉ đọc trên chính bản ghi). */
export type EffectSummaryRow = EffectQueryRow & {
  toDate: Date | null;
  className: string | null;
  requestedInAt: string | null;
  requestedOutAt: string | null;
  requestedIn2At: string | null;
  requestedOut2At: string | null;
  startTime: string | null;
  endTime: string | null;
  detail: string | null;
  leaveDurationType: string | null;
};

/** `Map<WorkRequest.id, EffectSummary>` — loại đơn lạ bị bỏ khỏi map (chỗ gọi in "—"). */
export function effectSummaries(
  rows: readonly EffectSummaryRow[],
  lookups: EffectLookups,
): Map<string, EffectSummary> {
  const out = new Map<string, EffectSummary>();
  for (const r of rows) {
    const dayKey = r.fromDate ? effectKey(r.requesterId, r.fromDate) : null;
    const targetKey = r.fromDate && r.targetUserId ? effectKey(r.targetUserId, r.fromDate) : null;
    const taps = dayKey ? lookups.tapsByUserDay.get(dayKey) : undefined;
    const summary = describeEffect({
      kind: r.kind,
      fromDate: r.fromDate,
      toDate: r.toDate,
      targetUserName: (r.targetUserId ? lookups.userNameById.get(r.targetUserId) : null) ?? null,
      currentCode: (dayKey ? lookups.shiftCodeByUserDay.get(dayKey) : null) ?? null,
      targetCurrentCode: (targetKey ? lookups.shiftCodeByUserDay.get(targetKey) : null) ?? null,
      requesterNewCode:
        (r.requesterNewTemplateId ? lookups.templateCodeById.get(r.requesterNewTemplateId) : null) ?? null,
      targetNewCode:
        (r.targetNewTemplateId ? lookups.templateCodeById.get(r.targetNewTemplateId) : null) ?? null,
      leaveCode: (r.leaveTypeId ? lookups.leaveCodeById.get(r.leaveTypeId) : null) ?? null,
      currentIn: taps?.first ?? null,
      currentOut: taps?.last ?? null,
      requestedIn: r.requestedInAt,
      requestedOut: r.requestedOutAt,
      requestedIn2: r.requestedIn2At,
      requestedOut2: r.requestedOut2At,
      soCapQuetKyVong: (dayKey ? lookups.soCapByUserDay.get(dayKey) : null) ?? null,
      className: r.className,
      startTime: r.startTime,
      endTime: r.endTime,
      detail: r.detail,
      leaveDurationType: r.leaveDurationType,
    });
    if (summary) out.set(r.id, summary);
  }
  return out;
}
