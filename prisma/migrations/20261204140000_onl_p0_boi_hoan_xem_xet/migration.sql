-- P0 Mobile (Agent E) — thay TRẦN CỨNG bồi hoàn bằng cơ chế XEM XÉT: vượt ngưỡng ⇒ chờ Admin quyết định (không âm thầm từ chối).
-- Cộng thêm: hai giá trị enum + ba cột NULL. Giá trị enum mới chỉ được DÙNG ở mã ứng dụng (không dùng trong chính migration này). CHẠY LẠI ĐƯỢC (MIG-01).
ALTER TYPE "OnlInterruptionStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "OnlInterruptionStatus" ADD VALUE IF NOT EXISTS 'DENIED';

ALTER TABLE "OnlAttemptInterruption" ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT;
ALTER TABLE "OnlAttemptInterruption" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ(6);
ALTER TABLE "OnlAttemptInterruption" ADD COLUMN IF NOT EXISTS "reviewReason" TEXT;
