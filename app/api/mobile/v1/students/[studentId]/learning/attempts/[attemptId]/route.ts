import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layLuot } from "@/lib/mobile-api/dich-vu/bai-thi-luot";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/attempts/:attemptId → LuotLam (KHÔI PHỤC bản nháp: cùng bản ghim, cùng thứ tự xáo, `daLuu`, `conLaiGiay` mới). Đã nộp ⇒ 409 `LUOT_DA_NOP`. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; attemptId: string }> }) {
  const { studentId, attemptId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, _nguoi, c) => traThanhCong(await layLuot(hs, attemptId, c.now)));
}
