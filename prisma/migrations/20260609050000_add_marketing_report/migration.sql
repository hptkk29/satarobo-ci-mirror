-- R1-12 — MarketingReport (snapshot tuần/tháng). Additive.

-- CreateEnum
CREATE TYPE "ReportPeriodType" AS ENUM ('WEEK', 'MONTH');

-- CreateTable
CREATE TABLE "MarketingReport" (
    "id" TEXT NOT NULL,
    "periodType" "ReportPeriodType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingReport_periodType_periodKey_submittedById_key" ON "MarketingReport"("periodType", "periodKey", "submittedById");

-- CreateIndex
CREATE INDEX "MarketingReport_periodType_periodKey_idx" ON "MarketingReport"("periodType", "periodKey");
