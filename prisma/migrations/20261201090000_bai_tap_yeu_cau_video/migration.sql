-- 12/11/2026 — Bài tập dạng NỘP VIDEO: giáo viên đánh dấu bài giao "yêu cầu nộp video".
-- Cộng thêm MỘT cột, NOT NULL DEFAULT false: bài cũ giữ nguyên hành vi (không bắt buộc video). Không backfill, không đổi/bỏ cột nào.
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "requireVideo" BOOLEAN NOT NULL DEFAULT false;
