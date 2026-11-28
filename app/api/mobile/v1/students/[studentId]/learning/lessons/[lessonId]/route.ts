import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layChiTietBaiHoc } from "@/lib/mobile-api/dich-vu/hoc-tap";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/lessons/[lessonId] — chi tiết MỘT bài học. Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ 404 phong bì. Cổng C. Chỉ đọc. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; lessonId: string }> }) {
  const { studentId, lessonId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layChiTietBaiHoc(hs, lessonId)));
}
