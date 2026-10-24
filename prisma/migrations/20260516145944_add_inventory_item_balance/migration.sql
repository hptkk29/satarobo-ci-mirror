-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM (
  'MAINBOARD', 'SENSOR', 'MOTOR', 'BATTERY', 'MECHANICAL',
  'WIRE', 'TOOL', 'CONSUMABLE', 'ROBOSIM', 'OTHER'
);

-- CreateTable
CREATE TABLE "InventoryItem" (
  "id"                  TEXT NOT NULL,
  "itemCode"            TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "category"            "InventoryCategory" NOT NULL DEFAULT 'OTHER',
  "unit"                TEXT NOT NULL DEFAULT 'Cái',
  "pricePerUnit"        DOUBLE PRECISION,
  "supplier"            TEXT,
  "defaultMinThreshold" INTEGER NOT NULL DEFAULT 5,
  "imageUrl"            TEXT,
  "tags"                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive"            BOOLEAN NOT NULL DEFAULT true,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_itemCode_key" ON "InventoryItem"("itemCode");

-- CreateIndex
CREATE INDEX "InventoryItem_category_isActive_idx" ON "InventoryItem"("category", "isActive");

-- CreateTable
CREATE TABLE "StockBalance" (
  "id"            TEXT NOT NULL,
  "itemId"        TEXT NOT NULL,
  "centerId"      TEXT NOT NULL,
  "quantity"      INTEGER NOT NULL DEFAULT 0,
  "reserved"      INTEGER NOT NULL DEFAULT 0,
  "minThreshold"  INTEGER,
  "lastReceiptAt" TIMESTAMP(3),
  "lastIssueAt"   TIMESTAMP(3),
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_itemId_centerId_key" ON "StockBalance"("itemId", "centerId");

-- CreateIndex
CREATE INDEX "StockBalance_centerId_quantity_idx" ON "StockBalance"("centerId", "quantity");

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
