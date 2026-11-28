import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { batDauLuot, batDauLuotSchema, lichSuLuot } from "@/lib/mobile-api/dich-vu/bai-thi-luot";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/students/:studentId/learning/exams/:examId/attempts { khoaGuiLai } → LuotLam (bản ghim đề, KHÔNG đáp án, `conLaiGiay` do máy chủ).
 * Bắt đầu hoặc TIẾP TỤC: có lượt đang dở ⇒ trả lại chính nó. 422 `HET_LUOT` · `CHUA_MO` · `DA_DONG` · `DE_CHUA_HO_TRO`. Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ 404.
 * GET → lịch sử các lượt làm của đề này (điểm chỉ khi đã chấm + cấu hình cho phép).
 */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; examId: string }> }) {
  const { studentId, examId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, batDauLuotSchema, async (hs, nguoi, c, thanDl) => traThanhCong(await batDauLuot(hs, examId, nguoi.userId, thanDl, c.now)));
}

export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; examId: string }> }) {
  const { studentId, examId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await lichSuLuot(hs, examId, nguoi.hocSinhId !== null)));
}
