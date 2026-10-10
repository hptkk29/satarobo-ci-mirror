-- Nền Hệ thống P1 · US-07 — thêm cột `orgUnitId` SONG SONG cho 24 bảng còn thiếu, và
-- bảng nhật ký đối soát.
--
-- ADDITIVE TUYỆT ĐỐI: chỉ ADD COLUMN + CREATE INDEX + UPDATE điền chỗ đang NULL.
-- Không RENAME, không DROP, không đụng `centerId` (luật cứng #4 + luật #3 "ghi kép cả hai
-- cột cho tới P4").
--
-- ĐÂY LÀ NỬA SAU của việc PR-A (`20260615083728_pr_a_add_orgunitid`, 15/06) đã làm cho 28
-- bảng đầu. Bài học từ PR-A phải nhớ: backfill đó chạy ĐÚNG MỘT LẦN lúc migrate, còn đường
-- ghi thì tiếp tục đẻ dòng thiếu `orgUnitId` suốt từ đó — bằng chứng là
-- `scripts/backfill-enrollment-center.ts` (05/08) phải vá tay lại đúng thứ migration
-- `20260624010000_fl_backfill_centerid` đã backfill hồi 24/06. Vì vậy US-07 KHÔNG dừng ở
-- migration: có thêm cơ chế ghi kép (lib/org/dual-write.ts) và đối soát đêm.
--
-- ⚠️ BA NHÓM, KHÔNG PHẢI HAI. Ý nghĩa của `centerId = NULL` khác nhau theo bảng; bảng phân
-- loại là `lib/org/center-bridge.ts` (nguồn sự thật dùng chung cho migration, ghi kép và
-- đối soát). Backfill dưới đây dùng INNER JOIN nên tự nó KHÔNG đụng dòng null — đó là chủ
-- đích, đừng có ai "điền cho đủ" bằng cơ sở mặc định:
--   · null = TOÀN HỆ THỐNG (Affiliate, EvaluationRound, RevenueTarget, SataCoinRule,
--     WorkShiftConfig, FacebookPageMapping) — điền vào là khoá dữ liệu dùng chung về 1 cơ sở.
--   · null = CHƯA ĐỐI KHỚP (BankTransaction, WorkRequest) — tiền về chưa xử lý; điền vào
--     là giấu mất việc đang tồn đọng.
--
-- ⚠️ CENTER MỒ CÔI: `Center("hoi-so")` (code "HO") không được OrgUnit nào trỏ tới vì luật V7
-- cấm đơn vị HO mang `centerId` (đã thử nới ở US-05 và phải GỠ — nới ra là màn nhân sự neo
-- vai người Hội sở tại HO ⇒ isHoLevel ⇒ thấy mọi cơ sở). Nên backfill JOIN theo HAI nhánh:
-- `OrgUnit.centerId = Center.id`, HOẶC `OrgUnit.code = Center.code`. Nhánh thứ hai là thứ
-- kéo được dữ liệu Hội sở về đúng đơn vị mà không nạp thêm nghĩa cho cột `centerId`.
--
-- THỨ TỰ CHẠY TRÊN DB ĐANG CÓ DỮ LIỆU: chạy `scripts/nen-p1-reshape-org-tree.ts` TRƯỚC,
-- rồi mới `pnpm tsx scripts/nen-p1-backfill-orgunit.ts --apply`. Ngược lại thì cây chưa có
-- vùng, và dữ liệu vẫn khớp nhưng đối soát về sau phải chạy lại.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Thêm cột + index. Cột TRẦN (không FK) — giống hệt 28 bảng của PR-A, để
--    không đẻ ra 24 ràng buộc mới trên dữ liệu PROD trong cùng một lần.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Enrollment" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "ClassSession" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "ReportCard" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "CourseCompletionRequest" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "StudentBirthdayGreeting" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "TrialClassV2" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "LeadTrialHistory" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "LeadAssignmentConfig" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "CreditBalance" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "QrSession" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "EvaluationRound" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "RevenueTarget" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "SataCoinRule" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "WorkShiftConfig" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "FacebookPageMapping" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;

CREATE INDEX IF NOT EXISTS "Enrollment_orgUnitId_idx" ON "Enrollment"("orgUnitId");
CREATE INDEX IF NOT EXISTS "ClassSession_orgUnitId_idx" ON "ClassSession"("orgUnitId");
CREATE INDEX IF NOT EXISTS "Attendance_orgUnitId_idx" ON "Attendance"("orgUnitId");
CREATE INDEX IF NOT EXISTS "ReportCard_orgUnitId_idx" ON "ReportCard"("orgUnitId");
CREATE INDEX IF NOT EXISTS "CourseCompletionRequest_orgUnitId_idx" ON "CourseCompletionRequest"("orgUnitId");
CREATE INDEX IF NOT EXISTS "StudentBirthdayGreeting_orgUnitId_idx" ON "StudentBirthdayGreeting"("orgUnitId");
CREATE INDEX IF NOT EXISTS "TrialClassV2_orgUnitId_idx" ON "TrialClassV2"("orgUnitId");
CREATE INDEX IF NOT EXISTS "LeadTrialHistory_orgUnitId_idx" ON "LeadTrialHistory"("orgUnitId");
CREATE INDEX IF NOT EXISTS "ConversationMessage_orgUnitId_idx" ON "ConversationMessage"("orgUnitId");
CREATE INDEX IF NOT EXISTS "LeadAssignmentConfig_orgUnitId_idx" ON "LeadAssignmentConfig"("orgUnitId");
CREATE INDEX IF NOT EXISTS "Payment_orgUnitId_idx" ON "Payment"("orgUnitId");
CREATE INDEX IF NOT EXISTS "PaymentRequest_orgUnitId_idx" ON "PaymentRequest"("orgUnitId");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_orgUnitId_idx" ON "PaymentAllocation"("orgUnitId");
CREATE INDEX IF NOT EXISTS "CreditBalance_orgUnitId_idx" ON "CreditBalance"("orgUnitId");
CREATE INDEX IF NOT EXISTS "RefundRequest_orgUnitId_idx" ON "RefundRequest"("orgUnitId");
CREATE INDEX IF NOT EXISTS "QrSession_orgUnitId_idx" ON "QrSession"("orgUnitId");
CREATE INDEX IF NOT EXISTS "Affiliate_orgUnitId_idx" ON "Affiliate"("orgUnitId");
CREATE INDEX IF NOT EXISTS "EvaluationRound_orgUnitId_idx" ON "EvaluationRound"("orgUnitId");
CREATE INDEX IF NOT EXISTS "RevenueTarget_orgUnitId_idx" ON "RevenueTarget"("orgUnitId");
CREATE INDEX IF NOT EXISTS "SataCoinRule_orgUnitId_idx" ON "SataCoinRule"("orgUnitId");
CREATE INDEX IF NOT EXISTS "WorkShiftConfig_orgUnitId_idx" ON "WorkShiftConfig"("orgUnitId");
CREATE INDEX IF NOT EXISTS "FacebookPageMapping_orgUnitId_idx" ON "FacebookPageMapping"("orgUnitId");
CREATE INDEX IF NOT EXISTS "BankTransaction_orgUnitId_idx" ON "BankTransaction"("orgUnitId");
CREATE INDEX IF NOT EXISTS "WorkRequest_orgUnitId_idx" ON "WorkRequest"("orgUnitId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill. `WHERE t."orgUnitId" IS NULL` ⇒ chạy lại là no-op (AC1 idempotent).
--    INNER JOIN ⇒ dòng centerId NULL không bao giờ bị đụng tới.
--    Nhánh `ou."code" = c."code"` là cầu cho Center mồ côi (xem đầu file).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "Enrollment" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "ClassSession" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "Attendance" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "ReportCard" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "CourseCompletionRequest" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "StudentBirthdayGreeting" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "TrialClassV2" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "LeadTrialHistory" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "ConversationMessage" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "LeadAssignmentConfig" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "Payment" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "PaymentRequest" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "PaymentAllocation" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "CreditBalance" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "RefundRequest" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "QrSession" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "Affiliate" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "EvaluationRound" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "RevenueTarget" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "SataCoinRule" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "WorkShiftConfig" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "FacebookPageMapping" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "BankTransaction" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;

UPDATE "WorkRequest" t
SET "orgUnitId" = ou."id"
FROM "Center" c
JOIN "OrgUnit" ou
  ON ou."deletedAt" IS NULL
 AND (ou."centerId" = c."id" OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
WHERE t."centerId" = c."id" AND t."orgUnitId" IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Nhật ký đối soát đêm (AC3). Mỗi lần chạy MỘT dòng `OrgUnitDriftRun` + N dòng
--    `OrgUnitDriftItem` cho bảng lệch.
--
--    Vì sao có bảng RUN riêng chứ không chỉ ghi bảng lệch: không có nó thì "đêm sạch"
--    và "job không chạy" trông giống hệt nhau — đúng cái bẫy mà cron chat đã phải
--    dựng `ConversationReconcileRun` để tránh, và đúng cái đã xảy ra hồi cron prod chết
--    vì canonical 308 mà không ai thấy (manh mối vàng lúc đó là `attempts = 0`).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OrgUnitDriftRun" (
    "id" TEXT NOT NULL,
    "ranAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tablesChecked" INTEGER NOT NULL DEFAULT 0,
    "driftCount" INTEGER NOT NULL DEFAULT 0,
    "totalRows" BIGINT NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "OrgUnitDriftRun_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "OrgUnitDriftRun" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "OrgUnitDriftRun_ranAt_idx" ON "OrgUnitDriftRun"("ranAt");

CREATE TABLE IF NOT EXISTS "OrgUnitDriftItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    -- Phân loại lấy từ lib/org/center-bridge.ts: BAT_BUOC | NULL_TOAN_HE_THONG | NULL_CHUA_KHOP
    "nullMeaning" TEXT NOT NULL,
    -- MẪU SỐ bắt buộc đi kèm: prod đã bị dọn sạch dữ liệu 01/08 nên "0 lệch" rất dễ là
    -- XANH GIẢ vì mẫu số bằng 0. Không có totalRows thì 7 đêm sạch không chứng minh gì.
    "totalRows" BIGINT NOT NULL DEFAULT 0,
    "withCenter" BIGINT NOT NULL DEFAULT 0,
    "withOrgUnit" BIGINT NOT NULL DEFAULT 0,
    "missingOrgUnit" BIGINT NOT NULL DEFAULT 0,
    "mismatched" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgUnitDriftItem_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "OrgUnitDriftItem" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "OrgUnitDriftItem_runId_idx" ON "OrgUnitDriftItem"("runId");
CREATE INDEX IF NOT EXISTS "OrgUnitDriftItem_model_idx" ON "OrgUnitDriftItem"("model");

DO $$ BEGIN
    ALTER TABLE "OrgUnitDriftItem" ADD CONSTRAINT "OrgUnitDriftItem_runId_fkey"
        FOREIGN KEY ("runId") REFERENCES "OrgUnitDriftRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

