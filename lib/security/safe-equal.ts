import { timingSafeEqual } from "crypto";

/**
 * So sánh chuỗi thời-gian-hằng (constant-time) cho secret/token — chống timing side-channel.
 * SEC-L02. Trả về false ngay nếu khác độ dài (timingSafeEqual yêu cầu buffer cùng độ dài;
 * độ dài của secret không phải bí mật cần bảo vệ).
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
