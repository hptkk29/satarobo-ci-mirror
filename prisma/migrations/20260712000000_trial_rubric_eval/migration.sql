-- CreateTable: phiếu đánh giá buổi trải nghiệm (rubric thang 8.0)
CREATE TABLE "TrialRubricEval" (
    "id" TEXT NOT NULL,
    "trialEnrollmentId" TEXT NOT NULL,
    "trialClassSessionId" TEXT,
    "scores" JSONB NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "rank" TEXT NOT NULL,
    "generalComment" TEXT,
    "orientation" TEXT,
    "evaluatedById" TEXT,
    "evaluatedByName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrialRubricEval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialRubricEval_trialEnrollmentId_key" ON "TrialRubricEval"("trialEnrollmentId");

-- CreateIndex
CREATE INDEX "TrialRubricEval_trialClassSessionId_idx" ON "TrialRubricEval"("trialClassSessionId");
