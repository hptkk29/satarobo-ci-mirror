-- BGĐ 31/07 — nguồn giới thiệu (affiliate): mã giới thiệu + link ?ref= gắn lead về
-- đúng người. Hoa hồng affiliate chờ quy chế BGĐ → model chỉ ghi nguồn + % tham chiếu.

CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "userId" TEXT,
    "centerId" TEXT,
    "commissionPercent" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");
CREATE INDEX "Affiliate_isActive_idx" ON "Affiliate"("isActive");
CREATE INDEX "Affiliate_centerId_idx" ON "Affiliate"("centerId");

ALTER TABLE "Lead" ADD COLUMN "affiliateId" TEXT;
CREATE INDEX "Lead_affiliateId_idx" ON "Lead"("affiliateId");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
