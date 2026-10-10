-- Học bù đời mới — case dạy bù + phí bù (docs/hoc-bu/DAC-TA.md). Chỉ THÊM.
-- Chạy lại được ([MIG-01]): IF NOT EXISTS ở mọi lệnh tạo; TYPE/CONSTRAINT kiểm catalog.

ALTER TYPE "TeachingCreditSource" ADD VALUE IF NOT EXISTS 'MAKEUP';
ALTER TYPE "OrderItemType" ADD VALUE IF NOT EXISTS 'MAKEUP_FEE';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MakeupCaseStatus') THEN
    CREATE TYPE "MakeupCaseStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MakeupCaseStudentStatus') THEN
    CREATE TYPE "MakeupCaseStudentStatus" AS ENUM ('PLACED', 'PRESENT', 'ABSENT');
  END IF;
END $$;

ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "feeOrderItemId" TEXT;
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "freeApprovedAt" TIMESTAMPTZ(6);
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "freeApprovedById" TEXT;
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "freeReason" TEXT;

CREATE TABLE IF NOT EXISTS "MakeupCase" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "roomId" TEXT,
    "teacherId" TEXT NOT NULL,
    "sessionCategoryId" TEXT,
    "status" "MakeupCaseStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "MakeupCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MakeupCase_centerId_date_idx" ON "MakeupCase"("centerId", "date");
CREATE INDEX IF NOT EXISTS "MakeupCase_teacherId_date_idx" ON "MakeupCase"("teacherId", "date");
CREATE INDEX IF NOT EXISTS "MakeupCase_orgUnitId_idx" ON "MakeupCase"("orgUnitId");

CREATE TABLE IF NOT EXISTS "MakeupCaseStudent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "makeupNeedId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "status" "MakeupCaseStudentStatus" NOT NULL DEFAULT 'PLACED',
    "dungLuot" BOOLEAN NOT NULL DEFAULT true,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "MakeupCaseStudent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCaseStudent_caseId_makeupNeedId_key" ON "MakeupCaseStudent"("caseId", "makeupNeedId");
CREATE INDEX IF NOT EXISTS "MakeupCaseStudent_makeupNeedId_idx" ON "MakeupCaseStudent"("makeupNeedId");
CREATE INDEX IF NOT EXISTS "MakeupCaseStudent_centerId_idx" ON "MakeupCaseStudent"("centerId");
CREATE INDEX IF NOT EXISTS "MakeupCaseStudent_orgUnitId_idx" ON "MakeupCaseStudent"("orgUnitId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseStudent_caseId_fkey') THEN
    ALTER TABLE "MakeupCaseStudent" ADD CONSTRAINT "MakeupCaseStudent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MakeupCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseStudent_makeupNeedId_fkey') THEN
    ALTER TABLE "MakeupCaseStudent" ADD CONSTRAINT "MakeupCaseStudent_makeupNeedId_fkey" FOREIGN KEY ("makeupNeedId") REFERENCES "MakeupNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Một dòng cần bù chỉ nằm trong TỐI ĐA một case chưa điểm danh.
CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCaseStudent_need_placed_key" ON "MakeupCaseStudent"("makeupNeedId") WHERE "status" = 'PLACED';

ALTER TABLE "MakeupCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MakeupCaseStudent" ENABLE ROW LEVEL SECURITY;
