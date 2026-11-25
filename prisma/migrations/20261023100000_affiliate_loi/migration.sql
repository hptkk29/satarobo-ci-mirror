-- AFF-P0b (12/10/2026) — LÕI AFFILIATE: mở rộng `Affiliate` (= AffiliateParty) + danh mục Loại / Nhãn / Campaign / Rule / Site / Landing / Membership.
-- docs/source-commission/12-affiliate-kien-truc.md.
--
-- ADDITIVE hoàn toàn: ADD COLUMN có mặc định / nullable trên `Affiliate`, 9 bảng MỚI, không DROP/RENAME/đổi kiểu cột nào. Không có dữ liệu mẫu nào
-- được chèn (không seed Loại/Campaign/chính sách) — danh mục do admin tạo ở giao diện. Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này.
--
-- Phần DDL bên dưới do `prisma migrate diff` sinh từ schema (tên index/ràng buộc theo quy ước Prisma); phần sau là thứ Prisma KHÔNG biểu diễn được:
-- backfill `status` từ `isActive`, CHECK, và RLS. Lưới duy nhất cho phần đó là ca DB [AFF-DB-*].

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliatePartyKind') THEN
    CREATE TYPE "AffiliatePartyKind" AS ENUM ('PERSON', 'ORGANIZATION');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliatePartyStatus') THEN
    CREATE TYPE "AffiliatePartyStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateCampaignStatus') THEN
    CREATE TYPE "AffiliateCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateMembershipStatus') THEN
    CREATE TYPE "AffiliateMembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateAttributionModel') THEN
    CREATE TYPE "AffiliateAttributionModel" AS ENUM ('FIRST_VALID', 'LAST_VALID', 'MANUAL_REVIEW', 'SPLIT');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateSiteStatus') THEN
    CREATE TYPE "AffiliateSiteStatus" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Affiliate" ADD COLUMN IF NOT EXISTS     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS     "approvedById" TEXT,
ADD COLUMN IF NOT EXISTS     "employeeId" TEXT,
ADD COLUMN IF NOT EXISTS     "parentPartyId" TEXT,
ADD COLUMN IF NOT EXISTS     "partyKind" "AffiliatePartyKind" NOT NULL DEFAULT 'PERSON',
ADD COLUMN IF NOT EXISTS     "status" "AffiliatePartyStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS     "typeId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultSourceGroupId" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateTag" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliatePartyTag" (
    "partyId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliatePartyTag_pkey" PRIMARY KEY ("partyId","tagId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateCampaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AffiliateCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "attributionModel" "AffiliateAttributionModel" NOT NULL DEFAULT 'FIRST_VALID',
    "cookieWindowDays" INTEGER NOT NULL DEFAULT 30,
    "protectWindowDays" INTEGER NOT NULL DEFAULT 90,
    "allowSelfReferral" BOOLEAN NOT NULL DEFAULT false,
    "defaultSourceGroupId" TEXT,
    "effectiveFrom" TIMESTAMPTZ(6),
    "effectiveTo" TIMESTAMPTZ(6),
    "createdById" TEXT,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateCampaignRule" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "typeId" TEXT,
    "tagId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "sourceGroupId" TEXT NOT NULL,
    "policyId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateCampaignRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateSite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "allowedDomains" TEXT[],
    "status" "AffiliateSiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "trackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultCampaignId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateLandingPage" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "pathPattern" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateLandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateCampaignSite" (
    "campaignId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCampaignSite_pkey" PRIMARY KEY ("campaignId","siteId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateMembership" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "AffiliateMembershipStatus" NOT NULL DEFAULT 'PENDING',
    "groupLabel" TEXT,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "customTerms" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliateMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateType_code_key" ON "AffiliateType"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateType_isActive_sortOrder_idx" ON "AffiliateType"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateType_defaultSourceGroupId_idx" ON "AffiliateType"("defaultSourceGroupId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateTag_code_key" ON "AffiliateTag"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateTag_isActive_idx" ON "AffiliateTag"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliatePartyTag_tagId_idx" ON "AffiliatePartyTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateCampaign_code_key" ON "AffiliateCampaign"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateCampaign_status_effectiveFrom_idx" ON "AffiliateCampaign"("status", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateCampaign_defaultSourceGroupId_idx" ON "AffiliateCampaign"("defaultSourceGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateCampaignRule_typeId_idx" ON "AffiliateCampaignRule"("typeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateCampaignRule_tagId_idx" ON "AffiliateCampaignRule"("tagId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateCampaignRule_sourceGroupId_idx" ON "AffiliateCampaignRule"("sourceGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateCampaignRule_policyId_idx" ON "AffiliateCampaignRule"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateCampaignRule_campaignId_ruleKey_key" ON "AffiliateCampaignRule"("campaignId", "ruleKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateSite_code_key" ON "AffiliateSite"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateSite_status_idx" ON "AffiliateSite"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateSite_defaultCampaignId_idx" ON "AffiliateSite"("defaultCampaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateLandingPage_siteId_isActive_idx" ON "AffiliateLandingPage"("siteId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateLandingPage_siteId_pathPattern_key" ON "AffiliateLandingPage"("siteId", "pathPattern");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateCampaignSite_siteId_idx" ON "AffiliateCampaignSite"("siteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateMembership_campaignId_status_idx" ON "AffiliateMembership"("campaignId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateMembership_status_effectiveTo_idx" ON "AffiliateMembership"("status", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateMembership_partyId_campaignId_key" ON "AffiliateMembership"("partyId", "campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Affiliate_status_idx" ON "Affiliate"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Affiliate_typeId_idx" ON "Affiliate"("typeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Affiliate_employeeId_idx" ON "Affiliate"("employeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Affiliate_parentPartyId_idx" ON "Affiliate"("parentPartyId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Affiliate_typeId_fkey' AND conrelid = '"Affiliate"'::regclass) THEN
    ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AffiliateType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Affiliate_employeeId_fkey' AND conrelid = '"Affiliate"'::regclass) THEN
    ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Affiliate_parentPartyId_fkey' AND conrelid = '"Affiliate"'::regclass) THEN
    ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_parentPartyId_fkey" FOREIGN KEY ("parentPartyId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateType_defaultSourceGroupId_fkey' AND conrelid = '"AffiliateType"'::regclass) THEN
    ALTER TABLE "AffiliateType" ADD CONSTRAINT "AffiliateType_defaultSourceGroupId_fkey" FOREIGN KEY ("defaultSourceGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliatePartyTag_partyId_fkey' AND conrelid = '"AffiliatePartyTag"'::regclass) THEN
    ALTER TABLE "AffiliatePartyTag" ADD CONSTRAINT "AffiliatePartyTag_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliatePartyTag_tagId_fkey' AND conrelid = '"AffiliatePartyTag"'::regclass) THEN
    ALTER TABLE "AffiliatePartyTag" ADD CONSTRAINT "AffiliatePartyTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "AffiliateTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaign_defaultSourceGroupId_fkey' AND conrelid = '"AffiliateCampaign"'::regclass) THEN
    ALTER TABLE "AffiliateCampaign" ADD CONSTRAINT "AffiliateCampaign_defaultSourceGroupId_fkey" FOREIGN KEY ("defaultSourceGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignRule_campaignId_fkey' AND conrelid = '"AffiliateCampaignRule"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignRule" ADD CONSTRAINT "AffiliateCampaignRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignRule_typeId_fkey' AND conrelid = '"AffiliateCampaignRule"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignRule" ADD CONSTRAINT "AffiliateCampaignRule_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AffiliateType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignRule_tagId_fkey' AND conrelid = '"AffiliateCampaignRule"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignRule" ADD CONSTRAINT "AffiliateCampaignRule_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "AffiliateTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignRule_sourceGroupId_fkey' AND conrelid = '"AffiliateCampaignRule"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignRule" ADD CONSTRAINT "AffiliateCampaignRule_sourceGroupId_fkey" FOREIGN KEY ("sourceGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignRule_policyId_fkey' AND conrelid = '"AffiliateCampaignRule"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignRule" ADD CONSTRAINT "AffiliateCampaignRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CommissionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateSite_defaultCampaignId_fkey' AND conrelid = '"AffiliateSite"'::regclass) THEN
    ALTER TABLE "AffiliateSite" ADD CONSTRAINT "AffiliateSite_defaultCampaignId_fkey" FOREIGN KEY ("defaultCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateLandingPage_siteId_fkey' AND conrelid = '"AffiliateLandingPage"'::regclass) THEN
    ALTER TABLE "AffiliateLandingPage" ADD CONSTRAINT "AffiliateLandingPage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "AffiliateSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignSite_campaignId_fkey' AND conrelid = '"AffiliateCampaignSite"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignSite" ADD CONSTRAINT "AffiliateCampaignSite_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignSite_siteId_fkey' AND conrelid = '"AffiliateCampaignSite"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignSite" ADD CONSTRAINT "AffiliateCampaignSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "AffiliateSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateMembership_partyId_fkey' AND conrelid = '"AffiliateMembership"'::regclass) THEN
    ALTER TABLE "AffiliateMembership" ADD CONSTRAINT "AffiliateMembership_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateMembership_campaignId_fkey' AND conrelid = '"AffiliateMembership"'::regclass) THEN
    ALTER TABLE "AffiliateMembership" ADD CONSTRAINT "AffiliateMembership_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Backfill: `status` mặc định ACTIVE, mà dòng cũ có `isActive = false` phải là SUSPENDED ────────────────────────────────────────────
-- (idempotent: chạy lại không đổi gì vì chỉ chạm dòng đang ACTIVE ∧ isActive = false).
UPDATE "Affiliate" SET "status" = 'SUSPENDED' WHERE "isActive" = false AND "status" = 'ACTIVE';

-- ── CHECK — thứ Prisma không biết ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Mã danh mục: chữ HOA + số + gạch dưới, 3–40 ký tự (mã ổn định, được dùng làm khoá máy; người nhập không gõ).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateType_code_chk' AND conrelid = '"AffiliateType"'::regclass) THEN
    ALTER TABLE "AffiliateType" ADD CONSTRAINT "AffiliateType_code_chk" CHECK ("code" ~ '^[A-Z0-9_]{3,40}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTag_code_chk' AND conrelid = '"AffiliateTag"'::regclass) THEN
    ALTER TABLE "AffiliateTag" ADD CONSTRAINT "AffiliateTag_code_chk" CHECK ("code" ~ '^[A-Z0-9_]{3,40}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaign_code_chk' AND conrelid = '"AffiliateCampaign"'::regclass) THEN
    ALTER TABLE "AffiliateCampaign" ADD CONSTRAINT "AffiliateCampaign_code_chk" CHECK ("code" ~ '^[A-Z0-9_]{3,40}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateSite_code_chk' AND conrelid = '"AffiliateSite"'::regclass) THEN
    ALTER TABLE "AffiliateSite" ADD CONSTRAINT "AffiliateSite_code_chk" CHECK ("code" ~ '^[A-Z0-9_]{3,40}$');
  END IF;
END $$;

-- Campaign: cửa sổ cookie 1..365 ngày, bảo vệ 1..730 ngày, hiệu lực có thứ tự.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaign_cookie_chk' AND conrelid = '"AffiliateCampaign"'::regclass) THEN
    ALTER TABLE "AffiliateCampaign" ADD CONSTRAINT "AffiliateCampaign_cookie_chk" CHECK ("cookieWindowDays" BETWEEN 1 AND 365);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaign_bao_ve_chk' AND conrelid = '"AffiliateCampaign"'::regclass) THEN
    ALTER TABLE "AffiliateCampaign" ADD CONSTRAINT "AffiliateCampaign_bao_ve_chk" CHECK ("protectWindowDays" BETWEEN 1 AND 730);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaign_hieu_luc_chk' AND conrelid = '"AffiliateCampaign"'::regclass) THEN
    ALTER TABLE "AffiliateCampaign" ADD CONSTRAINT "AffiliateCampaign_hieu_luc_chk"
      CHECK ("effectiveFrom" IS NULL OR "effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
  END IF;
END $$;

-- Rule: phải có loại HOẶC nhãn (cả hai null là chỗ của nguồn mặc định ở campaign); `ruleKey` khớp đúng hai cột.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignRule_pham_vi_chk' AND conrelid = '"AffiliateCampaignRule"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignRule" ADD CONSTRAINT "AffiliateCampaignRule_pham_vi_chk" CHECK ("typeId" IS NOT NULL OR "tagId" IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignRule_rule_key_chk' AND conrelid = '"AffiliateCampaignRule"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignRule" ADD CONSTRAINT "AffiliateCampaignRule_rule_key_chk"
      CHECK ("ruleKey" = 'T:' || COALESCE("typeId", '*') || '|G:' || COALESCE("tagId", '*'));
  END IF;
END $$;

-- Site: chỉ https; ít nhất một tên miền; tên miền chữ thường, không đường dẫn/dấu cách (so khớp host ở P1 là so chuỗi chính xác).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateSite_base_url_chk' AND conrelid = '"AffiliateSite"'::regclass) THEN
    ALTER TABLE "AffiliateSite" ADD CONSTRAINT "AffiliateSite_base_url_chk" CHECK ("baseUrl" ~ '^https://[^/[:space:]]+');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateSite_domains_chk' AND conrelid = '"AffiliateSite"'::regclass) THEN
    ALTER TABLE "AffiliateSite" ADD CONSTRAINT "AffiliateSite_domains_chk"
      CHECK (cardinality("allowedDomains") >= 1 AND array_to_string("allowedDomains", ',') ~ '^[a-z0-9.,-]+$');
  END IF;
END $$;

-- Landing: đường dẫn bắt đầu bằng "/", không dấu cách/"?"/"#"; "*" chỉ được ở CUỐI (tiền tố).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateLandingPage_path_chk' AND conrelid = '"AffiliateLandingPage"'::regclass) THEN
    ALTER TABLE "AffiliateLandingPage" ADD CONSTRAINT "AffiliateLandingPage_path_chk"
      CHECK ("pathPattern" ~ '^/[^[:space:]?#*]*[*]?$');
  END IF;
END $$;

-- Membership: hiệu lực có thứ tự.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateMembership_hieu_luc_chk' AND conrelid = '"AffiliateMembership"'::regclass) THEN
    ALTER TABLE "AffiliateMembership" ADD CONSTRAINT "AffiliateMembership_hieu_luc_chk"
      CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
  END IF;
END $$;

-- Tổ chức không thuộc tổ chức khác, không tự làm cha của chính mình. "Cha phải là ORGANIZATION" kiểm ở tầng ghi (CHECK không tham chiếu dòng khác).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Affiliate_org_khong_co_cha_chk' AND conrelid = '"Affiliate"'::regclass) THEN
    ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_org_khong_co_cha_chk" CHECK ("partyKind" <> 'ORGANIZATION' OR "parentPartyId" IS NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Affiliate_khong_tu_cha_chk' AND conrelid = '"Affiliate"'::regclass) THEN
    ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_khong_tu_cha_chk" CHECK ("parentPartyId" IS NULL OR "parentPartyId" <> "id");
  END IF;
END $$;

-- ── RLS: chỉ ENABLE (không FORCE, không policy) — như mọi bảng mới của repo ───────────────────────────────────────────────────────
ALTER TABLE "AffiliateType" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateTag" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliatePartyTag" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateCampaign" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateCampaignRule" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateSite" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateLandingPage" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateCampaignSite" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AffiliateMembership" ENABLE ROW LEVEL SECURITY;
