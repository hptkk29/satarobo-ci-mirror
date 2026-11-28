import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { chiTietDonOnlineMobile } from "@/lib/mobile-api/dich-vu/online-mua";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/online-orders/:orderId — chi tiết đơn + trạng thái cấp quyền từng dòng (DANG_CHO_THANH_TOAN → DA_CAP_QUYEN / CAN_NHAN_VIEN_XU_LY). Đơn người khác/không có ⇒ 404. App «làm mới sau thanh toán» gọi route này (hỏi lại an toàn). */
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await chiTietDonOnlineMobile(nguoi.userId, orderId)));
}
