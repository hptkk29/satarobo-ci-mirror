-- V8.18 (Owner chốt): ONLINE = SataRobo bán · nhận tiền · xuất hoá đơn, KHÔNG theo cơ sở Offline.
-- CHỈ THÊM (không đổi/xoá cột nào đang có, không backfill): bảng cấu hình thu tiền Online (do Quản trị tối cao quản lý) + hai cột chụp trên Order.
-- CHẠY LẠI ĐƯỢC (luật [MIG-01]): mọi câu đều IF NOT EXISTS / khối DO bắt duplicate_object.

-- 1. Cấu hình thu tiền Online — mỗi lần đổi là MỘT dòng mới (lịch sử bất biến); đúng MỘT dòng đang bật.
CREATE TABLE IF NOT EXISTS "OnlinePaymentConfig" (
    "id"              TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "legalEntityId"   TEXT NOT NULL,
    "memoPrefix"      TEXT NOT NULL DEFAULT 'SR',
    "mode"            TEXT NOT NULL,
    "isActive"        BOOLEAN NOT NULL DEFAULT false,
    "reason"          TEXT NOT NULL,
    "createdById"     TEXT NOT NULL,
    "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt"     TIMESTAMPTZ(6),
    "deactivatedAt"   TIMESTAMPTZ(6),
    CONSTRAINT "OnlinePaymentConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OnlinePaymentConfig_mode_check" CHECK ("mode" IN ('TEST', 'PROD')),
    CONSTRAINT "OnlinePaymentConfig_memoPrefix_check" CHECK ("memoPrefix" ~ '^[A-Z0-9]{1,8}$')
);

CREATE INDEX IF NOT EXISTS "OnlinePaymentConfig_isActive_idx" ON "OnlinePaymentConfig"("isActive");
CREATE INDEX IF NOT EXISTS "OnlinePaymentConfig_createdAt_idx" ON "OnlinePaymentConfig"("createdAt");
-- Chỉ mục TỪNG PHẦN (Prisma không biểu diễn được WHERE): không bao giờ có hai cấu hình cùng bật.
CREATE UNIQUE INDEX IF NOT EXISTS "OnlinePaymentConfig_one_active_key" ON "OnlinePaymentConfig"("isActive") WHERE "isActive";

DO $$ BEGIN
  ALTER TABLE "OnlinePaymentConfig" ADD CONSTRAINT "OnlinePaymentConfig_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OnlinePaymentConfig" ADD CONSTRAINT "OnlinePaymentConfig_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "OnlinePaymentConfig" ENABLE ROW LEVEL SECURITY;

-- 2. Chụp lúc tạo đơn Online: pháp nhân bán + thông tin nhận tiền ĐÃ PHÁT HÀNH cho đơn. NULL = đơn không phải Online / tạo trước khi có cấu hình.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onlinePaymentSnapshot" JSONB;
CREATE INDEX IF NOT EXISTS "Order_legalEntityId_idx" ON "Order"("legalEntityId");
DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
