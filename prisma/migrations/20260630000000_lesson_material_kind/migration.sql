-- CreateEnum
CREATE TYPE "LessonMaterialKind" AS ENUM ('SCORM', 'PDF');

-- AlterTable
ALTER TABLE "ScormPackage" ADD COLUMN     "kind" "LessonMaterialKind" NOT NULL DEFAULT 'SCORM';
