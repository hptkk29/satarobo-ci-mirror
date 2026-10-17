-- CÔNG PARTTIME — SR.QD.238 · P1 nền dữ liệu (13/10/2026). ADDITIVE: 6 enum + 4 bảng mới, không đụng bảng cũ.
-- Thiết kế: docs/cham-cong/parttime/01-DATA-MODEL.md.
-- Chạy lại được (luật [MIG-01]): TYPE/khoá ngoại/trigger bọc kiểm tồn tại, bảng/chỉ mục IF NOT EXISTS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkRole') THEN
    CREATE TYPE "WorkRole" AS ENUM ('MAIN_TEACHER', 'TEACHING_ASSISTANT', 'OPERATIONS_SUPPORT');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkActivityType') THEN
    CREATE TYPE "WorkActivityType" AS ENUM ('REGULAR_CLASS', 'MAKEUP', 'ADVANCE', 'TRIAL', 'SPECIAL');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffAssignmentType') THEN
    CREATE TYPE "StaffAssignmentType" AS ENUM ('REGULAR', 'SUBSTITUTE', 'MANUAL', 'SYSTEM');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffAssignmentStatus') THEN
    CREATE TYPE "StaffAssignmentStatus" AS ENUM ('PROPOSED', 'WAITING_ACCEPTANCE', 'ACCEPTED', 'ACTIVE', 'DECLINED', 'REPLACED', 'CANCELLED', 'COMPLETED');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkSourceType') THEN
    CREATE TYPE "WorkSourceType" AS ENUM ('CLASS_SESSION', 'MAKEUP_CASE', 'TRIAL_SESSION');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentDecision') THEN
    CREATE TYPE "AssignmentDecision" AS ENUM ('ACCEPTED', 'DECLINED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CompensationPolicyVersion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentNo" TEXT,
    "appliesTo" TEXT NOT NULL DEFAULT 'PARTTIME',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "paramsJson" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CompensationPolicyVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CompensationPolicyVersion_code_key" ON "CompensationPolicyVersion"("code");
CREATE INDEX IF NOT EXISTS "CompensationPolicyVersion_effectiveFrom_idx" ON "CompensationPolicyVersion"("effectiveFrom");

CREATE TABLE IF NOT EXISTS "TeacherRankHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherRankHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherRankHistory_rank_check" CHECK ("rank" BETWEEN 1 AND 4)
);
CREATE UNIQUE INDEX IF NOT EXISTS "TeacherRankHistory_userId_effectiveFrom_key" ON "TeacherRankHistory"("userId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "TeacherRankHistory_userId_idx" ON "TeacherRankHistory"("userId");

CREATE TABLE IF NOT EXISTS "SessionStaffAssignment" (
    "id" TEXT NOT NULL,
    "sourceType" "WorkSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "ngay" DATE NOT NULL,
    "gioBatDau" TEXT NOT NULL,
    "gioKetThuc" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkRole" NOT NULL,
    "activityType" "WorkActivityType" NOT NULL,
    "assignmentType" "StaffAssignmentType" NOT NULL DEFAULT 'REGULAR',
    "status" "StaffAssignmentStatus" NOT NULL DEFAULT 'WAITING_ACCEPTANCE',
    "assignmentVersion" INTEGER NOT NULL DEFAULT 1,
    "replacesAssignmentId" TEXT,
    "sourceWorkRequestId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SessionStaffAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SessionStaffAssignment_version_check" CHECK ("assignmentVersion" >= 1)
);
CREATE INDEX IF NOT EXISTS "SessionStaffAssignment_sourceType_sourceId_idx" ON "SessionStaffAssignment"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "SessionStaffAssignment_userId_ngay_idx" ON "SessionStaffAssignment"("userId", "ngay");
CREATE INDEX IF NOT EXISTS "SessionStaffAssignment_centerId_ngay_idx" ON "SessionStaffAssignment"("centerId", "ngay");
CREATE INDEX IF NOT EXISTS "SessionStaffAssignment_orgUnitId_idx" ON "SessionStaffAssignment"("orgUnitId");
-- Một người một vai SỐNG trên một buổi (DECLINED/REPLACED/CANCELLED là lịch sử, được trùng).
CREATE UNIQUE INDEX IF NOT EXISTS "SessionStaffAssignment_live_user_role_key" ON "SessionStaffAssignment"("sourceType", "sourceId", "userId", "role")
  WHERE "status" IN ('PROPOSED', 'WAITING_ACCEPTANCE', 'ACCEPTED', 'ACTIVE', 'COMPLETED');
-- Tối đa MỘT giáo viên đứng chính SỐNG mỗi buổi (dạy thay = phân công cũ REPLACED, phân công mới SUBSTITUTE).
CREATE UNIQUE INDEX IF NOT EXISTS "SessionStaffAssignment_live_main_key" ON "SessionStaffAssignment"("sourceType", "sourceId")
  WHERE "role" = 'MAIN_TEACHER' AND "status" IN ('PROPOSED', 'WAITING_ACCEPTANCE', 'ACCEPTED', 'ACTIVE', 'COMPLETED');

CREATE TABLE IF NOT EXISTS "StaffAssignmentAcceptance" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "assignmentVersion" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "AssignmentDecision" NOT NULL,
    "roleSnapshot" "WorkRole" NOT NULL,
    "scheduleSnapshot" JSONB NOT NULL,
    "classSnapshot" JSONB,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL,
    "viewedAt" TIMESTAMPTZ(6),
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionNote" TEXT,
    "userAgent" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAssignmentAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StaffAssignmentAcceptance_assignmentId_assignmentVersion_key" ON "StaffAssignmentAcceptance"("assignmentId", "assignmentVersion");
CREATE INDEX IF NOT EXISTS "StaffAssignmentAcceptance_userId_decidedAt_idx" ON "StaffAssignmentAcceptance"("userId", "decidedAt");
CREATE INDEX IF NOT EXISTS "StaffAssignmentAcceptance_centerId_idx" ON "StaffAssignmentAcceptance"("centerId");
CREATE INDEX IF NOT EXISTS "StaffAssignmentAcceptance_orgUnitId_idx" ON "StaffAssignmentAcceptance"("orgUnitId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffAssignmentAcceptance_assignmentId_fkey') THEN
    ALTER TABLE "StaffAssignmentAcceptance" ADD CONSTRAINT "StaffAssignmentAcceptance_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "SessionStaffAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Xác nhận nhận lớp là BẢN GHI BẤT BIẾN: chặn UPDATE/DELETE ở tầng DB (BA: "Acceptance log phải immutable").
-- Không có cột "đã vô hiệu" — hiệu lực suy từ assignmentVersion, nên không bao giờ cần sửa dòng này.
CREATE OR REPLACE FUNCTION "staff_assignment_acceptance_bat_bien"() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'SAA_IMMUTABLE: StaffAssignmentAcceptance là bản ghi bất biến — không được % (id=%)', TG_OP, OLD."id";
  END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'StaffAssignmentAcceptance_bat_bien') THEN
    CREATE TRIGGER "StaffAssignmentAcceptance_bat_bien" BEFORE UPDATE OR DELETE ON "StaffAssignmentAcceptance"
      FOR EACH ROW EXECUTE FUNCTION "staff_assignment_acceptance_bat_bien"();
  END IF;
END $$;

-- Hai bản chính sách — đúng văn bản ký. Nạp ngay trong migration (không qua seed tay): dòng HB_CHINH của học bù đã
-- từng thiếu trên prod vì seed phải bấm tay; chính sách thiếu thì bộ tính không chạy. ON CONFLICT ⇒ chạy lại vô hại.
INSERT INTO "CompensationPolicyVersion" ("id", "code", "name", "documentNo", "appliesTo", "effectiveFrom", "effectiveTo", "paramsJson", "updatedAt")
VALUES
  ('cpv_legacy_truoc_15_10_2026', 'LEGACY', 'Cách tính cũ (trước SR.QD.238)', 'SR.QD.230', 'PARTTIME', DATE '2000-01-01', DATE '2026-10-14',
   '{"loai":"LEGACY"}'::jsonb, CURRENT_TIMESTAMP),
  ('cpv_sr_qd_238', 'SR.QD.238', 'Chính sách thù lao Nhân sự Parttime', 'SR.QD.238', 'PARTTIME', DATE '2026-10-15', NULL,
   '{"loai":"SR_QD_238","tiet":{"chuanBiPhut":10,"dayPhut":90,"chuanPhut":100},"ca":[{"ma":"S","tu":"07:45","den":"11:30"},{"ma":"C","tu":"13:45","den":"17:30"},{"ma":"T","tu":"17:15","den":"21:00"}],"toiDaTietMoiCa":2,"donGia":{"mainTheoRank":{"1":120000,"2":140000,"3":160000,"4":200000},"troGiang":80000,"trucCa":90000,"nuaCaTruc":45000},"rankMacDinh":1,"nguongTroGiang":[{"khoa":"Sata3","tuHocVien":7},{"khoa":"Sata4","tuHocVien":9},{"khoa":"Sata5","tuHocVien":9},{"khoa":"Sata6","tuHocVien":9},{"khoa":"Sata7","tuHocVien":9}]}'::jsonb,
   CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "CompensationPolicyVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherRankHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionStaffAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffAssignmentAcceptance" ENABLE ROW LEVEL SECURITY;
