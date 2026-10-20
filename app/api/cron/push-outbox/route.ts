import { withCron } from "@/lib/cron/handler";
import { chayLuotGuiPush } from "@/lib/push/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trần thời gian một lượt. Mỗi thiết bị là MỘT request HTTPS ra push service, nên một lô xấu
 * (nhiều máy, mạng chậm) chạm trần được. Engine tự dừng ở `NGAN_SACH_MS` (45s) để phần chưa xử
 * còn nguyên `PENDING` cho lượt sau; 60s ở đây là lưới ngoài cùng.
 *
 * Tiền lệ khai `maxDuration` trong repo: `app/api/cron/orgunit-drift/route.ts`.
 */
export const maxDuration = 60;

// US-14b Đợt 4 — worker gửi Web Push cho NHÂN VIÊN, quét `WebPushOutbox`.
//
// Nhịp MỖI PHÚT (`vercel.json`) vì lời hứa duy nhất của tính năng là chữ "ngay": một lead báo
// sau 30 phút thì khách đã gọi xong ba trung tâm khác. Lượt lúc kênh đang tắt gần như không tốn
// gì — engine đọc công tắc rồi thoát trước mọi truy vấn bảng.
//
// ⚠️ `runtime = "nodejs"` BẮT BUỘC: gói `web-push` dùng `node:https` + `node:crypto`, rơi vào
// Edge runtime là chết câm. Tiền lệ: `app/api/cron/email-queue/route.ts`.
//
// KILL SWITCH nhanh nhất KHÔNG phải xoá dòng cron mà là tắt `push.webPushEnabled` ở
// /admin/cau-hinh-van-hanh. Hiệu lực trong ≤5 phút — `getSetting` cache `revalidate: 300`, và
// nhánh xoá cache theo tag chỉ ăn khi sửa từ Server Action (màn cấu hình có), nên đừng hứa với
// người vận hành là "tắt xong ngưng ngay".
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch trả JSON
// có cấu trúc (API-18). Số liệu trả ra (`sent`/`failed`/`dead`/`skippedRows`/`reaped`) là thứ
// duy nhất người trực đọc được: repo không gọi `captureException` ở đâu, nên lỗi nuốt trong
// engine là im lặng với Sentry.
export const GET = withCron("push-outbox", async () => {
  const data = await chayLuotGuiPush();
  return { ok: true, data };
});
