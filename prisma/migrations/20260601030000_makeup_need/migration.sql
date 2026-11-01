-- Cụm B1 — MakeupNeed (nhu cầu học bù)

CREATE TYPE "MakeupNeedStatus" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "MakeupNeed" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "centerId" TEXT,
  "missedSessionId" TEXT NOT NULL,
  "missedLessonId" TEXT,
  "status" "MakeupNeedStatus" NOT NULL DEFAULT 'PENDING',
  "makeupSessionId" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "scheduledById" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MakeupNeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MakeupNeed_studentId_missedSessionId_key" ON "MakeupNeed"("studentId", "missedSessionId");
CREATE INDEX "MakeupNeed_studentId_status_idx" ON "MakeupNeed"("studentId", "status");
CREATE INDEX "MakeupNeed_centerId_status_idx" ON "MakeupNeed"("centerId", "status");
CREATE INDEX "MakeupNeed_classId_idx" ON "MakeupNeed"("classId");

ALTER TABLE "MakeupNeed" ADD CONSTRAINT "MakeupNeed_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MakeupNeed" ADD CONSTRAINT "MakeupNeed_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
