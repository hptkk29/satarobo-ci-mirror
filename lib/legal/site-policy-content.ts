// lib/legal/site-policy-content.ts — NỘI DUNG + PHIÊN BẢN của ô tích "Chính sách hoạt động".
//
// ⚠️ Vì sao tách khỏi `lib/legal/site-policy.ts`: màn cổng là Client Component (có ô tích),
// mà `site-policy.ts` import `@/lib/db` — để chung một file là kéo Prisma vào bundle client.
// File này KHÔNG được import bất cứ thứ gì chạm DB hay `server-only`.
// (Cùng lý do, cùng khuôn với `lib/chat/policy-content.ts`.)

import { LEGAL_INDEX_SLUG, legalHref } from "@/lib/legal-pages";

/** Khoá định danh loại đồng ý — `SitePolicyAcceptance.policyKey`. */
export const SITE_POLICY_KEY = "chinh-sach-hoat-dong";

/**
 * Phiên bản bộ chính sách, dạng NGÀY PHÁT HÀNH để đối chiếu thẳng với hồ sơ đã nộp.
 *
 * Sổ phiên bản:
 *   · "2026-09-21" — bản nộp Bộ Công Thương lần 1 (10 chính sách theo hướng dẫn 21/09/2026).
 *
 * ⚠️ LUẬT NÂNG PHIÊN BẢN — đọc trước khi đổi con số này:
 *  1. Version và chữ đổi trong CÙNG một commit, hoặc không đổi gì cả. Sửa nội dung mà
 *     quên nâng = sổ ghi "đã đồng ý bản mới" cho người chỉ mới đọc bản cũ. Không test nào
 *     bắt được loại sai đó.
 *  2. NÂNG khi đổi NGHĨA VỤ — thứ phụ huynh đang đồng ý: quyền/nghĩa vụ, luật hoàn tiền,
 *     phạm vi dữ liệu, bên thứ ba. Hệ quả: mọi phụ huynh phải tích lại, TỰ ĐỘNG, không
 *     thêm một dòng mã nào (câu đọc khoá theo version hiện hành).
 *  3. KHÔNG nâng khi sửa lỗi gõ, định dạng, số điện thoại, tên đường. Nâng bừa = dựng một
 *     bức tường trước mặt toàn bộ phụ huynh vì một dấu phẩy, và lần sau họ bấm mà không đọc.
 *  4. Dòng cũ KHÔNG BAO GIỜ bị UPDATE/DELETE — nó là bằng chứng "lúc đó họ đồng ý bản nào".
 */
export const SITE_POLICY_VERSION = "2026-09-21";

/** Nhãn NGUYÊN VĂN theo hướng dẫn BCT mục 4. */
export const SITE_POLICY_NHAN_TRUOC = "Tôi đã đọc và đồng ý với ";
export const SITE_POLICY_NHAN_LINK = "Chính sách hoạt động";
export const SITE_POLICY_NHAN_SAU = " của website";

/**
 * Trang mà link trong ô tích trỏ tới.
 *
 * ⚠️ CẦN ĐƠN VỊ TƯ VẤN XÁC NHẬN: cái tên "Chính sách hoạt động" **không tồn tại** trong bộ
 * 11 file .docx gửi kèm — `grep` cả 11 file ra đúng một dòng, và nó chính là dòng yêu cầu
 * mục 4. Nó cũng không nằm trong danh sách 10 tên bắt buộc của mục 1.
 *
 * Cách đọc ít suy diễn nhất là trỏ về TRANG MỤC LỤC (`/chinh-sach`), nơi liệt kê đủ 10
 * chính sách — tức "chính sách hoạt động của website" hiểu là toàn bộ bộ chính sách.
 * Nếu đơn vị tư vấn gửi thêm một văn bản riêng mang đúng tên đó, đổi hằng này sang slug
 * của nó và NÂNG `SITE_POLICY_VERSION`.
 */
export const SITE_POLICY_HREF = legalHref(LEGAL_INDEX_SLUG);

export const SITE_POLICY_TIEU_DE = "Chính sách hoạt động của website";

/**
 * Tóm tắt thứ phụ huynh đang đồng ý — 4 dòng, KHÔNG dán cả văn bản.
 * Viết đúng những gì hệ thống thực sự làm; muốn đọc đủ thì có link "Đọc toàn văn".
 */
export const SITE_POLICY_TOM_TAT: readonly string[] = [
  "Cách Sata Robo niêm yết giá, tiếp nhận thanh toán và xuất chứng từ cho khoá học, dịch vụ.",
  "Điều kiện đổi trả hàng hoá, chấm dứt khoá học và mức hoàn trả học phí theo thời điểm rút học.",
  "Cách Sata Robo thu thập, sử dụng, lưu trữ và bảo vệ thông tin cá nhân của phụ huynh và học viên.",
  "Kênh tiếp nhận phản ánh, yêu cầu, khiếu nại và thời hạn giải quyết.",
];

/** Câu giải thích VÌ SAO phụ huynh đang bị hỏi — thiếu nó là hotline đổ chuông. */
export const SITE_POLICY_LY_DO =
  "Theo quy định của Bộ Công Thương về website thương mại điện tử, Sata Robo cần ghi nhận " +
  "xác nhận của quý phụ huynh trước khi tiếp tục. Quý phụ huynh chỉ phải xác nhận MỘT LẦN.";
