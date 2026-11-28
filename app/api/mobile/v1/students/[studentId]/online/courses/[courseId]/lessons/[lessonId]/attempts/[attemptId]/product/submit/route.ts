import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { dangKyBaiNopSanPham, dangKyBaiNopSchema } from "@/lib/mobile-api/dich-vu/online-san-pham";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId/attempts/:attemptId/product/submit { questionId, key, name, mime, durationSec? } — đăng ký bài nộp SAU khi tệp đã PUT lên; trả `submissionId` (= câu trả lời của câu PRODUCT). Chỉ phiên Student Mode của chính em. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string; attemptId: string }> }) {
  const { studentId, courseId, lessonId, attemptId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, dangKyBaiNopSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await dangKyBaiNopSanPham(hs, nguoi, courseId, lessonId, attemptId, thanDl)));
}
