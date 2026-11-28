import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { trangThaiLuotOnline } from "@/lib/mobile-api/dich-vu/online-nhap";

export const dynamic = "force-dynamic";

/** GET …/attempts/:attemptId/status — trạng thái NHẸ của lượt (IN_PROGRESS · SUBMITTED · GRADED · EXPIRED · INTERRUPTED), giờ máy chủ, `tuDongNop`, `gianDoan`, `luotThayThe`, `luotConLai` (không đề/đáp án). INTERRUPTED/EXPIRED ⇒ `coKetQua=false` (KHÔNG phải trượt). */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string; attemptId: string }> }) {
  const { studentId, courseId, lessonId, attemptId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await trangThaiLuotOnline(hs, nguoi, courseId, lessonId, attemptId)));
}
