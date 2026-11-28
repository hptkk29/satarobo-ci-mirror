import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { layTrangThaiThanhToan } from "@/lib/mobile-api/dich-vu/don-hang";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/parent/orders/:orderId/payment-status — trạng thái thanh toán của MỘT đơn, SUY RA từ Order/Payment/QrSession thật (CHỈ ĐỌC, hỏi lại an toàn).
 * Đơn không có học viên nào của phụ huynh trong phiên ⇒ 404 (cùng mã với "không tồn tại"). Phiên chế độ học sinh ⇒ 403 (allow-list default-deny).
 */
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await layTrangThaiThanhToan(nguoi.userId, orderId)));
}
