-- P6 D3 — câu hỏi tự luận/sản phẩm chấm theo KHUNG (rubric) + điểm từng tiêu chí.
-- Bù migration còn thiếu: `schema.prisma` đã có 2 cột này từ commit d6caed591 nhưng
-- chưa có SQL ⇒ 30 ca Vitest DB đỏ ("column TrnExamAnswer.rubricScoresJson does not exist").
-- THUẦN CỘNG THÊM: 2 cột nullable (không backfill, không đổi dòng cũ) + 1 index + 1 FK.
-- Chạy tay theo luật cứng #4 (prisma migrate deploy), KHÔNG migrate dev.

ALTER TABLE "TrnExamAnswer" ADD COLUMN IF NOT EXISTS "rubricScoresJson" JSONB;

ALTER TABLE "TrnQuestion" ADD COLUMN IF NOT EXISTS "rubricId" TEXT;

CREATE INDEX IF NOT EXISTS "TrnQuestion_rubricId_idx" ON "TrnQuestion"("rubricId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrnQuestion_rubricId_fkey') THEN
    ALTER TABLE "TrnQuestion" ADD CONSTRAINT "TrnQuestion_rubricId_fkey"
      FOREIGN KEY ("rubricId") REFERENCES "TrnRubric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
