-- Cụm C5 — Zalo OA/ZNS adapter (skeleton) + delivery log

CREATE TYPE "ZaloMessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "ZaloMessageLog" (
  "id" TEXT NOT NULL,
  "toPhone" TEXT,
  "templateKey" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" "ZaloMessageStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "fallbackEmailed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "ZaloMessageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ZaloMessageLog_status_createdAt_idx" ON "ZaloMessageLog"("status","createdAt");
