-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED');

-- AlterTable: add new columns
ALTER TABLE "Employee"
  ADD COLUMN "nationalId" TEXT,
  ADD COLUMN "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "subjects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "certifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: derive status from existing isActive flag
-- (Inactive rows are treated as RESIGNED; admin can refine via the form.)
UPDATE "Employee" SET "status" = 'RESIGNED' WHERE "isActive" = FALSE;

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");
