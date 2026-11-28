-- 19/11/2026 (B-LMS3) — bản ghim đề + khoá bắt đầu + hạn nộp do máy chủ giữ (ExamAttempt); dữ liệu câu trả lời có cấu trúc + số thứ tự ghi (ExamAnswer).
-- CỘNG THÊM, mọi cột cho phép NULL/có mặc định ⇒ KHÔNG đổi hành vi dòng cũ; không backfill. Chạy lại được ([MIG-01]). Chạy TAY trên TEST/PROD (luật cứng #4).

ALTER TABLE "ExamAttempt" ADD COLUMN IF NOT EXISTS "contentSnapshot" JSONB;
ALTER TABLE "ExamAttempt" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "ExamAttempt" ADD COLUMN IF NOT EXISTS "seed" TEXT;
ALTER TABLE "ExamAttempt" ADD COLUMN IF NOT EXISTS "startKey" TEXT;
ALTER TABLE "ExamAttempt" ADD COLUMN IF NOT EXISTS "deadlineAt" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "ExamAttempt_studentId_examId_startKey_key" ON "ExamAttempt"("studentId", "examId", "startKey");

ALTER TABLE "ExamAnswer" ADD COLUMN IF NOT EXISTS "answerData" JSONB;
ALTER TABLE "ExamAnswer" ADD COLUMN IF NOT EXISTS "answerSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExamAnswer" ADD COLUMN IF NOT EXISTS "answeredAt" TIMESTAMPTZ(6);
