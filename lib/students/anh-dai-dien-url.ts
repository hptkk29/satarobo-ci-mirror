// lib/students/anh-dai-dien-url.ts — URL ảnh đại diện học viên nào được LƯU (25/09/2026).
//
// THUẦN (nhận gốc công khai của kho làm tham số) để MỌI đường ghi `Student.avatarUrl` dùng
// chung một luật: action đổi ảnh trên hồ sơ (`_anh-dai-dien-actions.ts`) và `createStudent`
// (form tạo học viên gửi `avatarUrl` qua ô ẩn — client sửa được ô đó).
//
// Chỉ nhận URL do CHÍNH route upload sinh ra (`app/api/admin/students/anh-dai-dien/route.ts`):
// gốc R2 + `/uploads/students/<yyyy-mm>/<uuid v4>.<jpg|png|webp>`. Ảnh đại diện hiện ở màn
// admin + site giáo viên; một URL tuỳ ý là ảnh theo dõi (tracking pixel) đọc được IP người
// xem, hoặc một ảnh không ai duyệt. Khuôn phải khớp khoá mà route dựng — đổi bên nào thì
// đổi bên kia.

/** Thoát ký tự đặc biệt của regex trong gốc URL (có `.`, `/`, `:`). */
function thoatRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * URL có phải ảnh đại diện do route upload của hệ thống sinh ra không. Khuôn neo `^…$`:
 * không `..`, không query, không fragment, không đuôi khác jpg/png/webp.
 */
export function laUrlAnhHocVien(url: string, goc: string): boolean {
  const khuon = new RegExp(
    `^${thoatRegex(goc)}/uploads/students/\\d{4}-\\d{2}/` +
      "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|webp)$",
  );
  return khuon.test(url);
}
