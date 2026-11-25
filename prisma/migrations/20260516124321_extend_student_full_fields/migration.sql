-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'GRADUATED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BloodType" AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'O_POS', 'O_NEG', 'AB_POS', 'AB_NEG', 'UNKNOWN');

-- AlterTable: add new columns (all nullable / with defaults to keep existing rows valid)
ALTER TABLE "Student"
  ADD COLUMN "studentCode"      TEXT,
  ADD COLUMN "gender"           "Gender",
  ADD COLUMN "currentGrade"     INTEGER,
  ADD COLUMN "school"           TEXT,
  ADD COLUMN "parentEmail"      TEXT,
  ADD COLUMN "parentRelation"   TEXT,
  ADD COLUMN "parent2Name"      TEXT,
  ADD COLUMN "parent2Phone"     TEXT,
  ADD COLUMN "parent2Relation"  TEXT,
  ADD COLUMN "address"          TEXT,
  ADD COLUMN "ward"             TEXT,
  ADD COLUMN "district"         TEXT,
  ADD COLUMN "city"             TEXT,
  ADD COLUMN "bloodType"        "BloodType",
  ADD COLUMN "allergies"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "healthNotes"      TEXT,
  ADD COLUMN "enrollmentDate"   DATE,
  ADD COLUMN "preferredCenterId" TEXT,
  ADD COLUMN "notes"            TEXT,
  ADD COLUMN "status"           "StudentStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentCode_key" ON "Student"("studentCode");

-- CreateIndex
CREATE INDEX "Student_status_idx" ON "Student"("status");

-- CreateIndex
CREATE INDEX "Student_preferredCenterId_idx" ON "Student"("preferredCenterId");

-- CreateIndex
CREATE INDEX "Student_parentPhone_idx" ON "Student"("parentPhone");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_preferredCenterId_fkey" FOREIGN KEY ("preferredCenterId") REFERENCES "Center"("id") ON DELETE SET NULL ON UPDATE CASCADE;
