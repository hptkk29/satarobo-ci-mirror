import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { luuTraLoi, luuTraLoiSchema } from "@/lib/mobile-api/dich-vu/bai-thi-luot";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/students/:studentId/learning/attempts/:attemptId/answers { phienBanDe, cauHoiId, traLoi, thuTuGhi } → { conLaiGiay, boQua }.
 * Lưu MỘT câu (tự lưu nháp). `thuTuGhi` ≤ số đã nhận ⇒ `boQua:true` (không ghi đè bản mới bằng bản cũ). Sau hạn ⇒ 422 `HET_GIO` (KHÔNG tự gia hạn). Lệch phiên bản đề ⇒ 409 `NOI_DUNG_DA_DOI`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; attemptId: string }> }) {
  const { studentId, attemptId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, luuTraLoiSchema, async (hs, nguoi, c, thanDl) => traThanhCong(await luuTraLoi(hs, attemptId, nguoi.userId, thanDl, c.now)));
}
