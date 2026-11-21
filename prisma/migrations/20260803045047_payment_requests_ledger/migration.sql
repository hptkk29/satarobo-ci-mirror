-- 03/08 — So thu theo DOT (PaymentRequest) + phan bo waterfall (PaymentAllocation)
-- + giao dich tien ve (BankTransaction) + tien thua (CreditBalance) + phien QR.
--
-- ADDITIVE ONLY: chi CREATE TYPE/TABLE/INDEX. KHONG sua kieu, KHONG xoa/rename cot
-- nao -- so moi chay SONG SONG voi Payment/OrderInstallment cho toi khi
-- shadow-compare sach (co PAYMENT_LEDGER_V2, mac dinh TAT).
--
-- CANH BAO: `prisma migrate dev` sinh kem ~20 lenh `ALTER COLUMN ... TIMESTAMP(3)`
-- tren cac bang LMS -- do la DRIFT cua DB test local, KHONG phai thay doi cua phase
-- nay. Da GO TAY (bay da dinh 01/08). De nguyen la am tham doi kieu cot tren PROD.

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "QrSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'IGNORED');
-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "centerId" TEXT,
    "installmentNo" INTEGER NOT NULL,
    "amountDue" INTEGER NOT NULL,
    "dueDate" TIMESTAMPTZ(6),
    "matchKey" TEXT,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrSession" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "centerId" TEXT,
    "providerOrderCode" TEXT,
    "amountShown" INTEGER NOT NULL,
    "qrContent" TEXT,
    "checkoutUrl" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "QrSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTxnId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "transferredAt" TIMESTAMPTZ(6) NOT NULL,
    "accountNumber" TEXT,
    "referenceCode" TEXT,
    "content" TEXT,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "unmatchedNote" TEXT,
    "centerId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "centerId" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditBalance" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT,
    "studentId" TEXT,
    "orderId" TEXT,
    "bankTransactionId" TEXT,
    "centerId" TEXT,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "settledAt" TIMESTAMPTZ(6),
    "settledById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_matchKey_key" ON "PaymentRequest"("matchKey");

-- CreateIndex
CREATE INDEX "PaymentRequest_centerId_status_idx" ON "PaymentRequest"("centerId", "status");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_dueDate_idx" ON "PaymentRequest"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_orderId_installmentNo_key" ON "PaymentRequest"("orderId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "QrSession_providerOrderCode_key" ON "QrSession"("providerOrderCode");

-- CreateIndex
CREATE INDEX "QrSession_paymentRequestId_status_idx" ON "QrSession"("paymentRequestId", "status");

-- CreateIndex
CREATE INDEX "QrSession_centerId_createdAt_idx" ON "QrSession"("centerId", "createdAt");

-- CreateIndex
CREATE INDEX "BankTransaction_status_createdAt_idx" ON "BankTransaction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BankTransaction_centerId_createdAt_idx" ON "BankTransaction"("centerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_provider_providerTxnId_key" ON "BankTransaction"("provider", "providerTxnId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentRequestId_idx" ON "PaymentAllocation"("paymentRequestId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_centerId_createdAt_idx" ON "PaymentAllocation"("centerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_bankTransactionId_paymentRequestId_key" ON "PaymentAllocation"("bankTransactionId", "paymentRequestId");

-- CreateIndex
CREATE INDEX "CreditBalance_parentUserId_settledAt_idx" ON "CreditBalance"("parentUserId", "settledAt");

-- CreateIndex
CREATE INDEX "CreditBalance_studentId_idx" ON "CreditBalance"("studentId");

-- CreateIndex
CREATE INDEX "CreditBalance_centerId_createdAt_idx" ON "CreditBalance"("centerId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrSession" ADD CONSTRAINT "QrSession_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
