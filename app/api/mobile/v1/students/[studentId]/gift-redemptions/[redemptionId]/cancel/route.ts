import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { huyDoiQua } from "@/lib/mobile-api/dich-vu/doi-qua";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/gift-redemptions/:redemptionId/cancel — huỷ yêu cầu CHƯA duyệt ⇒ hoàn coin + hoàn chỗ quà. Yêu cầu của con khác ⇒ 404. Cổng C. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; redemptionId: string }> }) {
  const { studentId, redemptionId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await huyDoiQua(hs, redemptionId)));
}
