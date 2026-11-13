-- R1-07 — AdsInsightDaily (SR.QD.217). Additive.

-- CreateTable
CREATE TABLE "AdsInsightDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'META_API',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsInsightDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdsInsightDaily_date_channel_key" ON "AdsInsightDaily"("date", "channel");

-- CreateIndex
CREATE INDEX "AdsInsightDaily_date_idx" ON "AdsInsightDaily"("date");
