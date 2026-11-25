-- AFF-L6 (13/10/2026) — AFFILIATE ĐA WEBSITE / ĐA LANDING. docs/source-commission/closeout/l6-da-website-landing.md.
--
-- Affiliate = DANH TÍNH; link giới thiệu được tạo trên MỌI website / landing page Admin đã khai (quatang.edu.vn, covua.quatang.edu.vn, satarobo.vn…). Migration này thêm phần dữ liệu còn thiếu:
--
--   1. `AffiliateLandingPage.host` (NULL = tên miền của baseUrl) + `hostKey` (khuôn `ruleKey`: COALESCE(host,'') do ứng dụng giữ, CHECK bắt lệch) + `trackingEnabled`.
--      Khoá duy nhất đổi từ (siteId, pathPattern) sang (siteId, hostKey, pathPattern): cùng đường dẫn `/` trên `quatang.edu.vn` VÀ `covua.quatang.edu.vn` là HAI trang đích khác nhau.
--      Mọi dòng cũ có hostKey = '' ⇒ khoá mới thoả ngay; bỏ khoá cũ là NỚI ràng buộc, không đụng dữ liệu.
--   2. `AffiliateTrackingAsset.landingPageId` + `landingHost` (ảnh chụp trang đích lúc phát; nullable, FK SET NULL). Trigger bất biến mở rộng: đã có giá trị thì không đổi.
--   3. Bảng nối `AffiliateCampaignLanding(campaignId, landingPageId)` — thu hẹp campaign xuống mức trang đích (không dòng nào của website ⇒ không hạn chế). RLS bật (chỉ ENABLE).
--   4. Backfill `landingPageId` cho link cũ: CHỈ khi (siteId, landingPath) khớp ĐÚNG MỘT trang đích; mơ hồ hoặc không khớp ⇒ NULL (không đoán). Chạy lại được: chỉ chạm dòng còn NULL.
--
-- ADDITIVE (cột nullable / mặc định; bảng mới), CHẠY LẠI ĐƯỢC ([MIG-01]). Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này. Prisma KHÔNG đọc CHECK/trigger.

-- ─── 1 · Trang đích: host + hostKey + trackingEnabled ────────────────────────────────────────────────────────
ALTER TABLE "AffiliateLandingPage" ADD COLUMN IF NOT EXISTS "host" TEXT;
ALTER TABLE "AffiliateLandingPage" ADD COLUMN IF NOT EXISTS "hostKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AffiliateLandingPage" ADD COLUMN IF NOT EXISTS "trackingEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateLandingPage_siteId_hostKey_pathPattern_key" ON "AffiliateLandingPage"("siteId", "hostKey", "pathPattern");
DROP INDEX IF EXISTS "AffiliateLandingPage_siteId_pathPattern_key";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateLandingPage_host_key_chk' AND conrelid = '"AffiliateLandingPage"'::regclass) THEN
    ALTER TABLE "AffiliateLandingPage" ADD CONSTRAINT "AffiliateLandingPage_host_key_chk" CHECK ("hostKey" = COALESCE("host", ''));
  END IF;
END $$;

-- Tên miền: chữ thường, ≥ 2 nhãn, mỗi nhãn 1–63 ký tự [a-z0-9-] không đầu/cuối '-' (cùng luật `kiemTenMien`).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateLandingPage_host_chk' AND conrelid = '"AffiliateLandingPage"'::regclass) THEN
    ALTER TABLE "AffiliateLandingPage" ADD CONSTRAINT "AffiliateLandingPage_host_chk"
      CHECK ("host" IS NULL OR "host" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$');
  END IF;
END $$;

-- ─── 2 · Link: ảnh chụp trang đích ────────────────────────────────────────────────────────────────────────────
ALTER TABLE "AffiliateTrackingAsset" ADD COLUMN IF NOT EXISTS "landingPageId" TEXT;
ALTER TABLE "AffiliateTrackingAsset" ADD COLUMN IF NOT EXISTS "landingHost" TEXT;

CREATE INDEX IF NOT EXISTS "AffiliateTrackingAsset_landingPageId_idx" ON "AffiliateTrackingAsset"("landingPageId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_landingPageId_fkey' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_landingPageId_fkey"
      FOREIGN KEY ("landingPageId") REFERENCES "AffiliateLandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateTrackingAsset_landing_host_chk' AND conrelid = '"AffiliateTrackingAsset"'::regclass) THEN
    ALTER TABLE "AffiliateTrackingAsset" ADD CONSTRAINT "AffiliateTrackingAsset_landing_host_chk"
      CHECK ("landingHost" IS NULL OR "landingHost" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$');
  END IF;
END $$;

-- ─── 3 · Campaign × trang đích ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AffiliateCampaignLanding" (
    "campaignId" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCampaignLanding_pkey" PRIMARY KEY ("campaignId","landingPageId")
);

CREATE INDEX IF NOT EXISTS "AffiliateCampaignLanding_landingPageId_idx" ON "AffiliateCampaignLanding"("landingPageId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignLanding_campaignId_fkey' AND conrelid = '"AffiliateCampaignLanding"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignLanding" ADD CONSTRAINT "AffiliateCampaignLanding_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "AffiliateCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateCampaignLanding_landingPageId_fkey' AND conrelid = '"AffiliateCampaignLanding"'::regclass) THEN
    ALTER TABLE "AffiliateCampaignLanding" ADD CONSTRAINT "AffiliateCampaignLanding_landingPageId_fkey"
      FOREIGN KEY ("landingPageId") REFERENCES "AffiliateLandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "AffiliateCampaignLanding" ENABLE ROW LEVEL SECURITY;

-- ─── 4 · Trigger bất biến: thêm landingPageId / landingHost (khối thô: thân hàm có `;`) ───────────────────────
-- Giữ NGUYÊN các vế cũ. Hai cột mới: NULL → giá trị được phép (backfill / link cũ); đã có giá trị thì KHÔNG đổi sang giá trị khác.
-- `landingPageId` được phép về NULL (hành động `ON DELETE SET NULL` của khoá ngoại chạy qua chính trigger này).
CREATE OR REPLACE FUNCTION "AffiliateTrackingAsset_bat_bien_fn"() RETURNS trigger AS $fn$
  BEGIN
  IF NEW."publicToken" IS DISTINCT FROM OLD."publicToken"
     OR NEW."partyId" IS DISTINCT FROM OLD."partyId"
     OR NEW."membershipId" IS DISTINCT FROM OLD."membershipId"
     OR NEW."campaignId" IS DISTINCT FROM OLD."campaignId"
     OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."landingPath" IS DISTINCT FROM OLD."landingPath"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR (OLD."landingHost" IS NOT NULL AND NEW."landingHost" IS DISTINCT FROM OLD."landingHost")
     OR (OLD."landingPageId" IS NOT NULL AND NEW."landingPageId" IS NOT NULL AND NEW."landingPageId" IS DISTINCT FROM OLD."landingPageId") THEN
    RAISE EXCEPTION 'AffiliateTrackingAsset: định danh của link không đổi được sau khi phát — thu hồi rồi phát link mới' USING ERRCODE = 'check_violation';
  END IF;
  -- Đã thu hồi thì không sống lại (xoay mã tạo dòng MỚI).
  IF OLD."status" = 'REVOKED' AND NEW."status" <> 'REVOKED' THEN
    RAISE EXCEPTION 'AffiliateTrackingAsset: link đã thu hồi không bật lại được — phát link mới' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
  END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AffiliateTrackingAsset_bat_bien" ON "AffiliateTrackingAsset";
CREATE TRIGGER "AffiliateTrackingAsset_bat_bien" BEFORE UPDATE ON "AffiliateTrackingAsset"
  FOR EACH ROW EXECUTE FUNCTION "AffiliateTrackingAsset_bat_bien_fn"();

-- ─── 5 · Backfill `landingPageId` của link cũ — CHỈ khi khớp DUY NHẤT; không đoán ─────────────────────────────
-- Khớp (cùng luật `khopDuongDan`, so bằng hàm chuỗi — KHÔNG dùng LIKE vì `_` trong mẫu là ký tự thường): trang đích CHÍNH XÁC = `landingPath` (bỏ một '/' cuối), hoặc tiền tố `/a/*`
-- khớp `/a`, `/a/…`. Chỉ trang đích CÓ host NULL (dòng cũ chưa có host riêng) — link cũ luôn đi qua tên miền của baseUrl. Chạy lại: chỉ dòng còn NULL.
UPDATE "AffiliateTrackingAsset" AS a
   SET "landingPageId" = m."landingId"
  FROM (
    SELECT t."id" AS "assetId", MIN(l."id") AS "landingId", COUNT(*) AS "soKhop"
      FROM (
        SELECT "id", "siteId",
               CASE WHEN length("landingPath") > 1 AND right("landingPath", 1) = '/' THEN left("landingPath", -1) ELSE "landingPath" END AS "np"
          FROM "AffiliateTrackingAsset"
         WHERE "landingPageId" IS NULL
      ) t
      JOIN "AffiliateLandingPage" l ON l."siteId" = t."siteId" AND l."host" IS NULL
     WHERE CASE
             WHEN right(l."pathPattern", 2) = '/*' THEN
               left(l."pathPattern", -2) = ''
               OR t."np" = left(l."pathPattern", -2)
               OR left(t."np", length(l."pathPattern") - 1) = left(l."pathPattern", -1)
             ELSE t."np" = l."pathPattern"
           END
     GROUP BY t."id"
  ) AS m
 WHERE a."id" = m."assetId" AND m."soKhop" = 1 AND a."landingPageId" IS NULL;
