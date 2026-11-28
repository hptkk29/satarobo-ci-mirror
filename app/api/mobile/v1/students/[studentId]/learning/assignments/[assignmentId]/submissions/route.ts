import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { nopBaiTap, nopBaiTapSchema } from "@/lib/mobile-api/dich-vu/hoc-tap-nop";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/students/:studentId/learning/assignments/:assignmentId/submissions { khoaGuiLai, vanBan?, tepIds? } → { trangThaiNop, nopLuc, trungLap, phienBan }.
 * Nộp / nộp lại bài tập (văn bản). Idempotent theo `khoaGuiLai`; ghi lịch sử phiên bản; cửa nộp do MÁY CHỦ (422 DA_DONG); đã chấm ⇒ 409 DA_CHAM; tệp/video ⇒ 422 TEP_CHUA_HO_TRO.
 * Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ 404 phong bì. Cổng C. Phiên chế độ học sinh nộp được bài của CHÍNH mình.
 */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; assignmentId: string }> }) {
  const { studentId, assignmentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, nopBaiTapSchema, async (hs, nguoi, c, thanDl) => traThanhCong(await nopBaiTap(hs, assignmentId, nguoi.userId, thanDl, c.now)));
}
