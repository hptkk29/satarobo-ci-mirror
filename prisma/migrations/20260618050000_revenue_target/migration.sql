-- LMS-16 — mục tiêu doanh thu (KPI) theo cơ sở × kỳ.
CREATE TABLE "RevenueTarget" (
  "id"        TEXT NOT NULL,
  "centerId"  TEXT,
  "period"    TEXT NOT NULL,
  "amount"    INTEGER NOT NULL,
  "note"      TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "RevenueTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RevenueTarget_centerId_period_key" ON "RevenueTarget"("centerId", "period");
CREATE INDEX "RevenueTarget_period_idx" ON "RevenueTarget"("period");
