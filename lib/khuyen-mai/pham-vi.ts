// lib/khuyen-mai/pham-vi.ts — phép so cây tổ chức cho việc báo tin khuyến mãi. THUẦN.
//
// Tách khỏi `chinh-sach.ts` (file đó kéo `notifications/notify` ⇒ `server-only`, test thuần
// không nạp được).

/**
 * Người neo vai ở đơn vị có đường dẫn `duongDanNeo` có BAO TRÙM ít nhất một đơn vị đích không.
 * Đường dẫn cây dạng "/ho/danang/cs1/" — CÓ dấu "/" ở cuối, nên "/ho/danang/cs1/" không bao trùm
 * "/ho/danang/cs10/" (so tiền tố trên chuỗi thiếu dấu "/" cuối là lỗi kinh điển của path cây).
 */
export function baoTrum(duongDanNeo: string, duongDanDich: readonly string[]): boolean {
  if (!duongDanNeo.endsWith("/")) return false;
  return duongDanDich.some((d) => d.startsWith(duongDanNeo));
}
