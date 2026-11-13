-- AFF-P1 (13/10/2026) — THEO DÕI & REFERRAL: link/QR/mã giới thiệu (`AffiliateTrackingAsset`), lượt bấm ẩn danh (`ReferralClick`), referral gắn lead (`AffiliateReferral`).
-- docs/source-commission/12-affiliate-kien-truc.md §2.2–§2.6.
--
-- ADDITIVE: 3 bảng + 4 enum MỚI, không đụng cột/bảng cũ. CHẠY LẠI ĐƯỢC ([MIG-01]). Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này.
-- Phần Prisma KHÔNG biểu diễn được: CHECK (định dạng token · nhất quán trạng thái ↔ cột thu hồi · referral hợp lệ phải có lead · khai tay phải có bằng chứng),
-- trigger BẤT BIẾN (định danh của link không đổi được sau khi phát; lượt bấm chỉ-thêm), RLS. Lưới duy nhất cho phần đó là ca DB [AFF-DB-*].

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateAssetType') THEN
    CREATE TYPE "AffiliateAssetType" AS ENUM ('LINK', 'QR', 'CODE');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateAssetStatus') THEN
    CREATE TYPE "AffiliateAssetStatus" AS ENUM ('ACTIVE', 'REVOKED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateReferralMethod') THEN
    CREATE TYPE "AffiliateReferralMethod" AS ENUM ('LINK', 'QR', 'CODE', 'MANUAL', 'OFFLINE', 'API');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateReferralStatus') THEN
    CREATE TYPE "AffiliateReferralStatus" AS ENUM ('VALID', 'REJECTED_DUPLICATE', 'MANUAL_REVIEW', 'DISPUTED', 'REJECTED');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateTrackingAsset" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "type" "AffiliateAssetType" NOT NULL DEFAULT 'LINK',
    "status" "AffiliateAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" TEXT,
    "revokedReason" TEXT,
    "rotatedFromId" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateTrackingAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReferralClick" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "referrerHost" TEXT,
    "utm" JSONB,
    "sessionKey" TEXT,

    CONSTRAINT "ReferralClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateReferral" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "membershipId" TEXT,
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT,
    "clickId" TEXT,
    "leadId" TEXT,
    "method" "AffiliateReferralMethod" NOT NULL,
    "status" "AffiliateReferralStatus" NOT NULL,
    "sourceGroupId" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "evidence" JSONB,
    "protectedUntil" TIMESTAMPTZ(6),
    "qualifiedAt" TIMESTAMPTZ(6),
    "rejectedAt" TIMESTAMPTZ(6),
    "resolutionReason" TEXT,
    "idempotencyKey" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateTrackingAsset_publicToken_key" ON "AffiliateTrackingAsset"("publicToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateTrackingAsset_partyId_status_idx" ON "AffiliateTrackingAsset"("partyId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateTrackingAsset_campaignId_status_idx" ON "AffiliateTrackingAsset"("campaignId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateTrackingAsset_membershipId_idx" ON "AffiliateTrackingAsset"("membershipId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateTrackingAsset_siteId_idx" ON "AffiliateTrackingAsset"("siteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateTrackingAsset_rotatedFromId_idx" ON "AffiliateTrackingAsset"("rotatedFromId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralClick_assetId_occurredAt_idx" ON "ReferralClick"("assetId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralClick_campaignId_occurredAt_idx" ON "ReferralClick"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralClick_partyId_occurredAt_idx" ON "ReferralClick"("partyId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralClick_sessionKey_idx" ON "ReferralClick"("sessionKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateReferral_idempotencyKey_key" ON "AffiliateReferral"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferral_partyId_createdAt_idx" ON "AffiliateReferral"("partyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferral_campaignId_status_idx" ON "AffiliateReferral"("campaignId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferral_leadId_idx" ON "AffiliateReferral"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferral_assetId_idx" ON "AffiliateReferral"("assetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferral_centerId_idx" ON "AffiliateReferral"("centerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferral_orgUnitId_idx" ON "AffiliateReferral"("orgUnitId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferral_status_createdAt_idx" ON "AffiliateReferral"("status", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_partyId_fkey' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_membershipId_fkey' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "AffiliateMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_campaignId_fkey' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_siteId_fkey' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "AffiliateSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_rotatedFromId_fkey' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "AffiliateTrackingAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralClick_assetId_fkey' AND conrelid = '"ReferralClick"'::regclass) THEN
    ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AffiliateTrackingAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_partyId_fkey' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_membershipId_fkey' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "AffiliateMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_campaignId_fkey' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_assetId_fkey' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AffiliateTrackingAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_clickId_fkey' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "ReferralClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_leadId_fkey' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_sourceGroupId_fkey' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_sourceGroupId_fkey" FOREIGN KEY ("sourceGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── CHECK — thứ Prisma không biết ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Token: 10 ký tự Crockford base32 (khớp lib/affiliate/token.ts — BANG_CHU_TOKEN, DO_DAI_TOKEN).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_token_chk' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_token_chk" CHECK ("publicToken" ~ '^[0-9A-HJKMNP-TV-Z]{10}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_duong_dan_chk' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_duong_dan_chk" CHECK ("landingPath" ~ '^/[^[:space:]?#]*$');
  END IF;
END $$;

-- Thu hồi ⇔ có mốc + lý do; link đang chạy KHÔNG mang dấu vết thu hồi.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_thu_hoi_chk' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_thu_hoi_chk"
      CHECK (("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedReason" IS NOT NULL) OR ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "revokedReason" IS NULL));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_khong_tu_xoay_chk' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_khong_tu_xoay_chk" CHECK ("rotatedFromId" IS NULL OR "rotatedFromId" <> "id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralClick_outcome_chk' AND conrelid = '"ReferralClick"'::regclass) THEN
    ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_outcome_chk" CHECK ("outcome" ~ '^[A-Z_]{2,40}$');
  END IF;
END $$;

-- Referral: VALID ⇒ đã gắn lead; từ chối ⇒ có mốc từ chối; link/QR/mã/API ⇒ có tài sản; khai tay/ngoài đời ⇒ có bằng chứng.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_valid_co_lead_chk' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_valid_co_lead_chk" CHECK ("status" <> 'VALID' OR "leadId" IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_tu_choi_chk' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_tu_choi_chk"
      CHECK (("status" IN ('REJECTED', 'REJECTED_DUPLICATE')) = ("rejectedAt" IS NOT NULL));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_tai_san_chk' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_tai_san_chk" CHECK ("method" NOT IN ('LINK', 'QR', 'CODE') OR "assetId" IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_bang_chung_chk' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_bang_chung_chk" CHECK ("method" NOT IN ('MANUAL', 'OFFLINE') OR "evidence" IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferral_idem_chk' AND conrelid = '"AffiliateReferral"'::regclass) THEN
    ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_idem_chk" CHECK ("idempotencyKey" IS NULL OR length("idempotencyKey") BETWEEN 8 AND 128);
  END IF;
END $$;

-- ── RLS: chỉ ENABLE (không FORCE, không policy) ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "AffiliateTrackingAsset" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ReferralClick" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateReferral" ENABLE ROW LEVEL SECURITY;

-- ── TRIGGER bất biến (khối thô: thân hàm có `;` nên KHÔNG đi qua bộ làm-idempotent; tự idempotent bằng CREATE OR REPLACE + DROP TRIGGER IF EXISTS) ──────────────
-- (1) Định danh của link không đổi sau khi phát: token, đối tác, membership, campaign, website, trang đích. Đổi một trong số đó là «link này nay trỏ chỗ khác» — người đã in QR
--     bị dẫn sang nơi họ không hề đồng ý. Muốn đổi thì THU HỒI rồi phát link mới (xoay mã). Chỉ trạng thái thu hồi, nhãn và `updatedAt` được sửa.
CREATE OR REPLACE FUNCTION "AffiliateTrackingAsset_bat_bien_fn"() RETURNS trigger AS $fn$
  BEGIN
  IF NEW."publicToken" IS DISTINCT FROM OLD."publicToken"
     OR NEW."partyId" IS DISTINCT FROM OLD."partyId"
     OR NEW."membershipId" IS DISTINCT FROM OLD."membershipId"
     OR NEW."campaignId" IS DISTINCT FROM OLD."campaignId"
     OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."landingPath" IS DISTINCT FROM OLD."landingPath"
     OR NEW."type" IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'AffiliateTrackingAsset: định danh của link không đổi được sau khi phát — thu hồi rồi phát link mới' USING ERRCODE = 'check_violation';
  END IF;
  -- Đã thu hồi thì không sống lại (xoay mã tạo dòng MỚI).
  IF OLD."status" = 'REVOKED' AND NEW."status" <> 'REVOKED' THEN
    RAISE EXCEPTION 'AffiliateTrackingAsset: link đã thu hồi không bật lại được — phát link mới' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
  END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AffiliateTrackingAsset_bat_bien" ON "AffiliateTrackingAsset";
CREATE TRIGGER "AffiliateTrackingAsset_bat_bien" BEFORE UPDATE ON "AffiliateTrackingAsset"
  FOR EACH ROW EXECUTE FUNCTION "AffiliateTrackingAsset_bat_bien_fn"();

-- (2) Lượt bấm CHỈ-THÊM: không sửa, không xoá (số liệu báo cáo phải kiểm lại được).
CREATE OR REPLACE FUNCTION "ReferralClick_chi_them_fn"() RETURNS trigger AS $fn$
  BEGIN
  RAISE EXCEPTION 'ReferralClick: sổ lượt bấm chỉ-thêm (không sửa/xoá)' USING ERRCODE = 'check_violation';
  END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ReferralClick_chi_them" ON "ReferralClick";
CREATE TRIGGER "ReferralClick_chi_them" BEFORE UPDATE OR DELETE ON "ReferralClick"
  FOR EACH ROW EXECUTE FUNCTION "ReferralClick_chi_them_fn"();
