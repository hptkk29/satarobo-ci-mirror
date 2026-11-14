-- DISC × SataRobo — S-01 vòng đời dữ liệu bài ĐÃ NHẬN: cột ghi mốc người dùng RÚT ĐỒNG Ý (xoá kết quả của chính mình).
--
-- HOÀN TOÀN ADDITIVE trên "DiscSubmission": một cột nullable, không DROP/RENAME, không backfill, không bảng mới
-- ⇒ không cần RLS thêm. Chạy lại được (IF NOT EXISTS) — luật [MIG-01].
--
-- consentWithdrawnAt : mốc người dùng xoá kết quả = rút đồng ý xử lý hồ sơ (và tiếp thị). NULL = chưa rút.
ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "consentWithdrawnAt" TIMESTAMPTZ(6);
