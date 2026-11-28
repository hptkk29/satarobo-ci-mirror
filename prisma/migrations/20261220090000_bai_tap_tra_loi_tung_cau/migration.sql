-- 26/11/2026 — HỌC VIÊN LÀM BÀI TẬP TỪNG CÂU.
--
-- Trước đây bài nộp (`AssignmentSubmission`) chỉ có `textAnswer` + tệp, nên bài tập có nhiều câu hỏi (trắc nghiệm, đúng/sai, điền
-- khuyết…) không có chỗ để học viên làm và không có chỗ để lưu câu trả lời. Bảng này lưu câu trả lời theo TỪNG CÂU.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): MỘT bảng mới, không đụng cột/bảng đang có dữ liệu PROD, không backfill. Bài nộp cũ không có
-- dòng nào ở đây — màn chấm xử lý trường hợp đó. Rollback = ngừng ghi; bảng nằm im.
--
-- Câu «Nộp video» KHÔNG có dòng ở đây: video là tệp đính kèm của bài nộp (AssignmentSubmissionFile).

CREATE TABLE IF NOT EXISTS "AssignmentAnswer" (
  "id"           TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "questionId"   TEXT NOT NULL,
  "answer"       JSONB NOT NULL,
  "autoRatio"    DOUBLE PRECISION,
  "autoScore"    DOUBLE PRECISION,
  "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "AssignmentAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentAnswer_submissionId_questionId_key"
  ON "AssignmentAnswer"("submissionId", "questionId");
CREATE INDEX IF NOT EXISTS "AssignmentAnswer_questionId_idx"
  ON "AssignmentAnswer"("questionId");

ALTER TABLE "AssignmentAnswer"
  ADD CONSTRAINT "AssignmentAnswer_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentAnswer"
  ADD CONSTRAINT "AssignmentAnswer_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bảng MỚI phải tự bật RLS (chỉ ENABLE, không FORCE, không policy) — CLAUDE.md / prisma-db.md.
ALTER TABLE "AssignmentAnswer" ENABLE ROW LEVEL SECURITY;
