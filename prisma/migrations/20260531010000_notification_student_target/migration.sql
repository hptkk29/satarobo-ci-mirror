-- Đợt 6 #7 — gửi thông báo cho 1 học viên/phụ huynh cụ thể

-- AlterEnum
ALTER TYPE "NotificationAudience" ADD VALUE IF NOT EXISTS 'STUDENT';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "studentId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_studentId_idx" ON "Notification"("studentId");
