-- 08/10/2026 — NGUỒN LEAD: danh mục 8 nguồn mặc định + UNKNOWN (sửa tại chỗ 09/10: nguồn ĐỘNG) · quy nguồn MỘT dòng mỗi lead · touchpoint.
-- Đặc tả: docs/source-commission/07 §2.4 · mô hình 02 §5–§7, §10, §13.1.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 6 enum + 3 bảng MỚI. KHÔNG cột nào trên bảng có sẵn, KHÔNG
-- trigger, KHÔNG chỉ mục từng phần, KHÔNG backfill dữ liệu nghiệp vụ (di trú 28 nhãn = script chạy tay
-- scripts/nguon/di-tru-nguon-cu.ts). Rollback = ngừng ghi; bảng nằm im.
-- Chạy lại được: enum kiểm pg_type, bảng/chỉ mục IF NOT EXISTS, FK/CHECK kiểm pg_constraint,
-- seed ON CONFLICT DO NOTHING. [MIG-01] chỉ soi ADD COLUMN / CREATE TYPE / CREATE TABLE|INDEX — vế
-- pg_constraint KHÔNG có lưới nào ngoài bước "áp lại cả tệp" ở 07 §4 (kiểm drift, bước c).
--
-- ⚠️ LeadAttribution/LeadTouchpoint KHÔNG có centerId/orgUnitId (02 §2.5 — ngoại lệ CÓ CHỦ ĐÍCH luật Nền #3,
-- chủ dự án chấp nhận 07/10/2026):
-- mọi lượt đọc đi qua Lead đã scope; lưới [QN-W11] chặn đọc thẳng ngoài lib/nguon/**.

-- ─── Enum ───────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SourceStatus') THEN
    CREATE TYPE "SourceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SourceReferrerRequirement') THEN
    CREATE TYPE "SourceReferrerRequirement" AS ENUM ('NONE', 'PARENT', 'EMPLOYEE', 'AFFILIATE_ORG', 'EVENT');
  END IF;
  -- Nhóm cấp cao của nguồn (lọc / báo cáo / mặc định UI) — KHÔNG quyết hoa hồng (SPEC nguồn động §1.1).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadSourceType') THEN
    CREATE TYPE "LeadSourceType" AS ENUM ('REFERRAL', 'MARKETING', 'ORGANIC', 'OFFLINE', 'EVENT', 'PARTNER', 'OTHER', 'SYSTEM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SourceIdentificationMethod') THEN
    CREATE TYPE "SourceIdentificationMethod" AS ENUM (
      'EXISTING_LEAD', 'REFERRAL_CODE', 'EVENT_QR', 'PARTNER_CODE', 'AFFILIATE', 'AD_FORM_CAMPAIGN',
      'PAGE_MAPPING', 'EMPLOYEE_REFERRAL', 'PARENT_REFERRAL', 'MANUAL', 'SYSTEM_IMPORT',
      'SYSTEM_DEFAULT', 'UNKNOWN'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferrerKind') THEN
    CREATE TYPE "ReferrerKind" AS ENUM ('EMPLOYEE', 'PARENT', 'AFFILIATE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadTouchpointKind') THEN
    CREATE TYPE "LeadTouchpointKind" AS ENUM (
      'TAO_LEAD', 'NHAP_LAI', 'REF_SAU', 'THEM_CON', 'NHAP_EXCEL', 'DOI_NGUON_BI_CHAN', 'GOP_LEAD'
    );
  END IF;
END $$;

-- ─── LeadSourceGroup ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LeadSourceGroup" (
  "id"                  TEXT NOT NULL,
  "code"                TEXT NOT NULL,
  "documentNo"          INTEGER,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "referrerRequirement" "SourceReferrerRequirement" NOT NULL DEFAULT 'NONE',
  "requiresNote"        BOOLEAN NOT NULL DEFAULT false,
  "selectable"          BOOLEAN NOT NULL DEFAULT true,
  "isSystem"            BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"           INTEGER NOT NULL DEFAULT 100,
  "status"              "SourceStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceType"          "LeadSourceType" NOT NULL DEFAULT 'OTHER',
  "attributionWindowDays" INTEGER,
  "commissionEnabled"   BOOLEAN NOT NULL DEFAULT false,
  "ownerOrgUnitId"      TEXT,
  "ownerEmployeeId"     TEXT,
  "effectiveFrom"       TIMESTAMPTZ(6),
  "effectiveTo"         TIMESTAMPTZ(6),
  "createdById"         TEXT,
  "updatedById"         TEXT,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LeadSourceGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeadSourceGroup_code_key" ON "LeadSourceGroup"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadSourceGroup_documentNo_key" ON "LeadSourceGroup"("documentNo");
CREATE INDEX IF NOT EXISTS "LeadSourceGroup_status_sortOrder_idx" ON "LeadSourceGroup"("status", "sortOrder");
CREATE INDEX IF NOT EXISTS "LeadSourceGroup_sourceType_idx" ON "LeadSourceGroup"("sourceType");
CREATE INDEX IF NOT EXISTS "LeadSourceGroup_ownerEmployeeId_idx" ON "LeadSourceGroup"("ownerEmployeeId");

-- ─── LeadAttribution ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LeadAttribution" (
  "id"                   TEXT NOT NULL,
  "leadId"               TEXT NOT NULL,
  "groupId"              TEXT NOT NULL,
  "otherSourceNote"      TEXT,
  "referrerKind"         "ReferrerKind",
  "referrerEmployeeId"   TEXT,
  "referrerParentUserId" TEXT,
  "referrerStudentId"    TEXT,
  "referrerAffiliateId"  TEXT,
  "referrerMissing"      BOOLEAN NOT NULL DEFAULT false,
  "referrerRoleCode"     TEXT,
  "referrerSaleUserId"   TEXT,
  "identificationMethod" "SourceIdentificationMethod" NOT NULL,
  "matchedRule"          TEXT NOT NULL,
  "reasonText"           TEXT NOT NULL,
  "canhBao"              TEXT[] DEFAULT ARRAY[]::TEXT[],
  "originalGroupId"      TEXT NOT NULL,
  "inheritedFromLeadId"  TEXT,
  "conversionEntry"      TEXT,
  "signals"              JSONB,
  "attributedAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changeReason"         TEXT,
  "changedById"          TEXT,
  "createdAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LeadAttribution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeadAttribution_leadId_key" ON "LeadAttribution"("leadId");
CREATE INDEX IF NOT EXISTS "LeadAttribution_groupId_attributedAt_idx" ON "LeadAttribution"("groupId", "attributedAt");
CREATE INDEX IF NOT EXISTS "LeadAttribution_originalGroupId_idx" ON "LeadAttribution"("originalGroupId");
CREATE INDEX IF NOT EXISTS "LeadAttribution_referrerEmployeeId_idx" ON "LeadAttribution"("referrerEmployeeId");
CREATE INDEX IF NOT EXISTS "LeadAttribution_referrerParentUserId_idx" ON "LeadAttribution"("referrerParentUserId");
CREATE INDEX IF NOT EXISTS "LeadAttribution_referrerStudentId_idx" ON "LeadAttribution"("referrerStudentId");
CREATE INDEX IF NOT EXISTS "LeadAttribution_referrerAffiliateId_idx" ON "LeadAttribution"("referrerAffiliateId");
CREATE INDEX IF NOT EXISTS "LeadAttribution_referrerSaleUserId_idx" ON "LeadAttribution"("referrerSaleUserId");
CREATE INDEX IF NOT EXISTS "LeadAttribution_inheritedFromLeadId_idx" ON "LeadAttribution"("inheritedFromLeadId");

-- ─── LeadTouchpoint ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LeadTouchpoint" (
  "id"              TEXT NOT NULL,
  "leadId"          TEXT NOT NULL,
  "kind"            "LeadTouchpointKind" NOT NULL,
  "occurredAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conversionEntry" TEXT,
  "claimedGroupId"  TEXT,
  "signals"         JSONB,
  "leadDuplicateId" TEXT,
  "actorId"         TEXT,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadTouchpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeadTouchpoint_leadId_occurredAt_idx" ON "LeadTouchpoint"("leadId", "occurredAt");
CREATE INDEX IF NOT EXISTS "LeadTouchpoint_kind_occurredAt_idx" ON "LeadTouchpoint"("kind", "occurredAt");

-- ─── Khoá ngoại (khuôn 20260825120000_lead_status_history: kiểm pg_constraint) ─────────────
-- Lead xoá cứng (chỉ script dọn test/demo) ⇒ quy nguồn + touchpoint đi theo. Người giới thiệu
-- RESTRICT: không xoá cứng được người đang là nguồn của một lead (D13 — RESIGNED vẫn trỏ về họ).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_leadId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_groupId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_referrerEmployeeId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_referrerEmployeeId_fkey"
      FOREIGN KEY ("referrerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_referrerParentUserId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_referrerParentUserId_fkey"
      FOREIGN KEY ("referrerParentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Sale phụ trách của phụ huynh giới thiệu LÚC GHI NHẬN (snapshot). RESTRICT: không xoá cứng User đang là mốc hưởng.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_referrerSaleUserId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_referrerSaleUserId_fkey"
      FOREIGN KEY ("referrerSaleUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Người phụ trách nguồn (đầu vào resolver SOURCE_OWNER). RESTRICT: nhân sự đang phụ trách một nguồn không xoá cứng được.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceGroup_ownerEmployeeId_fkey') THEN
    ALTER TABLE "LeadSourceGroup" ADD CONSTRAINT "LeadSourceGroup_ownerEmployeeId_fkey"
      FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_referrerStudentId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_referrerStudentId_fkey"
      FOREIGN KEY ("referrerStudentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_referrerAffiliateId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_referrerAffiliateId_fkey"
      FOREIGN KEY ("referrerAffiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_originalGroupId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_originalGroupId_fkey"
      FOREIGN KEY ("originalGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_inheritedFromLeadId_fkey') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_inheritedFromLeadId_fkey"
      FOREIGN KEY ("inheritedFromLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadTouchpoint_leadId_fkey') THEN
    ALTER TABLE "LeadTouchpoint" ADD CONSTRAINT "LeadTouchpoint_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadTouchpoint_claimedGroupId_fkey') THEN
    ALTER TABLE "LeadTouchpoint" ADD CONSTRAINT "LeadTouchpoint_claimedGroupId_fkey"
      FOREIGN KEY ("claimedGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── CHECK (02 §10.2). Prisma 5 KHÔNG đọc CHECK ⇒ drift không thấy; lưới duy nhất là [NHH-SRC-23c]. ───
DO $$ BEGIN
  -- NULL-safe (lượt cấy lại 07/10): CHECK chỉ chặn khi biểu thức FALSE, còn NULL thì QUA. Thiếu
  -- "referrerKind" IS NOT NULL ở ba nhánh có kiểu, dòng {kind NULL + một cột người} cho ra NULL OR NULL OR NULL ⇒ lọt.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_nguoi_gioi_thieu_chk') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_nguoi_gioi_thieu_chk" CHECK (
      ("referrerKind" IS NULL
        AND "referrerEmployeeId" IS NULL AND "referrerParentUserId" IS NULL
        AND "referrerStudentId" IS NULL AND "referrerAffiliateId" IS NULL)
      OR ("referrerKind" IS NOT NULL AND "referrerKind" = 'EMPLOYEE'
        AND "referrerEmployeeId" IS NOT NULL AND "referrerParentUserId" IS NULL
        AND "referrerStudentId" IS NULL AND "referrerAffiliateId" IS NULL)
      OR ("referrerKind" IS NOT NULL AND "referrerKind" = 'PARENT'
        AND ("referrerParentUserId" IS NOT NULL OR "referrerStudentId" IS NOT NULL)
        AND "referrerEmployeeId" IS NULL AND "referrerAffiliateId" IS NULL)
      OR ("referrerKind" IS NOT NULL AND "referrerKind" = 'AFFILIATE'
        AND "referrerAffiliateId" IS NOT NULL AND "referrerEmployeeId" IS NULL
        AND "referrerParentUserId" IS NULL AND "referrerStudentId" IS NULL)
    );
  END IF;
  -- Cửa sổ ghi công riêng của nguồn phải trong (0, 3650] ngày (NULL = dùng setting `nguon.cuaSoGhiCongNgay`; 3650 = cùng cận với setting và validator
  -- `CUA_SO_NGAY_TOI_DA` — lưới `[NHH-SRC-MIG-06]` ghim hai nơi cùng một con số). NULL qua CHECK ⇒ tường minh.
  -- Sửa TẠI CHỖ (migration này chưa áp ở đâu chung): bản đầu chỉ chặn `> 0`. DB dev nào đã chạy bản đó giữ ràng buộc cũ vì khối chỉ chạy khi CHƯA có tên này — dựng lại DB, hoặc
  -- chạy tay `ALTER TABLE "LeadSourceGroup" DROP CONSTRAINT "LeadSourceGroup_cua_so_chk"` rồi migrate lại; ca `[NHH-DYN-DB-01]` (3651 phải bị chặn) báo đúng DB như vậy.
  -- Không thêm nhánh DROP ở đây: `[NHH-SRC-MIG-03]` canh «additive-only, không DROP» và lưới đó không nên bị nới chỉ để vá một DB nháp.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceGroup_cua_so_chk') THEN
    ALTER TABLE "LeadSourceGroup" ADD CONSTRAINT "LeadSourceGroup_cua_so_chk" CHECK (
      "attributionWindowDays" IS NULL OR ("attributionWindowDays" > 0 AND "attributionWindowDays" <= 3650)
    );
  END IF;
  -- Khoảng hiệu lực: hết hạn phải SAU ngày bắt đầu (thiếu một đầu = mở).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceGroup_hieu_luc_chk') THEN
    ALTER TABLE "LeadSourceGroup" ADD CONSTRAINT "LeadSourceGroup_hieu_luc_chk" CHECK (
      "effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" > "effectiveFrom"
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadAttribution_giai_trinh_chk') THEN
    ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_giai_trinh_chk" CHECK (
      ("otherSourceNote" IS NULL OR btrim("otherSourceNote") <> '')
      AND ("changedById" IS NULL OR char_length(btrim(coalesce("changeReason", ''))) >= 10)
    );
  END IF;
END $$;

-- ─── Seed 8 nguồn MẶC ĐỊNH + UNKNOWN (SPEC "nguồn động" 09/10/2026 §1.3 — thay 11 nguồn của văn bản 06/10; tên
--     NGUYÊN VĂN khảo sát 06/10 §1). 8 dòng là DANH MỤC MẶC ĐỊNH, KHÔNG phải taxonomy đóng: nguồn thứ 9, 10, 50 do admin
--     thêm bằng cấu hình. Đổi ở đây ⇔ đổi lib/nguon/danh-muc-goc.ts — lưới [NHH-SRC-01c] so hai bên. Ca [NHH-SRC-01] đọc khối giữa
--     hai dấu dưới và chạy nó HAI lần: đừng đổi dấu, đừng tách thành nhiều câu.
-- >>> SEED LeadSourceGroup
INSERT INTO "LeadSourceGroup"
  ("id", "code", "documentNo", "name", "description", "referrerRequirement",
   "requiresNote", "selectable", "isSystem", "sortOrder", "status", "sourceType", "commissionEnabled", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'PARENT_REFERRAL',    1, 'Nguồn từ phụ huynh giới thiệu',               NULL, 'PARENT'::"SourceReferrerRequirement",        false, true,  true,   1, 'ACTIVE'::"SourceStatus", 'REFERRAL'::"LeadSourceType",  true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PAID_ADS',           2, 'Nguồn từ Quảng Cáo',                          NULL, 'NONE'::"SourceReferrerRequirement",          false, true,  true,   2, 'ACTIVE'::"SourceStatus", 'MARKETING'::"LeadSourceType", true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CENTER_ORGANIC',     3, 'Nguồn Review, chia sẻ, seeding từ Trung tâm', NULL, 'NONE'::"SourceReferrerRequirement",          false, true,  true,   3, 'ACTIVE'::"SourceStatus", 'ORGANIC'::"LeadSourceType",   false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'WALK_IN',            4, 'Nguồn KH tự đến Trung tâm',                   NULL, 'NONE'::"SourceReferrerRequirement",          false, true,  true,   4, 'ACTIVE'::"SourceStatus", 'OFFLINE'::"LeadSourceType",   false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EMPLOYEE_REFERRAL',  5, 'Nguồn từ nhân sự giới thiệu',                 NULL, 'EMPLOYEE'::"SourceReferrerRequirement",      false, true,  true,   5, 'ACTIVE'::"SourceStatus", 'REFERRAL'::"LeadSourceType",  true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'EVENT',              6, 'Nguồn từ sự kiện',                            NULL, 'EVENT'::"SourceReferrerRequirement",         false, true,  true,   6, 'ACTIVE'::"SourceStatus", 'EVENT'::"LeadSourceType",     false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PARTNER',            7, 'Nguồn từ đối tác',                            NULL, 'AFFILIATE_ORG'::"SourceReferrerRequirement", false, true,  true,   7, 'ACTIVE'::"SourceStatus", 'PARTNER'::"LeadSourceType",   false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'OTHER',              8, 'Nguồn khác',                                  'BẮT BUỘC giải trình rõ (văn bản 06/10/2026).', 'NONE'::"SourceReferrerRequirement", true,  true,  true,   8, 'ACTIVE'::"SourceStatus", 'OTHER'::"LeadSourceType",     false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'UNKNOWN',         NULL, 'Không rõ nguồn (hệ thống)',                   'Hệ thống gán khi không xác định được nguồn. Không chọn được ở ô nhập; khác "Nguồn khác" (D7).', 'NONE'::"SourceReferrerRequirement", false, false, true, 999, 'ACTIVE'::"SourceStatus", 'SYSTEM'::"LeadSourceType",    false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
-- <<< SEED LeadSourceGroup

-- ─── RLS: bảng MỚI ra đời với RLS TẮT (sự cố 09/08). Chỉ ENABLE, không FORCE, không policy. ─────
ALTER TABLE "LeadSourceGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadAttribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadTouchpoint" ENABLE ROW LEVEL SECURITY;
