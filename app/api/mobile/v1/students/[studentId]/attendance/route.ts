import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layChuyenCan } from "@/lib/mobile-api/dich-vu/chuyen-can";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/attendance — chuyên cần + trạng thái học bù của MỘT con. Cổng C (đăng nhập → quy định → kiểm sở hữu). Học viên của gia đình khác / không tồn tại ⇒ cùng 404. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layChuyenCan(hs)));
}
