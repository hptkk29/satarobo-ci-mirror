-- Module CRM & Lead PHẦN 3/4 — chuyển lead + note bàn giao

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "handoverNote" TEXT;

-- CreateTable
CREATE TABLE "LeadTransfer" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "fromCenterId" TEXT,
  "toCenterId" TEXT,
  "fromSaleId" TEXT,
  "toSaleId" TEXT,
  "note" TEXT NOT NULL,
  "reason" TEXT,
  "transferredById" TEXT,
  "transferredByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadTransfer_createdAt_idx" ON "LeadTransfer"("createdAt");
CREATE INDEX "LeadTransfer_leadId_idx" ON "LeadTransfer"("leadId");
CREATE INDEX "LeadTransfer_fromCenterId_toCenterId_idx" ON "LeadTransfer"("fromCenterId", "toCenterId");
