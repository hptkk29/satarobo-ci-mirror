-- EL-13 — cờ nghi ngờ học đối phó.
--
-- Migration ADD-ONLY: hai enum mới + một bảng mới. Không đụng cột nào của bảng
-- đang có dữ liệu (luật cứng #4).

-- CreateEnum
CREATE TYPE "TrnFlagSubject" AS ENUM ('LESSON_PROGRESS', 'VIDEO_SESSION');

-- CreateEnum
CREATE TYPE "TrnFlagStatus" AS ENUM ('OPEN', 'APPEALED', 'UPHELD', 'REVOKED');

-- CreateTable
CREATE TABLE "TrnWatchFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "subjectKind" "TrnFlagSubject" NOT NULL,
    "lessonProgressId" TEXT,
    "videoSessionId" TEXT,
    "ruleCode" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "status" "TrnFlagStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appealedAt" TIMESTAMPTZ(6),
    "appealNote" TEXT,
    "appealDeadline" TIMESTAMPTZ(6) NOT NULL,
    "handlerUserId" TEXT NOT NULL,
    "decisionDueAt" TIMESTAMPTZ(6),
    "decidedAt" TIMESTAMPTZ(6),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnWatchFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrnWatchFlag_status_openedAt_idx" ON "TrnWatchFlag"("status", "openedAt");
CREATE INDEX "TrnWatchFlag_userId_status_idx" ON "TrnWatchFlag"("userId", "status");
CREATE INDEX "TrnWatchFlag_orgUnitId_status_idx" ON "TrnWatchFlag"("orgUnitId", "status");
-- Cron chốt UPHELD khi hết cửa sổ khiếu nại đi bằng index này.
CREATE INDEX "TrnWatchFlag_appealDeadline_idx" ON "TrnWatchFlag"("appealDeadline");
CREATE INDEX "TrnWatchFlag_handlerUserId_status_idx" ON "TrnWatchFlag"("handlerUserId", "status");
CREATE INDEX "TrnWatchFlag_decisionDueAt_status_idx" ON "TrnWatchFlag"("decisionDueAt", "status");

-- AddForeignKey
ALTER TABLE "TrnWatchFlag" ADD CONSTRAINT "TrnWatchFlag_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "TrnLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
