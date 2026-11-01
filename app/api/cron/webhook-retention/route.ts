import { withCron } from "@/lib/cron/handler";
import { donWebhookDelivery } from "@/lib/compliance/webhook-retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// S9-B7 (tích hợp ZaloCRM) — dọn dấu vết webhook + outbox sự kiện, mỗi ngày 01:00 VN
// (vercel.json: `0 18 * * *` UTC — giờ vắng, không đụng nhịp của cron nào khác).
//
// Vì sao có cron này: `WebhookDelivery.payload` lưu payload THÔ của mọi webhook — tên
// và số điện thoại phụ huynh nằm nguyên văn trong đó — còn `DomainEvent.payloadJson`
// lưu payload sự kiện. Trước hôm nay KHÔNG cron nào dọn hai bảng đó, tức dữ liệu cá
// nhân nằm vô thời hạn, không chủ sở hữu, và đi theo mọi bản sao DB. Với ZaloCRM (mỗi
// tin nhắn một dòng) bảng còn phình nhanh hơn hẳn webhook lead.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch
// JSON có cấu trúc (API-18). KHÔNG auto-retry: cron này idempotent, đêm sau chạy lại
// là dọn tiếp đúng chỗ đang dở (kể cả khi lượt trước chạm trần lô).
//
// Kill switch: xoá entry cron trong vercel.json — hệ chạy tiếp, chỉ ngừng dọn.
export const GET = withCron("webhook-retention", async () => {
  const data = await donWebhookDelivery();
  return { ok: true, data };
});
