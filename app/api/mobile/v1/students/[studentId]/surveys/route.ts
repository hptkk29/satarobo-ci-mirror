import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layKhaoSat } from "@/lib/mobile-api/dich-vu/khao-sat";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/surveys — khảo sát «mục góp ý» đang mở (kèm câu hỏi) + lịch sử đã gửi của con. Thang NPS 0–10; KHÔNG ẩn danh (OD-16). */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layKhaoSat(hs)));
}
