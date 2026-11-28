import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { huyYeuCau } from "@/lib/mobile-api/dich-vu/yeu-cau";
import { huyYeuCauParams } from "@/lib/mobile-api/schema/yeu-cau";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/requests/:requestId/cancel — huỷ yêu cầu đang chờ / rút đơn xin nghỉ đã tiếp nhận (đúng luật web). Đơn của con khác ⇒ 404. Cổng C. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; requestId: string }> }) {
  const { studentId, requestId } = await ctx.params;
  const p = huyYeuCauParams.safeParse({ requestId });
  if (!p.success) return chayTheoHocVien(req, studentId, async () => traThanhCong({ daXong: false }));
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await huyYeuCau(hs, nguoi.userId, p.data.requestId)));
}
