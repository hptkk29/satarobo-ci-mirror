import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, thanRong, xoaLanLam } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/results/:resultId/delete — xoá một lần làm bài của sổ này (kèm các bản phân tích đã dùng nó). Id lạ / của sổ khác ⇒ 404. */
export async function POST(req: Request, ctx: { params: Promise<{ resultId: string }> }) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  const { resultId } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, thanRong, async (nguoi) => traThanhCong(await xoaLanLam(nguoi, resultId)));
}
