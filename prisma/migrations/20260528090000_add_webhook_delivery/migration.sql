-- Phase T1.4 — WebhookDelivery (log nhận lead tự động)
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'DUPLICATE');

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_source_externalId_idx" ON "WebhookDelivery"("source", "externalId");
CREATE INDEX "WebhookDelivery_status_receivedAt_idx" ON "WebhookDelivery"("status", "receivedAt");
