import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layTongQuan } from "@/lib/mobile-api/dich-vu/tong-quan";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/overview — tổng quan của MỘT con (dùng lại `getTongQuan` của web). Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layTongQuan(hs, nguoi.userId)));
}
