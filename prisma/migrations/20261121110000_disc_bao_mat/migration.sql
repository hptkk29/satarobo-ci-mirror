-- DISC × SataRobo — bảo mật & quyền riêng tư (rà soát độc lập F-01/F-02/F-03/F-05/F-08).
--
-- HOÀN TOÀN ADDITIVE trên bảng "DiscSubmission" (migration 20261114090000, chưa có dữ liệu PROD khi
-- cờ DISC_ENABLED còn tắt). Không DROP/RENAME, không backfill, không bảng mới ⇒ không cần RLS thêm.
-- Chạy lại được (IF NOT EXISTS) — luật [MIG-01].
--
-- payloadHash          : HMAC các trường có nghĩa của lượt lưu; replay cùng idempotencyKey chỉ hợp lệ khi khớp.
-- consentSubjectRole   : BO | ME | NGUOI_GIAM_HO — vai của người đồng ý (lời khai).
-- consentTextHash      : SHA-256 văn bản đồng ý mà giao diện đã hiển thị (lời khai của client).
-- consentMarketingAt   : mốc người gõ tích đồng ý tiếp thị (NULL = không tích).
-- emailVerifyExpiresAt : hạn token xác minh email (chưa có luồng ghi).
-- Chỉ mục (phoneKey, consentAt): trần số bài mới theo SĐT trong cửa sổ trượt.
--
-- Cố ý KHÔNG thêm "tokenUsedAt": token tải là không-đơn-dùng theo thiết kế (tải JSON rồi mở HTML trong
-- cùng hạn 30 phút) và không có mã nào ghi cột đó.
--
-- Cột "reportSnapshot" GIỮ NGUYÊN (NOT NULL) nhưng KHÔNG còn là nơi lưu kết quả: mã luôn ghi '{}'; kết quả
-- chỉ ở "DiscSubject"."result". Không DROP ở đợt này (2-phase).

ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "payloadHash" TEXT;
ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "consentSubjectRole" TEXT;
ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "consentTextHash" TEXT;
ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "consentMarketingAt" TIMESTAMPTZ(6);
ALTER TABLE "DiscSubmission" ADD COLUMN IF NOT EXISTS "emailVerifyExpiresAt" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "DiscSubmission_phoneKey_consentAt_idx" ON "DiscSubmission"("phoneKey", "consentAt");
