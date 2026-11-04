-- Module CRM & Lead PHẦN 2 — cấu hình chia lead + loại hoạt động HANDOVER

-- AlterEnum
ALTER TYPE "LeadActivityType" ADD VALUE IF NOT EXISTS 'HANDOVER';

-- CreateEnum
CREATE TYPE "LeadAssignMode" AS ENUM ('ROUND_ROBIN', 'CLOSE_RATE', 'MANUAL');

-- CreateTable
CREATE TABLE "LeadAssignmentConfig" (
  "id" TEXT NOT NULL,
  "centerId" TEXT NOT NULL,
  "mode" "LeadAssignMode" NOT NULL DEFAULT 'ROUND_ROBIN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadAssignmentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadAssignmentConfig_centerId_key" ON "LeadAssignmentConfig"("centerId");
