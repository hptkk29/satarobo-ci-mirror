-- FL4 (R4/R5/R6) — Phiếu đánh giá buổi linh hoạt: ô ảnh, nhóm tiêu chí, free-text, lớp trải nghiệm.
-- FL1-06 (R2) — Template bài tập mang câu hỏi (clone khi sinh bài giao). Tất cả ADDITIVE.

-- AlterEnum (PG12+: thêm value an toàn trong tx khi KHÔNG dùng ngay trong migration này)
ALTER TYPE "EvalQuestionType" ADD VALUE 'PHOTO';

-- AlterTable EvalQuestion — nhóm tiêu chí + cho phép nhập tự do kèm lựa chọn
ALTER TABLE "EvalQuestion" ADD COLUMN     "groupLabel" TEXT,
ADD COLUMN     "allowCustomText" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable EvalResponse — gắn buổi lớp trải nghiệm (TrialClassSession)
ALTER TABLE "EvalResponse" ADD COLUMN     "trialClassSessionId" TEXT;
CREATE INDEX "EvalResponse_trialClassSessionId_idx" ON "EvalResponse"("trialClassSessionId");

-- CreateTable AssignmentTemplateQuestion (Template ↔ Question bank)
CREATE TABLE "AssignmentTemplateQuestion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssignmentTemplateQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssignmentTemplateQuestion_templateId_questionId_key" ON "AssignmentTemplateQuestion"("templateId", "questionId");
CREATE INDEX "AssignmentTemplateQuestion_templateId_idx" ON "AssignmentTemplateQuestion"("templateId");
CREATE INDEX "AssignmentTemplateQuestion_questionId_idx" ON "AssignmentTemplateQuestion"("questionId");

ALTER TABLE "AssignmentTemplateQuestion" ADD CONSTRAINT "AssignmentTemplateQuestion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssignmentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentTemplateQuestion" ADD CONSTRAINT "AssignmentTemplateQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
