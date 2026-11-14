-- R1-09 — MarketingCostPeriod (SR.QD.217). Additive.

-- CreateEnum
CREATE TYPE "CostPeriodStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REOPENED');

-- CreateTable
CREATE TABLE "MarketingCostPeriod" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalQcCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CostPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCostPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCostPeriod_period_key" ON "MarketingCostPeriod"("period");
