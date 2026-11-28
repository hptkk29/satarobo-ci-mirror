import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { motSanPhamShopMobile } from "@/lib/mobile-api/dich-vu/online-shop";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/online/shop/products/{id} — một sản phẩm + các biến thể cùng nhóm. Không bán Online / không tồn tại ⇒ cùng 404. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await motSanPhamShopMobile(nguoi.userId, id)));
}
