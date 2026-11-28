-- OD-16 (19/11/2026) — góp ý từ app di động dùng thang 0–10.
-- CỘNG THÊM, nullable, KHÔNG backfill: góp ý cũ (web, 1–5) giữ nguyên nghĩa của cột `rating`.
-- Khi app gửi `npsScore`, máy chủ ghi thêm `rating` quy đổi để các màn admin đọc `rating` không đổi.
ALTER TABLE "ParentFeedback" ADD COLUMN IF NOT EXISTS "npsScore" SMALLINT;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentFeedback_npsScore_range_chk') THEN ALTER TABLE "ParentFeedback" ADD CONSTRAINT "ParentFeedback_npsScore_range_chk" CHECK ("npsScore" IS NULL OR ("npsScore" >= 0 AND "npsScore" <= 10)); END IF; END $$;
