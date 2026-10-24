import { withCron } from "@/lib/cron/handler";
import { donTepHoaDonMoCoi } from "@/lib/finance/hoa-don/don-tep-mo-coi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trần thời gian một lượt: liệt kê kho theo trang (1000 khoá/trang) + một câu tra tham chiếu + một lệnh
 * xoá lô (≤200 khoá). Tiền lệ khai `maxDuration`: `app/api/cron/email-queue/route.ts`.
 */
export const maxDuration = 60;

// Hoá đơn điện tử (docs/ke-toan-hoa-don/PLAN.md §6) — dọn tệp PDF/XML đã PUT lên kho hoá đơn mà không
// hoá đơn nào lưu (kế toán đổi dòng / đóng tab). Hằng tuần, Chủ nhật 04:00 giờ VN
// (`deploy/crontab.example`; `vercel.json` UTC `0 21 * * 6`).
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc.
// Idempotent: lượt nào chạm trần 200 tệp thì lượt tuần sau dọn tiếp đúng chỗ đang dở. Kho chưa cấu hình
// ⇒ 200 kèm `boQua`, không ném. Luật "xoá được khoá nào": `lib/finance/hoa-don/tep-mo-coi.ts`.
export const GET = withCron("hoa-don-tep-mo-coi", async () => ({
  ok: true,
  data: await donTepHoaDonMoCoi(new Date()),
}));
