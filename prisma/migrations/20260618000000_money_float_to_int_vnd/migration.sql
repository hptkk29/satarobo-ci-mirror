-- FIX-H5/COL2 — Tiền VND là số nguyên (không có đơn vị lẻ).
-- Chuyển các cột tiền đang là Float (double precision) → Int (integer).
-- Giá trị hiện có được LÀM TRÒN (ROUND) — VND không có phần thập phân nên không mất thông tin thật.
--
-- KHÔNG đụng AdsInsightDaily.spend (giữ Float): nguồn nạp từ Meta API trả số thập phân
-- theo hợp đồng bên ngoài; rounding sẽ ở tầng tổng hợp/báo cáo, không ở cột thô.
--
-- Tiền giao dịch lõi (Payment.amount / Order.totalAmount / Enrollment.finalPrice) ĐÃ là Int từ trước.

ALTER TABLE "MarketingCostPeriod"
  ALTER COLUMN "totalQcCost" SET DATA TYPE INTEGER USING ROUND("totalQcCost")::integer;

ALTER TABLE "Employee"
  ALTER COLUMN "bhxhBase" SET DATA TYPE INTEGER USING ROUND("bhxhBase")::integer;

ALTER TABLE "InventoryItem"
  ALTER COLUMN "pricePerUnit" SET DATA TYPE INTEGER USING ROUND("pricePerUnit")::integer;

ALTER TABLE "StockMovement"
  ALTER COLUMN "unitPrice" SET DATA TYPE INTEGER USING ROUND("unitPrice")::integer;

ALTER TABLE "StockMovement"
  ALTER COLUMN "totalCost" SET DATA TYPE INTEGER USING ROUND("totalCost")::integer;
