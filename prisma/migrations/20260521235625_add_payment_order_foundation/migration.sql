-- Phase 5.6.0 — Payment + Order foundation
-- 4 new enums, 4 new tables, polymorphic OrderItem, status workflow audit chain.
-- VND-only Int storage. Customer info snapshotted on Order.

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CASH', 'BANK_TRANSFER', 'VNPAY', 'TINGEE', 'COD', 'WALLET');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('COURSE', 'PACKAGE', 'EXAM', 'PRODUCT', 'COMBO');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderItemType" AS ENUM ('COURSE_ENROLLMENT', 'COURSE_PACKAGE', 'EXAM_REGISTRATION', 'PRODUCT');

-- CreateTable PaymentMethod
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "image" TEXT,
    "description" TEXT,
    "canBuyCourse" BOOLEAN NOT NULL DEFAULT true,
    "canBuyPackage" BOOLEAN NOT NULL DEFAULT true,
    "canBuyExam" BOOLEAN NOT NULL DEFAULT true,
    "canBuyProduct" BOOLEAN NOT NULL DEFAULT false,
    "canDeposit" BOOLEAN NOT NULL DEFAULT false,
    "bankName" TEXT,
    "bankBranch" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "gatewayConfig" JSONB,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex PaymentMethod
CREATE UNIQUE INDEX "PaymentMethod_code_key" ON "PaymentMethod"("code");
CREATE INDEX "PaymentMethod_code_idx" ON "PaymentMethod"("code");
CREATE INDEX "PaymentMethod_isActive_displayOrder_idx" ON "PaymentMethod"("isActive", "displayOrder");

-- CreateTable Order
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerAddress" TEXT,
    "customerWard" TEXT,
    "customerCity" TEXT,
    "studentId" TEXT,
    "leadId" TEXT,
    "centerId" TEXT,
    "paymentMethodId" TEXT,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "shippingFee" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL DEFAULT 0,
    "voucherCode" TEXT,
    "bankReference" TEXT,
    "gatewayTxnId" TEXT,
    "paidAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "customerNote" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex Order
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");
CREATE INDEX "Order_code_idx" ON "Order"("code");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_type_status_idx" ON "Order"("type", "status");
CREATE INDEX "Order_studentId_idx" ON "Order"("studentId");
CREATE INDEX "Order_leadId_idx" ON "Order"("leadId");
CREATE INDEX "Order_centerId_createdAt_idx" ON "Order"("centerId", "createdAt");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Order_customerPhone_idx" ON "Order"("customerPhone");

-- AddForeignKey Order
ALTER TABLE "Order" ADD CONSTRAINT "Order_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- CreateTable OrderItem
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderItemType" NOT NULL,
    "enrollmentId" TEXT,
    "packageId" TEXT,
    "examAttemptId" TEXT,
    "productId" TEXT,
    "itemName" TEXT NOT NULL,
    "itemDescription" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex OrderItem
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_type_idx" ON "OrderItem"("type");
CREATE INDEX "OrderItem_enrollmentId_idx" ON "OrderItem"("enrollmentId");
CREATE INDEX "OrderItem_packageId_idx" ON "OrderItem"("packageId");
CREATE INDEX "OrderItem_examAttemptId_idx" ON "OrderItem"("examAttemptId");

-- AddForeignKey OrderItem
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CoursePackage"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_examAttemptId_fkey" FOREIGN KEY ("examAttemptId") REFERENCES "ExamAttempt"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- CreateTable OrderStatusHistory
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus" NOT NULL,
    "toStatus" "OrderStatus" NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex OrderStatusHistory
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");
CREATE INDEX "OrderStatusHistory_createdAt_idx" ON "OrderStatusHistory"("createdAt");
CREATE INDEX "OrderStatusHistory_changedByUserId_idx" ON "OrderStatusHistory"("changedByUserId");

-- AddForeignKey OrderStatusHistory
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
