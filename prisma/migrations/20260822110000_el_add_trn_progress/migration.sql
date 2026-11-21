-- EL-04 PR1 — TIẾN ĐỘ HỌC + QUYỀN CHỦ THỂ DỮ LIỆU. 2 bảng, 3 enum, chỉ-ADD.
--
-- TrnLessonProgress · TrnDataSubjectRequest
--
-- ⚠️ `segmentBitmap` PHẢI nullable. Cả hai tệp đặc tả đều viết `Bytes` (NOT NULL) ở bảng
-- cột, nhưng bảng phân loại hai tầng lại bắt cron đêm dọn bằng `SET segmentBitmap = NULL`.
-- Khai NOT NULL là khoá chết chính bước dọn 90 ngày mà quyết định đòi.
--
-- ⚠️ `TrnLessonProgress` KHÔNG mang cột đơn vị — ngoại lệ nhịp ghi cao, có tên trong
-- §5.0.3. Cách ly đi qua `enrollmentId` → `TrnEnrollment` (đã scoped) khi ĐỌC.
-- Model này phải nằm NGOÀI cả bốn danh sách, có test khẳng định.
--
-- ⚠️ MIGRATION NÀY CỐ Ý KHÔNG CHỨA 16 câu nợ lệch sẵn có của repo (1 DROP INDEX,
-- 1 DROP COLUMN, 14 ALTER đổi kiểu thời gian). Cùng lý do đã ghi ở `el_add_trn_core`.
--
-- Kiểm trên chính tệp này: 2 CREATE TABLE, 3 CREATE TYPE, 0 DROP, 0 ALTER trên bảng cũ.

-- CreateEnum
CREATE TYPE "TrnLessonProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "TrnDsrKind" AS ENUM ('VIEW_EXPORT', 'CORRECTION', 'WITHDRAW_CONSENT');

-- CreateEnum
CREATE TYPE "TrnDsrStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'REJECTED');

-- CreateTable
CREATE TABLE "TrnLessonProgress" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "segmentBitmap" BYTEA,
    "segmentSec" INTEGER NOT NULL DEFAULT 5,
    "coveredSec" INTEGER NOT NULL DEFAULT 0,
    "contentSec" INTEGER NOT NULL DEFAULT 0,
    "totalWatchSec" INTEGER NOT NULL DEFAULT 0,
    "maxPositionSec" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readSeconds" INTEGER NOT NULL DEFAULT 0,
    "scrollMaxPct" INTEGER NOT NULL DEFAULT 0,
    "seekCount" INTEGER NOT NULL DEFAULT 0,
    "blockedSeekCount" INTEGER NOT NULL DEFAULT 0,
    "attnAskedCount" INTEGER NOT NULL DEFAULT 0,
    "attnPassedCount" INTEGER NOT NULL DEFAULT 0,
    "attnPendingAt" TIMESTAMPTZ(6),
    "attnPendingPosSec" INTEGER,
    "cueLogJson" JSONB,
    "status" "TrnLessonProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "firstStartedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "verifiedAt" TIMESTAMPTZ(6),
    "seq" INTEGER NOT NULL DEFAULT 0,
    "bitmapPurgedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnLessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnDataSubjectRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "TrnDsrKind" NOT NULL,
    "detail" TEXT NOT NULL,
    "status" "TrnDsrStatus" NOT NULL DEFAULT 'NEW',
    "handledByUserId" TEXT,
    "handledAt" TIMESTAMPTZ(6),
    "resolutionNote" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnDataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrnLessonProgress_userId_lessonId_idx" ON "TrnLessonProgress"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "TrnLessonProgress_lessonId_status_idx" ON "TrnLessonProgress"("lessonId", "status");

-- CreateIndex
CREATE INDEX "TrnLessonProgress_lastActivityAt_idx" ON "TrnLessonProgress"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrnLessonProgress_enrollmentId_lessonId_key" ON "TrnLessonProgress"("enrollmentId", "lessonId");

-- CreateIndex
CREATE INDEX "TrnDataSubjectRequest_status_createdAt_idx" ON "TrnDataSubjectRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TrnDataSubjectRequest_userId_idx" ON "TrnDataSubjectRequest"("userId");

-- CreateIndex
CREATE INDEX "TrnDataSubjectRequest_centerId_idx" ON "TrnDataSubjectRequest"("centerId");

-- CreateIndex
CREATE INDEX "TrnDataSubjectRequest_orgUnitId_idx" ON "TrnDataSubjectRequest"("orgUnitId");

-- AddForeignKey
ALTER TABLE "TrnLessonProgress" ADD CONSTRAINT "TrnLessonProgress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "TrnEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnLessonProgress" ADD CONSTRAINT "TrnLessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "TrnLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
