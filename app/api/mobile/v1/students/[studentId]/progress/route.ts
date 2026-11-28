import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layTienDo } from "@/lib/mobile-api/dich-vu/tien-do";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/progress — hành trình + chuyên cần + nhận xét của MỘT con (gộp ba nguồn sẵn có của web). Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layTienDo(hs, nguoi.userId)));
}
