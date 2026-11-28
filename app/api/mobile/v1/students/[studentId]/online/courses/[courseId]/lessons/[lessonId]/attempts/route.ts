import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { batDauBodySchema, batDauLamBaiOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId/attempts {} — bắt đầu / tiếp tục lượt làm bài (đề KHÔNG đáp án, `hetGioLuc`). */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string }> }) {
  const { studentId, courseId, lessonId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, batDauBodySchema, async (hs, nguoi, _ctx) => traThanhCong(await batDauLamBaiOnline(hs, nguoi, courseId, lessonId)));
}
