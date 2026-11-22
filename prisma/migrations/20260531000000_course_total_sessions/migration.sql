-- Đợt 6 #1+2 — số buổi chuẩn của khoá + backfill từ CoursePackage.lessons

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "totalSessions" INTEGER;

-- Backfill: khớp Course với CoursePackage theo slug HOẶC code → lấy lessons.
UPDATE "Course" c
SET "totalSessions" = cp."lessons"
FROM "CoursePackage" cp
WHERE (c."slug" = cp."slug" OR c."code" = cp."code")
  AND cp."lessons" IS NOT NULL
  AND c."totalSessions" IS NULL;
