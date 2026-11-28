import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layChiTietBaiTap } from "@/lib/mobile-api/dich-vu/hoc-tap";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/assignments/[assignmentId] — chi tiết MỘT bài tập (kèm bài nộp của chính học viên). Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ 404 phong bì. Cổng C. Chỉ đọc. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; assignmentId: string }> }) {
  const { studentId, assignmentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layChiTietBaiTap(hs, assignmentId, { laHocSinh: nguoi.hocSinhId !== null })));
}
