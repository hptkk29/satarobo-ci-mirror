-- LMS-3 — ClassSession checklist + status
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

ALTER TABLE "ClassSession" ADD COLUMN "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "ClassSession" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "ClassSession" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "ClassSession" ADD COLUMN "ckAttendance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "ckLessonConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "ckFeedback" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "ckMedia" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "ckHomework" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "ckIncident" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "incidentNote" TEXT;

CREATE INDEX "ClassSession_status_idx" ON "ClassSession"("status");
