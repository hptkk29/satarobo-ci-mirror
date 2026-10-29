-- AI LEAD GATEWAY — SỰ CỐ MỞ LẠI (11/11/2026).
-- Bối cảnh: sự cố Agent đã ĐÓNG mà tái diễn cùng ngày được mở lại (incident.ts) nhưng cron leo thang vẫn tính mốc từ `firstSeenAt` (lúc phát hiện lần đầu), nên sự cố mở lại sau nhiều giờ bị
-- leo thang NGAY bằng các bậc cũ, hoặc không leo thang vì khoá thông báo bậc cũ đã dùng. Thêm hai cột để mốc và khoá theo LẦN MỞ LẠI.
--
-- ⚠️ CHỈ THÊM: hai cột vào `AiLeadIncident` (bảng của chính gói AI Lead; chưa có dòng nào trên PROD). Cột nullable / có DEFAULT hằng ⇒ không viết lại bảng, không backfill.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): `ADD COLUMN IF NOT EXISTS`.

ALTER TABLE "AiLeadIncident" ADD COLUMN IF NOT EXISTS "moLaiLuc" TIMESTAMPTZ(6);
ALTER TABLE "AiLeadIncident" ADD COLUMN IF NOT EXISTS "soLanMoLai" INTEGER NOT NULL DEFAULT 0;
