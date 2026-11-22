import "server-only";
// lib/payments/pos/agent/nhip-doc.ts — đọc dữ liệu cho `tinhNextPollMs` (GĐ4 POS — T17). Hai câu, mỗi câu
// `take: 1` (chỉ cần biết CÓ hay không). Luật quyết ở `nhip.ts` (thuần, ca [POS4-NP-01]).
import { db } from "@/lib/db";
import { JOB_SONG_MS, PHIEU_MO_GAN_MS } from "./hop-dong";
import { tinhNextPollMs } from "./nhip";
import { TRANG_THAI_MO } from "../phieu-pos-luat";

export async function docNextPollMs(agent: { id: string; centerId: string }, now: Date): Promise<number> {
  const [jobPending, phieu] = await Promise.all([
    db.posCheckJob.findMany({
      where: { agentId: agent.id, status: "PENDING", createdAt: { gte: new Date(now.getTime() - JOB_SONG_MS), lte: now } },
      select: { createdAt: true },
      take: 1,
    }),
    db.posPaymentIntent.findMany({
      where: {
        centerId: agent.centerId,
        status: { in: [...TRANG_THAI_MO] },
        createdAt: { gt: new Date(now.getTime() - PHIEU_MO_GAN_MS), lte: now },
      },
      select: { createdAt: true, centerId: true, status: true },
      take: 1,
    }),
  ]);
  return tinhNextPollMs({ now, centerIdAgent: agent.centerId, jobPending, phieu });
}
