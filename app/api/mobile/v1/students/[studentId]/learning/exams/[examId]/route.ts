import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layChiTietBaiThi } from "@/lib/mobile-api/dich-vu/hoc-tap";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/exams/[examId] — chi tiết bài thi TRƯỚC khi bắt đầu (không câu hỏi, không đáp án). Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ 404 phong bì. Cổng C. Chỉ đọc. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; examId: string }> }) {
  const { studentId, examId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layChiTietBaiThi(hs, examId, { laHocSinh: nguoi.hocSinhId !== null })));
}
