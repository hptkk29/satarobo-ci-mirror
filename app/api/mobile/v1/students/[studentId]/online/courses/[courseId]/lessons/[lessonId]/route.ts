import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { moBaiOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId — mở MỘT bài qua cổng duy nhất của E (quyền + hạn + thu hồi + bài ẩn + thứ tự mở + không xem lại). `{soBan, bai}`; VIDEO ⇒ coVideo (không khoá media); QUIZ/… ⇒ coDe (không đề). */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string }> }) {
  const { studentId, courseId, lessonId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await moBaiOnline(hs, nguoi, courseId, lessonId)));
}
