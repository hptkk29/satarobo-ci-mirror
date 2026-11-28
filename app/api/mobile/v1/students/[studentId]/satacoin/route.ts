import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { laySataCoin } from "@/lib/mobile-api/dich-vu/satacoin";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/satacoin — số dư + lịch sử SataCoin, CHỈ ĐỌC. Cờ `PORTAL_SATACOIN_ENABLED` TẮT (mặc định; chủ dự án ẩn từ 04/11/2026) ⇒ 404 như web. Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => {
    const d = await laySataCoin(hs);
    if (!d) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    return traThanhCong(d);
  });
}
