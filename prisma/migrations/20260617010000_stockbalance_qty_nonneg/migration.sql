-- FIX-C4 (TOCTOU âm kho) — DB backstop: tồn kho không bao giờ được âm.
-- Guard phía ứng dụng (guarded updateMany) là tuyến đầu; CHECK này là chốt chặn
-- cuối cùng ở DB nếu có đường ghi khác bỏ sót.
ALTER TABLE "StockBalance"
  ADD CONSTRAINT stockbalance_qty_nonneg CHECK ("quantity" >= 0);
