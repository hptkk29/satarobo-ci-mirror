-- Cụm B3 — Khảo sát / NPS

CREATE TYPE "SurveyMilestone" AS ENUM ('AFTER_TRIAL','AFTER_3_SESSIONS','MID_COURSE','END_COURSE','AFTER_COMPLAINT','GENERAL');
CREATE TYPE "SurveyQuestionType" AS ENUM ('NPS','RATING','TEXT');

CREATE TABLE "Survey" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "milestone" "SurveyMilestone" NOT NULL DEFAULT 'GENERAL',
  "isActive" BOOLEAN NOT NULL DEFAULT true, "centerId" TEXT, "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Survey_isActive_milestone_idx" ON "Survey"("isActive","milestone");
CREATE INDEX "Survey_centerId_idx" ON "Survey"("centerId");

CREATE TABLE "SurveyQuestion" (
  "id" TEXT NOT NULL, "surveyId" TEXT NOT NULL, "text" TEXT NOT NULL,
  "type" "SurveyQuestionType" NOT NULL DEFAULT 'RATING', "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SurveyQuestion_surveyId_order_idx" ON "SurveyQuestion"("surveyId","order");
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SurveyResponse" (
  "id" TEXT NOT NULL, "surveyId" TEXT NOT NULL, "studentId" TEXT, "parentUserId" TEXT,
  "centerId" TEXT, "classId" TEXT, "teacherId" TEXT, "csmId" TEXT, "npsScore" INTEGER,
  "comment" TEXT, "answers" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SurveyResponse_surveyId_createdAt_idx" ON "SurveyResponse"("surveyId","createdAt");
CREATE INDEX "SurveyResponse_centerId_createdAt_idx" ON "SurveyResponse"("centerId","createdAt");
CREATE INDEX "SurveyResponse_csmId_idx" ON "SurveyResponse"("csmId");
CREATE INDEX "SurveyResponse_teacherId_idx" ON "SurveyResponse"("teacherId");
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
