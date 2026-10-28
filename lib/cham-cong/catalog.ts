// lib/cham-cong/catalog.ts — Danh mục 21 mã ca theo tab DANH MỤC CA của Sheet lịch phân ca
// (29/08/2026). THUẦN — không DB. Đây là dữ liệu SEED NỀN chạy 1 lần (prisma/seed-cham-cong.ts);
// sau đó nguồn sự thật là bảng `ShiftTemplate` và người vận hành sửa trên màn danh mục
// (PHẦN 6b). Engine tính công đọc `segments`, không đọc file này.
//
// Giờ kế hoạch theo Sheet (K-01 "theo Sheet", chốt 05/09): S 07:45–11:30 · C 13:45–17:30 ·
// T 17:15–21:00 (C/T chồng 15′ — ghép cặp theo thứ tự lượt, không theo "gần mốc nhất").
// CS nghỉ giữa giờ 16:30–17:00 TÍNH công (PAID_BREAK). Mọi mã làm việc = 1 công; X/P = 0.

export type SegmentKind = "WORK" | "PAID_BREAK";

/** Nơi làm của một đoạn ca. `HOME` = cơ sở của đơn vị người đó trên Sheet. */
export type PlaceToken =
  | "HOME"
  | `CENTER:${string}`
  | "ANY_CENTER"
  | "ASSIGNED"
  | "OFFSITE"
  | "ANYWHERE";

export type ShiftSegment = {
  /** "HH:mm" giờ VN. */
  start: string;
  end: string;
  kind: SegmentKind;
  /** Bỏ trống = theo `defaultPlace` của mã. */
  place?: PlaceToken;
};

export type ShiftTemplateKindT = "TIMED" | "LOCATION_ONLY" | "FLEXIBLE" | "OFF" | "LEAVE";
export type AttendanceModeT = "REQUIRED" | "OPTIONAL" | "NONE";
export type PayModeT = "SHIFT" | "ADMIN_HOURS" | "NONE";

export type CatalogEntry = {
  code: string;
  name: string;
  kind: ShiftTemplateKindT;
  segments: ShiftSegment[];
  defaultPlace: PlaceToken;
  attendanceMode: AttendanceModeT;
  dayCredit: number;
  isLeave: boolean;
  nominalMinutes: number | null;
  payMode: PayModeT;
  /**
   * Số CẶP QUÉT kỳ vọng trong ngày. Nguồn sự thật là `docs/cham-cong/BANG-MA-CA-CHOT.md`
   * (chốt 09/09/2026); `catalog.test.ts` canh hai bên khớp nhau, lệch một bên là ĐỎ.
   *
   * | | |
   * |---|---|
   * | `0` | KHÔNG kiểm quét, KHÔNG cờ thiếu lượt (`LD` `D1` `D2` `P` `X`) |
   * | `1` | gom MỌI đoạn WORK thành MỘT cụm — vào = `start` đoạn đầu, ra = `end` đoạn cuối |
   * | `2` | HAI cụm, cắt ở KHOẢNG HỞ LỚN NHẤT; mỗi cụm một cặp mốc riêng (`ST`) |
   *
   * ⚠️ VÌ SAO CẦN CỘT NÀY thay vì cứ suy từ đoạn WORK như hôm nay: engine gộp cụm bằng
   * `mergeIntervals`, tức theo TÍNH LIỀN KỀ. Nó ra đúng kết quả nhưng VÌ LÝ DO KHÁC —
   * khoảng nghỉ-không-tính hiện không thuộc đoạn nào nên tự nhiên tách cụm. Ngày thêm
   * `UNPAID_BREAK` (đợt sau) thì khoảng ấy thành một đoạn THẬT, `mergeIntervals` nối liền
   * hai bên lại, và `ST` tụt từ 2 cụm xuống 1 mà KHÔNG ca test nào đỏ.
   *
   * ⚠️ CỐ Ý KHÔNG có mặc định trong `timed()` — luật 7. Mỗi mã phải tự khai, và `tsc`
   * liệt kê chỗ nào quên. Mặc định (kể cả mặc định "an toàn" = 1) là cách chắc chắn để
   * một mã mới mang giá trị không ai chọn cho nó.
   */
  soCapQuetKyVong: 0 | 1 | 2;
  /** Cột hiển thị cho màn danh mục — chép nguyên chữ Sheet. */
  amStart?: string;
  amEnd?: string;
  pmStart?: string;
  pmEnd?: string;
  pmBreakStart?: string;
  pmBreakEnd?: string;
  note?: string;
  displayOrder: number;
};

const W = (start: string, end: string, place?: PlaceToken): ShiftSegment =>
  place ? { start, end, kind: "WORK", place } : { start, end, kind: "WORK" };
const BREAK = (start: string, end: string): ShiftSegment => ({ start, end, kind: "PAID_BREAK" });

function timed(
  code: string,
  name: string,
  segments: ShiftSegment[],
  // `soCapQuetKyVong` BẮT BUỘC, phần còn lại tuỳ chọn — xem chú thích ở `CatalogEntry`.
  extra: Partial<CatalogEntry> & Pick<CatalogEntry, "soCapQuetKyVong">,
): CatalogEntry {
  const am = segments.filter((s) => toMinutes(s.start) < 12 * 60);
  const pm = segments.filter((s) => toMinutes(s.start) >= 12 * 60);
  return {
    code,
    name,
    kind: "TIMED",
    segments,
    defaultPlace: "HOME",
    attendanceMode: "REQUIRED",
    dayCredit: 1,
    isLeave: false,
    nominalMinutes: null,
    payMode: "SHIFT",
    amStart: am[0]?.start,
    amEnd: am.length ? am[am.length - 1].end : undefined,
    pmStart: pm[0]?.start,
    pmEnd: pm.length ? pm[pm.length - 1].end : undefined,
    displayOrder: 0,
    ...extra,
  };
}

/**
 * Thứ tự = thứ tự dòng trên tab DANH MỤC CA (thêm mã mới thì thêm cuối, không chèn giữa).
 *
 * ⚠️ NGUỒN SỰ THẬT của `dayCredit` và giờ/nghỉ là bảng chốt 09/09/2026 ở
 * `docs/cham-cong/BANG-MA-CA-CHOT.md`. Ca test `catalog.test.ts` đối chiếu file này với
 * bảng đó — lệch là ĐỎ, không phải đợi ai phát hiện bằng mắt.
 *
 * ⚠️ `seedShiftTemplates` chỉ ghi đè khi `--force`. Nên sửa ở đây KHÔNG tự đổi prod; và
 * ngược lại, chỉnh tay trên prod KHÔNG tự về đây. Đối chiếu định kỳ bằng mục V10 của
 * `scripts/do-khung-ca-diem-cham.ts`.
 */
const RAW_CATALOG: CatalogEntry[] = [
  timed("CG", "Ca gãy", [W("09:00", "11:30"), W("14:00", "17:45")], { soCapQuetKyVong: 1 }),
  timed(
    "CS",
    "Ca suốt",
    [W("14:00", "16:30"), BREAK("16:30", "17:00"), W("17:00", "21:00")],
    {
      soCapQuetKyVong: 1,
      pmStart: "14:00",
      pmEnd: "21:00",
      pmBreakStart: "16:30",
      pmBreakEnd: "17:00",
      note: "Nghỉ giữa giờ 16:30–17:00, tính vào giờ làm",
    },
  ),
  timed("CCT", "Ca cuối tuần", [W("07:45", "11:30"), W("13:45", "17:45")], { soCapQuetKyVong: 1 }),
  timed("CGD", "Ca gãy dài", [W("09:00", "11:30"), W("13:30", "19:15")], { soCapQuetKyVong: 1 }),
  {
    code: "D1",
    soCapQuetKyVong: 0, // nhãn NƠI LÀM, không phải ca có giờ
    name: "Làm tại Cơ sở 1",
    kind: "LOCATION_ONLY",
    segments: [],
    defaultPlace: "CENTER:CS1",
    attendanceMode: "OPTIONAL",
    dayCredit: 1,
    isLeave: false,
    nominalMinutes: null,
    payMode: "SHIFT",
    note: "Ô con trỏ — lưới tháng gộp vào ô cùng ngày ở khối Cơ sở 1",
    displayOrder: 0,
  },
  {
    code: "D2",
    soCapQuetKyVong: 0, // nhãn NƠI LÀM, không phải ca có giờ
    name: "Làm tại Cơ sở 2",
    kind: "LOCATION_ONLY",
    segments: [],
    defaultPlace: "CENTER:CS2",
    attendanceMode: "OPTIONAL",
    dayCredit: 1,
    isLeave: false,
    nominalMinutes: null,
    payMode: "SHIFT",
    note: "Ô con trỏ — lưới tháng gộp vào ô cùng ngày ở khối Cơ sở 2",
    displayOrder: 0,
  },
  timed("HC", "Giờ hành chính", [W("08:00", "11:30", "ASSIGNED"), W("13:30", "17:30", "ASSIGNED")], {
    // ĐẢO 1 → 2 ngày 22/09/2026 theo chốt của chủ dự án: giờ hành chính chấm SÁNG và CHIỀU
    // RIÊNG (quét ra nghỉ trưa, quét vào đầu giờ chiều). Trước đó khai 1 ⇒ mọi đoạn WORK gom
    // một cụm, vào = 08:00, ra = 17:30, và nghỉ trưa không bị đòi mốc nào.
    //
    // ⚠️ Con số này còn phải khớp cột "Cặp quét" của `docs/cham-cong/BANG-MA-CA-CHOT.md` —
    // `catalog.test.ts` đối chiếu từng mã, sửa một bên là đỏ (đúng ý đồ của cổng đó).
    //
    // ⚠️ `12` `21` `2C` cùng hình dạng giờ nhưng VẪN khai 1 — cố ý, chủ dự án chỉ chốt HC.
    // `12`/`21` đổi cơ sở giữa ngày nên chúng là ứng viên rõ ràng của lượt sau; đừng đổi kèm
    // mà không hỏi, vì nó đổi cách tính công của người đang chạy kỳ.
    soCapQuetKyVong: 2,
    defaultPlace: "ASSIGNED",
    payMode: "ADMIN_HOURS",
    note: "Nơi làm theo phân công (HO)",
  }),
  timed("12", "Sáng CS1 · Chiều CS2", [W("08:00", "11:30", "CENTER:CS1"), W("13:30", "17:30", "CENTER:CS2")], { soCapQuetKyVong: 1 }),
  timed("21", "Sáng CS2 · Chiều CS1", [W("08:00", "11:30", "CENTER:CS2"), W("13:30", "17:30", "CENTER:CS1")], { soCapQuetKyVong: 1 }),
  timed("2C", "Cả 2 cơ sở", [W("08:00", "11:30", "ANY_CENTER"), W("13:30", "17:30", "ANY_CENTER")], {
    soCapQuetKyVong: 1,
    defaultPlace: "ANY_CENTER",
  }),
  timed("S", "Ca sáng", [W("07:45", "11:30")], { dayCredit: 0.5, soCapQuetKyVong: 1 }),
  timed("C", "Ca chiều", [W("13:45", "17:30")], { dayCredit: 0.5, soCapQuetKyVong: 1 }),
  timed("T", "Ca tối", [W("17:15", "21:00")], { dayCredit: 0.5, soCapQuetKyVong: 1 }),
  timed("SC", "Ca sáng + chiều", [W("07:45", "11:30"), W("13:45", "17:30")], { soCapQuetKyVong: 1 }),
  timed("ST", "Ca sáng + tối", [W("07:45", "11:30"), W("17:15", "21:00")], { soCapQuetKyVong: 2 }),
  timed(
    "CT",
    "Ca chiều + tối",
    [W("13:45", "16:30"), BREAK("16:30", "17:30"), W("17:30", "21:00")],
    {
      soCapQuetKyVong: 1,
      pmStart: "13:45",
      pmEnd: "21:00",
      pmBreakStart: "16:30",
      pmBreakEnd: "17:30",
      note: "Nghỉ giữa giờ 16:30–17:30, TÍNH vào giờ làm",
    },
  ),
  timed(
    "SCT",
    "Ca sáng + chiều + tối",
    [
      W("07:45", "11:30"),
      W("13:45", "16:30"),
      BREAK("16:30", "17:30"),
      W("17:30", "21:00"),
    ],
    {
      soCapQuetKyVong: 1,
      dayCredit: 1.5,
      pmStart: "13:45",
      pmEnd: "21:00",
      pmBreakStart: "16:30",
      pmBreakEnd: "17:30",
      note: "Nghỉ giữa giờ 16:30–17:30, TÍNH vào giờ làm",
    },
  ),
  {
    code: "LD",
    soCapQuetKyVong: 0, // linh động — không kiểm quét
    name: "Linh động",
    kind: "FLEXIBLE",
    segments: [],
    defaultPlace: "ANYWHERE",
    attendanceMode: "OPTIONAL",
    dayCredit: 1,
    isLeave: false,
    nominalMinutes: null, // T-03: 1 công, 0 giờ
    payMode: "SHIFT",
    note: "Không nhất thiết đến Trung tâm",
    displayOrder: 0,
  },
  timed("NG", "Công tác ngoài", [W("08:00", "11:30", "OFFSITE"), W("13:30", "17:30", "OFFSITE")], {
    // ĐẢO 15/09/2026 (phần A): 1 công / 0 cặp quét → 1 công / **1 CẶP QUÉT**.
    //
    // Hai vế phải đi CÙNG NHAU, và cùng với hai nút Check in/out ở màn "Của tôi":
    //   · `soCapQuetKyVong: 1` một mình KHÔNG đổi gì — cổng ngoài của engine là
    //     `attendanceMode === "REQUIRED"`, nên ca OPTIONAL không chạy nhánh kiểm nào;
    //   · `attendanceMode: "REQUIRED"` một mình là đòi quét mà chưa có nút để bấm.
    //
    // Đo prod 15/09 TRƯỚC khi đảo (`viec = ngay-cong-tac`): 0 ô ca công tác đã xếp,
    // 0 ngày công mã công tác ⇒ KHÔNG ngày quá khứ nào bị gắn cờ oan. Đó là lý do đảo
    // được ngay mà không cần một lượt xử lý quá khứ.
    soCapQuetKyVong: 1,
    defaultPlace: "OFFSITE",
    attendanceMode: "REQUIRED",
    nominalMinutes: 450,
  }),
  {
    code: "X",
    soCapQuetKyVong: 0, // ngày nghỉ — không kiểm quét
    name: "Nghỉ",
    kind: "OFF",
    segments: [],
    defaultPlace: "HOME",
    attendanceMode: "NONE",
    dayCredit: 0,
    isLeave: false,
    nominalMinutes: null,
    payMode: "NONE",
    displayOrder: 0,
  },
  {
    code: "P",
    soCapQuetKyVong: 0, // ngày nghỉ — không kiểm quét
    name: "Nghỉ phép",
    kind: "LEAVE",
    segments: [],
    defaultPlace: "HOME",
    attendanceMode: "NONE",
    dayCredit: 0,
    isLeave: true,
    nominalMinutes: null,
    payMode: "NONE",
    displayOrder: 0,
  },
];

export const SHIFT_CATALOG: readonly CatalogEntry[] = RAW_CATALOG.map((e, i) => ({ ...e, displayOrder: i + 1 }));

export const SHIFT_CODES: readonly string[] = SHIFT_CATALOG.map((e) => e.code);

export function catalogByCode(code: string): CatalogEntry | undefined {
  return SHIFT_CATALOG.find((e) => e.code === code);
}

/** "HH:mm" → phút từ 00:00. Ném lỗi nếu sai định dạng (dữ liệu danh mục là do người nhập). */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Giờ không hợp lệ: "${hhmm}" (cần HH:mm)`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new Error(`Giờ không hợp lệ: "${hhmm}"`);
  return h * 60 + mi;
}

/** Giờ kế hoạch của một mã = tổng WORK + PAID_BREAK (phút). Mã không giờ → nominalMinutes ?? 0. */
export function plannedMinutes(entry: Pick<CatalogEntry, "segments" | "nominalMinutes">): number {
  if (entry.segments.length === 0) return entry.nominalMinutes ?? 0;
  return entry.segments.reduce((sum, s) => sum + (toMinutes(s.end) - toMinutes(s.start)), 0);
}

export type SegmentIssue = { index: number; message: string };

/**
 * Luật cấu trúc segments (Zod của màn danh mục gọi hàm này): tăng dần, không qua đêm,
 * PAID_BREAK phải kẹp giữa hai WORK, không chồng nhau trong cùng mã.
 */
export function validateSegments(segments: ShiftSegment[]): SegmentIssue[] {
  const issues: SegmentIssue[] = [];
  let prevEnd = -1;
  segments.forEach((s, i) => {
    let start: number;
    let end: number;
    try {
      start = toMinutes(s.start);
      end = toMinutes(s.end);
    } catch (e) {
      issues.push({ index: i, message: (e as Error).message });
      return;
    }
    if (end <= start) issues.push({ index: i, message: "Giờ kết thúc phải sau giờ bắt đầu (không qua đêm)" });
    if (start < prevEnd) issues.push({ index: i, message: "Đoạn ca chồng lên đoạn trước" });
    if (s.kind === "PAID_BREAK") {
      const before = segments[i - 1];
      const after = segments[i + 1];
      if (!before || before.kind !== "WORK" || !after || after.kind !== "WORK") {
        issues.push({ index: i, message: "Nghỉ giữa giờ tính công phải nằm giữa hai đoạn làm việc" });
      } else if (before.end !== s.start || after.start !== s.end) {
        issues.push({ index: i, message: "Nghỉ giữa giờ phải nối liền với hai đoạn làm việc" });
      }
    }
    prevEnd = Math.max(prevEnd, end);
  });
  return issues;
}

/** Mã đơn ⊂ mã ghép theo Sheet (SC = S; C …) — dùng cho gợi ý và cho export ngược. */
export const COMPOSITE_CODES: Readonly<Record<string, readonly string[]>> = {
  SC: ["S", "C"],
  ST: ["S", "T"],
  CT: ["C", "T"],
  SCT: ["S", "C", "T"],
};

/** Danh mục loại nghỉ (K-06 theo MISA) — seed nền 1 lần, sửa trên màn CRUD. */
export const LEAVE_TYPE_CATALOG: readonly {
  code: string;
  name: string;
  paidRatio: number;
  maxDaysPerYear: number | null;
  countsAsWorked: boolean;
  /** Ngày phải báo trước. null = không đòi (việc đột xuất, không ai hẹn trước được). */
  noticeDays: number | null;
}[] = [
  // `noticeDays` mặc định 1 ngày theo yêu cầu chủ dự án 06/09 ("phải xin nghỉ trước 1 ngày"),
  // TRỪ ba loại về bản chất không báo trước được. Người vận hành sửa từng dòng ở màn Loại nghỉ.
  { code: "NGHI_PHEP", name: "Nghỉ phép năm", paidRatio: 1, maxDaysPerYear: null, countsAsWorked: false, noticeDays: 1 },
  { code: "KHONG_LUONG", name: "Nghỉ không lương", paidRatio: 0, maxDaysPerYear: 10, countsAsWorked: false, noticeDays: 1 },
  { code: "KET_HON", name: "Nghỉ kết hôn", paidRatio: 1, maxDaysPerYear: 7, countsAsWorked: false, noticeDays: 7 },
  { code: "CON_KET_HON", name: "Nghỉ con kết hôn", paidRatio: 1, maxDaysPerYear: 3, countsAsWorked: false, noticeDays: 7 },
  // Ba loại dưới đây KHÔNG đặt hạn báo trước — người ta không hẹn trước được ngày mất, ngày ốm.
  { code: "MA_CHAY", name: "Nghỉ ma chay", paidRatio: 1, maxDaysPerYear: 3, countsAsWorked: false, noticeDays: null },
  { code: "BHXH", name: "Nghỉ hưởng BHXH (ốm)", paidRatio: 0, maxDaysPerYear: null, countsAsWorked: false, noticeDays: null },
  { code: "THAI_SAN", name: "Nghỉ thai sản", paidRatio: 0, maxDaysPerYear: 180, countsAsWorked: false, noticeDays: null },
  { code: "NGHI_BU", name: "Nghỉ bù", paidRatio: 1, maxDaysPerYear: null, countsAsWorked: true, noticeDays: 1 },
];

// ── Danh mục LOẠI CÔNG DẠY (đợt 2, 07/09/2026) ──────────────────────────────────────────
//
// Seed nền chạy MỘT LẦN rồi buông: sau đó nguồn sự thật là bảng `TeachingCreditType`, người
// vận hành sửa hệ số và bật/tắt ở màn Công dạy — không cần lập trình viên. Chạy lại có
// `--force` mới ghi đè.
//
// Giá trị mặc định giữ ĐÚNG hành vi đang chạy để bật tính năng không làm đổi số của ai:
// chỉ lớp chính đang được đếm (`period.ts` đếm buổi COMPLETED quy về người dạy), nên ba loại
// còn lại để `countsInPeriod: false` — vẫn liệt kê để theo dõi, chưa cộng vào tổng. BLĐ muốn
// tính thì bật lên, đó chính là "dự phòng" mà chủ dự án yêu cầu.
export const TEACHING_CREDIT_CATALOG: {
  code: string;
  name: string;
  source: "CLASS" | "TRIAL" | "MAKEUP";
  role: "MAIN" | "SUBSTITUTE" | "ASSISTANT";
  basis: "PER_SESSION" | "PER_HOUR";
  factor: number;
  countsInPeriod: boolean;
}[] = [
  { code: "LOP_CHINH", name: "Lớp chính — giáo viên đứng lớp", source: "CLASS", role: "MAIN", basis: "PER_SESSION", factor: 1, countsInPeriod: true },
  { code: "DAY_THAY", name: "Lớp chính — dạy thay", source: "CLASS", role: "SUBSTITUTE", basis: "PER_SESSION", factor: 1, countsInPeriod: true },
  { code: "TRO_GIANG", name: "Lớp chính — trợ giảng", source: "CLASS", role: "ASSISTANT", basis: "PER_SESSION", factor: 0.5, countsInPeriod: false },
  { code: "TN_CHINH", name: "Trải nghiệm — người dạy", source: "TRIAL", role: "MAIN", basis: "PER_SESSION", factor: 1, countsInPeriod: false },
  { code: "TN_THAY", name: "Trải nghiệm — dạy thay", source: "TRIAL", role: "SUBSTITUTE", basis: "PER_SESSION", factor: 1, countsInPeriod: false },
  { code: "TN_TRO_GIANG", name: "Trải nghiệm — trợ giảng", source: "TRIAL", role: "ASSISTANT", basis: "PER_SESSION", factor: 0.5, countsInPeriod: false },
  // Học bù (29/09/2026, docs/hoc-bu/DAC-TA.md): case dạy bù mang PHÂN LOẠI BUỔI (mặc định `BU`),
  // nên BLĐ thêm được dòng riêng theo phân loại ngay trên màn. Dòng này là dòng BAO SÂN của
  // nguồn MAKEUP. Mặc định KHÔNG cộng vào kỳ — buổi bù là buổi trách nhiệm (PL04 §A.1.b), giống
  // Trải nghiệm; BLĐ muốn tính thì bật lên.
  { code: "HB_CHINH", name: "Học bù — người dạy", source: "MAKEUP", role: "MAIN", basis: "PER_SESSION", factor: 1, countsInPeriod: false },
];

/**
 * PHÂN LOẠI BUỔI — SR.QD.230 PL03 §4 (hệ số 100% / 75% / 120% theo loại buổi).
 *
 * Đây là danh mục MỞ: người vận hành thêm/sửa trên màn `/cham-cong/phan-loai-buoi`. Bảy dòng dưới
 * đây chỉ là điểm khởi hành để BLĐ không phải gõ từ số không.
 *
 * `TRIAL` CỐ Ý KHÔNG có trong danh sách: buổi trải nghiệm là model riêng (`TrialClassSession`),
 * đã được `TeachingCreditSource.TRIAL` phân biệt. Thêm một dòng TRIAL ở đây nữa là hai đường
 * cùng nói một chuyện, và sớm muộn hai đường lệch nhau.
 *
 * `countsTowardQuota` = buổi TRÁCH NHIỆM của GV cơ hữu (PL04 §A.1.b: Trial/Bù/Vượt/Hỗ trợ ĐT&VH
 * nằm trong lương cơ bản, chỉ phần VƯỢT định mức 50/30/20 mới được 80.000đ/buổi). ⚠️ Cột này
 * hiện chỉ LƯU — chưa có bộ đếm định mức nào đọc nó, vì đó là phần TIỀN và tiền chưa chốt.
 */
export const SESSION_CATEGORY_CATALOG: {
  code: string;
  name: string;
  isDefault: boolean;
  countsTowardQuota: boolean;
}[] = [
  { code: "CHINH_THUC", name: "Học chính thức", isDefault: true, countsTowardQuota: false },
  { code: "COACH", name: "Lớp Coach (1-1, 1-2, 1-4)", isDefault: false, countsTowardQuota: false },
  { code: "BU", name: "Học bù", isDefault: false, countsTowardQuota: true },
  { code: "VUOT", name: "Học vượt", isDefault: false, countsTowardQuota: true },
  { code: "WORKSHOP", name: "Workshop", isDefault: false, countsTowardQuota: false },
  { code: "SU_KIEN", name: "Sự kiện", isDefault: false, countsTowardQuota: false },
  { code: "HO_TRO_DT_VH", name: "Hỗ trợ Đào tạo & Vận hành", isDefault: false, countsTowardQuota: true },
];
