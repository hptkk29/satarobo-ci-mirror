import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layKetQua } from "@/lib/mobile-api/dich-vu/hoc-tap";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/results — lịch sử kết quả (bài thi đã nộp + bài tập đã nộp). Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ 404 phong bì. Cổng C. Chỉ đọc. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layKetQua(hs, { laHocSinh: nguoi.hocSinhId !== null })));
}
