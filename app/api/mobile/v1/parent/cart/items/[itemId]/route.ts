import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { suaDongGioMobile, suaDongGioSchema, xoaDongGioMobile } from "@/lib/mobile-api/dich-vu/online-gio";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ itemId: string }> };

/** PATCH /parent/cart/items/:itemId { maGiamGia: string|null, revision? } — mã giảm RIÊNG của dòng. Dòng của giỏ khác ⇒ 404. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { itemId } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, suaDongGioSchema, async (nguoi, _c, than) => traThanhCong(await suaDongGioMobile(nguoi.userId, itemId, than)));
}

/** DELETE /parent/cart/items/:itemId[?revision=] — xoá dòng (xoá lặp ⇒ ok). Dòng của giỏ khác ⇒ 404. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { itemId } = await ctx.params;
  const v = new URL(req.url).searchParams.get("revision");
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await xoaDongGioMobile(nguoi.userId, itemId, v !== null && /^\d{1,10}$/.test(v) ? Number(v) : undefined)));
}
