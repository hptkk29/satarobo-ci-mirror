-- Phase 5.9.0 — Student lifecycle: reserve history
-- 1 table. enrollmentId nullable + SetNull (enrollment-specific reserve can
-- outlive its enrollment record). studentId Cascade — reserve history dies
-- with the student row.

-- CreateTable
CREATE TABLE "StudentReserve" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedEndAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "endedByUserId" TEXT,
    "endedByName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentReserve_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentReserve_studentId_isActive_idx" ON "StudentReserve"("studentId", "isActive");
CREATE INDEX "StudentReserve_studentId_startedAt_idx" ON "StudentReserve"("studentId", "startedAt");
CREATE INDEX "StudentReserve_startedAt_idx" ON "StudentReserve"("startedAt");
CREATE INDEX "StudentReserve_endedAt_idx" ON "StudentReserve"("endedAt");

-- AddForeignKey
ALTER TABLE "StudentReserve" ADD CONSTRAINT "StudentReserve_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentReserve" ADD CONSTRAINT "StudentReserve_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
