-- Cụm A2 — Email queue

-- CreateEnum
CREATE TYPE "EmailQueueStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "EmailQueue" (
  "id" TEXT NOT NULL,
  "toEmail" TEXT NOT NULL,
  "toName" TEXT,
  "templateKey" TEXT,
  "subject" TEXT,
  "bodyText" TEXT,
  "bodyHtml" TEXT,
  "payload" JSONB NOT NULL,
  "status" "EmailQueueStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "error" TEXT,
  "contextType" TEXT,
  "contextId" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "emailLogId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailQueue_status_scheduledAt_idx" ON "EmailQueue"("status", "scheduledAt");
CREATE INDEX "EmailQueue_contextType_contextId_idx" ON "EmailQueue"("contextType", "contextId");
CREATE INDEX "EmailQueue_createdAt_idx" ON "EmailQueue"("createdAt");
