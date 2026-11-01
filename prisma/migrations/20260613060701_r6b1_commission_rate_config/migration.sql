-- CreateTable
CREATE TABLE "CommissionRateConfig" (
    "id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRateConfig_tier_effectiveFrom_idx" ON "CommissionRateConfig"("tier", "effectiveFrom");
