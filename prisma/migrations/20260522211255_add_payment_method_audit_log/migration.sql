-- Phase 5.6.1 — PaymentMethod audit log table

-- CreateTable
CREATE TABLE "PaymentMethodAuditLog" (
    "id" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMethodAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethodAuditLog_paymentMethodId_createdAt_idx" ON "PaymentMethodAuditLog"("paymentMethodId", "createdAt");
CREATE INDEX "PaymentMethodAuditLog_createdAt_idx" ON "PaymentMethodAuditLog"("createdAt");
CREATE INDEX "PaymentMethodAuditLog_changedByUserId_idx" ON "PaymentMethodAuditLog"("changedByUserId");

-- AddForeignKey
ALTER TABLE "PaymentMethodAuditLog" ADD CONSTRAINT "PaymentMethodAuditLog_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
