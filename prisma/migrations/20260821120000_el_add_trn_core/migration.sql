-- EL-03 · LÕI ĐÀO TẠO NỘI BỘ — 12 bảng mới, CHỈ-ADD.
--
-- 9 bảng lõi: TrnProgram · TrnCourse · TrnCourseVersion · TrnCourseVersionLesson
--             TrnModule · TrnLesson · TrnRequirement · TrnPolicyAcceptance
--             TrnEvaluationResult
-- 3 bảng khai RỖNG từ GĐ1 (luồng ghi + màn hình ở ticket sau):
--             TrnLessonCue (EL-12) · TrnEvalLinkConfig (EL-21) · TrnVideoSession (EL-12)
--
-- ⚠️ TrnVideoSession.purgeAfter NOT NULL nằm NGAY TRONG câu CREATE TABLE (QĐ-CDA-14).
-- Đó là toàn bộ lý do bảng này khai ở GĐ1 thay vì EL-12: thêm cột vào bảng đã có
-- dữ liệu prod vướng luật cứng #4, còn khai lúc CREATE TABLE tốn 0 đồng và không
-- tồn tại cửa sổ nào mà phiên xem được ghi mà chưa có hạn dọn.
--
-- ⚠️ MIGRATION NÀY CỐ Ý KHÔNG CHỨA phần lệch sẵn có giữa schema.prisma và DB.
-- `prisma migrate diff` trên DB dev trả thêm 16 câu KHÔNG thuộc EL-03: 1 DROP INDEX,
-- 1 DROP COLUMN ("ScopeShadowDiff"."dataScope"), và 14 ALTER đổi TIMESTAMPTZ(6) →
-- TIMESTAMP(3) trên các bảng cũ. `prisma migrate status` báo "205 migrations, up to
-- date" ⇒ đó là nợ có sẵn: schema.prisma đã được sửa mà chưa ai sinh migration.
-- Gộp chúng vào đây là âm thầm đẩy một DROP COLUMN của người khác lên PROD — đúng
-- thứ luật cứng #4 cấm. Nợ đó phải có ticket riêng, có người đọc, có dry-run.
--
-- Kiểm: 0 DROP, 0 ALTER TABLE trên bảng cũ trong toàn bộ tệp này (AC1).

-- CreateEnum
CREATE TYPE "TrnProgramStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RUNNING', 'DONE', 'EVALUATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrnFunctionTag" AS ENUM ('SALE', 'TEACHING', 'MARKETING', 'HR', 'ACCOUNTING', 'OPERATION', 'COMPANY_WIDE');

-- CreateEnum
CREATE TYPE "TrnLevelTag" AS ENUM ('L1', 'L2', 'L3', 'L4');

-- CreateEnum
CREATE TYPE "TrnStageTag" AS ENUM ('NEW_HIRE', 'IN_SERVICE');

-- CreateEnum
CREATE TYPE "TrnDurationTag" AS ENUM ('S', 'M', 'LG');

-- CreateEnum
CREATE TYPE "TrnNatureTag" AS ENUM ('MANDATORY', 'MANDATORY_COMPLIANCE', 'RECOMMENDED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "TrnFormatTag" AS ENUM ('ELEARNING', 'OFFLINE', 'BLENDED', 'OJT', 'COACHING', 'WEBINAR');

-- CreateEnum
CREATE TYPE "TrnSecurityTag" AS ENUM ('PUBLIC', 'INTERNAL', 'RESTRICTED', 'CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "TrnCourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrnCourseVisibility" AS ENUM ('ASSIGNED_ONLY', 'SELF_ENROLL', 'RULE_BASED');

-- CreateEnum
CREATE TYPE "TrnVersionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrnLessonKind" AS ENUM ('READ', 'VIDEO', 'SCORM', 'QUIZ', 'TASK', 'LIVE_SESSION');

-- CreateEnum
CREATE TYPE "TrnReqScope" AS ENUM ('POSITION', 'DEPARTMENT', 'LEVEL_TAG', 'ORG_UNIT', 'ALL_STAFF');

-- CreateEnum
CREATE TYPE "TrnReqStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrnEvalLevel" AS ENUM ('L1', 'L2', 'L3', 'L4');

-- CreateEnum
CREATE TYPE "TrnEnrollSource" AS ENUM ('ASSIGNMENT', 'REQUIREMENT', 'EQUIVALENCE', 'SELF_ENROLL');

-- CreateEnum
CREATE TYPE "TrnEnrollmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED_LATE', 'OVERDUE', 'REVOKED');

-- CreateEnum
CREATE TYPE "TrnEvalLinkMode" AS ENUM ('REPORT_ONLY', 'LINKED');

-- CreateEnum
CREATE TYPE "TrnEvalCriterion" AS ENUM ('ON_TIME', 'EXAM_SCORE');

-- CreateTable
CREATE TABLE "TrnProgram" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "objectivesJson" JSONB,
    "primaryFunctionTag" "TrnFunctionTag" NOT NULL,
    "functionTags" "TrnFunctionTag"[],
    "levelTags" "TrnLevelTag"[],
    "stageTag" "TrnStageTag" NOT NULL,
    "durationTag" "TrnDurationTag" NOT NULL,
    "natureTag" "TrnNatureTag" NOT NULL,
    "formatTag" "TrnFormatTag" NOT NULL,
    "securityTag" "TrnSecurityTag" NOT NULL DEFAULT 'INTERNAL',
    "sourceDocCode" TEXT,
    "sourceDocVersion" TEXT,
    "sourceDocEffectiveAt" TIMESTAMPTZ(6),
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "validityMonths" INTEGER,
    "expiresAt" TIMESTAMPTZ(6),
    "needId" TEXT,
    "needExemptReason" TEXT,
    "budgetPlanned" DECIMAL(14,2),
    "status" "TrnProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" TEXT NOT NULL,
    "contentOwnerUserId" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnCourse" (
    "id" TEXT NOT NULL,
    "programId" TEXT,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "estimatedMinutes" INTEGER,
    "sequential" BOOLEAN NOT NULL DEFAULT false,
    "status" "TrnCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(6),
    "securityLevel" "TrnSecurityTag" NOT NULL DEFAULT 'INTERNAL',
    "visibility" "TrnCourseVisibility" NOT NULL DEFAULT 'ASSIGNED_ONLY',
    "selfEnrollEnabled" BOOLEAN NOT NULL DEFAULT false,
    "catalogRuleJson" JSONB,
    "clonedFromCourseId" TEXT,
    "ownerUserId" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnCourseVersion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "major" INTEGER NOT NULL,
    "minor" INTEGER NOT NULL,
    "clonedFromVersionId" TEXT,
    "status" "TrnVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "changeNote" TEXT,
    "approvedByUserId" TEXT,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnCourseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnCourseVersionLesson" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "TrnCourseVersionLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnModule" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnLesson" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "kind" "TrnLessonKind" NOT NULL,
    "contentMd" TEXT,
    "sourceGuideSlug" TEXT,
    "minReadSeconds" INTEGER NOT NULL DEFAULT 30,
    "videoKey" TEXT,
    "videoKey360" TEXT,
    "durationSec" INTEGER,
    "videoMeta" JSONB,
    "captionKey" TEXT,
    "transcriptMd" TEXT,
    "audioKey" TEXT,
    "cueCount" INTEGER NOT NULL DEFAULT 0,
    "scormPackageId" TEXT,
    "examId" TEXT,
    "rubricId" TEXT,
    "sessionDate" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnRequirement" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "scopeKind" "TrnReqScope" NOT NULL,
    "positionId" TEXT,
    "departmentId" TEXT,
    "levelTag" "TrnLevelTag",
    "dueDays" INTEGER NOT NULL,
    "validityMonths" INTEGER,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "status" "TrnReqStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnPolicyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnPolicyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnEvaluationResult" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "level" "TrnEvalLevel" NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "score" DECIMAL(6,2),
    "payloadJson" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnEvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnLessonCue" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "atSec" INTEGER NOT NULL,
    "questionId" TEXT,
    "inlineJson" JSONB,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnLessonCue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnEvalLinkConfig" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mode" "TrnEvalLinkMode" NOT NULL DEFAULT 'REPORT_ONLY',
    "criteria" "TrnEvalCriterion"[],
    "weightOnTime" INTEGER,
    "weightExamScore" INTEGER,
    "effectiveFrom" TIMESTAMPTZ(6),
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnEvalLinkConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnVideoSession" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalWatchSec" INTEGER NOT NULL DEFAULT 0,
    "maxPositionSec" INTEGER NOT NULL DEFAULT 0,
    "ipHash" TEXT,
    "ipPrefix" TEXT,
    "deviceClass" TEXT,
    "browserFamily" TEXT,
    "checkpointAnswered" INTEGER NOT NULL DEFAULT 0,
    "checkpointMissed" INTEGER NOT NULL DEFAULT 0,
    "checkpointLogJson" JSONB,
    "purgeAfter" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnVideoSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrnProgram_code_key" ON "TrnProgram"("code");

-- CreateIndex
CREATE INDEX "TrnProgram_status_year_idx" ON "TrnProgram"("status", "year");

-- CreateIndex
CREATE INDEX "TrnProgram_orgUnitId_idx" ON "TrnProgram"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnProgram_centerId_idx" ON "TrnProgram"("centerId");

-- CreateIndex
CREATE INDEX "TrnProgram_needsReview_idx" ON "TrnProgram"("needsReview");

-- CreateIndex
CREATE UNIQUE INDEX "TrnProgram_primaryFunctionTag_year_seq_key" ON "TrnProgram"("primaryFunctionTag", "year", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "TrnCourse_code_key" ON "TrnCourse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TrnCourse_slug_key" ON "TrnCourse"("slug");

-- CreateIndex
CREATE INDEX "TrnCourse_status_orgUnitId_idx" ON "TrnCourse"("status", "orgUnitId");

-- CreateIndex
CREATE INDEX "TrnCourse_orgUnitId_idx" ON "TrnCourse"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnCourse_centerId_idx" ON "TrnCourse"("centerId");

-- CreateIndex
CREATE INDEX "TrnCourse_visibility_status_idx" ON "TrnCourse"("visibility", "status");

-- CreateIndex
CREATE INDEX "TrnCourse_programId_idx" ON "TrnCourse"("programId");

-- CreateIndex
CREATE INDEX "TrnCourseVersion_courseId_status_idx" ON "TrnCourseVersion"("courseId", "status");

-- CreateIndex
CREATE INDEX "TrnCourseVersion_status_publishedAt_idx" ON "TrnCourseVersion"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrnCourseVersion_courseId_major_minor_key" ON "TrnCourseVersion"("courseId", "major", "minor");

-- CreateIndex
CREATE INDEX "TrnCourseVersionLesson_lessonId_idx" ON "TrnCourseVersionLesson"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnCourseVersionLesson_versionId_lessonId_key" ON "TrnCourseVersionLesson"("versionId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnModule_courseId_orderIndex_key" ON "TrnModule"("courseId", "orderIndex");

-- CreateIndex
CREATE INDEX "TrnLesson_kind_idx" ON "TrnLesson"("kind");

-- CreateIndex
CREATE INDEX "TrnLesson_scormPackageId_idx" ON "TrnLesson"("scormPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnLesson_moduleId_orderIndex_key" ON "TrnLesson"("moduleId", "orderIndex");

-- CreateIndex
CREATE INDEX "TrnRequirement_scopeKind_idx" ON "TrnRequirement"("scopeKind");

-- CreateIndex
CREATE INDEX "TrnRequirement_courseId_idx" ON "TrnRequirement"("courseId");

-- CreateIndex
CREATE INDEX "TrnRequirement_centerId_idx" ON "TrnRequirement"("centerId");

-- CreateIndex
CREATE INDEX "TrnRequirement_orgUnitId_idx" ON "TrnRequirement"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnRequirement_courseId_scopeKind_positionId_departmentId_l_key" ON "TrnRequirement"("courseId", "scopeKind", "positionId", "departmentId", "levelTag", "orgUnitId");

-- CreateIndex
CREATE INDEX "TrnPolicyAcceptance_policyKey_policyVersion_idx" ON "TrnPolicyAcceptance"("policyKey", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "TrnPolicyAcceptance_userId_policyKey_policyVersion_key" ON "TrnPolicyAcceptance"("userId", "policyKey", "policyVersion");

-- CreateIndex
CREATE INDEX "TrnEvaluationResult_programId_level_idx" ON "TrnEvaluationResult"("programId", "level");

-- CreateIndex
CREATE INDEX "TrnEvaluationResult_centerId_idx" ON "TrnEvaluationResult"("centerId");

-- CreateIndex
CREATE INDEX "TrnEvaluationResult_orgUnitId_idx" ON "TrnEvaluationResult"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnEvaluationResult_programId_level_subjectUserId_sourceRef_key" ON "TrnEvaluationResult"("programId", "level", "subjectUserId", "sourceRef");

-- CreateIndex
CREATE INDEX "TrnLessonCue_lessonId_idx" ON "TrnLessonCue"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnLessonCue_lessonId_atSec_key" ON "TrnLessonCue"("lessonId", "atSec");

-- CreateIndex
CREATE UNIQUE INDEX "TrnEvalLinkConfig_programId_key" ON "TrnEvalLinkConfig"("programId");

-- CreateIndex
CREATE INDEX "TrnEvalLinkConfig_centerId_idx" ON "TrnEvalLinkConfig"("centerId");

-- CreateIndex
CREATE INDEX "TrnEvalLinkConfig_orgUnitId_idx" ON "TrnEvalLinkConfig"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnVideoSession_purgeAfter_idx" ON "TrnVideoSession"("purgeAfter");

-- CreateIndex
CREATE INDEX "TrnVideoSession_userId_lessonId_idx" ON "TrnVideoSession"("userId", "lessonId");

-- AddForeignKey
ALTER TABLE "TrnCourse" ADD CONSTRAINT "TrnCourse_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrnProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnCourseVersion" ADD CONSTRAINT "TrnCourseVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrnCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnCourseVersionLesson" ADD CONSTRAINT "TrnCourseVersionLesson_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TrnCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnCourseVersionLesson" ADD CONSTRAINT "TrnCourseVersionLesson_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "TrnLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnModule" ADD CONSTRAINT "TrnModule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrnCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnLesson" ADD CONSTRAINT "TrnLesson_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrnModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnLesson" ADD CONSTRAINT "TrnLesson_scormPackageId_fkey" FOREIGN KEY ("scormPackageId") REFERENCES "ScormPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnRequirement" ADD CONSTRAINT "TrnRequirement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrnCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnRequirement" ADD CONSTRAINT "TrnRequirement_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnRequirement" ADD CONSTRAINT "TrnRequirement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "DepartmentDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnRequirement" ADD CONSTRAINT "TrnRequirement_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnPolicyAcceptance" ADD CONSTRAINT "TrnPolicyAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnEvaluationResult" ADD CONSTRAINT "TrnEvaluationResult_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrnProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnLessonCue" ADD CONSTRAINT "TrnLessonCue_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "TrnLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnEvalLinkConfig" ADD CONSTRAINT "TrnEvalLinkConfig_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrnProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnVideoSession" ADD CONSTRAINT "TrnVideoSession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "TrnLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
