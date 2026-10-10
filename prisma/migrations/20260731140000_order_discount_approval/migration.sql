-- BGĐ 31/07 — giảm giá nhập tay: theo % hoặc số tiền, giải trình bắt buộc,
-- Quản lý cơ sở duyệt trước khi đơn được xác nhận. Voucher KHÔNG đi luồng này.

CREATE TYPE "DiscountApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

ALTER TABLE "Order" ADD COLUMN "discountPercent" INTEGER;
ALTER TABLE "Order" ADD COLUMN "discountReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountApprovalStatus" "DiscountApprovalStatus";
ALTER TABLE "Order" ADD COLUMN "discountRequestedById" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountApprovedById" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountApprovedAt" TIMESTAMPTZ(6);
ALTER TABLE "Order" ADD COLUMN "discountRejectReason" TEXT;
