import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { guiKhaoSat, guiKhaoSatSchema } from "@/lib/mobile-api/dich-vu/khao-sat";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/students/:studentId/surveys/:surveyId/responses — gửi MỘT lần trả lời khảo sát cho MỘT con (NPS 0–10, RATING 1–5, TEXT). Gắn tài khoản xác thực; KHÔNG có chế độ ẩn danh (OD-16).
 * Đã trả lời ⇒ 409. Khảo sát ngoài phạm vi cơ sở / đã đóng / không phải «mục góp ý» ⇒ 404.
 */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; surveyId: string }> }) {
  const { studentId, surveyId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, guiKhaoSatSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await guiKhaoSat(hs, nguoi.userId, surveyId, thanDl)));
}
