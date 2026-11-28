-- 18/11/2026 — B-11 (sao chép-khi-ghi theo phiên bản): GHIM phiên bản vào lượt học + truy vết bài được tách bản.
-- CHỈ THÊM cột NULLABLE + chỉ mục, không backfill, không đụng dữ liệu cũ. NULL = "chưa ghim" ⇒ đọc theo bản đang phát hành gần nhất (đúng hành vi cũ).
ALTER TABLE "TrnEnrollment" ADD COLUMN IF NOT EXISTS "courseVersionId" TEXT;
ALTER TABLE "TrnLesson" ADD COLUMN IF NOT EXISTS "forkedFromLessonId" TEXT;

CREATE INDEX IF NOT EXISTS "TrnEnrollment_courseVersionId_idx" ON "TrnEnrollment"("courseVersionId");
CREATE INDEX IF NOT EXISTS "TrnLesson_forkedFromLessonId_idx" ON "TrnLesson"("forkedFromLessonId");

-- Phiên bản bị xoá (xoá cả khoá) ⇒ lượt học mất ghim, không mất lượt học.
ALTER TABLE "TrnEnrollment"
  ADD CONSTRAINT "TrnEnrollment_courseVersionId_fkey"
  FOREIGN KEY ("courseVersionId") REFERENCES "TrnCourseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
