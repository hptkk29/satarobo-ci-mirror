// lib/legal-pages.ts — NGUỒN DUY NHẤT của 10 chính sách bắt buộc trong hồ sơ Bộ Công Thương.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO FILE NÀY TỒN TẠI
//
// Hướng dẫn của đơn vị tư vấn BCT (`E:\websatarobo data\Satarobo.vn\0. HƯỚNG DẪN CHỈNH SỬA
// GIAO DIỆN WEB.docx`, mục 1) ghi rõ: *"Ghi ĐÚNG TÊN chính sách dưới đây"*. Mà cùng một
// trang, repo đang gọi bằng BA cái tên khác nhau ở ba chân trang:
//
//   components/sections/site-footer.tsx      → "Chính sách bảo mật"
//   components/sections/site-footer.tsx (dải cuối) → "Bảo mật"
//   components/legacy-laptrinhrobot/Footer.tsx     → "Bảo Mật"   (hoa chữ M)
//
// Ba cách viết đó sinh ra khi chỉ có 2–3 liên kết. Sắp tới là 10 liên kết × 3 chân trang ×
// sitemap = 40 chỗ chép tay. Không có nguồn chung thì lệch tên là chắc chắn, và lệch tên ở
// đây KHÔNG làm test đỏ, không ném lỗi — chỉ cán bộ tiếp nhận hồ sơ mới thấy.
//
// Nếp này chép từ `lib/locations.ts` (hằng phẳng + helper, có test kèm). `app/sitemap.ts:3`
// vốn đã import hằng slug từ ngoài (`VALID_COURSE_SLUGS`) nên đây không phải kiểu mới.
//
// ⚠️ `label` là TÊN BẮT BUỘC trong danh sách hướng dẫn — KHÔNG phải tiêu đề trong file .docx.
//    Ví dụ: file "6.1" đặt tiêu đề "CHÍNH SÁCH VỀ GIAO HÀNG", nhưng tên bắt buộc là
//    "Chính sách giao hàng" (không có chữ "về"). Sửa `label` = sửa thứ cơ quan đối chiếu.
// ─────────────────────────────────────────────────────────────────────────────

export type LegalPage = {
  /** Đường dẫn công khai, không có dấu `/` đầu. */
  slug: string;
  /** Tên hiển thị ở chân trang — ĐÚNG NGUYÊN VĂN danh sách bắt buộc của BCT. */
  label: string;
  /** Tên file .docx gốc trong bộ hồ sơ — để người sau truy ngược nguồn nội dung. */
  nguon: string;
};

/**
 * 10 chính sách bắt buộc, ĐÚNG THỨ TỰ trong file hướng dẫn.
 * Thứ tự này cũng là thứ tự hiển thị ở chân trang và ở trang mục lục `/chinh-sach`.
 */
export const LEGAL_PAGES: readonly LegalPage[] = [
  {
    slug: "chinh-sach-bao-mat",
    label: "Chính sách bảo mật",
    nguon: "1. CHÍNH SÁCH BẢO MẬT.docx",
  },
  {
    slug: "phuong-thuc-tiep-nhan-phan-anh",
    label: "Phương thức tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại",
    nguon: "2. PHƯƠNG THỨC TIẾP NHẬN VÀ GIẢI QUYẾT PHẢN ÁNH.docx",
  },
  {
    slug: "chinh-sach-gia",
    label: "Chính sách về giá",
    nguon: "3. CHÍNH SÁCH VỀ GIÁ.docx",
  },
  {
    slug: "chinh-sach-thanh-toan",
    label: "Chính sách thanh toán",
    nguon: "4. CHÍNH SÁCH THANH TOÁN.docx",
  },
  {
    slug: "cac-dieu-kien-va-han-che",
    label: "Các điều kiện và hạn chế trong việc giao hàng và cung cấp dịch vụ",
    nguon: "5. CÁC ĐIỀU KIỆN VÀ HẠN CHẾ.docx",
  },
  {
    slug: "chinh-sach-giao-hang",
    label: "Chính sách giao hàng",
    nguon: "6.1. CHÍNH SÁCH VỀ GIAO HÀNG.docx",
  },
  {
    slug: "phuong-thuc-cung-cap-dich-vu",
    label: "Phương thức cung cấp dịch vụ",
    nguon: "6.2. PHƯƠNG THỨC CUNG CẤP DỊCH VỤ.docx",
  },
  {
    // Giữ slug cũ `chinh-sach-hoan-tra`: URL này đã nằm trong sitemap và có thể đã được lập
    // chỉ mục. Hồ sơ BCT đối chiếu TÊN HIỂN THỊ, không đối chiếu slug — nên đổi `label` là đủ,
    // đổi slug chỉ đẻ thêm một URL chết.
    slug: "chinh-sach-hoan-tra",
    label: "Chính sách đổi trả hàng và hoàn tiền",
    nguon: "7.1. CHÍNH SÁCH ĐỔI TRẢ HÀNG VÀ HOÀN TIỀN.docx",
  },
  {
    slug: "chinh-sach-cham-dut-dich-vu",
    label: "Chính sách chấm dứt dịch vụ và hoàn tiền",
    nguon: "7.2. CHÍNH SÁCH CHẤM DỨT DỊCH VỤ VÀ HOÀN TIỀN.docx",
  },
  {
    slug: "quyen-va-nghia-vu-cac-ben",
    label: "Quyền và nghĩa vụ của các bên",
    nguon: "8. QUYỀN VÀ NGHĨA VỤ CỦA CÁC BÊN.docx",
  },
] as const;

/**
 * Trang pháp lý KHÔNG thuộc 10 mục bắt buộc nhưng vẫn công khai.
 * Giữ lại vì đang được chân trang, `app/sitemap.ts` và `components/public/cookie-consent.tsx`
 * trỏ tới — gỡ là đẻ link chết.
 */
export const LEGAL_PAGES_PHU: readonly LegalPage[] = [
  { slug: "dieu-khoan-su-dung", label: "Điều khoản sử dụng", nguon: "—" },
  { slug: "quyen-rieng-tu", label: "Trung tâm quyền riêng tư", nguon: "—" },
] as const;

/** Trang mục lục liệt kê đủ 10 chính sách. */
export const LEGAL_INDEX_SLUG = "chinh-sach";

// ⚠️ Phiên bản chính sách + khoá đồng ý KHÔNG nằm ở đây — chúng ở
// `lib/legal/site-policy-content.ts`, theo đúng nếp `lib/chat/policy-content.ts`.
// File này là nguồn {slug, label} cho 3 chân trang + sitemap, tức nó được import ở MỌI
// lượt render trang công khai; đừng kéo mối quan tâm "đồng ý của phụ huynh" vào đây.

/** Đường dẫn công khai (có `/` đầu) của một trang pháp lý. */
export function legalHref(slug: string): string {
  return `/${slug}`;
}

/** Mọi slug pháp lý công khai — dùng để sinh sitemap. */
export function allLegalSlugs(): string[] {
  return [
    LEGAL_INDEX_SLUG,
    ...LEGAL_PAGES.map((p) => p.slug),
    ...LEGAL_PAGES_PHU.map((p) => p.slug),
  ];
}
