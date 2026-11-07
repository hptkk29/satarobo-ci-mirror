-- AlterTable
ALTER TABLE "CoursePackage" ADD COLUMN "audienceTag" TEXT;
ALTER TABLE "CoursePackage" ADD COLUMN "audienceDescription" TEXT;
ALTER TABLE "CoursePackage" ADD COLUMN "mission" TEXT;
ALTER TABLE "CoursePackage" ADD COLUMN "outcomesJson" JSONB;
ALTER TABLE "CoursePackage" ADD COLUMN "methodsJson" JSONB;
ALTER TABLE "CoursePackage" ADD COLUMN "conditionsJson" JSONB;
ALTER TABLE "CoursePackage" ADD COLUMN "noteForParents" TEXT;
ALTER TABLE "CoursePackage" ADD COLUMN "faqsJson" JSONB;
ALTER TABLE "CoursePackage" ADD COLUMN "heroImageUrl" TEXT;
ALTER TABLE "CoursePackage" ADD COLUMN "galleryImageUrlsJson" JSONB;
