import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layHocBa } from "@/lib/mobile-api/dich-vu/nhan-xet";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/report-card — học bạ của MỘT con (bản chính thức nếu đã phát hành, không thì bản tạm tính — `laChinhThuc` nói rõ). Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => {
    const h = await layHocBa(hs);
    if (!h) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    return traThanhCong(h);
  });
}
