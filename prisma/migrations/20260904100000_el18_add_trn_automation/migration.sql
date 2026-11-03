-- EL-18 - co may tu dong hoa: luat, nhat ky thi hanh, va lo trinh hoc.
--
-- CHI ADD. Bon bang + ba enum hoan toan MOI, rong tren prod. Khong mot dong nao
-- cham bang dang co du lieu (luat cung Nen He thong #4). Cac dong troi dat san co
-- cua kho (DROP INDEX OrgUnit_path_idx + loat ALTER COLUMN TIMESTAMP(3)) da loc bo.

-- CreateEnum
CREATE TYPE "TrnAutoTrigger" AS ENUM ('NHAN_SU_MOI', 'KHOA_HOAN_THANH', 'CHUNG_NHAN_HET_HAN', 'YEU_CAU_MOI_AP_DUNG');

-- CreateEnum
CREATE TYPE "TrnAutoAction" AS ENUM ('GIAO_KHOA', 'GIAO_LO_TRINH', 'GUI_NHAC');

-- CreateEnum
CREATE TYPE "TrnAutoOutcome" AS ENUM ('APPLIED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "TrnAutomationRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trigger" "TrnAutoTrigger" NOT NULL,
    "action" "TrnAutoAction" NOT NULL,
    "conditionJson" JSONB NOT NULL DEFAULT '{}',
    "actionJson" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dueDays" INTEGER NOT NULL DEFAULT 30,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnAutomationLog" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "outcome" "TrnAutoOutcome" NOT NULL,
    "detail" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnAutomationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnLearningPath" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sequential" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnLearningPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnLearningPathStep" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "dueDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnLearningPathStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrnAutomationRule_code_key" ON "TrnAutomationRule"("code");

-- CreateIndex
CREATE INDEX "TrnAutomationRule_trigger_enabled_idx" ON "TrnAutomationRule"("trigger", "enabled");

-- CreateIndex
CREATE INDEX "TrnAutomationRule_centerId_idx" ON "TrnAutomationRule"("centerId");

-- CreateIndex
CREATE INDEX "TrnAutomationRule_orgUnitId_idx" ON "TrnAutomationRule"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnAutomationLog_dedupeKey_key" ON "TrnAutomationLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "TrnAutomationLog_ruleId_createdAt_idx" ON "TrnAutomationLog"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "TrnAutomationLog_subjectUserId_idx" ON "TrnAutomationLog"("subjectUserId");

-- CreateIndex
CREATE INDEX "TrnAutomationLog_outcome_createdAt_idx" ON "TrnAutomationLog"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "TrnAutomationLog_centerId_idx" ON "TrnAutomationLog"("centerId");

-- CreateIndex
CREATE INDEX "TrnAutomationLog_orgUnitId_idx" ON "TrnAutomationLog"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnLearningPath_code_key" ON "TrnLearningPath"("code");

-- CreateIndex
CREATE INDEX "TrnLearningPath_status_idx" ON "TrnLearningPath"("status");

-- CreateIndex
CREATE INDEX "TrnLearningPath_centerId_idx" ON "TrnLearningPath"("centerId");

-- CreateIndex
CREATE INDEX "TrnLearningPath_orgUnitId_idx" ON "TrnLearningPath"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnLearningPathStep_pathId_orderIndex_idx" ON "TrnLearningPathStep"("pathId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TrnLearningPathStep_pathId_courseId_key" ON "TrnLearningPathStep"("pathId", "courseId");

-- AddForeignKey
ALTER TABLE "TrnAutomationLog" ADD CONSTRAINT "TrnAutomationLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TrnAutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnLearningPathStep" ADD CONSTRAINT "TrnLearningPathStep_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "TrnLearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bảng MỚI tự bật RLS (luật .claude/rules/prisma-db.md; sự cố 09/08/2026 và đợt bù 20260921090000).
-- Chỉ ENABLE, không FORCE, không policy: vai kết nối của ứng dụng là superuser BYPASSRLS (đo 23/10/2026 ở TEST và PROD).
ALTER TABLE "TrnAutomationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnAutomationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnLearningPath" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnLearningPathStep" ENABLE ROW LEVEL SECURITY;
