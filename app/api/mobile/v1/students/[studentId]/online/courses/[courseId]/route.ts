import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { chiTietKhoaOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/courses/:courseId — chi tiết một khoá của con (không có quyền / thu hồi ⇒ 404). */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string }> }) {
  const { studentId, courseId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await chiTietKhoaOnline(hs, nguoi, courseId)));
}
