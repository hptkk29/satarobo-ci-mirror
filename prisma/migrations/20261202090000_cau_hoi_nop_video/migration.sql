-- 12/11/2026 — loại câu hỏi mới «Nộp video» (đáp án là một video của học viên, chấm tay).
-- Chỉ THÊM một giá trị enum: không đụng dữ liệu cũ, không backfill. Dùng IF NOT EXISTS để chạy lại an toàn.
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'VIDEO';
