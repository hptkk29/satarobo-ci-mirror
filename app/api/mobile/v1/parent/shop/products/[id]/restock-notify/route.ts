import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { dangKyBaoCoHangMobile, huyBaoCoHangMobile, thanRongSchema } from "@/lib/mobile-api/dich-vu/online-shop";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/shop/products/{id}/restock-notify {} — đăng ký «Báo khi có hàng» (idempotent). Sản phẩm không bán Online ⇒ 404. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, thanRongSchema, async (nguoi) => traThanhCong(await dangKyBaoCoHangMobile(nguoi.userId, id)));
}

/** DELETE — huỷ đăng ký (idempotent; luôn 200, không tiết lộ có/không). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, thanRongSchema, async (nguoi) => traThanhCong(await huyBaoCoHangMobile(nguoi.userId, id)));
}
