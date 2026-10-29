// lib/validators/phieu-pos.ts — đầu vào ba Server Action thu thẻ POS trên màn đơn (GĐ1 POS · 06/10/2026).
// Zod là nguồn kiểu (CLAUDE.md quy ước 2). Thiết kế: docs/pos-gd1-thiet-ke.md §6.
import { z } from "zod";

const id = z.string().trim().min(1, "Thiếu mã").max(64, "Mã quá dài");

/** "Thu bằng thẻ POS" cho MỘT đợt. `posTerminalId` bắt buộc khi cơ sở có > 1 máy (lib kiểm). */
export const taoPhieuPosSchema = z.object({
  orderId: id,
  paymentRequestId: id,
  posTerminalId: id.optional(),
});

/** "Kiểm tra thanh toán". */
export const kiemTraPhieuPosSchema = z.object({ orderId: id, intentId: id });

/** "Báo admin" (sau 10 phút vẫn chưa thấy giao dịch). */
export const baoAdminPhieuPosSchema = z.object({
  orderId: id,
  intentId: id,
  ghiChu: z.string().trim().max(500, "Ghi chú tối đa 500 ký tự").optional(),
});

export type TaoPhieuPosInput = z.infer<typeof taoPhieuPosSchema>;
export type KiemTraPhieuPosInput = z.infer<typeof kiemTraPhieuPosSchema>;
export type BaoAdminPhieuPosInput = z.infer<typeof baoAdminPhieuPosSchema>;

// ── VIỆC 3 (09/10/2026): "Tôi nhập sai mã trên máy" — bốn Server Action (docs/pos-hai-nut-khai-may.md §5) ──────────────────────

/** Lý do từ chối tối thiểu — cùng ngưỡng với CHECK `PosSaiMaYeuCau_tu_choi_check` và `LY_DO_TU_CHOI_TOI_THIEU`. */
const LY_DO_TU_CHOI_TOI_THIEU = 5;

/** Sale bấm nút: tìm ứng viên cho một phiếu thẻ (chỉ đọc). */
export const timSaiMaSchema = z.object({ orderId: id, intentId: id });

/**
 * Sale chọn MỘT giao dịch. Chỉ nhận ID giao dịch: mã đúng (`code5`), số tiền, cơ sở… đều do máy chủ đọc DƯỚI KHOÁ — client không
 * có chỗ nào để nhét một "mã xác nhận" (lưới `[HN3-W2]`).
 */
export const guiSaiMaSchema = z.object({ orderId: id, intentId: id, bankTransactionId: id });

/** Kế toán duyệt — một bấm. */
export const duyetSaiMaSchema = z.object({ orderId: id, yeuCauId: id });

/** Kế toán từ chối — lý do BẮT BUỘC. */
export const tuChoiSaiMaSchema = z.object({
  orderId: id,
  yeuCauId: id,
  lyDo: z
    .string()
    .trim()
    .min(LY_DO_TU_CHOI_TOI_THIEU, `Cần ghi lý do từ chối (ít nhất ${LY_DO_TU_CHOI_TOI_THIEU} ký tự)`)
    .max(500, "Lý do tối đa 500 ký tự"),
});

export type TimSaiMaInput = z.infer<typeof timSaiMaSchema>;
export type GuiSaiMaInput = z.infer<typeof guiSaiMaSchema>;
export type DuyetSaiMaInput = z.infer<typeof duyetSaiMaSchema>;
export type TuChoiSaiMaInput = z.infer<typeof tuChoiSaiMaSchema>;
