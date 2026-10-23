import { withCron } from "@/lib/cron/handler";
import { chayGiamSatAgent } from "@/lib/payments/pos/agent/giam-sat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GĐ4 POS (docs/pos-gd4-thiet-ke.md §8.3) — GIÁM SÁT máy đồng bộ, mỗi phút (`vercel.json` `* * * * *`,
// `deploy/crontab.example` khối "Mỗi phút" + khối TEST): agent im > 5′ ⇒ đánh dấu + (trong giờ 08:00–21:00 thứ Ba–CN)
// chuông `pos.agent-mat-ket-noi:`; job "đồng bộ ngay" > 2′ ⇒ EXPIRED; dọn nonce > 15′. KHÔNG ghi tiền / quyền.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
// Đồng hồ là HÀM (luật 19 ở lib — lưới [POS4-CRON-01]).
export const GET = withCron("pos-agent-giam-sat", async () => ({
  ok: true,
  data: await chayGiamSatAgent({ dongHo: () => new Date() }),
}));
