-- Hoàn tiền: bước "ĐÃ CHI" đi vào sổ `Payment` [29/09/2026].
--
-- Trước bản này `RefundRequest` dừng ở APPROVED: không đường nào ghi PAID, và tiền hoàn đã
-- duyệt KHÔNG vào sổ `Payment` ⇒ công nợ, số ròng hoá đơn điện tử, thực thu hoa hồng không
-- thấy khoản hoàn. Hàm ghi: `chiHoanTien` (lib/finance/chi-hoan-tien.ts).
--
-- ADDITIVE thuần trên bảng có dữ liệu PROD (luật cứng #4): 3 cột NULLABLE trên RefundRequest,
-- 1 cột NULLABLE + 1 FK + 1 chỉ mục trên Payment. Không backfill, không đổi kiểu, không bỏ cột.
-- Rollback = ngừng ghi; mọi dòng cũ giữ NULL.
--
-- ⚠️ FK `RESTRICT`: dòng `Payment` âm của một lượt chi hoàn không được mất dấu yêu cầu hoàn
-- sinh ra nó. Không đường mã chạy thật nào xoá `RefundRequest`.

ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMPTZ(6);
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "paidById" TEXT;
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "paidMethod" TEXT;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "Payment_refundRequestId_idx" ON "Payment"("refundRequestId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_refundRequestId_fkey'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_refundRequestId_fkey"
      FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
