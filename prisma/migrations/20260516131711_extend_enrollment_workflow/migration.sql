-- AlterTable: add D5 workflow fields. Status default kept as ACTIVE for
-- back-compat with existing rows; new enrollments will set PENDING explicitly
-- via server action.
ALTER TABLE "Enrollment"
  ADD COLUMN "enrolledAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "confirmedAt"     TIMESTAMP(3),
  ADD COLUMN "startedAt"       TIMESTAMP(3),
  ADD COLUMN "endedAt"         TIMESTAMP(3),
  ADD COLUMN "transferredToId" TEXT,
  ADD COLUMN "transferReason"  TEXT,
  ADD COLUMN "notes"           TEXT;

-- CreateIndex
CREATE INDEX "Enrollment_classId_status_idx" ON "Enrollment"("classId", "status");

-- CreateIndex
CREATE INDEX "Enrollment_studentId_status_idx" ON "Enrollment"("studentId", "status");

-- CreateIndex
CREATE INDEX "Enrollment_status_enrolledAt_idx" ON "Enrollment"("status", "enrolledAt");

-- Self-referencing FK for transfers
ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_transferredToId_fkey"
    FOREIGN KEY ("transferredToId") REFERENCES "Enrollment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EnrollmentAuditLog" (
  "id"              TEXT NOT NULL,
  "enrollmentId"    TEXT NOT NULL,
  "fromStatus"      TEXT NOT NULL,
  "toStatus"        TEXT NOT NULL,
  "changedByUserId" TEXT,
  "changedByName"   TEXT NOT NULL,
  "reason"          TEXT,
  "extraData"       JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnrollmentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrollmentAuditLog_enrollmentId_createdAt_idx"
  ON "EnrollmentAuditLog"("enrollmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "EnrollmentAuditLog"
  ADD CONSTRAINT "EnrollmentAuditLog_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
