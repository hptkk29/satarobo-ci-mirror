-- #15 câu 32: thêm CCCD phụ huynh (chỉ CCCD PH). Additive, nullable → không cần backfill.
ALTER TABLE "Student" ADD COLUMN "parentNationalId" TEXT;
