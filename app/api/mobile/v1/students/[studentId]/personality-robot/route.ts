import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layRobotTinhCach } from "@/lib/mobile-api/dich-vu/robot-tinh-cach";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/personality-robot — «Robot tính cách» của em (H-San-pham): kiểu robot chính/phụ từ kết quả DISC THẬT của em; chưa có kết quả ⇒ `coRobot:false`. Cờ DISC_ENABLED tắt ⇒ 404. Chỉ đọc. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layRobotTinhCach(hs, nguoi)));
}
