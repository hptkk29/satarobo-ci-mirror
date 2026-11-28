import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layDanhSachBaiHoc } from "@/lib/mobile-api/dich-vu/hoc-tap";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/lessons — bài học đã dạy + tài liệu giáo viên đã giao cho chính lớp. Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ 404 phong bì. Cổng C. Chỉ đọc. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layDanhSachBaiHoc(hs)));
}
