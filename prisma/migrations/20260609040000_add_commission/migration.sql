-- R1-10 — CommissionStatement + CommissionLine (SR.QD.217, tiền). Additive.

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REOPENED');

-- CreateTable
CREATE TABLE "CommissionStatement" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "isClawback" BOOLEAN NOT NULL DEFAULT false,
    "leadId" TEXT,

    CONSTRAINT "CommissionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionStatement_period_key" ON "CommissionStatement"("period");

-- CreateIndex
CREATE INDEX "CommissionLine_statementId_idx" ON "CommissionLine"("statementId");

-- CreateIndex
CREATE INDEX "CommissionLine_recipientId_idx" ON "CommissionLine"("recipientId");

-- AddForeignKey
ALTER TABLE "CommissionLine" ADD CONSTRAINT "CommissionLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CommissionStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
