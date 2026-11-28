-- 18/11/2026 — P5a (thiết kế lại e-learning, D5): ghi lại AI/KHI NÀO gửi duyệt và duyệt một phiên bản khoá; ngày lưu trữ + khoá thay thế.
-- CHỈ THÊM cột NULLABLE, không backfill, không đụng dữ liệu cũ (PROD 0 phiên bản; TEST 6). NULL = "chưa ghi nhận" (bản cũ trước khi có cột).
ALTER TABLE "TrnCourseVersion" ADD COLUMN IF NOT EXISTS "submittedByUserId" TEXT;
ALTER TABLE "TrnCourseVersion" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMPTZ(6);
ALTER TABLE "TrnCourseVersion" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMPTZ(6);
ALTER TABLE "TrnCourse" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ(6);
ALTER TABLE "TrnCourse" ADD COLUMN IF NOT EXISTS "replacedByCourseId" TEXT;
