-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'EXPERT');

-- DropColumn (TEXT markdown → TEXT[] bullet arrays; data not preservable as bullets)
ALTER TABLE "JobPosting"
  DROP COLUMN "requirements",
  DROP COLUMN "benefits";

-- AddColumn
ALTER TABLE "JobPosting"
  ADD COLUMN "workingHours" TEXT,
  ADD COLUMN "experienceLevel" "ExperienceLevel",
  ADD COLUMN "responsibilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactPhone" TEXT;
