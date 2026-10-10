-- Module Chấm công PHẦN 4 — yêu cầu chỉnh công + log chỉnh sửa

-- CreateEnum
CREATE TYPE "AdjustStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TimesheetAdjustmentRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "centerId" TEXT,
  "date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "requested" TEXT,
  "status" "AdjustStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedByName" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimesheetAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "field" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "reason" TEXT,
  "editedById" TEXT,
  "editedByName" TEXT,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimesheetEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimesheetAdjustmentRequest_status_createdAt_idx" ON "TimesheetAdjustmentRequest"("status", "createdAt");
CREATE INDEX "TimesheetAdjustmentRequest_userId_date_idx" ON "TimesheetAdjustmentRequest"("userId", "date");
CREATE INDEX "TimesheetAdjustmentRequest_centerId_date_idx" ON "TimesheetAdjustmentRequest"("centerId", "date");
CREATE INDEX "TimesheetEditLog_userId_date_idx" ON "TimesheetEditLog"("userId", "date");
CREATE INDEX "TimesheetEditLog_createdAt_idx" ON "TimesheetEditLog"("createdAt");
