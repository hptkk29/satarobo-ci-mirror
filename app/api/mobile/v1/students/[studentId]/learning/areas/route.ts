import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layKhuHocTap } from "@/lib/mobile-api/dich-vu/khu-hoc-tap";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/areas — khu học tập của học viên: offline (có lớp?) + online (CHUA_MO tới khi có engine entitlement). Cổng C; con nhà khác ⇒ 404. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layKhuHocTap(hs, nguoi)));
}
