-- Bump Course.shortDescription từ VARCHAR(280) → TEXT.
-- Lý do: marketing copy mới dài hơn 280 chars; vẫn semantic "short"
-- (so với description đã Text), nhưng không còn cứng limit.
ALTER TABLE "Course"
  ALTER COLUMN "shortDescription" SET DATA TYPE TEXT;
