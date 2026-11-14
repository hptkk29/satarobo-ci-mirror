-- LMS-1 — Lesson giáo án chi tiết + Curriculum status
CREATE TYPE "CurriculumStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

ALTER TABLE "Lesson" ADD COLUMN "teacherGuide" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "expectedOutput" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "homeworkDefault" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "assessmentCriteria" TEXT;

ALTER TABLE "Curriculum" ADD COLUMN "status" "CurriculumStatus" NOT NULL DEFAULT 'ACTIVE';
