import "server-only";
// lib/payments/pos/agent/sang.ts — CRON 07:30 SÁNG (giờ VN) của máy đồng bộ (GĐ4 POS). Thiết kế §8.3 (T22, T23).
//
// Route `/api/cron/pos-agent-sang` — `vercel.json` `30 0 * * *` (UTC) = `deploy/crontab.example` `30 7 * * *` (VN).
//   · phiên READY có `sessionExpiresAt` < 21:00 hôm nay ⇒ "Phiên CSx hết hạn lúc hh:mm hôm nay — đăng nhập lại trước
//     giờ mở cửa." (`pos.agent-sap-het-phien:<cơ sở>:<ngày>`);
//   · phiên ĐANG EXPIRED ⇒ chuông hết phiên của NGÀY MỚI (chuông hôm qua có thể đã bị đọc rồi quên);
//   · không biết mốc hết hạn (`null`) ⇒ bỏ qua.
// Một lịch riêng (không "phút bất kỳ khớp 07:30" trong cron mỗi phút — lỡ phút là mất chuông).
import { db } from "@/lib/db";
import { canBaoSang, nhanCoSo } from "./canh-bao-luat";
import { baoHetPhien, baoSapHetPhien } from "./canh-bao";

export async function chayCanhBaoSang(x: { dongHo: () => Date }): Promise<{ sapHetPhien: number; hetPhien: number }> {
  const now = x.dongHo();
  const kq = { sapHetPhien: 0, hetPhien: 0 };
  const agents = await db.posAgent.findMany({
    where: { active: true },
    select: { centerId: true, sessionState: true, sessionExpiresAt: true, sessionDoiLuc: true, center: { select: { code: true, name: true } } },
  });
  for (const a of agents) {
    const coSo = nhanCoSo(a.center);
    if (a.sessionState === "EXPIRED") {
      await baoHetPhien({ centerId: a.centerId, coSo, luc: a.sessionDoiLuc ?? now, now, reopen: false });
      kq.hetPhien += 1;
    } else if (a.sessionState === "READY" && a.sessionExpiresAt !== null && canBaoSang(a.sessionExpiresAt, now)) {
      await baoSapHetPhien({ centerId: a.centerId, coSo, hetLuc: a.sessionExpiresAt, now });
      kq.sapHetPhien += 1;
    }
  }
  return kq;
}
