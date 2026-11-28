-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN');

-- CreateTable
CREATE TABLE "StockMovement" (
  "id"             TEXT NOT NULL,
  "itemId"         TEXT NOT NULL,
  "centerId"       TEXT NOT NULL,
  "type"           "StockMovementType" NOT NULL,
  "quantity"       INTEGER NOT NULL,
  "transferPairId" TEXT,
  "referenceType"  TEXT,
  "referenceId"    TEXT,
  "referenceNote"  TEXT,
  "unitPrice"      DOUBLE PRECISION,
  "totalCost"      DOUBLE PRECISION,
  "performedById"  TEXT,
  "performedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"          TEXT,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_itemId_centerId_performedAt_idx"
  ON "StockMovement"("itemId", "centerId", "performedAt");

-- CreateIndex
CREATE INDEX "StockMovement_centerId_performedAt_idx"
  ON "StockMovement"("centerId", "performedAt");

-- CreateIndex
CREATE INDEX "StockMovement_type_performedAt_idx"
  ON "StockMovement"("type", "performedAt");

-- CreateIndex
CREATE INDEX "StockMovement_transferPairId_idx"
  ON "StockMovement"("transferPairId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transferPairId_fkey"
  FOREIGN KEY ("transferPairId") REFERENCES "StockMovement"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey"
  FOREIGN KEY ("performedById") REFERENCES "Employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
