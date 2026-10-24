-- Công Parttime SR.QD.238 · P5c — điều chỉnh tiền (đề xuất → QLCS xác nhận). THUẦN THÊM: 2 enum + 1 bảng.
-- Không đụng WorkUnit / StaffTimeLog / StudentSessionFeedback. Thiết kế: docs/cham-cong/parttime/10-DIEU-CHINH-NHAN-XET.md.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CompensationAdjustmentType') THEN
    CREATE TYPE "CompensationAdjustmentType" AS ENUM ('LATE_ARRIVAL', 'EARLY_LEAVE', 'MISSING_SESSION_COMMENT', 'ABANDONED_WORK');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CompensationAdjustmentStatus') THEN
    CREATE TYPE "CompensationAdjustmentStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CompensationAdjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "workDate" DATE NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "type" "CompensationAdjustmentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,
    "status" "CompensationAdjustmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionReason" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CompensationAdjustment_pkey" PRIMARY KEY ("id"),
    -- Điều chỉnh ở giai đoạn này chỉ là KHẤU TRỪ / PHẠT (âm). Khoản cộng thêm (thưởng) là việc khác, không đi đường này.
    CONSTRAINT "CompensationAdjustment_amount_check" CHECK ("amount" < 0),
    CONSTRAINT "CompensationAdjustment_rule_check" CHECK (length("ruleCode") > 0 AND length("sourceId") > 0)
);
CREATE INDEX IF NOT EXISTS "CompensationAdjustment_userId_workDate_idx" ON "CompensationAdjustment"("userId", "workDate");
CREATE INDEX IF NOT EXISTS "CompensationAdjustment_centerId_workDate_idx" ON "CompensationAdjustment"("centerId", "workDate");
CREATE INDEX IF NOT EXISTS "CompensationAdjustment_workUnitId_idx" ON "CompensationAdjustment"("workUnitId");
CREATE INDEX IF NOT EXISTS "CompensationAdjustment_orgUnitId_idx" ON "CompensationAdjustment"("orgUnitId");
-- Không phạt hai lần: một đơn vị × một loại có tối đa MỘT khoản đang đề xuất / đã xác nhận.
CREATE UNIQUE INDEX IF NOT EXISTS "CompensationAdjustment_live_key" ON "CompensationAdjustment"("workUnitId", "type")
  WHERE "status" IN ('PROPOSED', 'CONFIRMED');

ALTER TABLE "CompensationAdjustment" ENABLE ROW LEVEL SECURITY;
