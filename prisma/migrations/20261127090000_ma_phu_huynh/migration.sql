-- Mã PHỤ HUYNH làm «Mã khách hàng» trên hoá đơn (chủ dự án chốt 08/11/2026): `CS1-PH-AB3K9P`.
--
-- Một bảng MỚI `MaPhuHuynh`: (centerId, soDienThoai) → ma. Một phụ huynh = một mã trong một cơ sở; con ở hai cơ sở ⇒ hai mã.
-- Sinh khi lưu khối «Người mua trên hoá đơn» mà ô Mã KH còn trống (xem lib/finance/hoa-don/ma-phu-huynh.ts). Không backfill, không đụng bảng cũ.
-- Bảng mới có dữ liệu theo cơ sở ⇒ giữ CẢ HAI cột centerId + orgUnitId (luật Nền Hệ thống 3); RLS bật ở cuối (chỉ ENABLE).
--
-- CHẠY TAY TRÊN PROD (luật cứng #4) TRƯỚC khi bản mã dùng bảng này lên main. Idempotent.
-- ROLLBACK (an toàn khi chưa có hoá đơn nào mang mã PH; cột Order.invoiceCustomerCode giữ nguyên giá trị đã lưu):
--   DROP TABLE IF EXISTS "MaPhuHuynh";

CREATE TABLE IF NOT EXISTS "MaPhuHuynh" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "soDienThoai" TEXT NOT NULL,
    "ma" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaPhuHuynh_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MaPhuHuynh_ma_key" ON "MaPhuHuynh"("ma");
CREATE UNIQUE INDEX IF NOT EXISTS "MaPhuHuynh_centerId_soDienThoai_key" ON "MaPhuHuynh"("centerId", "soDienThoai");
CREATE INDEX IF NOT EXISTS "MaPhuHuynh_orgUnitId_idx" ON "MaPhuHuynh"("orgUnitId");

ALTER TABLE "MaPhuHuynh" ENABLE ROW LEVEL SECURITY;
