-- Phase 5.10.0 — Product catalog foundation
-- Sales/rental SKU layer, distinct from ZMRoboKit (marketing catalog).
-- 3 enums + 3 tables. Global stockOnHand for v1.

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('KIT_ROBOT', 'SENSOR', 'MISSION_BLOCK', 'ACCESSORY', 'BOOK', 'CONSUMABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "ProductMovementType" AS ENUM ('PURCHASE', 'SALE', 'ADJUSTMENT', 'DAMAGE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateTable Product
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "ProductCategory" NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "salePrice" INTEGER NOT NULL,
    "costPrice" INTEGER,
    "rentalPricePerMonth" INTEGER,
    "stockOnHand" INTEGER NOT NULL DEFAULT 0,
    "minThreshold" INTEGER NOT NULL DEFAULT 0,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "zmroboKitId" TEXT,
    "attributes" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex Product
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE INDEX "Product_category_status_idx" ON "Product"("category", "status");
CREATE INDEX "Product_status_idx" ON "Product"("status");
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- AddForeignKey Product
ALTER TABLE "Product" ADD CONSTRAINT "Product_zmroboKitId_fkey" FOREIGN KEY ("zmroboKitId") REFERENCES "ZMRoboKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ProductMovement
CREATE TABLE "ProductMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "orderId" TEXT,
    "stockBeforeMovement" INTEGER NOT NULL,
    "stockAfterMovement" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex ProductMovement
CREATE INDEX "ProductMovement_productId_createdAt_idx" ON "ProductMovement"("productId", "createdAt");
CREATE INDEX "ProductMovement_type_idx" ON "ProductMovement"("type");
CREATE INDEX "ProductMovement_orderId_idx" ON "ProductMovement"("orderId");

-- AddForeignKey ProductMovement
ALTER TABLE "ProductMovement" ADD CONSTRAINT "ProductMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ProductAuditLog
CREATE TABLE "ProductAuditLog" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex ProductAuditLog
CREATE INDEX "ProductAuditLog_productId_createdAt_idx" ON "ProductAuditLog"("productId", "createdAt");

-- AddForeignKey ProductAuditLog
ALTER TABLE "ProductAuditLog" ADD CONSTRAINT "ProductAuditLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
