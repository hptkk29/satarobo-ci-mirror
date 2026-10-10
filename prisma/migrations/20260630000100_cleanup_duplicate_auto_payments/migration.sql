-- G3 (data cleanup) — sửa "đã nộp" bị cộng đôi cho ĐƠN CŨ.
-- Triệu chứng: đơn vừa có khoản auto xác nhận tổng ([auto:order-confirm] = full totalAmount)
-- VỪA có khoản auto theo đợt ([auto:order-installment:dotN]) → getLeadPaymentSummary cộng cả 2.
-- Kế hoạch trả góp là NGUỒN SỰ THẬT về tiền của đơn → xoá mềm khoản [auto:order-confirm] thừa.
-- An toàn: chỉ set deletedAt (KHÔNG DELETE) nên không vướng FK; khoản auto chưa gắn enrollment
-- nên không sinh Receipt. Idempotent: chạy lại không xoá thêm gì (đã deletedAt).
UPDATE "Payment" p
SET "deletedAt" = NOW()
WHERE p."deletedAt" IS NULL
  AND p."note" LIKE '%[auto:order-confirm]%'
  AND p."orderId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Payment" q
    WHERE q."orderId" = p."orderId"
      AND q."deletedAt" IS NULL
      AND q."note" LIKE '%[auto:order-installment:%'
  );
