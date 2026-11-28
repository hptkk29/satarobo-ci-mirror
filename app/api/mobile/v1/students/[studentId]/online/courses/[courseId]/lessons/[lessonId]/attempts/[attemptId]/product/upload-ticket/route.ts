import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { capVeTaiLenSanPham, veTaiLenSchema } from "@/lib/mobile-api/dich-vu/online-san-pham";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId/attempts/:attemptId/product/upload-ticket { questionId, fileName, mime, sizeBytes, durationSec? } — vé PUT ngắn hạn cho câu PRODUCT. Chỉ phiên Student Mode của chính em. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string; attemptId: string }> }) {
  const { studentId, courseId, lessonId, attemptId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, veTaiLenSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await capVeTaiLenSanPham(hs, nguoi, courseId, lessonId, attemptId, thanDl)));
}
