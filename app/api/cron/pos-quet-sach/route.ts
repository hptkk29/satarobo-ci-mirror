import { withCron } from "@/lib/cron/handler";
import { quetSachPhieuPos } from "@/lib/payments/pos/quet-sach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Ngân sách quét 240 giây (`NGAN_SACH_QUET_SACH_MS`) — `deploy/cron-call.sh` cắt lượt gọi ở 300 giây. */
export const maxDuration = 300;

// GĐ2 POS (docs/pos-gd2-thiet-ke.md §5) — QUÉT SẠCH phiếu thu thẻ cuối ngày, 23:30 giờ VN (`vercel.json`
// `30 16 * * *` UTC; `deploy/crontab.example` khối "Hằng ngày (giờ VN)" + khối TEST). Kiểm MỌI phiếu còn
// mở qua `kiemTraPhieuPos` (nguồn QUET_SACH); phiếu vừa được ghi nhận ⇒ một chuông/ngày cho Kế toán HO.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
// Đồng hồ là HÀM — mỗi phiếu một mốc mới (lưới `[POS2-CRON-02b]`).
export const GET = withCron("pos-quet-sach", async () => ({
  ok: true,
  data: await quetSachPhieuPos({ dongHo: () => new Date() }),
}));
