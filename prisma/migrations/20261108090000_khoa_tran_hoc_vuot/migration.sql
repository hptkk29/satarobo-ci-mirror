-- 28/10/2026 — Trần học vượt THEO TỪNG KHOÁ (chủ dự án: "thiết kế setting mỗi mức có thể vượt cho từng khoá ở trong cấu hình khoá học").
-- Số buổi lớp đã học tối đa để Sale xếp bé vào lớp (học vượt). NULL = dùng mức chung của cơ sở (`enrollment.catchUpMaxSessions`, QLCS chỉnh).
-- CỘNG THÊM: một cột nullable, không backfill, không đụng dữ liệu cũ. Không bảng mới ⇒ không cần RLS. Chạy lại được (IF NOT EXISTS / DROP IF EXISTS).
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "catchUpMaxSessions" INTEGER;
ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS "Course_catchUpMaxSessions_check";
ALTER TABLE "Course" ADD CONSTRAINT "Course_catchUpMaxSessions_check" CHECK ("catchUpMaxSessions" IS NULL OR ("catchUpMaxSessions" >= 0 AND "catchUpMaxSessions" <= 48));
