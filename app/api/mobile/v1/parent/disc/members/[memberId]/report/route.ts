import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, docBaoCaoCaNhan } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/disc/members/:memberId/report — P-Disc-ca-nhan: báo cáo đầy đủ của một người. Id lạ / của sổ khác / chưa có bài ⇒ 404. */
export async function GET(req: Request, ctx: { params: Promise<{ memberId: string }> }) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  const { memberId } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docBaoCaoCaNhan(nguoi, memberId)));
}
