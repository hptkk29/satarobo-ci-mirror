-- P1-g — admin phản hồi lại đánh giá phụ huynh
ALTER TABLE "ParentFeedback" ADD COLUMN "adminResponse" TEXT;
ALTER TABLE "ParentFeedback" ADD COLUMN "respondedById" TEXT;
ALTER TABLE "ParentFeedback" ADD COLUMN "respondedAt" TIMESTAMP(3);
