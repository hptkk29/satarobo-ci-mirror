// components/public/phap-ly/danh-sach-chinh-sach.ts — danh sách 13 trang ở thanh bên của khu Chính sách.
//
// TÊN HIỂN THỊ lấy từ `lib/legal-pages.ts` (đúng nguyên văn danh sách BCT) — KHÔNG gõ lại ở đây.
// Chỉ có THỨ TỰ là của giao diện (theo artifact: mục lục · điều khoản · bảo mật · quyền riêng tư · rồi
// các chính sách giao dịch). Test `danh-sach-chinh-sach.test.ts` khoá: đủ 13 trang, không thừa không thiếu.
import { LEGAL_INDEX_SLUG, LEGAL_PAGES, LEGAL_PAGES_PHU, legalHref } from "@/lib/legal-pages";

export type MucChinhSach = { slug: string; label: string; href: string };

/** Thứ tự hiển thị theo artifact. */
export const THU_TU_CHINH_SACH: readonly string[] = [
  LEGAL_INDEX_SLUG,
  "dieu-khoan-su-dung",
  "chinh-sach-bao-mat",
  "quyen-rieng-tu",
  "chinh-sach-gia",
  "chinh-sach-thanh-toan",
  "chinh-sach-hoan-tra",
  "chinh-sach-giao-hang",
  "phuong-thuc-cung-cap-dich-vu",
  "chinh-sach-cham-dut-dich-vu",
  "cac-dieu-kien-va-han-che",
  "quyen-va-nghia-vu-cac-ben",
  "phuong-thuc-tiep-nhan-phan-anh",
];

const TEN_MUC_LUC = "Chính sách của website";

export function danhSachChinhSach(): MucChinhSach[] {
  const ten = new Map<string, string>([
    [LEGAL_INDEX_SLUG, TEN_MUC_LUC],
    ...LEGAL_PAGES.map((p) => [p.slug, p.label] as const),
    ...LEGAL_PAGES_PHU.map((p) => [p.slug, p.label] as const),
  ]);
  return THU_TU_CHINH_SACH.map((slug) => ({ slug, label: ten.get(slug) ?? slug, href: legalHref(slug) }));
}

/** Tách tiêu đề để tô gradient hai chữ cuối (một chữ cuối nếu tiêu đề chỉ có 1–2 chữ). */
export function tachTieuDeGradient(tieuDe: string): { dau: string; cuoi: string } {
  const t = tieuDe.trim().replace(/\s+/g, " ");
  const tu = t.split(" ");
  if (tu.length < 2) return { dau: "", cuoi: t };
  const n = tu.length >= 3 ? 2 : 1;
  return { dau: tu.slice(0, tu.length - n).join(" "), cuoi: tu.slice(-n).join(" ") };
}

/**
 * Mô tả ngắn từng trang cho thẻ ở trang mục lục `/chinh-sach`.
 * ⚠️ Mỗi câu là BẢN SAO phụ đề (`subtitle`) ở `app/(public)/<slug>/page.tsx` — test [DSC-05] khoá hai
 * chỗ không lệch nhau.
 */
export const MO_TA_CHINH_SACH: Readonly<Record<string, string>> = {
  "dieu-khoan-su-dung": "Quyền và nghĩa vụ khi sử dụng dịch vụ Sata Robo",
  "chinh-sach-bao-mat": "Theo Luật Bảo vệ dữ liệu cá nhân 91/2025 và Nghị định 356/2025/NĐ-CP",
  "quyen-rieng-tu":
    "Quản lý cách Sata Robo sử dụng cookie và dữ liệu cá nhân của anh/chị khi truy cập trang. Theo Nghị định 13/2023/NĐ-CP.",
  "chinh-sach-gia": "Nguyên tắc niêm yết, áp dụng và điều chỉnh giá sản phẩm, dịch vụ trên satarobo.vn",
  "chinh-sach-thanh-toan": "Các hình thức thanh toán, bảo mật thông tin thanh toán và xử lý sự cố giao dịch",
  "chinh-sach-hoan-tra": "Điều kiện đổi trả hàng hóa, chi phí hoàn trả và quy trình xử lý yêu cầu",
  "chinh-sach-giao-hang": "Phạm vi giao hàng, đơn vị vận chuyển, chi phí và thời gian giao nhận",
  "phuong-thuc-cung-cap-dich-vu": "Cách thức sử dụng dịch vụ, tính năng chính và điều chỉnh dịch vụ đã đặt",
  "chinh-sach-cham-dut-dich-vu": "Các trường hợp chấm dứt khóa học, mức hoàn trả học phí và quy trình xử lý",
  "cac-dieu-kien-va-han-che":
    "Giới hạn về thời gian, phạm vi địa lý, đối tượng và tính khả dụng của hàng hóa, dịch vụ",
  "quyen-va-nghia-vu-cac-ben": "Quyền và nghĩa vụ của Sata Robo và của khách hàng khi giao dịch trên website",
  "phuong-thuc-tiep-nhan-phan-anh":
    "Kênh tiếp nhận, trình tự xử lý và thời hạn giải quyết phản ánh, yêu cầu, khiếu nại của khách hàng",
};
