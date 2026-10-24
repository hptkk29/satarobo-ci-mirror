-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'RECALLED');

-- CreateEnum
CREATE TYPE "EvalScope" AS ENUM ('TEACHER_EVAL', 'CENTER_SURVEY');

-- CreateEnum
CREATE TYPE "EvalFormStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EvalQuestionType" AS ENUM ('STAR_RATING', 'RADIO', 'CHECKBOX', 'TEXTBOX');

-- CreateEnum
CREATE TYPE "EvaluationRoundStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "ReportCard" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'DRAFT',
    "periodComments" JSONB,
    "finalComment" TEXT,
    "completionStatus" TEXT,
    "teacherId" TEXT,
    "reviewedById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedSnapshot" JSONB,
    "centerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCardCriterion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCardCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCardScore" (
    "id" TEXT NOT NULL,
    "reportCardId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "ReportCardScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalForm" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" "EvalScope" NOT NULL,
    "status" "EvalFormStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvalForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalQuestion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "type" "EvalQuestionType" NOT NULL,
    "label" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EvalQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRound" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "scope" "EvalScope" NOT NULL,
    "name" TEXT NOT NULL,
    "centerId" TEXT,
    "courseId" TEXT,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "status" "EvaluationRoundStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResponse" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "teacherId" TEXT,
    "parentUserId" TEXT,
    "studentId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueNumber" INTEGER,
    "valueOptions" JSONB,
    "valueText" TEXT,

    CONSTRAINT "EvalAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_enrollmentId_key" ON "ReportCard"("enrollmentId");

-- CreateIndex
CREATE INDEX "ReportCard_status_idx" ON "ReportCard"("status");

-- CreateIndex
CREATE INDEX "ReportCard_centerId_idx" ON "ReportCard"("centerId");

-- CreateIndex
CREATE INDEX "ReportCard_teacherId_idx" ON "ReportCard"("teacherId");

-- CreateIndex
CREATE INDEX "ReportCardCriterion_courseId_active_idx" ON "ReportCardCriterion"("courseId", "active");

-- CreateIndex
CREATE INDEX "ReportCardScore_reportCardId_idx" ON "ReportCardScore"("reportCardId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCardScore_reportCardId_criterionId_key" ON "ReportCardScore"("reportCardId", "criterionId");

-- CreateIndex
CREATE INDEX "EvalForm_scope_status_idx" ON "EvalForm"("scope", "status");

-- CreateIndex
CREATE INDEX "EvalQuestion_formId_idx" ON "EvalQuestion"("formId");

-- CreateIndex
CREATE INDEX "EvaluationRound_scope_status_idx" ON "EvaluationRound"("scope", "status");

-- CreateIndex
CREATE INDEX "EvaluationRound_centerId_idx" ON "EvaluationRound"("centerId");

-- CreateIndex
CREATE INDEX "EvalResponse_roundId_idx" ON "EvalResponse"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalResponse_roundId_enrollmentId_teacherId_key" ON "EvalResponse"("roundId", "enrollmentId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalResponse_roundId_parentUserId_key" ON "EvalResponse"("roundId", "parentUserId");

-- CreateIndex
CREATE INDEX "EvalAnswer_responseId_idx" ON "EvalAnswer"("responseId");

-- AddForeignKey
ALTER TABLE "ReportCardScore" ADD CONSTRAINT "ReportCardScore_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalQuestion" ADD CONSTRAINT "EvalQuestion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "EvalForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRound" ADD CONSTRAINT "EvaluationRound_formId_fkey" FOREIGN KEY ("formId") REFERENCES "EvalForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResponse" ADD CONSTRAINT "EvalResponse_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "EvaluationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalAnswer" ADD CONSTRAINT "EvalAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "EvalResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

