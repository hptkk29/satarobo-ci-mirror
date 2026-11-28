import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { layNguoiDon, themNguoiDon, themNguoiDonSchema } from "@/lib/mobile-api/dich-vu/ho-so-ghi";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/pickup-contacts — người ĐƯỢC PHÉP ĐÓN con (đang hiệu lực). Cổng C; bị chặn ở chế độ học sinh. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layNguoiDon(hs)));
}

/** POST — thêm một người đón (≤ 5 người/bé, không trùng SĐT; SĐT chuẩn hoá). Có AUDIT. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, themNguoiDonSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await themNguoiDon(hs, nguoi, thanDl)));
}
