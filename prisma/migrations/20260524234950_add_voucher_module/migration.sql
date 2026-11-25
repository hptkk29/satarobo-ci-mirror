-- Phase 5.7.0 — Voucher module foundation
-- 2 enums + 3 tables. KIT_ROBOT/SENSOR types ready for Sprint 5.10 Product.

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('COURSE', 'PACKAGE', 'KIT_ROBOT', 'SENSOR', 'ALL');

-- CreateEnum
CREATE TYPE "VoucherDiscountKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable Voucher
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "VoucherType" NOT NULL,
    "discountKind" "VoucherDiscountKind" NOT NULL,
    "discountPercent" INTEGER,
    "discountAmount" INTEGER,
    "maxDiscount" INTEGER,
    "minOrderValue" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "usageLimitPerUser" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex Voucher
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");
CREATE INDEX "Voucher_code_idx" ON "Voucher"("code");
CREATE INDEX "Voucher_type_isActive_validFrom_validUntil_idx" ON "Voucher"("type", "isActive", "validFrom", "validUntil");
CREATE INDEX "Voucher_createdAt_idx" ON "Voucher"("createdAt");

-- CreateTable VoucherRedemption
CREATE TABLE "VoucherRedemption" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerId" TEXT,
    "discountApplied" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex VoucherRedemption
CREATE UNIQUE INDEX "VoucherRedemption_orderId_key" ON "VoucherRedemption"("orderId");
CREATE INDEX "VoucherRedemption_voucherId_redeemedAt_idx" ON "VoucherRedemption"("voucherId", "redeemedAt");
CREATE INDEX "VoucherRedemption_customerPhone_voucherId_idx" ON "VoucherRedemption"("customerPhone", "voucherId");

-- AddForeignKey VoucherRedemption
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable VoucherAuditLog
CREATE TABLE "VoucherAuditLog" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex VoucherAuditLog
CREATE INDEX "VoucherAuditLog_voucherId_createdAt_idx" ON "VoucherAuditLog"("voucherId", "createdAt");
CREATE INDEX "VoucherAuditLog_createdAt_idx" ON "VoucherAuditLog"("createdAt");
CREATE INDEX "VoucherAuditLog_changedByUserId_idx" ON "VoucherAuditLog"("changedByUserId");

-- AddForeignKey VoucherAuditLog
ALTER TABLE "VoucherAuditLog" ADD CONSTRAINT "VoucherAuditLog_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
