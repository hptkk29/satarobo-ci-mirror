import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { lamMoiQuyenOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/entitlements — LÀM MỚI quyền học (nhẹ): trạng thái từng khoá sau mua/gia hạn/thu hồi. no-store. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await lamMoiQuyenOnline(hs, nguoi)));
}
