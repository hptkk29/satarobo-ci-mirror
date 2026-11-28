import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { ketQuaLuot } from "@/lib/mobile-api/dich-vu/bai-thi-luot";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/attempts/:attemptId/result → KetQuaLuot. `xemLai` (đúng/sai + điểm + ghi chú theo câu) CHỈ khi đã chấm + `showResultAfterSubmit` + cấu hình cho phép; KHÔNG BAO GIỜ trả đáp án đúng. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; attemptId: string }> }) {
  const { studentId, attemptId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await ketQuaLuot(hs, attemptId, nguoi.hocSinhId !== null)));
}
