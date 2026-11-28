import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { khoaMuaDuocChoCon } from "@/lib/mobile-api/dich-vu/online-mua";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/purchasable — khoá ĐANG BÁN mà con này mua/gia hạn được + giá máy chủ (cùng luật với tạo đơn). Chỉ phụ huynh (chế độ học sinh ⇒ 403). */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await khoaMuaDuocChoCon(nguoi.userId, hs)));
}
