import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { moBaiHocThu } from "@/lib/mobile-api/dich-vu/free-mode";
import { thanRongSchema } from "@/lib/mobile-api/free-mode-hop-dong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/preview/courses/:slug/lessons/:lessonId/open {} — HỌC VIÊN (Student Mode, chính em) mở bài học thử: kiểm giới hạn F3 + ghi dấu lần đầu + trả nội dung. Phụ huynh ⇒ 403. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; slug: string; lessonId: string }> }) {
  const { studentId, slug, lessonId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, thanRongSchema, async (hs, nguoi) => traThanhCong(await moBaiHocThu(hs, nguoi, slug, lessonId)));
}
