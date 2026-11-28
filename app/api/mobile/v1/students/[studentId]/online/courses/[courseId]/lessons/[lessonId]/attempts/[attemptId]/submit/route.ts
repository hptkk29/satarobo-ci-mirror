import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { nopBaiOnline, nopBodySchema } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId/attempts/:attemptId/submit { traLoi } — nộp bài (idempotent theo attemptId). */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string; attemptId: string }> }) {
  const { studentId, courseId, lessonId, attemptId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, nopBodySchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await nopBaiOnline(hs, nguoi, courseId, lessonId, attemptId, thanDl)));
}
