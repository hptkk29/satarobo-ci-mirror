-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'REVIEWED');

-- CreateTable
CREATE TABLE "Exam" (
  "id"               TEXT NOT NULL,
  "examCode"         TEXT,
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "classId"          TEXT,
  "lessonId"         TEXT,
  "durationMinutes"  INTEGER NOT NULL DEFAULT 60,
  "totalPoints"      DOUBLE PRECISION NOT NULL DEFAULT 10,
  "passingScore"     DOUBLE PRECISION NOT NULL DEFAULT 5,
  "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
  "shuffleChoices"   BOOLEAN NOT NULL DEFAULT false,
  "openAt"           TIMESTAMP(3),
  "closeAt"          TIMESTAMP(3),
  "status"           "ExamStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exam_examCode_key" ON "Exam"("examCode");

-- CreateIndex
CREATE INDEX "Exam_status_classId_idx" ON "Exam"("status", "classId");

-- CreateIndex
CREATE INDEX "Exam_lessonId_idx" ON "Exam"("lessonId");

-- CreateIndex
CREATE INDEX "Exam_createdById_idx" ON "Exam"("createdById");

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ExamQuestion" (
  "id"         TEXT NOT NULL,
  "examId"     TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "order"      INTEGER NOT NULL,
  "points"     DOUBLE PRECISION NOT NULL DEFAULT 1,
  CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamQuestion_examId_order_key" ON "ExamQuestion"("examId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ExamQuestion_examId_questionId_key" ON "ExamQuestion"("examId", "questionId");

-- CreateIndex
CREATE INDEX "ExamQuestion_examId_idx" ON "ExamQuestion"("examId");

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ExamAttempt" (
  "id"           TEXT NOT NULL,
  "examId"       TEXT NOT NULL,
  "studentId"    TEXT NOT NULL,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt"  TIMESTAMP(3),
  "gradedAt"     TIMESTAMP(3),
  "status"       "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "totalScore"   DOUBLE PRECISION,
  "passed"       BOOLEAN,
  "gradedById"   TEXT,
  "feedback"     TEXT,
  CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_examId_studentId_key" ON "ExamAttempt"("examId", "studentId");

-- CreateIndex
CREATE INDEX "ExamAttempt_status_examId_idx" ON "ExamAttempt"("status", "examId");

-- CreateIndex
CREATE INDEX "ExamAttempt_studentId_idx" ON "ExamAttempt"("studentId");

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_gradedById_fkey"
  FOREIGN KEY ("gradedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ExamAnswer" (
  "id"                TEXT NOT NULL,
  "attemptId"         TEXT NOT NULL,
  "examQuestionId"    TEXT NOT NULL,
  "selectedChoiceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "textAnswer"        TEXT,
  "isCorrect"         BOOLEAN,
  "score"             DOUBLE PRECISION,
  "graderNote"        TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamAnswer_attemptId_examQuestionId_key" ON "ExamAnswer"("attemptId", "examQuestionId");

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_examQuestionId_fkey"
  FOREIGN KEY ("examQuestionId") REFERENCES "ExamQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
