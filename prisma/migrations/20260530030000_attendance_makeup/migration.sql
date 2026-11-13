-- Module QL học viên PHẦN 2 — vắng có cấu trúc (có bù / không bù + lý do)

-- CreateEnum
CREATE TYPE "MakeupStatus" AS ENUM ('NONE', 'NEEDS_MAKEUP', 'MADE_UP');

-- AlterTable
ALTER TABLE "Attendance"
  ADD COLUMN "makeupStatus" "MakeupStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "makeupSessionId" TEXT,
  ADD COLUMN "absenceReason" TEXT;

-- CreateIndex
CREATE INDEX "Attendance_studentId_makeupStatus_idx" ON "Attendance"("studentId", "makeupStatus");
