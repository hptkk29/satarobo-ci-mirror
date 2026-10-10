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
