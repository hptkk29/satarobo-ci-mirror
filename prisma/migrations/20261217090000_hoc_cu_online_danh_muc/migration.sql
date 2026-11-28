-- 25/11/2026 (tích hợp A+E): viết lại cho CHẠY LẠI ĐƯỢC (IF NOT EXISTS / DO $$ … $$) theo luật [MIG-01]; hiệu ứng trên DB trống KHÔNG đổi. Bản cũ chưa áp ở UAT/TEST/PROD (chỉ DB cục bộ của A).
-- V8.42 — DANH MỤC HỌC CỤ BÁN ONLINE (Commerce v2 · P0-A). CỘNG THÊM: 3 cột NULLABLE trên "Product" + 3 bảng MỚI. Không backfill, không đổi hành vi bán Offline.
-- Biến thể = mỗi biến thể là MỘT "Product" riêng (đã có SKU/giá/tồn riêng); chỉ gom nhóm bằng "onlineGroupKey" + nhãn "onlineVariantLabel".
-- Hoàn tác (chỉ khi các bảng mới đã dọn): DROP TABLE "CartRemovedNotice", "ProductRestockSubscription", "ProductOnlineAddon"; ALTER TABLE "Product" DROP COLUMN "onlineGroupKey", DROP COLUMN "onlineVariantLabel", DROP COLUMN "onlineMaxQty";

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "onlineGroupKey" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "onlineVariantLabel" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "onlineMaxQty" INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_onlineMaxQty_check') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_onlineMaxQty_check" CHECK ("onlineMaxQty" IS NULL OR ("onlineMaxQty" >= 1 AND "onlineMaxQty" <= 100));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Product_onlineGroupKey_idx" ON "Product"("onlineGroupKey");

-- Sản phẩm MUA KÈM (gợi ý trong giỏ). Cấu hình của Admin; không có logic giá.
CREATE TABLE IF NOT EXISTS "ProductOnlineAddon" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "addonProductId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductOnlineAddon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductOnlineAddon_productId_addonProductId_key" ON "ProductOnlineAddon"("productId", "addonProductId");
CREATE INDEX IF NOT EXISTS "ProductOnlineAddon_productId_sortOrder_idx" ON "ProductOnlineAddon"("productId", "sortOrder");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductOnlineAddon_productId_fkey') THEN
    ALTER TABLE "ProductOnlineAddon" ADD CONSTRAINT "ProductOnlineAddon_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductOnlineAddon_addonProductId_fkey') THEN
    ALTER TABLE "ProductOnlineAddon" ADD CONSTRAINT "ProductOnlineAddon_addonProductId_fkey" FOREIGN KEY ("addonProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductOnlineAddon_khac_nhau_check') THEN
    ALTER TABLE "ProductOnlineAddon" ADD CONSTRAINT "ProductOnlineAddon_khac_nhau_check" CHECK ("productId" <> "addonProductId");
  END IF;
END $$;
ALTER TABLE "ProductOnlineAddon" ENABLE ROW LEVEL SECURITY;

-- «Báo khi có hàng»: một phụ huynh đăng ký một lần cho một sản phẩm; "notifiedAt" đánh dấu đã báo (idempotent, không báo lặp).
CREATE TABLE IF NOT EXISTS "ProductRestockSubscription" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMPTZ(6),
    CONSTRAINT "ProductRestockSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductRestockSubscription_productId_parentUserId_key" ON "ProductRestockSubscription"("productId", "parentUserId");
CREATE INDEX IF NOT EXISTS "ProductRestockSubscription_parentUserId_idx" ON "ProductRestockSubscription"("parentUserId");
CREATE INDEX IF NOT EXISTS "ProductRestockSubscription_productId_notifiedAt_idx" ON "ProductRestockSubscription"("productId", "notifiedAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductRestockSubscription_productId_fkey') THEN
    ALTER TABLE "ProductRestockSubscription" ADD CONSTRAINT "ProductRestockSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductRestockSubscription_parentUserId_fkey') THEN
    ALTER TABLE "ProductRestockSubscription" ADD CONSTRAINT "ProductRestockSubscription_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "ProductRestockSubscription" ENABLE ROW LEVEL SECURITY;

-- Dòng BỊ HỆ THỐNG GỠ khỏi giỏ (khoá Offline, khoá/sản phẩm ngừng bán…): lưu theo GIỎ, trả trong mọi GET cho tới khi phụ huynh xác nhận.
CREATE TABLE IF NOT EXISTS "CartRemovedNotice" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "ten" TEXT NOT NULL,
    "lyDo" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMPTZ(6),
    CONSTRAINT "CartRemovedNotice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CartRemovedNotice_cartId_ackedAt_idx" ON "CartRemovedNotice"("cartId", "ackedAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CartRemovedNotice_cartId_fkey') THEN
    ALTER TABLE "CartRemovedNotice" ADD CONSTRAINT "CartRemovedNotice_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CartRemovedNotice_lyDo_check') THEN
    ALTER TABLE "CartRemovedNotice" ADD CONSTRAINT "CartRemovedNotice_lyDo_check" CHECK ("lyDo" IN ('LOAI_OFFLINE', 'KHOA_NGUNG_BAN', 'SAN_PHAM_NGUNG_BAN', 'HET_HANG_VINH_VIEN'));
  END IF;
END $$;
ALTER TABLE "CartRemovedNotice" ENABLE ROW LEVEL SECURITY;
