import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layDanhMucQua } from "@/lib/mobile-api/dich-vu/doi-qua";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/gifts — danh mục quà đang mở (kèm còn/hết theo cơ sở của bé) + số dư / đang giữ / khả dụng. Cờ SataCoin TẮT ⇒ 404. Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layDanhMucQua(hs)));
}
