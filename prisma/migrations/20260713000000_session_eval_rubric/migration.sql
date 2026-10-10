-- Phiếu nhận xét buổi học (site GV): mở rộng StudentSessionFeedback (2-phase additive).
-- comment → nullable (phiếu rubric-only không bắt buộc văn xuôi); +projectName, +notes
-- (4 mục), +rubric (9 tiêu chí 1-5). Không đụng comment/rating cũ.
ALTER TABLE "StudentSessionFeedback" ALTER COLUMN "comment" DROP NOT NULL;
ALTER TABLE "StudentSessionFeedback" ADD COLUMN "projectName" TEXT;
ALTER TABLE "StudentSessionFeedback" ADD COLUMN "notes" JSONB;
ALTER TABLE "StudentSessionFeedback" ADD COLUMN "rubric" JSONB;
