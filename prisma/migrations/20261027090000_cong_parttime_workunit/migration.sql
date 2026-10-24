-- Công Parttime SR.QD.238 · P5a — WorkUnit (sự thật công việc) + WorkConfirmation (QLCS xác nhận thực hiện).
-- THUẦN THÊM: 3 enum + 2 bảng mới. Không đụng bảng / dòng đang có. Thiết kế: docs/cham-cong/parttime/08-WORKUNIT.md.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkUnitType') THEN
    CREATE TYPE "WorkUnitType" AS ENUM ('MAIN_TEACHING', 'ASSISTANT_TEACHING', 'OPERATIONS_DUTY');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkUnitStatus') THEN
    CREATE TYPE "WorkUnitStatus" AS ENUM ('CONFIRMED', 'STALE', 'VOIDED');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkConfirmationDecision') THEN
    CREATE TYPE "WorkConfirmationDecision" AS ENUM ('CONFIRMED', 'REJECTED', 'NEEDS_INFO');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WorkConfirmation" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "assignmentVersion" INTEGER NOT NULL,
    "evidenceFingerprint" TEXT NOT NULL,
    "decision" "WorkConfirmationDecision" NOT NULL,
    "reason" TEXT,
    "evidenceSnapshot" JSONB NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,

    CONSTRAINT "WorkConfirmation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkConfirmation_version_check" CHECK ("assignmentVersion" >= 1)
);
CREATE INDEX IF NOT EXISTS "WorkConfirmation_assignmentId_assignmentVersion_idx" ON "WorkConfirmation"("assignmentId", "assignmentVersion");
CREATE INDEX IF NOT EXISTS "WorkConfirmation_centerId_decidedAt_idx" ON "WorkConfirmation"("centerId", "decidedAt");
CREATE INDEX IF NOT EXISTS "WorkConfirmation_orgUnitId_idx" ON "WorkConfirmation"("orgUnitId");

-- Xác nhận thực hiện là BẢN GHI BẤT BIẾN, cùng khuôn StaffAssignmentAcceptance: đổi ý = thêm dòng mới, không sửa dòng cũ.
CREATE OR REPLACE FUNCTION "work_confirmation_bat_bien"() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'WC_IMMUTABLE: WorkConfirmation là bản ghi bất biến — không được % (id=%)', TG_OP, OLD."id";
  END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'WorkConfirmation_bat_bien') THEN
    CREATE TRIGGER "WorkConfirmation_bat_bien" BEFORE UPDATE OR DELETE ON "WorkConfirmation"
      FOR EACH ROW EXECUTE FUNCTION "work_confirmation_bat_bien"();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WorkUnit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "workDate" DATE NOT NULL,
    "assignmentId" TEXT,
    "assignmentVersion" INTEGER,
    "sourceType" "WorkSourceType",
    "sourceId" TEXT,
    "role" "WorkRole" NOT NULL,
    "activityType" "WorkActivityType",
    "assignmentType" "StaffAssignmentType",
    "workUnitType" "WorkUnitType" NOT NULL,
    "quantity" DECIMAL(5,2) NOT NULL,
    "standardMinutes" INTEGER NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "rankSnapshot" INTEGER,
    "rateSnapshot" INTEGER NOT NULL,
    "evidenceFingerprint" TEXT NOT NULL,
    "evidenceStatus" TEXT NOT NULL,
    "status" "WorkUnitStatus" NOT NULL DEFAULT 'CONFIRMED',
    "confirmationId" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL,
    "staleAt" TIMESTAMPTZ(6),
    "staleReason" TEXT,
    "voidedAt" TIMESTAMPTZ(6),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WorkUnit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkUnit_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "WorkUnit_rate_check" CHECK ("rateSnapshot" >= 0),
    CONSTRAINT "WorkUnit_rank_check" CHECK ("rankSnapshot" IS NULL OR "rankSnapshot" BETWEEN 1 AND 4)
);
CREATE INDEX IF NOT EXISTS "WorkUnit_userId_workDate_idx" ON "WorkUnit"("userId", "workDate");
CREATE INDEX IF NOT EXISTS "WorkUnit_centerId_workDate_idx" ON "WorkUnit"("centerId", "workDate");
CREATE INDEX IF NOT EXISTS "WorkUnit_assignmentId_idx" ON "WorkUnit"("assignmentId");
CREATE INDEX IF NOT EXISTS "WorkUnit_orgUnitId_idx" ON "WorkUnit"("orgUnitId");
-- KHÔNG TRẢ HAI LẦN: một phiên bản phân công × một loại đơn vị có tối đa MỘT dòng chưa VOIDED (thử lại / bấm đúp an toàn).
CREATE UNIQUE INDEX IF NOT EXISTS "WorkUnit_live_assignment_key" ON "WorkUnit"("assignmentId", "assignmentVersion", "workUnitType")
  WHERE "status" <> 'VOIDED' AND "assignmentId" IS NOT NULL;

ALTER TABLE "WorkConfirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkUnit" ENABLE ROW LEVEL SECURITY;
