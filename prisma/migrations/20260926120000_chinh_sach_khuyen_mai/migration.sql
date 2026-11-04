-- CHÍNH SÁCH KHUYẾN MÃI (26/09/2026) — BLĐ ban hành văn bản, Sale tra cứu, agent đọc
-- (`van_ban.lay_khuyen_mai_hieu_luc`).
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 1 bảng MỚI + 1 cột MỚI cho phép trống trên "Voucher".
-- Không đổi kiểu, không bỏ cột, không backfill.
--
-- Vì sao là bảng CHA của "Voucher" chứ không thêm cột vào "Voucher": một văn bản (SR.QD.xxx)
-- là thứ BLĐ ký MỘT lần; mã voucher là thứ khách dùng — một chính sách có thể không có mã
-- nào (ưu đãi tư vấn viên tự áp) hoặc có nhiều mã. Khi nối voucher vào thanh toán (việc
-- sau), đơn chỉ cần đi "VoucherRedemption → Voucher → PromotionPolicy" là ra mã văn bản.
--
-- Không mang centerId/orgUnitId: chính sách do Hội sở ban hành; "áp ở cơ sở nào" là NỘI
-- DUNG của nó (cột "orgUnitIds"), không phải dữ liệu thuộc riêng một cơ sở. Sale mọi cơ sở
-- phải thấy chính sách áp toàn hệ thống — cách ly theo SCOPED_MODELS ở đây là sai nghĩa.
--
-- Rollback: bảng nằm im, cột "policyId" để trống — không đường nào khác đọc chúng.

-- ─── 1 · Bảng ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PromotionPolicy" (
    "id" TEXT NOT NULL,
    "documentCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "benefitText" TEXT NOT NULL,
    "conditionText" TEXT,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "orgUnitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "courseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PromotionPolicy_pkey" PRIMARY KEY ("id"),
    -- Ngày kết thúc không được trước ngày bắt đầu. Chặn ở DB vì cả Sale lẫn agent đọc thẳng
    -- hai cột này để quyết "còn hiệu lực không" — một dòng ngược sẽ không bao giờ hiệu lực
    -- mà cũng không bao giờ "hết hạn" theo nghĩa người đọc hiểu.
    CONSTRAINT "PromotionPolicy_validRange_check" CHECK ("validUntil" >= "validFrom")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PromotionPolicy_documentCode_key" ON "PromotionPolicy"("documentCode");
CREATE INDEX IF NOT EXISTS "PromotionPolicy_validFrom_validUntil_idx" ON "PromotionPolicy"("validFrom", "validUntil");
CREATE INDEX IF NOT EXISTS "PromotionPolicy_createdAt_idx" ON "PromotionPolicy"("createdAt");

-- ─── 2 · Cột nối trên Voucher ──────────────────────────────────────────────────────
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "policyId" TEXT;
CREATE INDEX IF NOT EXISTS "Voucher_policyId_idx" ON "Voucher"("policyId");

DO $$
BEGIN
  ALTER TABLE "Voucher"
    ADD CONSTRAINT "Voucher_policyId_fkey" FOREIGN KEY ("policyId")
    REFERENCES "PromotionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3 · RLS (bảng MỚI — chỉ ENABLE, không FORCE, không policy) ─────────────────────
ALTER TABLE "PromotionPolicy" ENABLE ROW LEVEL SECURITY;
