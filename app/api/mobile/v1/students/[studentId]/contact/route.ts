import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layLienHeHocSinh } from "@/lib/mobile-api/dich-vu/lien-he-hoc-sinh";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/contact — `{soHien, gioMoCua, tenCoSo}` của cơ sở của CHÍNH em; mở cho Student Mode (KHÔNG có zaloUrl / số `tel:` — trẻ em không có liên kết ngoài). Cổng sở hữu. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layLienHeHocSinh(hs, nguoi.userId)));
}
