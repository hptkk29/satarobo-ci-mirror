-- Phase 5.10.1 — Convert OrderItem.productId to FK Product (SetNull).
-- Column already nullable from Sprint 5.6; only adds constraint + index.

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
