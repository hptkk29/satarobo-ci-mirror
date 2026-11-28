-- WP8 (19/11/2026) — Đổi quà SataCoin: danh mục quà, tồn kho theo cơ sở, yêu cầu đổi.
-- CỘNG THÊM (3 bảng mới + 1 enum); KHÔNG đụng SataCoinTransaction / SataCoinRule / CoinRuleConfig.
-- Bảng mới ⇒ bật RLS ở cuối (chỉ ENABLE, không FORCE, không policy — khuôn 20260825120000_lead_status_history).

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SataCoinRedemptionStatus') THEN CREATE TYPE "SataCoinRedemptionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DELIVERED', 'REJECTED', 'CANCELLED'); END IF; END $$;

CREATE TABLE IF NOT EXISTS "SataCoinGift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coinCost" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SataCoinGift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SataCoinGift_coinCost_positive_chk" CHECK ("coinCost" > 0)
);

CREATE TABLE IF NOT EXISTS "SataCoinGiftStock" (
    "id" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "quantity" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SataCoinGiftStock_pkey" PRIMARY KEY ("id"),
    -- Hàng rào CUỐI chống bán quá tồn kho: dù mã sai, DB từ chối quantity âm.
    CONSTRAINT "SataCoinGiftStock_quantity_nonneg_chk" CHECK ("quantity" >= 0)
);

CREATE TABLE IF NOT EXISTS "SataCoinRedemption" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "coinCost" INTEGER NOT NULL,
    "status" "SataCoinRedemptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "spendTxId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SataCoinRedemption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SataCoinRedemption_coinCost_positive_chk" CHECK ("coinCost" > 0)
);

CREATE INDEX IF NOT EXISTS "SataCoinGift_isActive_sortOrder_idx" ON "SataCoinGift"("isActive", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "SataCoinGiftStock_giftId_centerId_key" ON "SataCoinGiftStock"("giftId", "centerId");
CREATE INDEX IF NOT EXISTS "SataCoinGiftStock_centerId_idx" ON "SataCoinGiftStock"("centerId");
CREATE INDEX IF NOT EXISTS "SataCoinGiftStock_orgUnitId_idx" ON "SataCoinGiftStock"("orgUnitId");
CREATE UNIQUE INDEX IF NOT EXISTS "SataCoinRedemption_spendTxId_key" ON "SataCoinRedemption"("spendTxId");
CREATE UNIQUE INDEX IF NOT EXISTS "SataCoinRedemption_studentId_idempotencyKey_key" ON "SataCoinRedemption"("studentId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "SataCoinRedemption_studentId_status_idx" ON "SataCoinRedemption"("studentId", "status");
CREATE INDEX IF NOT EXISTS "SataCoinRedemption_centerId_status_idx" ON "SataCoinRedemption"("centerId", "status");
CREATE INDEX IF NOT EXISTS "SataCoinRedemption_orgUnitId_idx" ON "SataCoinRedemption"("orgUnitId");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SataCoinGiftStock_giftId_fkey') THEN ALTER TABLE "SataCoinGiftStock" ADD CONSTRAINT "SataCoinGiftStock_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "SataCoinGift"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SataCoinRedemption_studentId_fkey') THEN ALTER TABLE "SataCoinRedemption" ADD CONSTRAINT "SataCoinRedemption_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SataCoinRedemption_giftId_fkey') THEN ALTER TABLE "SataCoinRedemption" ADD CONSTRAINT "SataCoinRedemption_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "SataCoinGift"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

ALTER TABLE "SataCoinGift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SataCoinGiftStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SataCoinRedemption" ENABLE ROW LEVEL SECURITY;
