import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { ghiTienDoOnline, tienDoBodySchema } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId/progress { percent? | daDoc? } — ghi tiến độ bài VIDEO (% chỉ tăng) hoặc READ (daDoc). Cổng quyền của E trước khi ghi; thu hồi/hết hạn ⇒ 403. Trường lạ ⇒ 400. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string }> }) {
  const { studentId, courseId, lessonId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, tienDoBodySchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await ghiTienDoOnline(hs, nguoi, courseId, lessonId, thanDl)));
}
