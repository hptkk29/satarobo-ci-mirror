-- Parity site GV 18/08 — additive, không đụng dữ liệu cũ (2-phase):
--   1. 3 loại câu hỏi mới cho soạn đề (điền khuyết / ghép cặp / sắp xếp).
--   2. Question.meta — payload soạn đề theo loại (nguồn sự thật khi hiển thị/sửa).
--   3. Assignment.openAt/closeAt — khung giờ làm bài KIỂM TRA (dueAt vẫn set = closeAt).
--   4. Assignment.classSessionId — bài giao gắn 1 buổi học (không bắt buộc).

-- AlterEnum (PG >= 12 cho phép ADD VALUE trong transaction, miễn không dùng ngay)
ALTER TYPE "QuestionType" ADD VALUE 'FILL_BLANK';
ALTER TYPE "QuestionType" ADD VALUE 'MATCHING';
ALTER TYPE "QuestionType" ADD VALUE 'ORDERING';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN "meta" JSONB;

ALTER TABLE "Assignment" ADD COLUMN "openAt" TIMESTAMPTZ(6);
ALTER TABLE "Assignment" ADD COLUMN "closeAt" TIMESTAMPTZ(6);
ALTER TABLE "Assignment" ADD COLUMN "classSessionId" TEXT;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Assignment_classSessionId_idx" ON "Assignment"("classSessionId");
