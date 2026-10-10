-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('PLANNED', 'RECRUITING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterTable: add new columns (all nullable / with defaults to keep existing rows valid)
ALTER TABLE "Class"
  ADD COLUMN "classCode"     TEXT,
  ADD COLUMN "description"   TEXT,
  ADD COLUMN "assistantId"   TEXT,
  ADD COLUMN "roomId"        TEXT,
  ADD COLUMN "scheduleDays"  INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "startTime"     TEXT,
  ADD COLUMN "endTime"       TEXT,
  ADD COLUMN "minStudents"   INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "status"        "ClassStatus" NOT NULL DEFAULT 'PLANNED',
  ADD COLUMN "notes"         TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Class_classCode_key" ON "Class"("classCode");

-- CreateIndex
CREATE INDEX "Class_status_centerId_idx" ON "Class"("status", "centerId");

-- CreateIndex
CREATE INDEX "Class_courseId_status_idx" ON "Class"("courseId", "status");

-- CreateIndex
CREATE INDEX "Class_roomId_idx" ON "Class"("roomId");

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
