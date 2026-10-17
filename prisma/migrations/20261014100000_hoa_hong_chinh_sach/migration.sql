-- 09/10/2026 — HOA HỒNG THEO NGUỒN · PR4: DANH MỤC CHÍNH SÁCH.
-- Master vai hưởng + loại giao dịch · văn bản quy định · chính sách + version + rule.
-- Đặc tả: docs/source-commission/02 §8.1, §8.2, §8.4, §8.5, §10.2, §13.3, §13.4 · 04 §6 · 05 PR4.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 6 enum + 6 bảng MỚI. KHÔNG cột nào trên bảng có sẵn, KHÔNG trigger,
-- KHÔNG backfill dữ liệu nghiệp vụ. Rollback = ngừng ghi; bảng nằm im. Hai bảng master có dòng seed
-- (ON CONFLICT DO NOTHING). Chính sách v1 SR.QD.208 KHÔNG seed ở đây — nó cần văn bản + người kích hoạt, đi
-- bằng script chạy tay scripts/hoa-hong/seed-chinh-sach-v1.ts (02 §12.1, 05 PR4).
--
-- Chưa có sổ (PR5) và chưa có LeadSource (PR7) ⇒ KHÔNG StudentTransaction, KHÔNG "scopeSourceId":
-- CHECK CommissionPolicyVersion_pham_vi_chk CẤM scopeType ∈ {SOURCE, CAMPAIGN, EVENT} cho tới PR8.
--
-- Chạy lại được ([MIG-01]): enum kiểm pg_type, bảng/chỉ mục IF NOT EXISTS, FK/CHECK kiểm pg_constraint,
-- seed ON CONFLICT DO NOTHING.
--
-- Bảng mang dữ liệu theo cơ sở (RegulationDocument, CommissionPolicy, CommissionPolicyVersion, CommissionRule)
-- giữ CẢ centerId + orgUnitId (luật Nền #3, đính chính 27/08/2026); NULL = Hội sở / dùng chung (NULL_IS_GLOBAL).

-- ─── Enum ───────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BeneficiaryResolverType') THEN
    CREATE TYPE "BeneficiaryResolverType" AS ENUM (
      'DIRECT_PERSON', 'TRANSACTION_ROLE', 'ORG_UNIT_ROLE', 'SOURCE_MEMBER', 'SOURCE_OWNER'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RevenueComponent') THEN
    CREATE TYPE "RevenueComponent" AS ENUM ('TUITION', 'MATERIAL', 'EQUIPMENT', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegulationDocumentKind') THEN
    CREATE TYPE "RegulationDocumentKind" AS ENUM ('COMMISSION_POLICY', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PolicyVersionStatus') THEN
    CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'SUPERSEDED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PolicyScopeType') THEN
    CREATE TYPE "PolicyScopeType" AS ENUM (
      'PERSON', 'AFFILIATE', 'SOURCE', 'CAMPAIGN', 'EVENT', 'SOURCE_GROUP', 'ORG_UNIT', 'ROLE', 'GLOBAL'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionCalcKind') THEN
    CREATE TYPE "CommissionCalcKind" AS ENUM ('PERCENT', 'FIXED_PER_PURCHASE', 'TIER_PERIOD_BONUS', 'EXCLUDE');
  END IF;
END $$;

-- ─── BeneficiaryRole ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BeneficiaryRole" (
  "id"            TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "resolverType"  "BeneficiaryResolverType" NOT NULL,
  "resolverKey"   TEXT,
  "isAcquisition" BOOLEAN NOT NULL DEFAULT false,
  "legacyTier"    TEXT,
  "isSystem"      BOOLEAN NOT NULL DEFAULT false,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 100,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BeneficiaryRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BeneficiaryRole_code_key" ON "BeneficiaryRole"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "BeneficiaryRole_legacyTier_key" ON "BeneficiaryRole"("legacyTier");

-- ─── CommissionTransactionType ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionTransactionType" (
  "code"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "hasClassifier" BOOLEAN NOT NULL DEFAULT false,
  "isActive"      BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"     INTEGER NOT NULL DEFAULT 100,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionTransactionType_pkey" PRIMARY KEY ("code")
);

-- ─── RegulationDocument ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RegulationDocument" (
  "id"             TEXT NOT NULL,
  "documentCode"   TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "kind"           "RegulationDocumentKind" NOT NULL DEFAULT 'COMMISSION_POLICY',
  "issuedOn"       DATE NOT NULL,
  "publishedOn"    DATE NOT NULL,
  "effectiveOn"    DATE NOT NULL,
  "approvedByName" TEXT NOT NULL,
  "approvedById"   TEXT,
  "fileKey"        TEXT,
  "fileName"       TEXT,
  "fileUrl"        TEXT,
  "centerId"       TEXT,
  "orgUnitId"      TEXT,
  "revokedAt"      TIMESTAMPTZ(6),
  "revokedById"    TEXT,
  "revokeReason"   TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "RegulationDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RegulationDocument_documentCode_key" ON "RegulationDocument"("documentCode");
CREATE INDEX IF NOT EXISTS "RegulationDocument_publishedOn_idx" ON "RegulationDocument"("publishedOn");
CREATE INDEX IF NOT EXISTS "RegulationDocument_centerId_idx" ON "RegulationDocument"("centerId");
CREATE INDEX IF NOT EXISTS "RegulationDocument_orgUnitId_idx" ON "RegulationDocument"("orgUnitId");

-- ─── CommissionPolicy ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionPolicy" (
  "id"          TEXT NOT NULL,
  "policyCode"  TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "centerId"    TEXT,
  "orgUnitId"   TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionPolicy_policyCode_key" ON "CommissionPolicy"("policyCode");
CREATE INDEX IF NOT EXISTS "CommissionPolicy_centerId_idx" ON "CommissionPolicy"("centerId");
CREATE INDEX IF NOT EXISTS "CommissionPolicy_orgUnitId_idx" ON "CommissionPolicy"("orgUnitId");

-- ─── CommissionPolicyVersion ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionPolicyVersion" (
  "id"                 TEXT NOT NULL,
  "policyId"           TEXT NOT NULL,
  "versionNo"          INTEGER NOT NULL,
  "status"             "PolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom"      TIMESTAMPTZ(6) NOT NULL,
  "effectiveTo"        TIMESTAMPTZ(6),
  "reason"             TEXT NOT NULL,
  "createdById"        TEXT,
  "createdByName"      TEXT,
  "documentId"         TEXT,
  "scopeType"          "PolicyScopeType" NOT NULL,
  "scopeKey"           TEXT NOT NULL,
  "scopeUserId"        TEXT,
  "scopeAffiliateId"   TEXT,
  "scopeSourceGroupId" TEXT,
  "scopeOrgUnitId"     TEXT,
  "scopeRoleDefId"     TEXT,
  "activatedById"      TEXT,
  "activatedAt"        TIMESTAMPTZ(6),
  "firstUsedAt"        TIMESTAMPTZ(6),
  "centerId"           TEXT,
  "orgUnitId"          TEXT,
  "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionPolicyVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionPolicyVersion_policyId_versionNo_key" ON "CommissionPolicyVersion"("policyId", "versionNo");
CREATE INDEX IF NOT EXISTS "CommissionPolicyVersion_status_effectiveFrom_idx" ON "CommissionPolicyVersion"("status", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "CommissionPolicyVersion_scopeType_scopeKey_idx" ON "CommissionPolicyVersion"("scopeType", "scopeKey");
CREATE INDEX IF NOT EXISTS "CommissionPolicyVersion_documentId_idx" ON "CommissionPolicyVersion"("documentId");
CREATE INDEX IF NOT EXISTS "CommissionPolicyVersion_centerId_idx" ON "CommissionPolicyVersion"("centerId");
CREATE INDEX IF NOT EXISTS "CommissionPolicyVersion_orgUnitId_idx" ON "CommissionPolicyVersion"("orgUnitId");

-- ─── CommissionRule ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionRule" (
  "id"                  TEXT NOT NULL,
  "versionId"           TEXT NOT NULL,
  "transactionTypeCode" TEXT NOT NULL,
  "beneficiaryRoleId"   TEXT NOT NULL,
  "revenueComponent"    "RevenueComponent" NOT NULL DEFAULT 'TUITION',
  "calcKind"            "CommissionCalcKind" NOT NULL,
  "rate"                DECIMAL(9,6),
  "fixedAmount"         INTEGER,
  "tierTable"           JSONB,
  "note"                TEXT,
  "centerId"            TEXT,
  "orgUnitId"           TEXT,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);
-- Tên khoá MỘT-rule-mỗi-ô đặt tay vì tên Prisma sinh ra dài hơn 63 ký tự (giới hạn định danh Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionRule_mot_rule_moi_o_key"
  ON "CommissionRule"("versionId", "transactionTypeCode", "beneficiaryRoleId", "revenueComponent");
CREATE INDEX IF NOT EXISTS "CommissionRule_beneficiaryRoleId_transactionTypeCode_idx" ON "CommissionRule"("beneficiaryRoleId", "transactionTypeCode");
CREATE INDEX IF NOT EXISTS "CommissionRule_centerId_idx" ON "CommissionRule"("centerId");
CREATE INDEX IF NOT EXISTS "CommissionRule_orgUnitId_idx" ON "CommissionRule"("orgUnitId");

-- ─── Khoá ngoại (khuôn 20260825120000_lead_status_history: kiểm pg_constraint) ─────────────
-- RESTRICT khắp nơi: văn bản / chính sách / vai đã được tham chiếu không xoá cứng được. Riêng
-- CommissionRule → CommissionPolicyVersion là CASCADE: chỉ có tác dụng khi xoá NHÁP (02 §8.5);
-- version đã sinh dòng sổ (PR5) bị khoá bằng Restrict từ phía sổ.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RegulationDocument_centerId_fkey') THEN
    ALTER TABLE "RegulationDocument" ADD CONSTRAINT "RegulationDocument_centerId_fkey"
      FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicy_centerId_fkey') THEN
    ALTER TABLE "CommissionPolicy" ADD CONSTRAINT "CommissionPolicy_centerId_fkey"
      FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_policyId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_policyId_fkey"
      FOREIGN KEY ("policyId") REFERENCES "CommissionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_documentId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "RegulationDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_scopeUserId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_scopeUserId_fkey"
      FOREIGN KEY ("scopeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_scopeAffiliateId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_scopeAffiliateId_fkey"
      FOREIGN KEY ("scopeAffiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_scopeSourceGroupId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_scopeSourceGroupId_fkey"
      FOREIGN KEY ("scopeSourceGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_scopeOrgUnitId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_scopeOrgUnitId_fkey"
      FOREIGN KEY ("scopeOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_scopeRoleDefId_fkey') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_scopeRoleDefId_fkey"
      FOREIGN KEY ("scopeRoleDefId") REFERENCES "RoleDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionRule_versionId_fkey') THEN
    ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_versionId_fkey"
      FOREIGN KEY ("versionId") REFERENCES "CommissionPolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionRule_transactionTypeCode_fkey') THEN
    ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_transactionTypeCode_fkey"
      FOREIGN KEY ("transactionTypeCode") REFERENCES "CommissionTransactionType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionRule_beneficiaryRoleId_fkey') THEN
    ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_beneficiaryRoleId_fkey"
      FOREIGN KEY ("beneficiaryRoleId") REFERENCES "BeneficiaryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── CHECK (02 §10.2). Prisma 5 KHÔNG đọc CHECK ⇒ drift không thấy; lưới duy nhất là ca DB [NHH-POL-DB-*]. ───
DO $$ BEGIN
  -- Luật 12: master không được bật một mã mà bộ phân loại không ra được.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransactionType_bat_chk') THEN
    ALTER TABLE "CommissionTransactionType" ADD CONSTRAINT "CommissionTransactionType_bat_chk"
      CHECK (NOT "isActive" OR "hasClassifier");
  END IF;
  -- Version chỉ rời DRAFT/CANCELLED khi có văn bản.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_van_ban_chk') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_van_ban_chk"
      CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "documentId" IS NOT NULL);
  END IF;
  -- Biên MỞ: hiệu lực phải kéo dài > 0.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_hieu_luc_chk') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_hieu_luc_chk"
      CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
  END IF;
  -- Đúng MỘT cột scope* theo scopeType. BẢN PR4: SOURCE/CAMPAIGN/EVENT ⇒ false (chưa có scopeSourceId; PR8 thay).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPolicyVersion_pham_vi_chk') THEN
    ALTER TABLE "CommissionPolicyVersion" ADD CONSTRAINT "CommissionPolicyVersion_pham_vi_chk" CHECK (
      CASE "scopeType"
        WHEN 'GLOBAL' THEN
          "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL AND "scopeSourceGroupId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL
        WHEN 'PERSON' THEN
          "scopeUserId" IS NOT NULL AND "scopeAffiliateId" IS NULL AND "scopeSourceGroupId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL
        WHEN 'AFFILIATE' THEN
          "scopeAffiliateId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeSourceGroupId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL
        WHEN 'SOURCE_GROUP' THEN
          "scopeSourceGroupId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL
          AND "scopeOrgUnitId" IS NULL AND "scopeRoleDefId" IS NULL
        WHEN 'ORG_UNIT' THEN
          "scopeOrgUnitId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL
          AND "scopeSourceGroupId" IS NULL AND "scopeRoleDefId" IS NULL
        WHEN 'ROLE' THEN
          "scopeRoleDefId" IS NOT NULL AND "scopeUserId" IS NULL AND "scopeAffiliateId" IS NULL
          AND "scopeSourceGroupId" IS NULL AND "scopeOrgUnitId" IS NULL
        ELSE false
      END
    );
  END IF;
  -- Giá trị đi đúng kiểu tính.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionRule_cach_tinh_chk') THEN
    ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_cach_tinh_chk" CHECK (
      CASE "calcKind"
        WHEN 'PERCENT' THEN
          "rate" IS NOT NULL AND "rate" > 0 AND "rate" <= 1 AND "fixedAmount" IS NULL AND "tierTable" IS NULL
        WHEN 'FIXED_PER_PURCHASE' THEN
          "fixedAmount" IS NOT NULL AND "fixedAmount" > 0 AND "rate" IS NULL AND "tierTable" IS NULL
        WHEN 'TIER_PERIOD_BONUS' THEN
          "tierTable" IS NOT NULL AND "rate" IS NULL AND "fixedAmount" IS NULL
        WHEN 'EXCLUDE' THEN
          "rate" IS NULL AND "fixedAmount" IS NULL AND "tierTable" IS NULL
        ELSE false
      END
    );
  END IF;
END $$;

-- ─── Seed master (02 §13.3, §13.4). Đổi ở đây ⇔ đổi lib/hoa-hong/vai-huong.ts + loai-giao-dich.ts — lưới
--     [NHH-POL-MIG-*] so hai bên. Hai khối giữa các dấu dưới là MỘT câu INSERT mỗi khối; ca DB chạy
--     chúng HAI lần: đừng đổi dấu, đừng tách câu.
-- >>> SEED BeneficiaryRole
INSERT INTO "BeneficiaryRole"
  ("id", "code", "name", "resolverType", "resolverKey", "isAcquisition", "legacyTier",
   "isSystem", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'SALE',              'Sale (người chốt đơn)',       'TRANSACTION_ROLE'::"BeneficiaryResolverType", 'LEAD_CONVERTED_BY',  false, 'SALE',          true, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SALE_ADMIN',        'Sale Admin (Hội sở)',         'TRANSACTION_ROLE'::"BeneficiaryResolverType", 'LEAD_ADMIN',         false, 'SALE_ADMIN',    true, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CENTER_MANAGER',    'Quản lý cơ sở',               'ORG_UNIT_ROLE'::"BeneficiaryResolverType",    'ASSIGNEE_QL_TT',     false, 'QL_TT',         true, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'MARKETING',         'Marketing (Quảng cáo)',       'ORG_UNIT_ROLE'::"BeneficiaryResolverType",    'ASSIGNEE_QC',        false, 'QC',            true, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'TRIAL_TEACHER',     'Giáo viên dạy Trial',         'TRANSACTION_ROLE'::"BeneficiaryResolverType", 'TRIAL_TEACHER',      false, 'TRIAL_TEACHER', true, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'REFERRER_PARENT',   'Phụ huynh giới thiệu',        'DIRECT_PERSON'::"BeneficiaryResolverType",    'REFERRER_PARENT',    true,  NULL,            true, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'REFERRER_EMPLOYEE', 'Nhân sự giới thiệu',          'DIRECT_PERSON'::"BeneficiaryResolverType",    'REFERRER_EMPLOYEE',  true,  NULL,            true, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'AFFILIATE',         'Cộng tác viên / đối tác',     'DIRECT_PERSON'::"BeneficiaryResolverType",    'AFFILIATE',          true,  NULL,            true, true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'REFERRER_PARENT_SALE', 'Sale phụ trách phụ huynh giới thiệu', 'DIRECT_PERSON'::"BeneficiaryResolverType", 'REFERRER_PARENT_SALE', true, NULL,       true, true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SOURCE_OWNER',      'Người phụ trách nguồn',       'SOURCE_OWNER'::"BeneficiaryResolverType",     'SOURCE_OWNER',       true,  NULL,            true, true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
-- <<< SEED BeneficiaryRole

-- >>> SEED CommissionTransactionType
INSERT INTO "CommissionTransactionType"
  ("code", "name", "hasClassifier", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('NEW',              'Khách hàng mới',                                          true,  true,  10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('RENEWAL',          'Tái tục',                                                 true,  true,  20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('UPSELL',           'Nâng cấp (chưa áp dụng)',                                 false, false, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CROSS_SELL',       'Bán chéo (chưa áp dụng)',                                 false, false, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('WINBACK',          'Khách quay lại (chưa áp dụng)',                           false, false, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CHUYEN_TRUNG_TAM', 'Chuyển trung tâm (SR.QD.208 PL08 Đ4, chưa áp dụng)',      false, false, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
-- <<< SEED CommissionTransactionType

-- ─── RLS: bảng MỚI ra đời với RLS TẮT (sự cố 09/08). Chỉ ENABLE, không FORCE, không policy. ─────
ALTER TABLE "BeneficiaryRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionTransactionType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegulationDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionPolicyVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionRule" ENABLE ROW LEVEL SECURITY;
