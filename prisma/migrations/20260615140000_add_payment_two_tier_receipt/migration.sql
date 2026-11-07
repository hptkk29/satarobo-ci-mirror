-- CreateEnum
CREATE TYPE "PaymentSaleStatus" AS ENUM ('RECORDED', 'COLLECT_CONFIRMED');
CREATE TYPE "PaymentAccountantStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED', 'ADJUSTED');
CREATE TYPE "ReceiptStatus" AS ENUM ('ACTIVE', 'VOID');

-- AlterTable
ALTER TABLE "OrderInstallment" ADD COLUMN "reminderDays" INTEGER;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL,
    "evidenceUrl" TEXT,
    "note" TEXT,
    "saleStatus" "PaymentSaleStatus" NOT NULL DEFAULT 'RECORDED',
    "accountantStatus" "PaymentAccountantStatus" NOT NULL DEFAULT 'PENDING',
    "recordedById" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "adjustmentOfId" TEXT,
    "centerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
CREATE INDEX "Payment_enrollmentId_idx" ON "Payment"("enrollmentId");
CREATE INDEX "Payment_centerId_idx" ON "Payment"("centerId");
CREATE INDEX "Payment_accountantStatus_idx" ON "Payment"("accountantStatus");
CREATE UNIQUE INDEX "Receipt_code_key" ON "Receipt"("code");
CREATE INDEX "Receipt_enrollmentId_idx" ON "Receipt"("enrollmentId");
CREATE INDEX "Receipt_paymentId_idx" ON "Receipt"("paymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_adjustmentOfId_fkey" FOREIGN KEY ("adjustmentOfId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
