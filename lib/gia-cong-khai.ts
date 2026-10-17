// lib/gia-cong-khai.ts — GIÁ HIỂN THỊ CÔNG KHAI của khoá học trên `/khoa-hoc`.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao tồn tại: hướng dẫn BCT mục 4 đòi "tạm thời ẩn các sản phẩm/dịch vụ KHÔNG công
// khai giá VÀ không đặt hàng được". Với hai khoá chủ lực, chủ dự án chốt **công khai giá**
// thay vì ẩn — phá vế thứ nhất thì mục đó không còn áp dụng, và site giữ được mục khoá học.
//
// Vì sao phải là MỘT hàm dùng chung: trước 21/09/2026 cùng một trang `/khoa-hoc` in HAI
// con số khác nhau cho cùng một khoá — thẻ ghi chuỗi cứng "Liên hệ" (page.tsx), còn bảng
// so sánh cách đó ~190 dòng in "Chỉ từ 1.485.000đ" (hằng gõ tay trong cùng file). Hai chỗ
// đọc hai nguồn thì sớm muộn cũng lệch, và lệch giá là thứ cơ quan quản lý soi.
//
// ⚠️ BA NGUỒN GIÁ CÙNG TỒN TẠI, và chúng KHÔNG khớp nhau — đo 21/09/2026:
//   · DB (`Course.price`, quản trị ở /admin/courses)  → Sata1 = 2.400.000đ
//   · `components/legacy-laptrinhrobot/_data/courses-pricing.ts` → Sata1 listPrice 1.650.000đ
//   · bảng so sánh trên `/khoa-hoc`                    → 1.485.000đ (là earlyBirdPrice)
// **DB THẮNG** (chủ dự án chốt, đối chiếu màn /admin/courses). File `courses-pricing.ts`
// hiện KHÔNG in số nào ra web (mọi chỗ dùng `CONTACT_PRICE`) nên không gây mâu thuẫn công
// khai — nhưng đừng tưởng nó là nguồn giá.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Giá sàn dự phòng theo slug — CHỈ dùng khi DB chưa khai `priceDisplay` lẫn `price`.
 *
 * Có lớp này vì trang pháp lý và hồ sơ BCT không được phụ thuộc vào việc ai đó đã gõ đúng
 * một ô chữ tự do trong admin hay chưa: `Course.priceDisplay` là `String?` người vận hành
 * nhập tay, bỏ trống là thẻ rơi về "Liên hệ" — đúng trạng thái hồ sơ đang yêu cầu sửa.
 *
 * Con số = giá NIÊM YẾT của khoá nhỏ nhất trong nhóm (chủ dự án chốt "lấy giá niêm yết của
 * khoá nhỏ nhất, dạng *Chỉ từ…*"): Sata1 Robosim Master 2.400.000đ cho nhóm offline, và
 * 490.000đ cho khoá luyện thi online (khớp 9 chỗ đang in trên landing luyenthirobosim).
 */
export const GIA_SAN_THEO_SLUG: Record<string, number> = {
  laptrinhrobot: 2_400_000,
  luyenthirobosim: 490_000,
};

/** "2.400.000đ" — dấu chấm ngăn nhóm nghìn, đúng cách viết đang dùng khắp site. */
export function dinhDangTien(vnd: number): string {
  return `${vnd.toLocaleString("vi-VN")}đ`;
}

/**
 * Chuỗi giá hiển thị trên thẻ khoá học và ở hàng "Giá" của bảng so sánh.
 *
 * Thứ tự ưu tiên — mỗi bước là một câu trả lời cho "ai được quyền quyết con số này":
 *   1. `priceDisplay` do người vận hành khai ở /admin/courses (thắng tất cả);
 *   2. `price` trong DB, nếu > 0 (0đ là "chưa khai", không phải "miễn phí");
 *   3. giá sàn theo slug ở trên;
 *   4. "Liên hệ" — chỉ còn cho khoá KHÔNG nằm trong danh sách, và khoá như vậy thuộc
 *      diện phải ẩn theo hướng dẫn BCT chứ không phải diện hiển thị.
 */
export function giaHienThi(course: {
  slug: string;
  price?: number | null;
  priceDisplay?: string | null;
}): string {
  const khai = course.priceDisplay?.trim();
  // ⚠️ `priceDisplay` chỉ thắng khi nó THỰC SỰ là một mức giá — tức có ít nhất một chữ số.
  //
  // Đo 21/09/2026 trên DB: `laptrinhrobot` và `luyenthirobosim` đang mang
  // `priceDisplay = "Liên hệ tư vấn"`. Nếu cho chuỗi đó thắng thì thẻ vẫn in "Liên hệ" —
  // đúng trạng thái mà hồ sơ BCT bắt sửa — và bản vá này thành vô tác dụng mà vẫn xanh.
  // Cột đó là CHỮ TỰ DO người vận hành gõ, nên không được để nó quyết định việc tuân thủ.
  if (khai && /\d/.test(khai)) return khai;

  if (typeof course.price === "number" && course.price > 0) {
    return `Chỉ từ ${dinhDangTien(course.price)}`;
  }

  const san = GIA_SAN_THEO_SLUG[course.slug];
  if (san) return `Chỉ từ ${dinhDangTien(san)}`;

  return "Liên hệ";
}
