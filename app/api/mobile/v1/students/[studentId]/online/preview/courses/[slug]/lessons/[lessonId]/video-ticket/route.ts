import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { capVeHocThuMobile } from "@/lib/mobile-api/dich-vu/free-mode";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/preview/courses/:slug/lessons/:lessonId/video-ticket — vé phát video học thử. Học sinh (chính em): mở bài (F3) rồi cấp vé; phụ huynh: chỉ cấp vé. Không thân. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; slug: string; lessonId: string }> }) {
  const { studentId, slug, lessonId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await capVeHocThuMobile(nguoi, hs, slug, lessonId)));
}
