-- DISC × SataRobo — vá đợt 2 rà soát bảo mật (06 §G: N6 trần theo cặp SĐT+IP, N9 pepper có phiên bản).
--
-- HOÀN TOÀN ADDITIVE trên "DiscSubmission" (bảng chưa có dữ liệu PROD khi cờ DISC_ENABLED còn tắt):
-- không DROP/RENAME, không backfill, không bảng mới ⇒ không cần RLS thêm. Chạy lại được (IF NOT EXISTS) — luật [MIG-01].
--
-- pepperVersion : "v1" = băm bằng DISC_PEPPER riêng; "ns0" = chưa đặt DISC_PEPPER nên dùng secret ký chung (NEXTAUTH_SECRET).
--                 Dòng đã có (nếu có) mặc định "ns0" — đúng với cách chúng đã được băm.
-- ipKey         : HMAC miền `disc-ip-v1` của IP người gõ (KHÔNG IP thô). NULL ở dòng cũ. Chỉ để đếm trần theo cặp (phoneKey, ipKey).
-- Chỉ mục (phoneKey, ipKey, consentAt): phép đếm trần theo cặp trong cửa sổ trượt.

ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "pepperVersion" TEXT NOT NULL DEFAULT 'ns0';
ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "ipKey" TEXT;

CREATE INDEX IF NOT EXISTS "DiscSubmission_phoneKey_ipKey_consentAt_idx" ON "DiscSubmission"("phoneKey", "ipKey", "consentAt");
