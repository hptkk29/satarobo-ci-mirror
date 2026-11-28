-- 25/11/2026 (tích hợp A+E): viết lại cho CHẠY LẠI ĐƯỢC (IF NOT EXISTS / DO $$ … $$) theo luật [MIG-01]; hiệu ứng trên DB trống KHÔNG đổi. Bản cũ chưa áp ở UAT/TEST/PROD (chỉ DB cục bộ của A).
-- V8.43 — GIAO HÀNG + ĐƠN HỖN HỢP + FULFILLMENT TỪNG DÒNG (Commerce v2 · P0). CỘNG THÊM: 1 enum + 5 bảng mới + 2 cột NULLABLE trên "Order" + 1 cột NULLABLE trên "Cart".
-- "Order"."shippingFee" (INTEGER NOT NULL DEFAULT 0) ĐÃ CÓ từ trước — migration này KHÔNG thêm lại và KHÔNG thêm CHECK lên bảng có dữ liệu.
-- Không backfill, không đổi hành vi đơn/giỏ đang có. Mức phí/khu vực/phương thức là DỮ LIỆU CẤU HÌNH (Admin), KHÔNG hard-code.
-- Hoàn tác (chỉ khi các bảng mới đã dọn): DROP TABLE "OrderItemFulfillment", "ParentShippingAddress", "ShippingRate", "ShippingMethod", "ShippingZone"; DROP TYPE "OrderItemFulfillmentStatus";
--   ALTER TABLE "Order" DROP COLUMN "shippingMethodCode", DROP COLUMN "shippingAddress"; ALTER TABLE "Cart" DROP COLUMN "shippingMethodCode";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderItemFulfillmentStatus') THEN
    CREATE TYPE "OrderItemFulfillmentStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'PACKING', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED', 'RETURNED', 'NEEDS_STAFF');
  END IF;
END $$;

-- Ảnh chụp giao hàng của ĐƠN (phương thức + địa chỉ lúc đặt; phí nằm ở cột "shippingFee" có sẵn): bất biến về sau, đổi cấu hình không đổi đơn cũ.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingMethodCode" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingAddress" JSONB;

-- Phương thức giao đang chọn của GIỎ (null = chưa chọn). Giỏ chỉ khoá Online không dùng.
ALTER TABLE "Cart" ADD COLUMN IF NOT EXISTS "shippingMethodCode" TEXT;

CREATE TABLE IF NOT EXISTS "ShippingZone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingZone_code_key" ON "ShippingZone"("code");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShippingZone_code_check') THEN
    ALTER TABLE "ShippingZone" ADD CONSTRAINT "ShippingZone_code_check" CHECK ("code" ~ '^[A-Z0-9_]{2,30}$');
  END IF;
END $$;
ALTER TABLE "ShippingZone" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "ShippingMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "etaText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingMethod_code_key" ON "ShippingMethod"("code");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShippingMethod_code_check') THEN
    ALTER TABLE "ShippingMethod" ADD CONSTRAINT "ShippingMethod_code_check" CHECK ("code" ~ '^[A-Z0-9_]{2,30}$');
  END IF;
END $$;
ALTER TABLE "ShippingMethod" ENABLE ROW LEVEL SECURITY;

-- Giá của MỘT phương thức TẠI MỘT khu vực. Không có dòng ⇒ phương thức KHÔNG khả dụng ở khu vực đó (vd. giao nhanh chỉ vài khu vực).
CREATE TABLE IF NOT EXISTS "ShippingRate" (
    "id" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "freeAboveAmount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingRate_methodId_zoneId_key" ON "ShippingRate"("methodId", "zoneId");
CREATE INDEX IF NOT EXISTS "ShippingRate_zoneId_idx" ON "ShippingRate"("zoneId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShippingRate_methodId_fkey') THEN
    ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "ShippingMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShippingRate_zoneId_fkey') THEN
    ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ShippingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShippingRate_fee_check') THEN
    ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_fee_check" CHECK ("fee" >= 0 AND ("freeAboveAmount" IS NULL OR "freeAboveAmount" >= 0));
  END IF;
END $$;
ALTER TABLE "ShippingRate" ENABLE ROW LEVEL SECURITY;

-- Địa chỉ nhận hàng của phụ huynh (MỘT địa chỉ mặc định / phụ huynh ở v1).
CREATE TABLE IF NOT EXISTS "ParentShippingAddress" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "hoTen" TEXT NOT NULL,
    "soDienThoai" TEXT NOT NULL,
    "tinhThanh" TEXT NOT NULL,
    "phuongXa" TEXT NOT NULL,
    "soNhaDuong" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ParentShippingAddress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ParentShippingAddress_parentUserId_key" ON "ParentShippingAddress"("parentUserId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentShippingAddress_parentUserId_fkey') THEN
    ALTER TABLE "ParentShippingAddress" ADD CONSTRAINT "ParentShippingAddress_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "ParentShippingAddress" ENABLE ROW LEVEL SECURITY;

-- Fulfillment TỪNG DÒNG hàng vật lý (tách khỏi trạng thái thanh toán và khỏi cấp quyền học của dòng khoá). Một dòng ⇒ tối đa một bản ghi.
CREATE TABLE IF NOT EXISTS "OrderItemFulfillment" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "status" "OrderItemFulfillmentStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "trackingCode" TEXT,
    "carrier" TEXT,
    "expectedDeliveryOn" DATE,
    "paidAt" TIMESTAMPTZ(6),
    "packedAt" TIMESTAMPTZ(6),
    "shippedAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "OrderItemFulfillment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrderItemFulfillment_orderItemId_key" ON "OrderItemFulfillment"("orderItemId");
CREATE INDEX IF NOT EXISTS "OrderItemFulfillment_status_idx" ON "OrderItemFulfillment"("status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItemFulfillment_orderItemId_fkey') THEN
    ALTER TABLE "OrderItemFulfillment" ADD CONSTRAINT "OrderItemFulfillment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
-- Trạng thái khớp dấu thời gian (không có «đang giao» mà không có mã vận đơn/thời điểm giao cho vận chuyển).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItemFulfillment_dau_thoi_gian_check') THEN
    ALTER TABLE "OrderItemFulfillment" ADD CONSTRAINT "OrderItemFulfillment_dau_thoi_gian_check" CHECK (
    ("status" NOT IN ('PAID', 'PACKING', 'SHIPPED', 'DELIVERED', 'RETURNED') OR "paidAt" IS NOT NULL)
    AND ("status" NOT IN ('SHIPPED', 'DELIVERED') OR "shippedAt" IS NOT NULL)
    AND ("status" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL)
);
  END IF;
END $$;
ALTER TABLE "OrderItemFulfillment" ENABLE ROW LEVEL SECURITY;
