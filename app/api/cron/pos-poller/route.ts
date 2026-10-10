import { withCron } from "@/lib/cron/handler";
import { chayPollerPos } from "@/lib/payments/pos/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Ngân sách một lượt 40 giây (`NGAN_SACH_POLLER_MS`) + đọc tập — lượt cron mỗi phút không chồng nhau. */
export const maxDuration = 60;

// GĐ2 POS (docs/pos-gd2-thiet-ke.md §3) — POLLER phiếu thu thẻ, mỗi phút (`vercel.json` `* * * * *`,
// `deploy/crontab.example` khối "Mỗi phút" + khối TEST). Kiểm phiếu MỞ đến nhịp qua `kiemTraPhieuPos`
// (nguồn POLLER — chịu cửa sổ chống bấm dồn 5 giây), phiếu quá 24 giờ: kiểm lần cuối rồi ghi HET_HAN.
// Không cờ bật/tắt (U18): gỡ khẩn = comment dòng trong crontab ĐÃ CÀI trên VPS.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
// Đồng hồ là HÀM — mỗi phiếu một mốc mới (lưới `[POS2-CRON-02]`).
export const GET = withCron("pos-poller", async () => ({
  ok: true,
  data: await chayPollerPos({ dongHo: () => new Date() }),
}));
