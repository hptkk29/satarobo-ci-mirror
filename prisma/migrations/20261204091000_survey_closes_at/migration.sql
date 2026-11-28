-- OD-16 (19/11/2026) — hạn nộp khảo sát tháng. CỘNG THÊM, nullable, KHÔNG backfill (NULL = không hạn, đúng hành vi cũ).
ALTER TABLE "Survey" ADD COLUMN IF NOT EXISTS "closesAt" TIMESTAMPTZ(6);
