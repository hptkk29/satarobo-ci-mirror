-- ĐƠN TỪ · ĐỢT 11 — dấu vết của luồng HUỶ ĐƠN ĐÃ DUYỆT (08/10/2026). ADDITIVE (luật cứng #4): toàn cột
-- NULLABLE, không backfill — đơn cũ NULL = "chưa từng xin huỷ". Rollback = ngừng ghi. Chạy lại được.
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMPTZ(6);
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "cancelDecidedById" TEXT;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "cancelDecidedByName" TEXT;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "cancelDecidedAt" TIMESTAMPTZ(6);
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "cancelDecisionNote" TEXT;
-- Ảnh chụp những gì lượt huỷ đã hoàn tác (ô ca khôi phục, lượt quét, quỹ hoàn…) — để truy ngược.
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "cancelEffect" JSONB;
