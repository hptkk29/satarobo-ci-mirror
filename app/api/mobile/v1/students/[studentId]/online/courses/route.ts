import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { danhSachKhoaOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/courses — khoá Online CỦA CON (lõi E-learning). Thu hồi ⇒ biến; hết hạn ⇒ vẫn hiện (trangThaiQuyen HET_HAN). Cờ ELEARNING_ONLINE_ENABLED tắt ⇒ 404. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await danhSachKhoaOnline(hs, nguoi)));
}
