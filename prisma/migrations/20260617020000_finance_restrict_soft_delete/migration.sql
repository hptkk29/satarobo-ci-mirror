-- FIX-C3 — onDelete tài chính → Restrict + soft-delete (2-phase: chỉ ADD, không drop).
-- 1) Thêm cột deletedAt (nullable) cho Order/Payment/Receipt/Enrollment + updatedAt cho Receipt.
-- 2) Đổi FK tài chính Cascade → Restrict (DROP + ADD lại constraint cùng tên).
-- Giữ SetNull cho liên kết mềm: Payment.enrollment, Payment.adjustmentOf (KHÔNG đụng).

-- ── Soft-delete columns ──────────────────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Enrollment" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Receipt: thêm updatedAt (FIX-M4) + deletedAt. updatedAt NOT NULL default now() để backfill row cũ.
ALTER TABLE "Receipt" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Receipt" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- ── onDelete Cascade → Restrict ──────────────────────────────────────────────
-- Payment.order
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_orderId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Receipt.payment
ALTER TABLE "Receipt" DROP CONSTRAINT "Receipt_paymentId_fkey";
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Receipt.enrollment
ALTER TABLE "Receipt" DROP CONSTRAINT "Receipt_enrollmentId_fkey";
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrderItem.order
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrderInstallment.order
ALTER TABLE "OrderInstallment" DROP CONSTRAINT "OrderInstallment_orderId_fkey";
ALTER TABLE "OrderInstallment" ADD CONSTRAINT "OrderInstallment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrderStatusHistory.order
ALTER TABLE "OrderStatusHistory" DROP CONSTRAINT "OrderStatusHistory_orderId_fkey";
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── FIX-C3 (B2b) — Enrollment unique → PARTIAL unique (chỉ row CÒN SỐNG) ──────────
-- Soft-delete cần cho phép ghi danh lại cùng (HS × lớp) sau khi xóa mềm. Bỏ unique
-- đầy đủ, thay bằng unique chỉ áp khi "deletedAt" IS NULL.
-- ⚠️ Prisma KHÔNG model được partial unique → schema dùng @@index([studentId,classId]);
-- index partial dưới đây CHỈ có trong migration. Lần `migrate dev` sau Prisma sẽ coi
-- là drift và muốn drop — PHẢI giữ lại (đừng để migrate dev xoá).
DROP INDEX "Enrollment_studentId_classId_key";
CREATE INDEX "Enrollment_studentId_classId_idx" ON "Enrollment"("studentId", "classId");
CREATE UNIQUE INDEX "Enrollment_studentId_classId_active_key" ON "Enrollment"("studentId", "classId") WHERE "deletedAt" IS NULL;
