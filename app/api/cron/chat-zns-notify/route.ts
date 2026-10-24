import { withCron } from "@/lib/cron/handler";
import { sendChatZnsNotifications } from "@/lib/chat/zns-notify";

export const dynamic = "force-dynamic";

// US-14 — nhắc phụ huynh qua ZNS khi tin nhắn của GV/QLCS trong NHÓM LỚP nằm chưa đọc
// quá ngưỡng (mặc định 6 tiếng; ô riêng cho THÔNG BÁO). Nhắn riêng (DM) không bao giờ gửi.
//
// Chạy mỗi 30 phút (vercel.json `*/30 * * * *`) vì ngưỡng có thể hạ xuống 30 phút cho
// THÔNG BÁO mà không cần deploy — cron thưa hơn thì ô cấu hình đó thành vô nghĩa.
// KHÔNG bó lịch cron vào khung giờ cho phép: luật khung cấm 22:00–06:00 VN nằm ở
// `isVnQuietHour` (lib/chat/zns-notify-rules.ts) và chỉ được có MỘT bản. Lượt rơi vào
// khung cấm trả về ngay `reason: "QUIET_HOURS"`, gần như không tốn gì.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch
// JSON có cấu trúc (API-18). Kill switch nhanh nhất KHÔNG phải xoá cron mà là tắt
// `chat.znsNotifyEnabled` ở /admin/cau-hinh-van-hanh (hiệu lực trong ≤5 phút, cache setting).
export const GET = withCron("chat-zns-notify", async () => {
  const data = await sendChatZnsNotifications(new Date());
  return { ok: true, data };
});
