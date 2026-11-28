import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { nopLuot, nopLuotSchema } from "@/lib/mobile-api/dich-vu/bai-thi-luot";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/students/:studentId/learning/attempts/:attemptId/submit { phienBanDe, khoaGuiLai } → { trangThai:"CHO_CHAM"|"DA_CHAM", nopLuc, tre, trungLap }.
 * Nộp NGUYÊN TỬ: chấm máy + cập nhật lượt + bài về nhà trong một giao dịch. Nộp lần hai ⇒ trả đúng kết quả cũ (`trungLap:true`). Không thưởng SataCoin.
 */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; attemptId: string }> }) {
  const { studentId, attemptId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, nopLuotSchema, async (hs, nguoi, c, thanDl) => traThanhCong(await nopLuot(hs, attemptId, nguoi.userId, thanDl, c.now)));
}
