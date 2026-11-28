-- H-S3 (19/11/2026) — chế độ học sinh ép ở MÁY CHỦ: phiên di động có thể bị khoá vào đúng MỘT học viên.
-- CỘNG THÊM, nullable, không backfill: phiên hiện có (hocSinhId NULL) giữ nguyên hành vi phụ huynh.
ALTER TABLE "MobileSession" ADD COLUMN IF NOT EXISTS "hocSinhId" TEXT;
ALTER TABLE "MobileSession" ADD COLUMN IF NOT EXISTS "hocSinhTuLuc" TIMESTAMPTZ(6);
