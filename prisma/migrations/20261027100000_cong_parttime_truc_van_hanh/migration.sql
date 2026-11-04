-- Công Parttime SR.QD.238 · P5b — trực vận hành TƯỜNG MINH (D-Q3) + xác nhận nhận trực (bất biến).
-- THUẦN THÊM: 2 bảng mới, dùng lại enum có sẵn (StaffAssignmentStatus, AssignmentDecision). Thiết kế:
-- docs/cham-cong/parttime/09-TRUC-VAN-HANH.md.

CREATE TABLE IF NOT EXISTS "OperationsDutyAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "workDate" DATE NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "status" "StaffAssignmentStatus" NOT NULL DEFAULT 'WAITING_ACCEPTANCE',
    "assignmentVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "replacesId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OperationsDutyAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OperationsDutyAssignment_version_check" CHECK ("assignmentVersion" >= 1)
);
CREATE INDEX IF NOT EXISTS "OperationsDutyAssignment_userId_workDate_idx" ON "OperationsDutyAssignment"("userId", "workDate");
CREATE INDEX IF NOT EXISTS "OperationsDutyAssignment_centerId_workDate_idx" ON "OperationsDutyAssignment"("centerId", "workDate");
CREATE INDEX IF NOT EXISTS "OperationsDutyAssignment_orgUnitId_idx" ON "OperationsDutyAssignment"("orgUnitId");
-- Một người không trực hai lần cùng ngày cùng ca (DECLINED/REPLACED/CANCELLED là lịch sử, được trùng).
CREATE UNIQUE INDEX IF NOT EXISTS "OperationsDutyAssignment_live_key" ON "OperationsDutyAssignment"("userId", "workDate", "shiftCode")
  WHERE "status" IN ('PROPOSED', 'WAITING_ACCEPTANCE', 'ACCEPTED', 'ACTIVE', 'COMPLETED');

CREATE TABLE IF NOT EXISTS "OperationsDutyAcceptance" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "assignmentVersion" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "AssignmentDecision" NOT NULL,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,

    CONSTRAINT "OperationsDutyAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperationsDutyAcceptance_dutyId_assignmentVersion_key" ON "OperationsDutyAcceptance"("dutyId", "assignmentVersion");
CREATE INDEX IF NOT EXISTS "OperationsDutyAcceptance_userId_decidedAt_idx" ON "OperationsDutyAcceptance"("userId", "decidedAt");
CREATE INDEX IF NOT EXISTS "OperationsDutyAcceptance_centerId_idx" ON "OperationsDutyAcceptance"("centerId");
CREATE INDEX IF NOT EXISTS "OperationsDutyAcceptance_orgUnitId_idx" ON "OperationsDutyAcceptance"("orgUnitId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationsDutyAcceptance_dutyId_fkey') THEN
    ALTER TABLE "OperationsDutyAcceptance" ADD CONSTRAINT "OperationsDutyAcceptance_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "OperationsDutyAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Nhận / từ chối trực là BẢN GHI BẤT BIẾN (cùng khuôn StaffAssignmentAcceptance).
CREATE OR REPLACE FUNCTION "operations_duty_acceptance_bat_bien"() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'ODA_IMMUTABLE: OperationsDutyAcceptance là bản ghi bất biến — không được % (id=%)', TG_OP, OLD."id";
  END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'OperationsDutyAcceptance_bat_bien') THEN
    CREATE TRIGGER "OperationsDutyAcceptance_bat_bien" BEFORE UPDATE OR DELETE ON "OperationsDutyAcceptance"
      FOR EACH ROW EXECUTE FUNCTION "operations_duty_acceptance_bat_bien"();
  END IF;
END $$;

ALTER TABLE "OperationsDutyAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationsDutyAcceptance" ENABLE ROW LEVEL SECURITY;
