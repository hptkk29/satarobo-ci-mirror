-- 25/11/2026 (tích hợp A+E): viết lại cho CHẠY LẠI ĐƯỢC (IF NOT EXISTS / DO $$ … $$) theo luật [MIG-01]; hiệu ứng trên DB trống KHÔNG đổi. Bản cũ chưa áp ở UAT/TEST/PROD (chỉ DB cục bộ của A).
-- V8.29 (A) — DomainEvent: THUÊ XỬ LÝ (lease) để reaper không thu hồi nhầm sự kiện đang được xử lý hợp lệ.
-- CHỈ CỘNG THÊM (additive, forward-only): 3 cột NULLABLE, KHÔNG backfill, KHÔNG đổi/xoá cột nào, KHÔNG khoá bảng lâu (ALTER ADD COLUMN nullable không ghi lại bảng).
--   claimedAt   — lúc dispatcher NHẬN sự kiện (đầu lượt xử lý này). Đo thời gian xử lý = processedAt − claimedAt.
--   claimedBy   — định danh worker đang giữ (hàng rào: chỉ chủ lease được ghi kết quả).
--   heartbeatAt — nhịp tim của worker khi handler chạy lâu; reaper chỉ thu hồi khi nhịp tim (hoặc claimedAt) quá hạn.
-- Tương thích dữ liệu cũ: hàng PROCESSING cũ không có 3 cột ⇒ reaper rơi về createdAt (đúng hành vi cũ). Mã cũ chạy bình thường khi 3 cột có mặt (bỏ qua chúng).
-- THỨ TỰ TRIỂN KHAI: migration TRƯỚC, mã dispatcher mới SAU (mã mới cần cột). Hoàn tác = chỉ hoàn tác MÃ; cột để nguyên (vô hại). Chỉ khi chắc chắn mới dọn:
--   -- DROP INDEX "DomainEvent_status_claimedAt_idx"; ALTER TABLE "DomainEvent" DROP COLUMN "heartbeatAt", DROP COLUMN "claimedBy", DROP COLUMN "claimedAt";
ALTER TABLE "DomainEvent" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "claimedBy" TEXT,
ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "DomainEvent_status_claimedAt_idx" ON "DomainEvent"("status", "claimedAt");
