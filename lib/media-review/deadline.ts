// lib/media-review/deadline.ts — hạn chốt media của một buổi học.
//
// BA §7.6: mặc định 10:00 NGÀY HÔM SAU buổi học, admin sửa được. Ở repo này cấu hình
// vận hành nằm ở `SystemSetting` (key/value) chứ không có bảng `OperationSetting` riêng
// như BA phác — dùng đúng nếp sẵn có thay vì đẻ cơ chế cấu hình thứ hai.
//
// THUẦN ở phần tính toán (`deadlineFor`) để test được không cần DB.

/** Key trong `SystemSetting`. Giá trị: số nguyên 0–23 (giờ VN). */
export const MEDIA_REVIEW_DEADLINE_KEY = "media.reviewDeadlineHour";

/** 10:00 sáng hôm sau — mặc định BA chốt. */
export const MEDIA_REVIEW_DEADLINE_HOUR_DEFAULT = 10;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Hạn chốt của buổi học `sessionDate` (cột `@db.Date` = UTC 00:00 của ngày lịch VN).
 *
 * Trả về mốc UTC thật để so sánh với `new Date()` ở bất kỳ đâu.
 *
 * ⚠️ KHÔNG dùng `new Date(y, m, d, h)`: Vercel chạy UTC còn máy dev +07, hàm đó cho hai
 * kết quả khác nhau và hạn chốt lệch 7 tiếng tuỳ nơi chạy. Cộng/trừ bằng số milli.
 */
export function deadlineFor(sessionDate: Date, hourVN: number): Date {
  const gioVN = Number.isFinite(hourVN) ? Math.min(23, Math.max(0, Math.trunc(hourVN))) : MEDIA_REVIEW_DEADLINE_HOUR_DEFAULT;
  // sessionDate là UTC 00:00 của NGÀY VN ⇒ +1 ngày rồi +giờ, tất cả tính theo giờ VN,
  // cuối cùng trừ bù múi giờ để ra mốc UTC.
  const ngayHomSauVN = sessionDate.getTime() + 24 * 60 * 60 * 1000;
  return new Date(ngayHomSauVN + gioVN * 60 * 60 * 1000 - VN_OFFSET_MS);
}

/** Đã quá hạn chưa (BA §7.8: quá hạn KHÔNG khoá thao tác, chỉ đánh dấu trễ). */
export function isOverdue(deadlineAt: Date, now: Date): boolean {
  return now.getTime() > deadlineAt.getTime();
}

/** Mốc UTC 00:00 của NGÀY hôm nay theo giờ VN — khớp cột `@db.Date`. */
export function vnToday(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}

/** "2026-08-26" theo ngày lịch VN của một cột `@db.Date`. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
