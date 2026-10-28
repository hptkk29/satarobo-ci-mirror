/**
 * lib/nguon/wave-c-gan-payment-ghi-danh.ts — PHẠM VI + nhãn của «PHASE C-C · gắn `Payment.enrollmentId` cho 3 khoản thu sống của 2 đơn nhóm C» (26/10/2026).
 *
 * ── Dùng LẠI lõi đã chạy thật ở PHASE B.2, không viết lại ────────────────────────────────────────────────────
 * PHASE B.2 (`gan-payment-ghi-danh.ts`, đã ghi PROD 24/10/2026, 9/9 khoản, idempotency 0) đã có MỌI luật cần cho việc này: ghi danh đích = ghi danh mà dòng đơn trỏ tới (C-A phải xong) ·
 * ghi danh phải ở GIÁ ĐÍCH (`discountType = PERCENT`, `finalPrice = tuition = giaDich` — C-B phải xong) · khoản sống + CONFIRMED + RECORDED + `enrollmentId` NULL · đúng MỘT giao dịch ngân hàng MATCHED cùng
 * số tiền, có phân bổ vào phiếu của CHÍNH đơn · khoản đã xoá mềm giữ nguyên · hoá đơn · tác dụng phụ (Receipt / hoa hồng / hoàn tiền = 0) · planner chuẩn `lapKeHoachGanGhiDanh` phải ra «GAN một mảnh giữ
 * nguyên tiền» · nợ dự kiến SAU khi gắn = 0 (chính hàm `computeDebt`). Lệnh này chỉ đổi BẢNG phạm vi + tên workflow/audit; ba lệnh PHASE C có ba chữ ký owner độc lập.
 *
 * ── Phép ghi: MỘT cột của MỘT bảng ──────────────────────────────────────────────────────────────────────────
 * `Payment.enrollmentId` (NULL → ghi danh đích). KHÔNG đổi amount / status / paidDate / note / orderItemId / method; KHÔNG Order, OrderItem, Enrollment, BankTransaction, allocation, Receipt, hoa hồng.
 * Số tiền KHÔNG BAO GIỜ bị tách. KHÔNG tạo Receipt (owner: `NO_BULK_BACKFILL`; Receipt chỉ phát từ đường kế toán xác nhận tay).
 *
 * ── KHÔNG có định danh tài chính thật trong mã nguồn ────────────────────────────────────────────────────────
 * Bảng cứng chỉ giữ mã đơn (kinh doanh) + giá đích + SỐ ĐẾM. Mọi id khoản / ghi danh / dòng đơn / hoá đơn và mã giao dịch ngân hàng được ĐỌC TỪ DB lúc chạy, in vào dòng ký (artifact riêng tư).
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import type { MucGanPayment } from "./gan-payment-ghi-danh";

export const LY_DO_WAVE_C_C = "PHASE C-C: gắn khoản thu vào ghi danh theo đơn đã duyệt — chỉ đổi Payment.enrollmentId, không đổi số tiền / trạng thái / ngày thu, không tạo Receipt";
export const NGUON_GHI_WAVE_C_C = "wave-c-gan-payment-ghi-danh";
export const HANH_DONG_WAVE_C_C_LUOT = "WAVE_C_GAN_PAYMENT_LUOT_CHAY";

/**
 * PHẠM VI CỨNG: đúng 2 đơn nhóm C của audit C0 (3 khoản sống, 1 khoản xoá mềm). Giá đích là `finalPrice` SAU C-B (8.640.000 = 11.520.000 − 25% · 11.424.000 = 13.440.000 − 15%).
 * Script truyền hằng này; không có tham số dòng lệnh / ô workflow nào thêm, bớt hay đổi (lưới `[WCC-W*]`). Thứ tự = thứ tự báo cáo/ghi.
 */
export const BANG_WAVE_C_C: Readonly<Record<string, MucGanPayment>> = {
  "ORD-260910-000004": { giaDich: 8_640_000, soKhoan: 1, soKhoanDaXoa: 0, soKhoanTrongHoaDon: 0 },
  // Một bản ghi nhận PENDING (2.000.000đ) đã xoá mềm — PHẢI GIỮ xoá, không gắn.
  "ORD-260910-000007": { giaDich: 11_424_000, soKhoan: 2, soKhoanDaXoa: 1, soKhoanTrongHoaDon: 0 },
};
export const MA_DON_WAVE_C_C: readonly string[] = Object.keys(BANG_WAVE_C_C);
export const TONG_KHOAN_WAVE_C_C = Object.values(BANG_WAVE_C_C).reduce((s, m) => s + m.soKhoan, 0);
