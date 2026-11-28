import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layHocPhi } from "@/lib/mobile-api/dich-vu/hoc-phi";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/billing — học phí & công nợ của MỘT con, CHỈ ĐỌC (số lấy từ `getStudentBilling`, không tính lại). Cổng C. Học viên của gia đình khác / không tồn tại ⇒ cùng 404. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layHocPhi(hs)));
}
