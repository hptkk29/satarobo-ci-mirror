// Lịch khai trương "rolling Saturday":
// - Khai trương rơi vào Thứ 7 hằng tuần.
// - 00:00 Chủ nhật → rollover sang Thứ 7 của tuần kế tiếp.
// - Mon..Fri 23:59 → countdown đến Thứ 7 đang tới.
// - Suốt Thứ 7 → coi như khai trương "hôm nay"; countdown vẫn dương cho tới
//   Sun 00:00 (cũng là mốc rollover).
//
// Áp dụng cho: popup khai giảng, Early Bird countdown, Top countdown bar,
// SpecialOfferCountdown deadline.

/**
 * Saturday upcoming hoặc hôm nay (nếu hôm nay là Sat). Trả về Date đặt vào
 * 00:00:00 local time của ngày Thứ 7 đó.
 */
export function getNextOpeningDate(now: Date = new Date()): Date {
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysUntilSaturday = (6 - day + 7) % 7;
  const target = new Date(now);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + daysUntilSaturday);
  return target;
}

/**
 * Monday opening date — 2 ngày sau Saturday đang tới. Dùng cho đợt khai
 * giảng kỳ tiếp theo trong popup 2-batch.
 */
export function getNextMondayOpeningDate(now: Date = new Date()): Date {
  const sat = getNextOpeningDate(now);
  const mon = new Date(sat);
  mon.setDate(sat.getDate() + 2);
  return mon;
}

/**
 * Countdown target = cuối ngày Thứ 7 (tức Sun 00:00:00). Khi đồng hồ chạy
 * qua mốc này, getNextOpeningDate sẽ trả về Thứ 7 tuần sau → countdown
 * tự reset.
 */
export function getOpeningCountdownTarget(now: Date = new Date()): Date {
  const sat = getNextOpeningDate(now);
  const sunMidnight = new Date(sat);
  sunMidnight.setDate(sat.getDate() + 1);
  return sunMidnight;
}

const WEEKDAY_LABEL: Record<number, string> = {
  0: "Chủ nhật",
  1: "Thứ 2",
  2: "Thứ 3",
  3: "Thứ 4",
  4: "Thứ 5",
  5: "Thứ 6",
  6: "Thứ 7",
};

/** Format: "Thứ 7" — Vietnamese weekday name. */
export function formatVietnameseWeekday(date: Date): string {
  return WEEKDAY_LABEL[date.getDay()] ?? "";
}

/** Format: "30/5/2026" (no zero-padding for d/m). */
export function formatVietnameseDate(date: Date): string {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

/** Format: "30/05/2026" (zero-padded). */
export function formatVietnameseDateLong(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}
