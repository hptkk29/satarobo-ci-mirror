-- Commit 4 — lịch thanh toán tối đa 2 đợt

CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID');

CREATE TABLE "OrderInstallment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "soDot" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
  "dueDate" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "recordedById" TEXT,
  "lastReminderAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderInstallment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderInstallment_orderId_soDot_key" ON "OrderInstallment"("orderId","soDot");
CREATE INDEX "OrderInstallment_status_dueDate_idx" ON "OrderInstallment"("status","dueDate");
ALTER TABLE "OrderInstallment" ADD CONSTRAINT "OrderInstallment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
