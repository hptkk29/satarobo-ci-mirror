import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, camOnViecSo, thanRong } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/plan/tasks/:taskId/thanks — gửi lời cảm ơn cho việc đã làm có người nhận (một lần). Id lạ / của sổ khác ⇒ 404. */
export async function POST(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  const { taskId } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, thanRong, async (nguoi) => traThanhCong(await camOnViecSo(nguoi, taskId)));
}
