// lib/working-hours/rules.ts — LÕI tính "giờ làm việc" (Q-C, 19/08/2026).
//
// THUẦN: không import Prisma, không "server-only" ⇒ test bằng Vitest không cần Postgres.
// Tầng đọc DB nằm ở `./service.ts`.
//
// ┌─ 4 quy ước phải nhớ, sai một cái là lệch âm thầm ────────────────────────────┐
// │ 1. THỨ: 0 = Chủ nhật … 6 = Thứ Bảy — khớp `Date.getDay()` / `vnWeekday()` và  │
// │    khớp luôn cột `WorkingHourRule.weekday`, nên không phải quy đổi ở đâu cả.  │
// │                                                                              │
// │ 2. GIỜ VN, KHÔNG phải giờ máy chạy. Vercel/CI chạy UTC, máy dev chạy +07 —    │
// │    dùng `getHours()`/`new Date(y,m,d,h)` là lỗi "chạy máy tôi thì được"       │
// │    (đúng cái bug sinh buổi học lệch 1 ngày, 06/08/2026). Mọi phép tính ở đây  │
// │    đi qua `@/lib/time/vn`.                                                    │
// │                                                                              │
// │ 3. KHOẢNG NỬA MỞ [open, close): đúng phút mở là ĐANG làm việc, đúng phút đóng │
// │    là ĐÃ NGHỈ. Nhờ vậy `elapsedBusinessMs` cộng liền mạch qua nhiều ngày mà   │
// │    không đếm trùng phút giao, và 21:00 không bị coi là "còn trong giờ" khiến  │
// │    thông báo bắn ra lúc nhân viên đã về.                                       │
// │                                                                              │
// │ 4. Cửa sổ NẰM GỌN trong một ngày (close > open). Sata Robo mở 07:45–21:00,    │
// │    không có ca đêm. Dòng khai `close <= open` bị coi là DỮ LIỆU HỎNG và bị bỏ │
// │    qua (xem `isUsableDay`) — đoán thành "qua nửa đêm" là tự chế nghiệp vụ     │
// │    chưa ai duyệt.                                                             │
// └──────────────────────────────────────────────────────────────────────────────┘
//
// ⚠️ VÌ SAO ENGINE KHÔNG TỰ ĐỌC BẢNG `Holiday`:
// `Holiday` khoá theo `centerId`, còn `WorkingHourRule` khoá theo `orgUnitId` — HAI TRỤC
// KHÁC NHAU (và `Center("hoi-so")` đang mồ côi, không OrgUnit nào trỏ tới). Bắc cầu hai
// trục đó ngay trong engine là chôn một chỗ sai âm thầm: nghỉ lễ của cơ sở này lặng lẽ áp
// cho đơn vị khác mà không ai thấy. ⇒ NGƯỜI GỌI tự nạp ngày nghỉ rồi truyền qua
// `opts.holidayKeys`. Nguồn có sẵn: `loadHolidayKeys(centerId)` (lib/classes/phases-service)
// hoặc `expandHolidaySet(rows)` (lib/classes/schedule) — cả hai sinh khoá "YYYY-MM-DD" bằng
// `vnYmd`, ĐÚNG định dạng mà file này so sánh (khớp do cùng hàm, không phải do trùng may).

import { vnDateAt, vnParts, vnWeekday, vnYmd } from "@/lib/time/vn";

/** Nhãn thứ hiển thị trên màn cấu hình — cùng chỉ số 0=CN…6=T7 với mảng tuần. */
export const WEEKDAY_LABELS_VN = [
  "Chủ nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
] as const;

/** Giờ làm việc của MỘT thứ. `openMinute`/`closeMinute` = phút-trong-ngày giờ VN (07:45 → 465). */
export interface WorkingHourDay {
  /** Nghỉ cả ngày. Khi true thì hai mốc giờ không còn ý nghĩa. */
  isClosed: boolean;
  openMinute: number;
  closeMinute: number;
}

/** Đúng 7 mục, index = thứ (0=CN … 6=T7). Tuple để quên một thứ là đỏ ngay lúc biên dịch. */
export type WorkingHourWeek = readonly [
  WorkingHourDay,
  WorkingHourDay,
  WorkingHourDay,
  WorkingHourDay,
  WorkingHourDay,
  WorkingHourDay,
  WorkingHourDay,
];

export interface WorkingHourOpts {
  /**
   * Ngày nghỉ lễ dạng "YYYY-MM-DD" theo lịch VN — coi như đóng cửa cả ngày, bất kể
   * bảng giờ khai gì. Người gọi nạp (xem khối ⚠️ đầu file).
   */
  holidayKeys?: ReadonlySet<string>;
  /**
   * Trần vòng lặp của `nextWorkingMoment` (ngày). Mặc định 14: nghỉ lễ dài nhất trong năm
   * (Tết) vẫn lọt, mà khi bảng giờ khai NGHỈ CẢ 7 THỨ thì hàm dừng và trả null thay vì quay
   * vô hạn treo request.
   */
  maxLookaheadDays?: number;
  /**
   * Trần vòng lặp của `elapsedBusinessMs` (ngày). Mặc định 366 — mọi ngưỡng nghiệp vụ hiện
   * có tính bằng GIỜ ("chưa trả lời quá 2 giờ làm việc"), nên vượt trần thì phần đã cộng
   * chắc chắn đã lớn hơn mọi ngưỡng; không có nghiệp vụ nào hỏi "bao nhiêu giờ làm việc
   * trong 2 năm".
   */
  maxSpanDays?: number;
}

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_MAX_LOOKAHEAD_DAYS = 14;
const DEFAULT_MAX_SPAN_DAYS = 366;

/**
 * "HH:mm" (giờ VN) → phút-trong-ngày. Chuỗi rác → null (KHÔNG đoán, không tự sửa).
 *
 * Chỉ nhận đúng 2 chữ số giờ + 2 chữ số phút — trùng định dạng `<input type="time">` và
 * trùng validator giờ lớp học (`lib/validators/class.ts`), nên dữ liệu đi vòng nào cũng
 * cùng một luật. `24:00` bị từ chối: cột `closeTime` phải là mốc CÙNG NGÀY.
 */
export function parseHhMm(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Phút-trong-ngày → "HH:mm". Ngoài [0,1440) → null (để chỗ gọi không in ra "25:70"). */
export function formatHhMm(minute: number): string | null {
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) return null;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Ngày này có giờ làm việc dùng được không (mở cửa + cửa sổ hợp lệ). */
export function isUsableDay(day: WorkingHourDay): boolean {
  return (
    !day.isClosed &&
    Number.isInteger(day.openMinute) &&
    Number.isInteger(day.closeMinute) &&
    day.openMinute >= 0 &&
    day.closeMinute <= MINUTES_PER_DAY &&
    day.closeMinute > day.openMinute
  );
}

/** Dựng đủ 7 mục — annotation tuple ép TypeScript bắt lỗi nếu thiếu/thừa thứ. */
export function buildWeek(pick: (weekday: number) => WorkingHourDay): WorkingHourWeek {
  return [pick(0), pick(1), pick(2), pick(3), pick(4), pick(5), pick(6)];
}

/** Ngày nghỉ (dùng chung cho "nghỉ Thứ Hai" lẫn ngày lễ). */
export const CLOSED_DAY: WorkingHourDay = { isClosed: true, openMinute: 0, closeMinute: 0 };

/** Cửa sổ giờ làm việc THẬT của ngày VN cách `dayOffset` ngày so với `from`. Nghỉ → null. */
function windowOfDay(
  from: Date,
  dayOffset: number,
  week: WorkingHourWeek,
  holidayKeys: ReadonlySet<string> | undefined,
): { openAt: Date; closeAt: Date } | null {
  const p = vnParts(from);
  // `vnDateAt` đi qua `Date.UTC` nên `day + offset` tự bắc cầu tháng/năm, và `minute` vượt
  // 59 cũng tự dồn sang giờ — không phải chia lấy dư ở đây.
  const dayStart = vnDateAt(p.year, p.month, p.day + dayOffset);
  if (holidayKeys?.has(vnYmd(dayStart))) return null;

  const day = week[vnWeekday(dayStart)];
  if (!isUsableDay(day)) return null;

  return {
    openAt: vnDateAt(p.year, p.month, p.day + dayOffset, 0, day.openMinute),
    closeAt: vnDateAt(p.year, p.month, p.day + dayOffset, 0, day.closeMinute),
  };
}

/** Thời điểm `date` có nằm trong giờ làm việc không (giờ VN, khoảng nửa mở `[open, close)`). */
export function isWorkingTime(
  date: Date,
  week: WorkingHourWeek,
  opts?: WorkingHourOpts,
): boolean {
  const w = windowOfDay(date, 0, week, opts?.holidayKeys);
  if (!w) return false;
  return date >= w.openAt && date < w.closeAt;
}

/**
 * Mốc làm việc GẦN NHẤT tính từ `date` trở đi.
 *
 * - Đang trong giờ → trả chính `date` (thông báo phát ngay, không hoãn).
 * - Ngoài giờ / ngày nghỉ / ngày lễ → trả 00:00-giờ-mở của ngày làm việc kế tiếp.
 * - Quét hết `maxLookaheadDays` mà không có ngày nào mở → **null**. Chỗ gọi PHẢI xử lý null
 *   (giữ tin lại / gửi thẳng), đừng ép `!` — bảng giờ khai nghỉ cả tuần là chuyện có thật
 *   khi người vận hành gõ nhầm, và vòng lặp không trần sẽ treo cứng request.
 */
export function nextWorkingMoment(
  date: Date,
  week: WorkingHourWeek,
  opts?: WorkingHourOpts,
): Date | null {
  const maxDays = opts?.maxLookaheadDays ?? DEFAULT_MAX_LOOKAHEAD_DAYS;
  for (let i = 0; i <= maxDays; i++) {
    const w = windowOfDay(date, i, week, opts?.holidayKeys);
    if (!w) continue;
    if (date < w.openAt) return w.openAt;
    if (date < w.closeAt) return new Date(date.getTime());
    // Đã quá giờ đóng của ngày này → xét ngày kế.
  }
  return null;
}

/**
 * Số mili-giây GIỜ LÀM VIỆC giữa `from` và `to` (bỏ ngoài giờ, ngày nghỉ, ngày lễ).
 *
 * `from >= to` → 0, KHÔNG trả số âm: chỗ dùng là các phép so ngưỡng ("quá 2 giờ làm việc"),
 * số âm ở đó chỉ tạo ra so sánh vô nghĩa mà không ai phát hiện.
 */
export function elapsedBusinessMs(
  from: Date,
  to: Date,
  week: WorkingHourWeek,
  opts?: WorkingHourOpts,
): number {
  if (!(to > from)) return 0;

  const maxDays = opts?.maxSpanDays ?? DEFAULT_MAX_SPAN_DAYS;
  const p = vnParts(from);
  let total = 0;
  for (let i = 0; i < maxDays; i++) {
    const w = windowOfDay(from, i, week, opts?.holidayKeys);
    if (w) {
      const start = from > w.openAt ? from : w.openAt;
      const end = to < w.closeAt ? to : w.closeAt;
      if (end > start) total += end.getTime() - start.getTime();
    }
    // Điều kiện dừng đặt SAU phần cộng và kiểm cả khi ngày này nghỉ: nếu chỉ dừng lúc gặp
    // ngày mở cửa thì một chuỗi ngày nghỉ ở cuối khoảng sẽ quét tới hết trần vô ích.
    if (vnDateAt(p.year, p.month, p.day + i + 1) >= to) break;
  }
  return total;
}

// ─── Suy bảng tuần từ các dòng cấu hình (thuần, để test không cần DB) ───────────────

/** Một dòng `WorkingHourRule` — khai lại tối giản để file này không phải import Prisma. */
export interface WorkingHourRuleRow {
  /** OrgUnit.id hoặc "*" (mọi đơn vị). */
  orgUnitId: string;
  /** RoleDef.code hoặc "*" (mọi vai). */
  roleCode: string;
  /** 0=CN … 6=T7. */
  weekday: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

/** Sentinel "mọi đơn vị" / "mọi vai". Dùng "*" thay NULL để `@@unique` chặn được bản trùng. */
export const WILDCARD = "*";

/** Giờ mặc định do chủ dự án chốt 19/08/2026: T3–CN 07:45–21:00, nghỉ Thứ Hai. */
const DEFAULT_OPEN_MINUTE = 7 * 60 + 45;
const DEFAULT_CLOSE_MINUTE = 21 * 60;
const DEFAULT_CLOSED_WEEKDAY = 1; // Thứ Hai

/**
 * LƯỚI CUỐI khi DB chưa có dòng nào — KHÔNG PHẢI nơi để chỉnh giờ.
 *
 * Chủ dự án chốt "quản trị tự chỉnh trên web chứ không sửa code": muốn đổi giờ thì thêm/sửa
 * dòng `WorkingHourRule`. Hằng số này chỉ tồn tại để hệ thống vẫn chạy đúng nghiệp vụ trong
 * khoảng thời gian bảng còn trống (và để test có mốc so). Sửa ở đây = số liệu thật của từng
 * cơ sở (chủ dự án sẽ cung cấp sau) sẽ bị một giá trị hardcode đè lên trong đầu người đọc code.
 */
export const DEFAULT_WORKING_HOUR_WEEK: WorkingHourWeek = buildWeek((weekday) =>
  weekday === DEFAULT_CLOSED_WEEKDAY
    ? CLOSED_DAY
    : { isClosed: false, openMinute: DEFAULT_OPEN_MINUTE, closeMinute: DEFAULT_CLOSE_MINUTE },
);

/**
 * Bậc ưu tiên của một dòng với cặp (đơn vị, vai) đang hỏi. Không khớp → null (bỏ dòng).
 *
 * 0 = (đơn vị, vai) · 1 = (đơn vị, *) · 2 = (*, vai) · 3 = (*, *). Số NHỎ thắng.
 */
function tierOf(row: WorkingHourRuleRow, orgUnitId: string, roleCode: string): number | null {
  const org = row.orgUnitId === orgUnitId ? 0 : row.orgUnitId === WILDCARD ? 1 : null;
  const role = row.roleCode === roleCode ? 0 : row.roleCode === WILDCARD ? 1 : null;
  if (org === null || role === null) return null;
  return org * 2 + role;
}

/** Dòng DB → mục trong tuần. Dòng hỏng (mở cửa mà thiếu/sai giờ) → null để rơi xuống bậc sau. */
function rowToDay(row: WorkingHourRuleRow): WorkingHourDay | null {
  if (row.isClosed) return CLOSED_DAY;
  const openMinute = parseHhMm(row.openTime);
  const closeMinute = parseHhMm(row.closeTime);
  if (openMinute === null || closeMinute === null || closeMinute <= openMinute) return null;
  return { isClosed: false, openMinute, closeMinute };
}

/**
 * Suy bảng tuần từ các dòng cấu hình, RƠI DẦN THEO TỪNG THỨ (không phải cả tuần).
 *
 * Vì sao theo từng thứ: một đơn vị có thể chỉ muốn khai riêng Thứ Bảy (mở sớm hơn) và để 6
 * thứ còn lại theo mặc định. Chọn "cả tuần" thì khai 1 thứ sẽ vô tình xoá sổ 6 thứ kia.
 *
 * Dòng KHÔNG PARSE ĐƯỢC bị bỏ qua như thể chưa khai (rơi xuống bậc sau) chứ không bị hiểu
 * thành "nghỉ": một ô giờ gõ sai không được phép âm thầm đóng cửa cả cơ sở.
 */
export function resolveWorkingHourWeek(
  rows: readonly WorkingHourRuleRow[],
  orgUnitId: string | null,
  roleCode?: string | null,
): WorkingHourWeek {
  const org = orgUnitId ?? WILDCARD;
  const role = roleCode ?? WILDCARD;

  const best = new Map<number, { tier: number; day: WorkingHourDay }>();
  for (const row of rows) {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) continue;
    const tier = tierOf(row, org, role);
    if (tier === null) continue;
    const day = rowToDay(row);
    if (!day) continue;
    const cur = best.get(row.weekday);
    if (!cur || tier < cur.tier) best.set(row.weekday, { tier, day });
  }

  return buildWeek((weekday) => best.get(weekday)?.day ?? DEFAULT_WORKING_HOUR_WEEK[weekday]);
}
