-- 12/10/2026 — HOA HỒNG THEO NGUỒN · PR5a: SỔ BẤT BIẾN + KỲ + Ô TÍNH + HÀNG CHỜ.
-- Đặc tả: docs/source-commission/02 §8.3, §9.1–9.4, §9.6, §10.1, §10.2, §10.4 · 04 §10–§13 · 05 PR5a.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 9 enum + 6 bảng MỚI. KHÔNG cột nào trên bảng có sẵn, KHÔNG backfill dữ liệu
-- nghiệp vụ. Rollback = ngừng ghi (`hoaHong.engineBat` tắt); bảng nằm im.
--
-- ĐÂY LÀ MIGRATION ĐẦU TIÊN CỦA REPO CÓ TRIGGER trên bảng nghiệp vụ. Prisma 5 KHÔNG đọc trigger/function/CHECK nên
-- kiểm drift `--from-url` không thấy chúng: lưới duy nhất là ca DB [NHH-W11] (hỏi pg_trigger) và [NHH-SC-*].
-- Viết lại được ([MIG-01]): CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS rồi CREATE TRIGGER.
--
-- Cửa sổ 90 ngày (02 §6.1, §7.1 dự kiến thêm `attributionWindowDays`/`windowDays`/`expiresAt`) KHÔNG làm ở đây:
-- PR2 đã hiện thực cửa sổ bằng setting `nguon.cuaSoGhiCongNgay` (lib/nguon/cua-so-ghi-cong.ts) — thêm cột là thêm
-- nguồn sự thật thứ hai cho cùng một con số. Engine chụp số ngày đã dùng lên `candidates` của dòng sổ.
--
-- Chạy lại được ([MIG-01]): enum kiểm pg_type, bảng/chỉ mục IF NOT EXISTS, FK/CHECK kiểm pg_constraint.

-- ─── Enum ───────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClassificationStatus') THEN
    CREATE TYPE "ClassificationStatus" AS ENUM ('CLASSIFIED', 'MANUAL_REVIEW_REQUIRED', 'PENDING_REGULATION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionPeriodStatus') THEN
    CREATE TYPE "CommissionPeriodStatus" AS ENUM ('OPEN', 'CALCULATED', 'REVIEWING', 'LOCKED', 'EXPORTED', 'PAID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionEntryKind') THEN
    CREATE TYPE "CommissionEntryKind" AS ENUM (
      'ORIGINAL', 'REVERSAL', 'SOURCE_CORRECTION', 'INPUT_CORRECTION', 'DISPUTE_ADJUSTMENT',
      'LEGACY_REVERSAL', 'PERIOD_BONUS', 'LATE_ARRIVAL'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionBeneficiaryKind') THEN
    CREATE TYPE "CommissionBeneficiaryKind" AS ENUM ('USER', 'AFFILIATE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionPayoutStatus') THEN
    CREATE TYPE "CommissionPayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPORTED', 'PAID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionHoldCode') THEN
    CREATE TYPE "CommissionHoldCode" AS ENUM (
      'CHUA_GAN_CON', 'CHO_HOC_VIEN', 'CAP_EXCEEDED', 'POLICY_OVERLAP', 'MANUAL_REVIEW_REQUIRED',
      'PENDING_REGULATION', 'INTERNAL_TRANSFER', 'NEGATIVE_WITHOUT_ORIGIN', 'INPUT_DRIFT', 'NO_ORG_UNIT',
      'PAYMENT_WITHDRAWN', 'NEGATIVE_BALANCE', 'UNRESOLVED_BENEFICIARY'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionHoldSeverity') THEN
    CREATE TYPE "CommissionHoldSeverity" AS ENUM ('SOFT', 'HARD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionHoldStatus') THEN
    CREATE TYPE "CommissionHoldStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionPayoutBatchKind') THEN
    CREATE TYPE "CommissionPayoutBatchKind" AS ENUM ('PAYROLL', 'EXTERNAL_SETTLEMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionPayoutBatchStatus') THEN
    CREATE TYPE "CommissionPayoutBatchStatus" AS ENUM ('EXPORTED', 'PAID');
  END IF;
END $$;

-- ─── StudentTransaction (02 §8.3) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudentTransaction" (
  "id"                  TEXT NOT NULL,
  "orderItemId"         TEXT NOT NULL,
  "orderId"             TEXT NOT NULL,
  "studentId"           TEXT,
  "revenueComponent"    "RevenueComponent" NOT NULL,
  "status"              "ClassificationStatus" NOT NULL,
  "transactionTypeCode" TEXT,
  "reasonCode"          TEXT NOT NULL,
  "evidence"            JSONB,
  "rulesetVersion"      TEXT NOT NULL,
  "classifiedAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById"         TEXT,
  "decidedAt"           TIMESTAMPTZ(6),
  "decisionNote"        TEXT,
  "centerId"            TEXT,
  "orgUnitId"           TEXT,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "StudentTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudentTransaction_orderItemId_key" ON "StudentTransaction"("orderItemId");
CREATE INDEX IF NOT EXISTS "StudentTransaction_studentId_classifiedAt_idx" ON "StudentTransaction"("studentId", "classifiedAt");
CREATE INDEX IF NOT EXISTS "StudentTransaction_orderId_idx" ON "StudentTransaction"("orderId");
CREATE INDEX IF NOT EXISTS "StudentTransaction_status_idx" ON "StudentTransaction"("status");
CREATE INDEX IF NOT EXISTS "StudentTransaction_centerId_idx" ON "StudentTransaction"("centerId");
CREATE INDEX IF NOT EXISTS "StudentTransaction_orgUnitId_idx" ON "StudentTransaction"("orgUnitId");

-- ─── CommissionPeriod (02 §9.1) ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionPeriod" (
  "id"                 TEXT NOT NULL,
  "period"             TEXT NOT NULL,
  "centerId"           TEXT NOT NULL,
  "orgUnitId"          TEXT NOT NULL,
  "status"             "CommissionPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "lastCalculatedAt"   TIMESTAMPTZ(6),
  "lastCalculatedById" TEXT,
  "reviewStartedAt"    TIMESTAMPTZ(6),
  "reviewStartedById"  TEXT,
  "lockedAt"           TIMESTAMPTZ(6),
  "lockedById"         TEXT,
  "exportedAt"         TIMESTAMPTZ(6),
  "exportedById"       TEXT,
  "paidAt"             TIMESTAMPTZ(6),
  "paidById"           TEXT,
  "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionPeriod_period_centerId_key" ON "CommissionPeriod"("period", "centerId");
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionPeriod_period_orgUnitId_key" ON "CommissionPeriod"("period", "orgUnitId");
CREATE INDEX IF NOT EXISTS "CommissionPeriod_status_idx" ON "CommissionPeriod"("status");

-- ─── CommissionPayoutBatch (02 §9.4) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionPayoutBatch" (
  "id"          TEXT NOT NULL,
  "kind"        "CommissionPayoutBatchKind" NOT NULL,
  "month"       TEXT NOT NULL,
  "status"      "CommissionPayoutBatchStatus" NOT NULL DEFAULT 'EXPORTED',
  "lineCount"   INTEGER NOT NULL,
  "totalAmount" INTEGER NOT NULL,
  "fileKey"     TEXT,
  "fileName"    TEXT,
  "note"        TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"      TIMESTAMPTZ(6),
  "paidById"    TEXT,
  CONSTRAINT "CommissionPayoutBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommissionPayoutBatch_month_kind_idx" ON "CommissionPayoutBatch"("month", "kind");

-- ─── CommissionCalcSlot — Ô TÍNH (02 §9.6, 04 L13) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionCalcSlot" (
  "id"                TEXT NOT NULL,
  "paymentId"         TEXT NOT NULL,
  "orderItemKey"      TEXT NOT NULL,
  "revenueComponent"  "RevenueComponent" NOT NULL,
  "netBase"           INTEGER NOT NULL,
  "firstInputHash"    TEXT NOT NULL,
  "lastMatchedHash"   TEXT NOT NULL,
  "lastCheckedAt"     TIMESTAMPTZ(6) NOT NULL,
  "originalLineCount" INTEGER NOT NULL,
  "calculationRunId"  TEXT,
  "centerId"          TEXT NOT NULL,
  "orgUnitId"         TEXT NOT NULL,
  "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionCalcSlot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionCalcSlot_paymentId_orderItemKey_revenueComponent_key"
  ON "CommissionCalcSlot"("paymentId", "orderItemKey", "revenueComponent");
CREATE INDEX IF NOT EXISTS "CommissionCalcSlot_centerId_idx" ON "CommissionCalcSlot"("centerId");
CREATE INDEX IF NOT EXISTS "CommissionCalcSlot_orgUnitId_idx" ON "CommissionCalcSlot"("orgUnitId");

-- ─── CommissionTransaction — SỔ BẤT BIẾN (02 §9.2) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionTransaction" (
  "id"                     TEXT NOT NULL,
  "idempotencyKey"         TEXT NOT NULL,
  "entryKind"              "CommissionEntryKind" NOT NULL,
  "calcSlotId"             TEXT,
  "periodId"               TEXT NOT NULL,
  "naturalPeriod"          TEXT NOT NULL,
  "lateArrival"            BOOLEAN NOT NULL DEFAULT false,
  "rateDate"               TIMESTAMPTZ(6) NOT NULL,
  "assigneeDate"           TIMESTAMPTZ(6),
  "paymentId"              TEXT,
  "orderId"                TEXT,
  "orderItemId"            TEXT,
  "studentId"              TEXT,
  "leadId"                 TEXT,
  "studentTransactionId"   TEXT,
  "transactionTypeCode"    TEXT NOT NULL,
  "revenueComponent"       "RevenueComponent" NOT NULL,
  "splitMethod"            TEXT,
  "attributionId"          TEXT,
  "sourceGroupId"          TEXT NOT NULL,
  "sourceGroupCode"        TEXT NOT NULL,
  "sourceId"               TEXT,
  "beneficiaryRoleId"      TEXT NOT NULL,
  "roleCode"               TEXT NOT NULL,
  "beneficiaryKind"        "CommissionBeneficiaryKind" NOT NULL,
  "beneficiaryUserId"      TEXT,
  "beneficiaryAffiliateId" TEXT,
  "beneficiaryEmployeeId"  TEXT,
  "beneficiaryName"        TEXT NOT NULL,
  "resolverType"           "BeneficiaryResolverType" NOT NULL,
  "resolverBasis"          JSONB,
  "policyId"               TEXT,
  "policyVersionId"        TEXT,
  "versionNo"              INTEGER,
  "ruleId"                 TEXT,
  "documentNumber"         TEXT,
  "calcKind"               "CommissionCalcKind",
  "scopeOrderVersion"      TEXT,
  "reason"                 TEXT NOT NULL,
  "reasonCode"             TEXT,
  "candidates"             JSONB,
  "legacyTier"             TEXT,
  "grossAmount"            INTEGER NOT NULL,
  "vatRate"                DECIMAL(5,4) NOT NULL,
  "netBase"                INTEGER NOT NULL,
  "rate"                   DECIMAL(9,6),
  "fixedAmount"            INTEGER,
  "amount"                 INTEGER NOT NULL,
  "capRate"                DECIMAL(5,4) NOT NULL,
  "equivalentRate"         DECIMAL(9,6) NOT NULL,
  "inputHash"              TEXT NOT NULL,
  "refEntryId"             TEXT,
  "refEventType"           TEXT,
  "refEventId"             TEXT,
  "payoutStatus"           "CommissionPayoutStatus" NOT NULL DEFAULT 'PENDING',
  "payoutBatchId"          TEXT,
  "payoutStatusAt"         TIMESTAMPTZ(6),
  "calculationRunId"       TEXT,
  "createdById"            TEXT,
  "createdAt"              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "centerId"               TEXT NOT NULL,
  "orgUnitId"              TEXT NOT NULL,
  CONSTRAINT "CommissionTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionTransaction_idempotencyKey_key" ON "CommissionTransaction"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_periodId_beneficiaryRoleId_idx" ON "CommissionTransaction"("periodId", "beneficiaryRoleId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_beneficiaryUserId_periodId_idx" ON "CommissionTransaction"("beneficiaryUserId", "periodId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_beneficiaryAffiliateId_idx" ON "CommissionTransaction"("beneficiaryAffiliateId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_paymentId_idx" ON "CommissionTransaction"("paymentId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_orderId_idx" ON "CommissionTransaction"("orderId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_refEntryId_idx" ON "CommissionTransaction"("refEntryId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_attributionId_idx" ON "CommissionTransaction"("attributionId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_policyVersionId_idx" ON "CommissionTransaction"("policyVersionId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_leadId_idx" ON "CommissionTransaction"("leadId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_studentId_idx" ON "CommissionTransaction"("studentId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_centerId_rateDate_idx" ON "CommissionTransaction"("centerId", "rateDate");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_orgUnitId_idx" ON "CommissionTransaction"("orgUnitId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_payoutBatchId_idx" ON "CommissionTransaction"("payoutBatchId");
CREATE INDEX IF NOT EXISTS "CommissionTransaction_calcSlotId_beneficiaryRoleId_idx" ON "CommissionTransaction"("calcSlotId", "beneficiaryRoleId");

-- ─── CommissionHold — HÀNG CHỜ (02 §9.3) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionHold" (
  "id"               TEXT NOT NULL,
  "holdKey"          TEXT NOT NULL,
  "code"             "CommissionHoldCode" NOT NULL,
  "severity"         "CommissionHoldSeverity" NOT NULL,
  "status"           "CommissionHoldStatus" NOT NULL DEFAULT 'OPEN',
  "paymentId"        TEXT,
  "orderId"          TEXT,
  "orderItemId"      TEXT,
  "studentId"        TEXT,
  "entryId"          TEXT,
  "calcSlotId"       TEXT,
  "blockingPeriodId" TEXT,
  "detail"           JSONB NOT NULL,
  "resolvedById"     TEXT,
  "resolvedAt"       TIMESTAMPTZ(6),
  "resolutionNote"   TEXT,
  "centerId"         TEXT,
  "orgUnitId"        TEXT,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionHold_holdKey_key" ON "CommissionHold"("holdKey");
CREATE INDEX IF NOT EXISTS "CommissionHold_status_code_idx" ON "CommissionHold"("status", "code");
CREATE INDEX IF NOT EXISTS "CommissionHold_blockingPeriodId_status_idx" ON "CommissionHold"("blockingPeriodId", "status");
CREATE INDEX IF NOT EXISTS "CommissionHold_calcSlotId_idx" ON "CommissionHold"("calcSlotId");
CREATE INDEX IF NOT EXISTS "CommissionHold_paymentId_idx" ON "CommissionHold"("paymentId");
CREATE INDEX IF NOT EXISTS "CommissionHold_centerId_status_idx" ON "CommissionHold"("centerId", "status");
CREATE INDEX IF NOT EXISTS "CommissionHold_orgUnitId_idx" ON "CommissionHold"("orgUnitId");

-- ─── Khoá ngoại (khuôn 20260825120000_lead_status_history: kiểm pg_constraint) ──────────────
-- RESTRICT khắp nơi: bản ghi đã được sổ tham chiếu không xoá cứng được.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentTransaction_orderItemId_fkey') THEN
    ALTER TABLE "StudentTransaction" ADD CONSTRAINT "StudentTransaction_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentTransaction_orderId_fkey') THEN
    ALTER TABLE "StudentTransaction" ADD CONSTRAINT "StudentTransaction_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentTransaction_studentId_fkey') THEN
    ALTER TABLE "StudentTransaction" ADD CONSTRAINT "StudentTransaction_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentTransaction_transactionTypeCode_fkey') THEN
    ALTER TABLE "StudentTransaction" ADD CONSTRAINT "StudentTransaction_transactionTypeCode_fkey"
      FOREIGN KEY ("transactionTypeCode") REFERENCES "CommissionTransactionType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPeriod_centerId_fkey') THEN
    ALTER TABLE "CommissionPeriod" ADD CONSTRAINT "CommissionPeriod_centerId_fkey"
      FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionCalcSlot_paymentId_fkey') THEN
    ALTER TABLE "CommissionCalcSlot" ADD CONSTRAINT "CommissionCalcSlot_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_calcSlotId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_calcSlotId_fkey"
      FOREIGN KEY ("calcSlotId") REFERENCES "CommissionCalcSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_periodId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_periodId_fkey"
      FOREIGN KEY ("periodId") REFERENCES "CommissionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_paymentId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_orderId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_studentTransactionId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_studentTransactionId_fkey"
      FOREIGN KEY ("studentTransactionId") REFERENCES "StudentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_attributionId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_attributionId_fkey"
      FOREIGN KEY ("attributionId") REFERENCES "LeadAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_sourceGroupId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_sourceGroupId_fkey"
      FOREIGN KEY ("sourceGroupId") REFERENCES "LeadSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_beneficiaryRoleId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_beneficiaryRoleId_fkey"
      FOREIGN KEY ("beneficiaryRoleId") REFERENCES "BeneficiaryRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_beneficiaryUserId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_beneficiaryUserId_fkey"
      FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_beneficiaryAffiliateId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_beneficiaryAffiliateId_fkey"
      FOREIGN KEY ("beneficiaryAffiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_policyId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_policyId_fkey"
      FOREIGN KEY ("policyId") REFERENCES "CommissionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_policyVersionId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_policyVersionId_fkey"
      FOREIGN KEY ("policyVersionId") REFERENCES "CommissionPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_ruleId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_ruleId_fkey"
      FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_refEntryId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_refEntryId_fkey"
      FOREIGN KEY ("refEntryId") REFERENCES "CommissionTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_payoutBatchId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_payoutBatchId_fkey"
      FOREIGN KEY ("payoutBatchId") REFERENCES "CommissionPayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_centerId_fkey') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_centerId_fkey"
      FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionHold_paymentId_fkey') THEN
    ALTER TABLE "CommissionHold" ADD CONSTRAINT "CommissionHold_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionHold_blockingPeriodId_fkey') THEN
    ALTER TABLE "CommissionHold" ADD CONSTRAINT "CommissionHold_blockingPeriodId_fkey"
      FOREIGN KEY ("blockingPeriodId") REFERENCES "CommissionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── CHECK (02 §10.2). Prisma 5 KHÔNG đọc CHECK ⇒ drift không thấy; lưới duy nhất là ca DB [NHH-SC-*]. ───
DO $$ BEGIN
  -- (hoà giải 07/10) REVERSAL / *_CORRECTION bắt buộc mang ô gốc; khiếu nại có đích mang ô nếu có; LEGACY_REVERSAL /
  -- PERIOD_BONUS không có ô. LATE_ARRIVAL (H22) = một khoản THU đến muộn ⇒ có ô của chính nó.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_o_tinh_chk') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_o_tinh_chk" CHECK (
      CASE "entryKind"
        WHEN 'PERIOD_BONUS' THEN "calcSlotId" IS NULL
        WHEN 'LEGACY_REVERSAL' THEN "calcSlotId" IS NULL
        WHEN 'DISPUTE_ADJUSTMENT' THEN true
        ELSE "calcSlotId" IS NOT NULL
      END
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_so_tien_chk') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_so_tien_chk" CHECK ("amount" <> 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_nguoi_huong_chk') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_nguoi_huong_chk" CHECK (
      CASE "beneficiaryKind"
        WHEN 'USER' THEN "beneficiaryUserId" IS NOT NULL AND "beneficiaryAffiliateId" IS NULL
        WHEN 'AFFILIATE' THEN "beneficiaryAffiliateId" IS NOT NULL AND "beneficiaryUserId" IS NULL
        ELSE false
      END
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_loai_dong_chk') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_loai_dong_chk" CHECK (
      CASE "entryKind"
        WHEN 'ORIGINAL' THEN "paymentId" IS NOT NULL AND "refEntryId" IS NULL AND "amount" > 0
        WHEN 'LATE_ARRIVAL' THEN "paymentId" IS NOT NULL AND "refEntryId" IS NULL AND "amount" > 0
        WHEN 'REVERSAL' THEN "refEntryId" IS NOT NULL AND "amount" < 0
        WHEN 'LEGACY_REVERSAL' THEN "paymentId" IS NOT NULL AND "amount" < 0
        ELSE true
      END
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_vat_chk') THEN
    ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_vat_chk"
      CHECK ("vatRate" >= 0 AND "vatRate" < 1);
  END IF;
  -- Hàng chờ mềm không chặn khoá kỳ (04 §10.5): UNRESOLVED_BENEFICIARY / NEGATIVE_BALANCE luôn không có kỳ chặn.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionHold_khong_chan_chk') THEN
    ALTER TABLE "CommissionHold" ADD CONSTRAINT "CommissionHold_khong_chan_chk" CHECK (
      "code" NOT IN ('UNRESOLVED_BENEFICIARY', 'NEGATIVE_BALANCE') OR "blockingPeriodId" IS NULL
    );
  END IF;
  -- Phân loại: CLASSIFIED ⇔ có mã loại giao dịch.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentTransaction_loai_chk') THEN
    ALTER TABLE "StudentTransaction" ADD CONSTRAINT "StudentTransaction_loai_chk"
      CHECK (("status" = 'CLASSIFIED') = ("transactionTypeCode" IS NOT NULL));
  END IF;
END $$;

-- ─── TRIGGER (02 §10.1) — viết lại được: CREATE OR REPLACE + DROP TRIGGER IF EXISTS ───────────
-- (1) SỔ BẤT BIẾN. DELETE ⇒ ném. UPDATE chỉ được đổi 3 cột chi trả; payoutStatus chỉ TIẾN; payoutBatchId ghi một lần.
CREATE OR REPLACE FUNCTION hoa_hong_so_bat_bien() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cho_sua text[] := ARRAY['payoutStatus','payoutBatchId','payoutStatusAt'];
  thu_tu  text[] := ARRAY['PENDING','APPROVED','EXPORTED','PAID'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CommissionTransaction là sổ bất biến — xoá bị chặn (id=%)', OLD."id";
  END IF;
  IF (to_jsonb(NEW) - cho_sua) IS DISTINCT FROM (to_jsonb(OLD) - cho_sua) THEN
    RAISE EXCEPTION 'CommissionTransaction là sổ bất biến — chỉ được đổi cột chi trả (id=%)', OLD."id";
  END IF;
  IF array_position(thu_tu, NEW."payoutStatus"::text) < array_position(thu_tu, OLD."payoutStatus"::text) THEN
    RAISE EXCEPTION 'payoutStatus chỉ tiến (% → % bị chặn, id=%)', OLD."payoutStatus", NEW."payoutStatus", OLD."id";
  END IF;
  IF OLD."payoutBatchId" IS NOT NULL AND NEW."payoutBatchId" IS DISTINCT FROM OLD."payoutBatchId" THEN
    RAISE EXCEPTION 'payoutBatchId chỉ ghi một lần (id=%)', OLD."id";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "CommissionTransaction_bat_bien_bud" ON "CommissionTransaction";
CREATE TRIGGER "CommissionTransaction_bat_bien_bud" BEFORE UPDATE OR DELETE ON "CommissionTransaction"
  FOR EACH ROW EXECUTE FUNCTION hoa_hong_so_bat_bien();

-- (2) KỲ MỞ. Lớp dưới của cổng `ghiSo`: INSERT vào kỳ không còn OPEN/CALCULATED ⇒ ném. FOR SHARE để lượt chèn
--     chờ lượt khoá kỳ đang chạy.
CREATE OR REPLACE FUNCTION hoa_hong_so_ky_mo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT p."status"::text INTO st FROM "CommissionPeriod" p WHERE p."id" = NEW."periodId" FOR SHARE;
  IF st IS NULL OR st NOT IN ('OPEN','CALCULATED') THEN
    RAISE EXCEPTION 'Kỳ % đang % — không ghi thêm dòng sổ (vào kỳ OPEN kế tiếp)', NEW."periodId", st;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "CommissionTransaction_ky_mo_bi" ON "CommissionTransaction";
CREATE TRIGGER "CommissionTransaction_ky_mo_bi" BEFORE INSERT ON "CommissionTransaction"
  FOR EACH ROW EXECUTE FUNCTION hoa_hong_so_ky_mo();

-- (3) RÒNG KHÔNG ÂM. Dòng âm gắn ô mà làm Σ ròng (ô × vai × người) < 0 ⇒ ném — không bao giờ đòi lại quá số đã ghi.
CREATE OR REPLACE FUNCTION hoa_hong_so_rong_khong_am() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE rong bigint;
BEGIN
  IF NEW."amount" >= 0 OR NEW."calcSlotId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(t."amount"), 0) INTO rong
  FROM "CommissionTransaction" t
  WHERE t."calcSlotId" = NEW."calcSlotId"
    AND t."beneficiaryRoleId" = NEW."beneficiaryRoleId"
    AND t."beneficiaryKind" = NEW."beneficiaryKind"
    AND t."beneficiaryUserId" IS NOT DISTINCT FROM NEW."beneficiaryUserId"
    AND t."beneficiaryAffiliateId" IS NOT DISTINCT FROM NEW."beneficiaryAffiliateId";
  IF rong + NEW."amount" < 0 THEN
    RAISE EXCEPTION 'Dòng âm % làm số ròng của ô % (vai %) thành % — không đảo quá số đã ghi',
      NEW."amount", NEW."calcSlotId", NEW."beneficiaryRoleId", rong + NEW."amount";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "CommissionTransaction_rong_khong_am_bi" ON "CommissionTransaction";
CREATE TRIGGER "CommissionTransaction_rong_khong_am_bi" BEFORE INSERT ON "CommissionTransaction"
  FOR EACH ROW EXECUTE FUNCTION hoa_hong_so_rong_khong_am();

-- ─── RLS: bảng MỚI ra đời với RLS TẮT (sự cố 09/08). Chỉ ENABLE, không FORCE, không policy. ─────
ALTER TABLE "StudentTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionPayoutBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionCalcSlot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionHold" ENABLE ROW LEVEL SECURITY;
