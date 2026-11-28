import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layKhuyenMai } from "@/lib/mobile-api/dich-vu/ho-so-khuyen-mai-gop-y";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/promotions — chương trình khuyến mãi đang áp dụng theo cơ sở của con (CHỈ ĐỌC; không có mã giảm giá). Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layKhuyenMai(hs)));
}
