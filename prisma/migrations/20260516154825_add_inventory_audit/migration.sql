-- CreateEnum
CREATE TYPE "InventoryAuditStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InventoryAudit" (
  "id"             TEXT NOT NULL,
  "auditCode"      TEXT,
  "centerId"       TEXT NOT NULL,
  "status"         "InventoryAuditStatus" NOT NULL DEFAULT 'DRAFT',
  "totalItems"     INTEGER NOT NULL DEFAULT 0,
  "totalAdjusted"  INTEGER NOT NULL DEFAULT 0,
  "totalIncreases" INTEGER NOT NULL DEFAULT 0,
  "totalDecreases" INTEGER NOT NULL DEFAULT 0,
  "performedById"  TEXT,
  "performedAt"    TIMESTAMP(3),
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAudit_auditCode_key" ON "InventoryAudit"("auditCode");

-- CreateIndex
CREATE INDEX "InventoryAudit_centerId_performedAt_idx" ON "InventoryAudit"("centerId", "performedAt");

-- CreateIndex
CREATE INDEX "InventoryAudit_status_idx" ON "InventoryAudit"("status");

-- AddForeignKey
ALTER TABLE "InventoryAudit" ADD CONSTRAINT "InventoryAudit_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAudit" ADD CONSTRAINT "InventoryAudit_performedById_fkey"
  FOREIGN KEY ("performedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "InventoryAuditItem" (
  "id"          TEXT NOT NULL,
  "auditId"     TEXT NOT NULL,
  "itemId"      TEXT NOT NULL,
  "previousQty" INTEGER NOT NULL,
  "actualQty"   INTEGER NOT NULL,
  "delta"       INTEGER NOT NULL,
  "reason"      TEXT,
  "movementId"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAuditItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAuditItem_movementId_key" ON "InventoryAuditItem"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAuditItem_auditId_itemId_key" ON "InventoryAuditItem"("auditId", "itemId");

-- CreateIndex
CREATE INDEX "InventoryAuditItem_itemId_idx" ON "InventoryAuditItem"("itemId");

-- AddForeignKey
ALTER TABLE "InventoryAuditItem" ADD CONSTRAINT "InventoryAuditItem_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "InventoryAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAuditItem" ADD CONSTRAINT "InventoryAuditItem_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAuditItem" ADD CONSTRAINT "InventoryAuditItem_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
