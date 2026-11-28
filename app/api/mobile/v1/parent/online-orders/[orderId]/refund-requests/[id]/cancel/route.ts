import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { rutYeuCauHoanMobile } from "@/lib/mobile-api/dich-vu/online-hoan";

export const dynamic = "force-dynamic";

/** POST /parent/online-orders/:orderId/refund-requests/:id/cancel — RÚT yêu cầu khi còn PENDING (đã xử lý ⇒ 409 HOAN_TIEN_KHONG_RUT_DUOC; rút lặp ⇒ 200 daRut:true). Thân bỏ qua. */
export async function POST(req: Request, ctx: { params: Promise<{ orderId: string; id: string }> }) {
  const { orderId, id } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await rutYeuCauHoanMobile(nguoi.userId, orderId, id)));
}
