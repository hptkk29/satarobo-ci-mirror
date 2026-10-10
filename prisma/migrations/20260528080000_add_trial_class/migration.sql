-- Phase T1.4 — TrialClass + TrialFeedback (học thử)

CREATE TYPE "TrialClassStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'ATTENDED', 'MISSED', 'POSTPONED', 'ENROLLED', 'REJECTED');
CREATE TYPE "ChildGrasp" AS ENUM ('EXCELLENT', 'GOOD', 'AVERAGE', 'POOR');

CREATE TABLE "TrialClass" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "centerId" TEXT,
    "classId" TEXT,
    "roomId" TEXT,
    "teacherId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "TrialClassStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attendedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialClass_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrialClass_leadId_idx" ON "TrialClass"("leadId");
CREATE INDEX "TrialClass_centerId_scheduledAt_idx" ON "TrialClass"("centerId", "scheduledAt");
CREATE INDEX "TrialClass_status_scheduledAt_idx" ON "TrialClass"("status", "scheduledAt");

CREATE TABLE "TrialFeedback" (
    "id" TEXT NOT NULL,
    "trialClassId" TEXT NOT NULL,
    "childEnjoyed" BOOLEAN,
    "childGrasp" "ChildGrasp",
    "teacherSuggestion" TEXT,
    "parentFeedback" TEXT,
    "recommendedCourseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialFeedback_trialClassId_key" ON "TrialFeedback"("trialClassId");

ALTER TABLE "TrialClass" ADD CONSTRAINT "TrialClass_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrialClass" ADD CONSTRAINT "TrialClass_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrialClass" ADD CONSTRAINT "TrialClass_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrialClass" ADD CONSTRAINT "TrialClass_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrialClass" ADD CONSTRAINT "TrialClass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrialFeedback" ADD CONSTRAINT "TrialFeedback_trialClassId_fkey" FOREIGN KEY ("trialClassId") REFERENCES "TrialClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrialFeedback" ADD CONSTRAINT "TrialFeedback_recommendedCourseId_fkey" FOREIGN KEY ("recommendedCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
