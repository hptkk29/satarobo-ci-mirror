-- EL-14 — KHẢO THÍ ĐÀO TẠO NỘI BỘ: 7 bảng + 4 enum.
--
-- ⚠️ MIGRATION CHỈ-THÊM. Kiểm được bằng mắt: 0 câu DROP, 0 câu ALTER TABLE trên
-- bảng đã có dữ liệu — mọi ALTER TABLE dưới đây đều là ADD CONSTRAINT trên chính
-- bảng vừa tạo ở migration này.
--
-- ⚠️ KHÔNG bật khoá ngoại `TrnLesson.examId → TrnExam` và KHÔNG đụng
-- `TrnLessonCue.questionId`. Cả hai đều là ALTER TABLE trên bảng đang có dữ liệu
-- prod (luật cứng #4), và `deploy.yml` chạy `prisma migrate deploy` NGAY khi merge
-- `main` — không có cổng người nào đứng trước schema prod. Hai cột đó giữ nguyên
-- là cột trần; ràng buộc thi hành ở tầng service.
--
-- ⚠️ `TrnExamAttempt.purgeAfter` NOT NULL ngay trong CREATE TABLE, cố ý. Thêm nó
-- sau bằng ALTER TABLE là để lại một lớp dữ liệu hành vi (dấu vân thiết bị) không
-- có hạn dọn, và test bất biến sẽ đỏ.
--
-- ⚠️ Ba bảng mang cột đơn vị (`TrnQuestion`, `TrnExam`, `TrnExamAttempt`) phải được
-- khai vào BỐN nơi ở tầng code — xem `lib/db-scope.ts` và `lib/org/center-bridge.ts`.
-- Quên nhánh `getModelPrefixes()` là hỏng CÂM theo hướng NỚI quyền, và không test
-- nào bắt.

-- CreateEnum
CREATE TYPE "TrnQuestionType" AS ENUM ('SINGLE', 'MULTIPLE', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING', 'ORDERING', 'SHORT_ANSWER', 'CASE', 'ESSAY');

-- CreateEnum
CREATE TYPE "TrnExamMode" AS ENUM ('FIXED', 'RANDOM');

-- CreateEnum
CREATE TYPE "TrnShowAnswerPolicy" AS ENUM ('NEVER', 'AFTER_EACH_ATTEMPT', 'AFTER_LAST_ATTEMPT');

-- CreateEnum
CREATE TYPE "TrnAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'PENDING_GRADE', 'GRADED', 'ABANDONED');

-- CreateTable
CREATE TABLE "TrnQuestion" (
    "id" TEXT NOT NULL,
    "bankPath" TEXT NOT NULL,
    "type" "TrnQuestionType" NOT NULL,
    "stem" TEXT NOT NULL,
    "explanation" TEXT,
    "contentJson" JSONB NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "skillTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultPoints" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnChoice" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "TrnChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnExam" (
    "id" TEXT NOT NULL,
    "courseId" TEXT,
    "lessonId" TEXT,
    "title" TEXT NOT NULL,
    "mode" "TrnExamMode" NOT NULL DEFAULT 'FIXED',
    "blueprintJson" JSONB,
    "durationMin" INTEGER NOT NULL,
    "passScore" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "showAnswerPolicy" "TrnShowAnswerPolicy" NOT NULL DEFAULT 'AFTER_LAST_ATTEMPT',
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "shuffleChoices" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnExamQuestion" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TrnExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnExamAttempt" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "status" "TrnAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(6),
    "gradedAt" TIMESTAMPTZ(6),
    "totalScore" INTEGER,
    "passed" BOOLEAN,
    "gradedByUserId" TEXT,
    "feedback" TEXT,
    "ipHash" TEXT,
    "ipPrefix" TEXT,
    "deviceClass" TEXT,
    "browserFamily" TEXT,
    "purgeAfter" TIMESTAMPTZ(6) NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnExamAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "examQuestionId" TEXT NOT NULL,
    "selectedChoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "textAnswer" TEXT,
    "isCorrect" BOOLEAN,
    "score" INTEGER,
    "graderNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnExamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnExamUnlock" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unlockedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnExamUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrnQuestion_bankPath_idx" ON "TrnQuestion"("bankPath");

-- CreateIndex
CREATE INDEX "TrnQuestion_centerId_idx" ON "TrnQuestion"("centerId");

-- CreateIndex
CREATE INDEX "TrnQuestion_orgUnitId_idx" ON "TrnQuestion"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnQuestion_type_difficulty_idx" ON "TrnQuestion"("type", "difficulty");

-- CreateIndex
CREATE INDEX "TrnChoice_questionId_idx" ON "TrnChoice"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnChoice_questionId_orderIndex_key" ON "TrnChoice"("questionId", "orderIndex");

-- CreateIndex
CREATE INDEX "TrnExam_courseId_idx" ON "TrnExam"("courseId");

-- CreateIndex
CREATE INDEX "TrnExam_lessonId_idx" ON "TrnExam"("lessonId");

-- CreateIndex
CREATE INDEX "TrnExam_centerId_idx" ON "TrnExam"("centerId");

-- CreateIndex
CREATE INDEX "TrnExam_orgUnitId_idx" ON "TrnExam"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnExamQuestion_examId_idx" ON "TrnExamQuestion"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnExamQuestion_examId_questionId_key" ON "TrnExamQuestion"("examId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnExamQuestion_examId_orderIndex_key" ON "TrnExamQuestion"("examId", "orderIndex");

-- CreateIndex
CREATE INDEX "TrnExamAttempt_userId_examId_idx" ON "TrnExamAttempt"("userId", "examId");

-- CreateIndex
CREATE INDEX "TrnExamAttempt_status_startedAt_idx" ON "TrnExamAttempt"("status", "startedAt");

-- CreateIndex
CREATE INDEX "TrnExamAttempt_purgeAfter_idx" ON "TrnExamAttempt"("purgeAfter");

-- CreateIndex
CREATE INDEX "TrnExamAttempt_orgUnitId_idx" ON "TrnExamAttempt"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnExamAttempt_centerId_idx" ON "TrnExamAttempt"("centerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnExamAttempt_examId_userId_attemptNo_key" ON "TrnExamAttempt"("examId", "userId", "attemptNo");

-- CreateIndex
CREATE INDEX "TrnExamAnswer_attemptId_idx" ON "TrnExamAnswer"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnExamAnswer_attemptId_examQuestionId_key" ON "TrnExamAnswer"("attemptId", "examQuestionId");

-- CreateIndex
CREATE INDEX "TrnExamUnlock_examId_userId_idx" ON "TrnExamUnlock"("examId", "userId");

-- CreateIndex
CREATE INDEX "TrnExamUnlock_userId_idx" ON "TrnExamUnlock"("userId");

-- AddForeignKey
ALTER TABLE "TrnChoice" ADD CONSTRAINT "TrnChoice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "TrnQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnExamQuestion" ADD CONSTRAINT "TrnExamQuestion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "TrnExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnExamQuestion" ADD CONSTRAINT "TrnExamQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "TrnQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnExamAttempt" ADD CONSTRAINT "TrnExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "TrnExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnExamAnswer" ADD CONSTRAINT "TrnExamAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TrnExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnExamAnswer" ADD CONSTRAINT "TrnExamAnswer_examQuestionId_fkey" FOREIGN KEY ("examQuestionId") REFERENCES "TrnExamQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnExamUnlock" ADD CONSTRAINT "TrnExamUnlock_examId_fkey" FOREIGN KEY ("examId") REFERENCES "TrnExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

