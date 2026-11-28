import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layNhanXet } from "@/lib/mobile-api/dich-vu/nhan-xet";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/feedback — nhận xét từng buổi của MỘT con. Cổng C (đăng nhập → quy định → kiểm sở hữu). Học viên của gia đình khác / không tồn tại ⇒ cùng 404. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layNhanXet(hs)));
}
