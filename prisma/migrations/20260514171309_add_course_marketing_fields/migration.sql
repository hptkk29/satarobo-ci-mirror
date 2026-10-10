-- Phase 4.UI.FINAL: add marketing fields to Course
-- All new columns nullable hoặc with defaults — backward compat, không break existing.

ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "shortDescription" VARCHAR(280);
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "priceDisplay" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "durationDisplay" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "studentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "isPublished" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Course_code_idx" ON "Course"("code");
CREATE INDEX IF NOT EXISTS "Course_isPublished_displayOrder_idx" ON "Course"("isPublished", "displayOrder");
