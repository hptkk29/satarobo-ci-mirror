// components/chat/portal/format.ts — hiển thị thời gian chat theo ĐỒNG HỒ VN.
//
// ⚠️ TZ landmine: Vercel chạy UTC, máy dev +07. `toLocaleString("vi-VN")` trên server
// in ra giờ UTC ⇒ phụ huynh thấy tin "gửi lúc 02:15" cho tin gửi lúc 09:15. Mọi mốc
// giờ ở màn chat đi qua `lib/time/vn.ts` (thuần, không phụ thuộc TZ tiến trình).
//
// Tất cả hàm ở đây TẤT ĐỊNH theo `value` (không đọc `Date.now()` ẩn) nên server và
// client render ra CÙNG một chuỗi — không có hydration mismatch.

import { vnParts, vnYmd } from "@/lib/time/vn";

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "HH:mm" theo giờ VN. */
export function formatVnClock(value: Date | string | number): string {
  const p = vnParts(toDate(value));
  return `${two(p.hour)}:${two(p.minute)}`;
}

/** "dd/MM HH:mm" — mốc giờ trên từng tin nhắn (luôn tuyệt đối, không "x phút trước"). */
export function formatChatTimestamp(value: Date | string | number): string {
  const p = vnParts(toDate(value));
  return `${two(p.day)}/${two(p.month + 1)} ${two(p.hour)}:${two(p.minute)}`;
}

/** "dd/MM/yyyy" — dải ngăn ngày trong luồng. */
export function formatVnDate(value: Date | string | number): string {
  const p = vnParts(toDate(value));
  return `${two(p.day)}/${two(p.month + 1)}/${p.year}`;
}

/**
 * Mốc giờ trong DANH SÁCH hội thoại: hôm nay chỉ hiện giờ, khác ngày hiện ngày/tháng,
 * khác năm hiện đủ năm — để dòng không bị dài trên màn 360px.
 */
export function formatConversationTime(
  value: Date | string | number,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (vnYmd(d) === vnYmd(now)) return formatVnClock(d);
  const p = vnParts(d);
  const nowParts = vnParts(now);
  return p.year === nowParts.year
    ? `${two(p.day)}/${two(p.month + 1)}`
    : `${two(p.day)}/${two(p.month + 1)}/${p.year}`;
}
