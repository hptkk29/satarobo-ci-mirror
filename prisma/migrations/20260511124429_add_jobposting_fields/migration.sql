-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStatus" ADD VALUE 'DRAFT';
ALTER TYPE "JobStatus" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "benefits" TEXT,
ADD COLUMN     "openings" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "salaryMax" INTEGER,
ADD COLUMN     "salaryMin" INTEGER,
ADD COLUMN     "salaryNote" TEXT;

-- CreateIndex
CREATE INDEX "JobPosting_department_idx" ON "JobPosting"("department");
