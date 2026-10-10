-- EL-05 PR0 — GIAO BÀI + GHI DANH: **CHỈ SCHEMA**. 5 bảng, 4 enum mới, chỉ-ADD.
--
-- TrnAssignment · TrnAssignmentRule · TrnAssignmentInclude · TrnAssignmentExclude · TrnEnrollment
--
-- VÌ SAO PR NÀY CHẠY TRƯỚC EL-04, ngược thứ tự kế hoạch:
-- EL-04 (trang đọc + đo tiến độ) khoá route theo `enrollmentId`, chống IDOR bằng
-- `TrnEnrollment`, và khoá ghi sau hạn bằng `TrnAssignment.allowLate`. Vòng phụ thuộc là
-- thật. Cách né dễ dãi — để `TrnLessonProgress.enrollmentId` nullable — ĐÃ BỊ BÁC, và lý do là
-- Postgres chứ không phải kỷ luật: `@@unique([enrollmentId, lessonId])` với `enrollmentId = NULL`
-- KHÔNG chặn được trùng (`NULL != NULL`) ⇒ một người đẻ nhiều dòng tiến độ cho cùng một bài.
--
-- ⚠️ KHÔNG tạo lại `TrnEnrollSource` và `TrnEnrollmentStatus` — hai enum đó đã
-- `CREATE TYPE` ở `el_add_trn_core` (EL-03). Tạo lần hai là lỗi `type already exists`.
--
-- ⚠️ MIGRATION NÀY CỐ Ý KHÔNG CHỨA phần lệch sẵn có giữa schema.prisma và DB
-- (16 câu: 1 DROP INDEX, 1 DROP COLUMN "ScopeShadowDiff"."dataScope", 14 ALTER đổi kiểu
-- thời gian). Đó là nợ có sẵn của repo; gộp vào đây là âm thầm đẩy một DROP COLUMN của
-- người khác lên PROD. Cùng lý do đã ghi ở `el_add_trn_core`.
--
-- Kiểm trên chính tệp này: 5 CREATE TABLE, 4 CREATE TYPE, 0 DROP, 0 ALTER TABLE trên bảng cũ.

-- CreateEnum
CREATE TYPE "TrnContentType" AS ENUM ('LESSON', 'COURSE', 'PATH');

-- CreateEnum
CREATE TYPE "TrnAudienceMode" AS ENUM ('STATIC', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "TrnDueAnchor" AS ENUM ('ASSIGNED_AT', 'JOINED_AT');

-- CreateEnum
CREATE TYPE "TrnAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "TrnAssignment" (
    "id" TEXT NOT NULL,
    "contentType" "TrnContentType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "courseVersionId" TEXT,
    "baseCourseVersionId" TEXT,
    "title" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "audienceMode" "TrnAudienceMode" NOT NULL DEFAULT 'STATIC',
    "startAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ(6),
    "dueRelativeDays" INTEGER,
    "dueAnchor" "TrnDueAnchor" NOT NULL DEFAULT 'ASSIGNED_AT',
    "allowLate" BOOLEAN NOT NULL DEFAULT false,
    "completionRuleJson" JSONB NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "blockSeek" BOOLEAN NOT NULL DEFAULT true,
    "maxPlaybackRate" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "notifyChannels" TEXT[],
    "reminderSchedule" TEXT[],
    "status" "TrnAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMPTZ(6),
    "revokeReason" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnAssignmentRule" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "filterJson" JSONB NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrnAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnAssignmentInclude" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedByUserId" TEXT,
    "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnAssignmentInclude_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnAssignmentExclude" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "addedByUserId" TEXT,
    "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnAssignmentExclude_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "source" "TrnEnrollSource" NOT NULL DEFAULT 'ASSIGNMENT',
    "status" "TrnEnrollmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "dueAtOriginal" TIMESTAMPTZ(6),
    "dueAt" TIMESTAMPTZ(6),
    "extensionReason" TEXT,
    "extendedByUserId" TEXT,
    "verifiedAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "lastActivityAt" TIMESTAMPTZ(6),
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMPTZ(6),
    "pausedDays" INTEGER NOT NULL DEFAULT 0,
    "snapDepartmentId" TEXT,
    "snapPositionId" TEXT,
    "snapOrgUnitId" TEXT,
    "snapManagerUserId" TEXT,
    "snapJobTitle" TEXT NOT NULL,
    "snappedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrnAssignment_status_dueAt_idx" ON "TrnAssignment"("status", "dueAt");

-- CreateIndex
CREATE INDEX "TrnAssignment_orgUnitId_status_idx" ON "TrnAssignment"("orgUnitId", "status");

-- CreateIndex
CREATE INDEX "TrnAssignment_contentType_contentId_idx" ON "TrnAssignment"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "TrnAssignment_centerId_idx" ON "TrnAssignment"("centerId");

-- CreateIndex
CREATE INDEX "TrnAssignmentRule_assignmentId_idx" ON "TrnAssignmentRule"("assignmentId");

-- CreateIndex
CREATE INDEX "TrnAssignmentInclude_userId_idx" ON "TrnAssignmentInclude"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnAssignmentInclude_assignmentId_userId_key" ON "TrnAssignmentInclude"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "TrnAssignmentExclude_userId_idx" ON "TrnAssignmentExclude"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnAssignmentExclude_assignmentId_userId_key" ON "TrnAssignmentExclude"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "TrnEnrollment_userId_status_idx" ON "TrnEnrollment"("userId", "status");

-- CreateIndex
CREATE INDEX "TrnEnrollment_status_dueAt_idx" ON "TrnEnrollment"("status", "dueAt");

-- CreateIndex
CREATE INDEX "TrnEnrollment_centerId_idx" ON "TrnEnrollment"("centerId");

-- CreateIndex
CREATE INDEX "TrnEnrollment_orgUnitId_idx" ON "TrnEnrollment"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnEnrollment_assignmentId_idx" ON "TrnEnrollment"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnEnrollment_courseId_userId_cycle_key" ON "TrnEnrollment"("courseId", "userId", "cycle");

-- AddForeignKey
ALTER TABLE "TrnAssignmentRule" ADD CONSTRAINT "TrnAssignmentRule_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrnAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnAssignmentInclude" ADD CONSTRAINT "TrnAssignmentInclude_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrnAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnAssignmentExclude" ADD CONSTRAINT "TrnAssignmentExclude_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrnAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnEnrollment" ADD CONSTRAINT "TrnEnrollment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrnAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
