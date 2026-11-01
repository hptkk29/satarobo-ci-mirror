-- FIX-H7 (CHECK constraints) — ép luật nghiệp vụ tại tầng DB làm chốt chặn cuối.
-- Guard phía ứng dụng (Zod mirror) là tuyến đầu chặn sớm với message VI; các CHECK
-- dưới đây bảo đảm dữ liệu không hợp lệ KHÔNG vào được DB dù qua đường ghi nào.
--
-- Phạm vi (StockBalance.quantity >= 0 KHÔNG nằm ở đây — đã có ở C4
-- 20260617010000_stockbalance_qty_nonneg, thêm lại sẽ trùng tên constraint):
--   - Voucher.discountPercent: NULL hoặc trong [1, 100]
--   - Enrollment.finalPrice: NULL hoặc >= 0
--   - Order.totalAmount: >= 0
--   - Payment.amount: <> 0 (giao dịch phải có giá trị, cho phép âm = hoàn/điều chỉnh)
--
-- LƯU Ý VẬN HÀNH: ALTER TABLE ... ADD CONSTRAINT sẽ SCAN toàn bộ bảng để validate
-- dữ liệu hiện hữu và giữ lock trong lúc scan. Với bảng lớn (Order/Payment/Enrollment)
-- nên CHẠY VÀO GIỜ THẤP ĐIỂM để tránh chặn ghi.

ALTER TABLE "Voucher"    ADD CONSTRAINT voucher_percent_range        CHECK ("discountPercent" IS NULL OR ("discountPercent" BETWEEN 1 AND 100));
ALTER TABLE "Enrollment" ADD CONSTRAINT enrollment_finalprice_nonneg CHECK ("finalPrice" IS NULL OR "finalPrice" >= 0);
ALTER TABLE "Order"      ADD CONSTRAINT order_total_nonneg           CHECK ("totalAmount" >= 0);
ALTER TABLE "Payment"    ADD CONSTRAINT payment_amount_nonzero       CHECK ("amount" <> 0);
