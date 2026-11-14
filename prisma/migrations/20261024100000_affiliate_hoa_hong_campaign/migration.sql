-- AFF-P2 (13/10/2026) — NỐI HOA HỒNG THEO CAMPAIGN CỦA AFFILIATE VÀO ENGINE HIỆN CÓ.
-- docs/source-commission/12-affiliate-kien-truc.md §8.
--
-- ADDITIVE, KHÔNG BACKFILL, CHẠY LẠI ĐƯỢC ([MIG-01]). Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này.
--
--   1. `CommissionPolicyVersion.scopeCampaignId` (+ FK Restrict + chỉ mục): cột phạm vi thứ sáu, dành cho phạm vi CAMPAIGN (campaign Affiliate).
--   2. CHECK `CommissionPolicyVersion_pham_vi_chk` GIỮ NGUYÊN TÊN, thay thân: mọi nhánh cũ thêm `scopeCampaignId IS NULL`; nhánh CAMPAIGN đòi đúng cột đó
--      và NULL năm cột kia; SOURCE / EVENT vẫn `ELSE false` (chưa có cột — quyết định riêng, không phải việc của đợt này).
--   3. Ba cột SNAPSHOT trên sổ `CommissionTransaction`: affiliateCampaignId · affiliateMembershipId · affiliateReferralId (nullable, FK Restrict).
--      Sổ BẤT BIẾN (trigger `hoa_hong_so_bat_bien` chặn mọi UPDATE trừ ba cột chi trả) nên ba cột phải được điền lúc INSERT — không có đường vá sau.
--      Dòng cũ giữ NULL = "không có gì để nói" (không đoán).
--
-- Prisma KHÔNG đọc CHECK: lưới duy nhất cho điểm 2 là ca DB [AFP-DB-*] và [NHH-POL-DB-03].

-- ─── 1 · Cột phạm vi CAMPAIGN ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "CommissionPolicyVersion" ADD COLUMN IF NOT EXISTS "scopeCampaignId" TEXT;

CREATE INDEX IF NOT EXISTS "CommissionPolicyVersion_scopeCampaignId_idx" ON "CommissionPolicyVersion"("scopeCampaignId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_scopeCampaignId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_scopeCampaignId_fkey"
      FOREIGN KEY ("scopeCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── 2 · CHECK `pham_vi` — thay thân, giữ tên. Chạy lại: thân đã có `scopeCampaignId` thì bỏ qua. ───────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'CommissionPolicyVersion_pham_vi_chk'
       AND conrelid = '"CommissionPolicyVersion"'::regclass
       AND pg_get_constraintdef(oid) LIKE '%scopeCampaignId%'
  ) THEN
    ALTER TABLE "CommissionPolicyVersion" DROP CONSTRAINT IF EXISTS "CommissionPolicyVersion_pham_vi_chk";
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_pham_vi_chk" CHECK (
      CASE "scopeType"
        WHEN 'GLOBAL' THEN
          "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL AND "scopeSourceGroupId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL AND "scopeCampaignId" IS NULL
        WHEN 'PERSON' THEN
          "scopeUserId" IS NOT NULL AND "scopeAffiliateId" IS NULL AND "scopeSourceGroupId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL AND "scopeCampaignId" IS NULL
        WHEN 'AFFILIATE' THEN
          "scopeAffiliateId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeSourceGroupId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL AND "scopeCampaignId" IS NULL
        WHEN 'CAMPAIGN' THEN
          "scopeCampaignId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL
          AND "scopeSourceGroupId" IS NULL AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL
        WHEN 'SOURCE_GROUP' THEN
          "scopeSourceGroupId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL AND "scopeCampaignId" IS NULL
        WHEN 'ORG_UNIT' THEN
          "scopeOrgUnitId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL
          AND "scopeSourceGroupId" IS NULL AND "scopeRoleDefId" IS NULL AND "scopeCampaignId" IS NULL
        WHEN 'ROLE' THEN
          "scopeRoleDefId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL
          AND "scopeSourceGroupId" IS NULL AND "scopeOrgUnitId" IS NULL AND "scopeCampaignId" IS NULL
        ELSE false
      END
    );
  END IF;
END $$;

-- ─── 3 · Ba cột snapshot trên sổ ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "affiliateCampaignId" TEXT;
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "affiliateMembershipId" TEXT;
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "affiliateReferralId" TEXT;

CREATE INDEX IF NOT EXISTS "CommissionTransaction_affiliateCampaignId_idx" ON "CommissionTransaction"("affiliateCampaignId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_affiliateCampaignId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_affiliateCampaignId_fkey"
      FOREIGN KEY ("affiliateCampaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_affiliateMembershipId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_affiliateMembershipId_fkey"
      FOREIGN KEY ("affiliateMembershipId") REFERENCES "AffiliateMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_affiliateReferralId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_affiliateReferralId_fkey"
      FOREIGN KEY ("affiliateReferralId") REFERENCES "AffiliateReferral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
