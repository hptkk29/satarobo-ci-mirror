-- Cụm C3 — Rubric chấm bài robotics

CREATE TYPE "RubricCriterion" AS ENUM ('ANALYSIS', 'DESIGN', 'PROGRAMMING', 'TESTING', 'CREATIVITY', 'PRESENTATION');
CREATE TYPE "RubricLevel" AS ENUM ('NEED_SUPPORT', 'BASIC', 'GOOD', 'EXCELLENT');

CREATE TABLE "SubmissionRubricScore" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "criterion" "RubricCriterion" NOT NULL,
  "level" "RubricLevel" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionRubricScore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubmissionRubricScore_submissionId_criterion_key" ON "SubmissionRubricScore"("submissionId","criterion");
CREATE INDEX "SubmissionRubricScore_submissionId_idx" ON "SubmissionRubricScore"("submissionId");
ALTER TABLE "SubmissionRubricScore" ADD CONSTRAINT "SubmissionRubricScore_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
