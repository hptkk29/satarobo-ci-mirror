-- #11 T1 (câu 10 BGĐ, Kiệt ký spec 10/07) — nút "dùng chung" data khách hàng.
-- ADDITIVE ONLY: 3 cột mới trên Lead, default false/null → không đổi hành vi hiện có.
-- Đọc mở rộng (OR isSharedWithTeam) xử ở tầng query; scopedDb vẫn cách ly cơ sở.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "isSharedWithTeam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "sharedAt" TIMESTAMPTZ(6);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "sharedById" TEXT;
