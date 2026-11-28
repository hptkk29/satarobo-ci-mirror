import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { taoQrDoiTac } from "@/lib/mobile-api/dich-vu/gioi-thieu";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/referral/links/:linkId/qr — QR (SVG data-URI) cho link ACTIVE CỦA CHÍNH đối tác; id của người khác / không tồn tại ⇒ 404; link đã thu hồi ⇒ 409. */
export async function POST(req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await ctx.params;
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await taoQrDoiTac(nguoi, linkId)));
}
