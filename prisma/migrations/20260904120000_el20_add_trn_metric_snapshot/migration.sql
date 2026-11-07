-- EL-20 - anh chup chi so theo ky (TrnMetricSnapshot).
--
-- CHI ADD. Bang hoan toan MOI, rong tren prod. Cac dong troi dat san co cua kho da loc bo.

-- CreateTable
CREATE TABLE "TrnMetricSnapshot" (
    "id" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "dimensionJson" JSONB NOT NULL DEFAULT '{}',
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,
    "groupN" INTEGER NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dimensionKey" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TrnMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrnMetricSnapshot_metricKey_periodEnd_idx" ON "TrnMetricSnapshot"("metricKey", "periodEnd");

-- CreateIndex
CREATE INDEX "TrnMetricSnapshot_centerId_idx" ON "TrnMetricSnapshot"("centerId");

-- CreateIndex
CREATE INDEX "TrnMetricSnapshot_orgUnitId_idx" ON "TrnMetricSnapshot"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnMetricSnapshot_metricKey_periodStart_periodEnd_dimension_key" ON "TrnMetricSnapshot"("metricKey", "periodStart", "periodEnd", "dimensionKey");

-- Bảng MỚI tự bật RLS (luật .claude/rules/prisma-db.md). Chỉ ENABLE, không FORCE, không policy.
ALTER TABLE "TrnMetricSnapshot" ENABLE ROW LEVEL SECURITY;
