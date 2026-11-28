import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, xoaThanhVienBody, xoaThanhVienSo } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/members/:memberId/delete — xoá thành viên; thân BẮT BUỘC `cheDo` = giu-bai | xoa-bai (không có mặc định). Không xoá được chủ sổ. */
export async function POST(req: Request, ctx: { params: Promise<{ memberId: string }> }) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  const { memberId } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, xoaThanhVienBody, async (nguoi, _ctx, than) => traThanhCong(await xoaThanhVienSo(nguoi, memberId, than)));
}
