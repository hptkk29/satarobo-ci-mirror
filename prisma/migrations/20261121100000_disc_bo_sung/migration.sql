-- DISC × SataRobo — bổ sung cột "mã nhận" (claim code) + chỉ mục tra token tải.
--
-- HOÀN TOÀN ADDITIVE trên bảng MỚI của migration 20261114090000_disc_tich_hop (chưa có dữ liệu PROD
-- khi cờ DISC_ENABLED còn tắt). Không DROP/RENAME, không backfill. Không có bảng mới ⇒ không cần RLS thêm.
--
-- claimCodeHash : HMAC-SHA256 của "mã nhận" (10 ký tự, >= 50 bit). Plaintext chỉ trả cho người lưu một lần.
-- claimAttempts : số lần nhập sai/thử mã cho dòng này; từ ngưỡng (lib/disc/luu.ts) trở đi dòng bị KHOÁ nhận.

ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "claimCodeHash" TEXT;
ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "claimAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "DiscSubmission_downloadTokenHash_idx" ON "DiscSubmission"("downloadTokenHash");
