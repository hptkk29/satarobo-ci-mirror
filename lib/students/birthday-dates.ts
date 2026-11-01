// Sinh nhật học viên — TOÀN BỘ phần tính ngày tháng, tách riêng để test bằng Vitest
// mà không cần DB. Không import Prisma, không "server-only".
//
// ┌─ Vì sao phải cẩn thận ở đây ──────────────────────────────────────────────┐
// │ Repo có HAI quy ước lưu ngày khác nhau, trộn vào nhau là lệch đúng 1 ngày: │
// │                                                                            │
// │  1. `Student.dateOfBirth` — LUÔN là UTC-midnight. Mọi đường ghi đều ép:    │
// │     import Excel `Date.UTC(...)` (app/api/admin/import/students/route.ts),  │
// │     form `<input type="date">` → `z.coerce.date()` ("2015-05-20" → UTC).    │
// │     Code hiển thị đang chạy đọc bằng `getUTCFullYear()`                     │
// │     (teacher/lop/_components/hub-students-tab.tsx:109) ⇒ ta cũng phải trích │
// │     tháng/ngày bằng getUTC*, đổi sang giờ VN riêng chỗ này là lệch với      │
// │     phần đang hiển thị cho giáo viên.                                       │
// │                                                                            │
// │  2. `ClassSession.date` — sinh bằng `new Date(y, m, d)`                     │
// │     (lib/classes/schedule.ts:32), tức nửa đêm theo giờ MÁY TẠO: UTC trên     │
// │     Vercel, UTC+7 khi tạo từ máy local. Hai instant khác nhau cho cùng một   │
// │     ngày lịch ⇒ KHÔNG được so bằng getUTCDate().                            │
// │     May mắn là `vnDayKey()` đưa cả hai về đúng ngày lịch định nói:           │
// │       UTC-midnight 06/08 → 07:00 VN 06/08 → "2026-08-06"                     │
// │       VN-midnight  06/08 → 00:00 VN 06/08 → "2026-08-06"                     │
// │     nên buổi học LUÔN đi qua vnDayKey().                                     │
// └────────────────────────────────────────────────────────────────────────────┘

const VN_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Ngày lịch "YYYY-MM-DD" theo giờ VN của một mốc thời gian ĐÃ LƯU. */
export function vnDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: VN_TZ }).format(d);
}

/**
 * Ngày lịch "YYYY-MM-DD" của một Date được DỰNG ở UTC-midnight (ngày sinh, ngày
 * sinh nhật quy năm). Với UTC-midnight thì kết quả trùng `vnDayKey` — dùng hàm
 * riêng để chỗ gọi tự nói rõ nó đang cầm loại nào.
 */
export function dayKeyUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Dịch một ngày lịch đi `days` ngày (âm = lùi). Chuẩn hoá luôn bắc cầu tháng/năm. */
export function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return dayKeyUTC(new Date(Date.UTC(y!, m! - 1, d! + days)));
}

/** Mốc UTC của 00:00 giờ VN ngày `dayKey` — dùng làm cận truy vấn Prisma. */
export function vnDayStartUtc(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) - VN_OFFSET_MS);
}

/**
 * "YYYY-MM-DD" → "dd/MM/yyyy" để hiển thị.
 *
 * KHÔNG dùng `formatDateVN`/`formatDateDMY` cho ngày buổi học: hai hàm đó cố ý
 * không set timeZone (xem ghi chú lib/format/date.ts:4-6) nên chạy theo giờ máy.
 * Buổi học lưu ở nửa đêm giờ VN (17:00Z hôm trước) đem render trên runtime UTC
 * sẽ ra NGÀY HÔM TRƯỚC — tin nhắn báo sai ngày tổ chức. Đi từ day key đã quy đúng
 * về giờ VN thì không có chỗ để lệch.
 */
export function formatDayKeyDMY(dayKey: string): string {
  const [y, m, d] = dayKey.split("-");
  return `${d}/${m}/${y}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Ngày sinh nhật rơi vào năm `year`, trả UTC-midnight.
 *
 * Sinh 29/02 mà năm xét KHÔNG nhuận → lấy **28/02**. Không được để
 * `Date.UTC(2026, 1, 29)` tự tràn sang 01/03: chúc sinh nhật sang tháng khác là
 * sai, và bé sinh 29/02 sẽ bị nhảy nhóm tháng trong mọi báo cáo.
 */
export function birthdayInYear(dob: Date, year: number): Date {
  const month = dob.getUTCMonth(); // 0-based
  const day = dob.getUTCDate();
  if (month === 1 && day === 29 && !isLeapYear(year)) {
    return new Date(Date.UTC(year, 1, 28));
  }
  return new Date(Date.UTC(year, month, day));
}

/**
 * Lần sinh nhật ĐẦU TIÊN rơi vào hoặc sau ngày `fromDayKey`.
 *
 * Bắc cầu cuối năm: quét ngày 28/12 thì sinh nhật 02/01 phải trả về năm SAU,
 * không phải năm hiện tại (đã trôi qua). `year` trả về chính là nửa còn lại của
 * khoá chống trùng `@@unique([studentId, year])`.
 */
export function nextBirthdayOccurrence(
  dob: Date,
  fromDayKey: string,
): { date: Date; year: number } {
  const fromYear = Number(fromDayKey.slice(0, 4));
  const thisYear = birthdayInYear(dob, fromYear);
  if (dayKeyUTC(thisYear) >= fromDayKey) return { date: thisYear, year: fromYear };
  const nextYear = fromYear + 1;
  return { date: birthdayInYear(dob, nextYear), year: nextYear };
}

/**
 * Sinh nhật sắp tới có nằm trong cửa sổ quét [từ hôm nay, +lookaheadDays] không?
 * Trả về chính lần sinh nhật đó, hoặc null nếu ngoài cửa sổ.
 */
export function birthdayWithinWindow(
  dob: Date,
  todayDayKey: string,
  lookaheadDays: number,
): { date: Date; year: number; dayKey: string } | null {
  const occ = nextBirthdayOccurrence(dob, todayDayKey);
  const key = dayKeyUTC(occ.date);
  if (key > shiftDayKey(todayDayKey, lookaheadDays)) return null;
  return { ...occ, dayKey: key };
}

export interface SessionCandidate {
  id: string;
  /** Mốc đã lưu của buổi học — hàm tự quy về ngày VN, đừng tự quy trước khi truyền vào. */
  date: Date;
  classId: string;
  className: string;
}

/**
 * Chọn BUỔI TỔ CHỨC sinh nhật trong số các buổi học của học viên.
 *
 * Thứ tự ưu tiên (chốt với chủ dự án 06/08/2026):
 *   1. Buổi ĐÚNG hôm sinh nhật.
 *   2. Buổi gần nhất TRƯỚC sinh nhật, trong vòng `lookbackDays` — đây chính là
 *      yêu cầu gốc "hôm đó không có lớp thì tổ chức ở buổi học trước đó".
 *   3. Buổi gần nhất SAU sinh nhật, trong vòng `forwardDays` (tổ chức bù).
 *      Chỉ chạm tới khi (1) và (2) rỗng — HV đang học mà rơi đúng đợt nghỉ lễ
 *      (bảng Holiday có thật) thì bỏ sót là mất luôn việc chăm sóc.
 *   4. Không có gì → null ⇒ chỗ gọi BỎ QUA học viên này hoàn toàn.
 */
export function pickCelebrationSession(
  sessions: SessionCandidate[],
  birthdayDayKey: string,
  opts: { lookbackDays: number; forwardDays: number },
): SessionCandidate | null {
  const minKey = shiftDayKey(birthdayDayKey, -opts.lookbackDays);
  const maxKey = shiftDayKey(birthdayDayKey, opts.forwardDays);

  let exact: SessionCandidate | null = null;
  let before: SessionCandidate | null = null;
  let beforeKey = "";
  let after: SessionCandidate | null = null;
  let afterKey = "";

  for (const s of sessions) {
    const key = vnDayKey(s.date);
    if (key === birthdayDayKey) {
      // Nhiều buổi cùng ngày (HV học 2 lớp) → lấy buổi sớm nhất trong ngày.
      if (!exact || s.date < exact.date) exact = s;
    } else if (key < birthdayDayKey && key >= minKey) {
      if (!before || key > beforeKey) {
        before = s;
        beforeKey = key;
      }
    } else if (key > birthdayDayKey && key <= maxKey) {
      if (!after || key < afterKey) {
        after = s;
        afterKey = key;
      }
    }
  }
  return exact ?? before ?? after;
}
