-- AFF-L1 (closeout Affiliate) — LỰA CHỌN «CÓ THƯỞNG / KHÔNG THƯỞNG» CỦA CAMPAIGN.
-- docs/source-commission/closeout/l1-chinh-sach-campaign.md.
--
-- ADDITIVE, KHÔNG BACKFILL, CHẠY LẠI ĐƯỢC ([MIG-01]). Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này.
--
-- Vì sao cần một cột: «Không thưởng» là một LỰA CHỌN, không phải ô trống. Campaign không có chính sách riêng thì GLOBAL / SOURCE_GROUP vẫn có thể trả
-- (ca [AFP-E2E-03]); nếu chỉ suy từ «không có chính sách» thì «chưa chọn» và «đã chọn không thưởng» không phân biệt được, và cổng kích hoạt không có gì để hỏi.
--   NULL   = chưa chọn (campaign cũ giữ NULL — KHÔNG đoán, KHÔNG tự tụt trạng thái)
--   NONE   = đã chọn rõ «không có mức hoa hồng riêng cho campaign này»
--   POLICY = đã chọn «có thưởng»: phải có chính sách CAMPAIGN đang hiệu lực mới kích hoạt được
-- Bảng đã có RLS — không bảng mới.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateRewardMode') THEN
    CREATE TYPE "AffiliateRewardMode" AS ENUM ('NONE', 'POLICY');
  END IF;
END $$;

ALTER TABLE "AffiliateCampaign" ADD COLUMN IF NOT EXISTS "rewardMode" "AffiliateRewardMode";
