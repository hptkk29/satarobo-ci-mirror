-- AFF-L3b (13/10/2026) — NHẬT KÝ XỬ LÝ REFERRAL: `AffiliateReferralEvent` (CHỈ-THÊM). Mỗi lần người có quyền duyệt / từ chối / xin bằng chứng / đánh dấu tranh chấp / bổ sung
-- bằng chứng / khai tay một referral Affiliate để lại MỘT dòng ở đây: ai, lúc nào, từ trạng thái nào sang trạng thái nào, lý do, ghi chú bằng chứng.
--
-- ADDITIVE: 1 enum + 1 bảng MỚI, không đụng cột/bảng cũ. CHẠY LẠI ĐƯỢC ([MIG-01]). Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này.
-- Không có `leadId` trên bảng này (cố ý): mọi lượt đọc đi qua `AffiliateReferral` đã scope; không có cột mới nào trỏ vào Lead.
-- `centerId`/`orgUnitId` CHÉP từ referral lúc ghi (luật Nền #3 — giữ cả hai cột); NULL = referral chưa quy được cơ sở ⇒ chỉ Hội sở thấy.
-- Trigger CHỈ-THÊM: không sửa, không xoá (lịch sử xử lý không được viết lại im lặng).

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateReferralEventKind') THEN
    CREATE TYPE "AffiliateReferralEventKind" AS ENUM ('KHAI_TAY', 'DUYET', 'TU_CHOI', 'XIN_BANG_CHUNG', 'BO_SUNG_BANG_CHUNG', 'DANH_DAU_TRANH_CHAP');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliateReferralEvent" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "kind" "AffiliateReferralEventKind" NOT NULL,
    "fromStatus" "AffiliateReferralStatus",
    "toStatus" "AffiliateReferralStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "previousReason" TEXT,
    "detail" JSONB,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferralEvent_referralId_createdAt_idx" ON "AffiliateReferralEvent"("referralId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferralEvent_centerId_idx" ON "AffiliateReferralEvent"("centerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliateReferralEvent_orgUnitId_idx" ON "AffiliateReferralEvent"("orgUnitId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferralEvent_referralId_fkey' AND conrelid = '"AffiliateReferralEvent"'::regclass) THEN
    ALTER TABLE "AffiliateReferralEvent" ADD CONSTRAINT "AffiliateReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "AffiliateReferral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Lý do bắt buộc (≥10 ký tự sau trim) — cùng ngưỡng với tầng ghi; CHECK chỉ là lưới cuối.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateReferralEvent_ly_do_chk' AND conrelid = '"AffiliateReferralEvent"'::regclass) THEN
    ALTER TABLE "AffiliateReferralEvent" ADD CONSTRAINT "AffiliateReferralEvent_ly_do_chk" CHECK (length(btrim("reason")) >= 10);
  END IF;
END $$;

-- ── RLS: chỉ ENABLE (không FORCE, không policy) ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "AffiliateReferralEvent" ENABLE ROW LEVEL SECURITY;

-- ── TRIGGER chỉ-thêm (khối thô: thân hàm có `;`; tự idempotent bằng CREATE OR REPLACE + DROP TRIGGER IF EXISTS) ────────────────────
CREATE OR REPLACE FUNCTION "AffiliateReferralEvent_chi_them_fn"() RETURNS trigger AS $fn$
  BEGIN
  RAISE EXCEPTION 'AffiliateReferralEvent: nhật ký xử lý referral chỉ-thêm (không sửa/xoá)' USING ERRCODE = 'check_violation';
  END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AffiliateReferralEvent_chi_them" ON "AffiliateReferralEvent";
CREATE TRIGGER "AffiliateReferralEvent_chi_them" BEFORE UPDATE OR DELETE ON "AffiliateReferralEvent"
  FOR EACH ROW EXECUTE FUNCTION "AffiliateReferralEvent_chi_them_fn"();
