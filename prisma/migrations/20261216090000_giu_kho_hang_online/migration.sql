-- 25/11/2026 (tích hợp A+E): viết lại cho CHẠY LẠI ĐƯỢC (IF NOT EXISTS / DO $$ … $$) theo luật [MIG-01]; hiệu ứng trên DB trống KHÔNG đổi. Bản cũ chưa áp ở UAT/TEST/PROD (chỉ DB cục bộ của A).
-- V8.42 — GIỮ KHO HÀNG ONLINE (Commerce v2 · P0-B). CỘNG THÊM: 1 enum + 1 bảng mới. Không đụng bảng đang có dữ liệu.
-- Giỏ không hết hạn; chỉ phần giữ kho của một ĐƠN chờ thanh toán có hạn. «Còn khả dụng» = stockOnHand − Σ(ACTIVE & expiresAt > now) — tính bằng vị từ, không phải cột.
-- Hoàn tác (chỉ khi bảng còn rỗng/đã dọn): DROP TABLE "ProductReservation"; DROP TYPE "ProductReservationStatus";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductReservationStatus') THEN
    CREATE TYPE "ProductReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED', 'RETURNED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ProductReservation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ProductReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "releasedAt" TIMESTAMPTZ(6),
    "returnedAt" TIMESTAMPTZ(6),
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProductReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductReservation_orderItemId_key" ON "ProductReservation"("orderItemId");
CREATE INDEX IF NOT EXISTS "ProductReservation_productId_status_expiresAt_idx" ON "ProductReservation"("productId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "ProductReservation_status_expiresAt_idx" ON "ProductReservation"("status", "expiresAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductReservation_productId_fkey') THEN
    ALTER TABLE "ProductReservation" ADD CONSTRAINT "ProductReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductReservation_orderItemId_fkey') THEN
    ALTER TABLE "ProductReservation" ADD CONSTRAINT "ProductReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Số lượng dương; trạng thái và dấu thời gian phải khớp nhau (không có «đã bán» mà không có thời điểm bán).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductReservation_quantity_check') THEN
    ALTER TABLE "ProductReservation" ADD CONSTRAINT "ProductReservation_quantity_check" CHECK ("quantity" > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductReservation_dau_thoi_gian_check') THEN
    ALTER TABLE "ProductReservation" ADD CONSTRAINT "ProductReservation_dau_thoi_gian_check" CHECK (
    ("status" NOT IN ('CONSUMED', 'RETURNED') OR "consumedAt" IS NOT NULL)
    AND ("status" <> 'RETURNED' OR "returnedAt" IS NOT NULL)
    AND ("status" NOT IN ('RELEASED', 'EXPIRED') OR "releasedAt" IS NOT NULL)
);
  END IF;
END $$;

ALTER TABLE "ProductReservation" ENABLE ROW LEVEL SECURITY;
