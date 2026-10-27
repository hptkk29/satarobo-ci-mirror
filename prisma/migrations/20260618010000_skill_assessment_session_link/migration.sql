-- LMS-17 — gắn đánh giá kỹ năng theo buổi/lesson (tùy chọn, additive nullable).
ALTER TABLE "StudentSkillAssessment" ADD COLUMN "classSessionId" TEXT;
ALTER TABLE "StudentSkillAssessment" ADD COLUMN "lessonId" TEXT;
CREATE INDEX "StudentSkillAssessment_classSessionId_idx" ON "StudentSkillAssessment"("classSessionId");
