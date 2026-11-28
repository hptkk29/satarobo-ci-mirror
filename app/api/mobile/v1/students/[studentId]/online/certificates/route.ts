import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { chungNhanOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/certificates — chứng nhận Online của con (giữ cả khoá đã thu hồi quyền). `ma` = khoá, `maHienThi` = chuỗi in cho người đọc. no-store. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await chungNhanOnline(hs, nguoi)));
}
