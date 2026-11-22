import { withCron } from "@/lib/cron/handler";
import { chayCanhBaoSang } from "@/lib/payments/pos/agent/sang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GĐ4 POS (docs/pos-gd4-thiet-ke.md §8.3) — 07:30 giờ VN (`vercel.json` `30 0 * * *` UTC, `deploy/crontab.example`
// `30 7 * * *` + khối TEST): phiên portal hết hạn trước 21:00 hôm nay ⇒ chuông "đăng nhập lại trước giờ mở cửa";
// phiên đang hết ⇒ chuông hết phiên của ngày mới. KHÔNG ghi tiền / quyền.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
export const GET = withCron("pos-agent-sang", async () => ({
  ok: true,
  data: await chayCanhBaoSang({ dongHo: () => new Date() }),
}));
