-- R7-17 — dedupeKey cho Notification sinh từ DomainEvent (idempotent handler).
-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex (unique; nhiều NULL được phép — announcement thủ công không set key)
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
