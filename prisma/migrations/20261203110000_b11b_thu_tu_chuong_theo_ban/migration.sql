-- 18/11/2026 — B-11b: THỨ TỰ CHƯƠNG theo phiên bản. Chỉ THÊM cột NULLABLE, không backfill. NULL = "chưa sắp lại ở bản này" ⇒ theo thứ tự chương hiện hành (hành vi cũ).
ALTER TABLE "TrnCourseVersionLesson" ADD COLUMN IF NOT EXISTS "moduleOrder" INTEGER;
