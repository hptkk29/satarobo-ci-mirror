import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { guiYeuCauHoanMobile, guiYeuCauHoanSchema, xemYeuCauHoanMobile } from "@/lib/mobile-api/dich-vu/online-hoan";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ orderId: string }> };

/** GET /parent/online-orders/:orderId/refund-requests — các yêu cầu hoàn tiền của đơn. LUÔN 200 (xem yêu cầu cũ kể cả khi kênh gửi tắt). Đơn của người khác ⇒ 404. */
export async function GET(req: Request, ctx: Ctx) {
  const { orderId } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await xemYeuCauHoanMobile(nguoi.userId, orderId)));
}

/**
 * POST /parent/online-orders/:orderId/refund-requests { orderItemId, lyDo } — GỬI yêu cầu hoàn tiền (KHÔNG có số tiền; strict). Kênh tắt ⇒ 409 HOAN_TIEN_DANG_TAT. Đã có yêu cầu MỞ cho dòng ⇒ 200 daCo:true.
 * Duyệt/chi/thu hồi quyền chỉ ở phía nhân viên.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { orderId } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, guiYeuCauHoanSchema, async (nguoi, _c, than) => traThanhCong(await guiYeuCauHoanMobile(nguoi.userId, orderId, than)));
}
