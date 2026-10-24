-- M0 — FIX lead→payment→enroll: additive, nullable fields + 2 new enums.
-- Tất cả ADD COLUMN nullable / CREATE TYPE → an toàn, 2-phase (không drop, không backfill bắt buộc).

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('COURSE', 'PRODUCT');

-- CreateEnum
CREATE TYPE "InstallmentApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable: User — CCCD + địa chỉ phụ huynh
ALTER TABLE "User" ADD COLUMN     "cccd" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "ward" TEXT,
ADD COLUMN     "city" TEXT;

-- AlterTable: Lead — loại đơn dự kiến
ALTER TABLE "Lead" ADD COLUMN     "orderKind" "OrderKind";

-- AlterTable: Order — CCCD người mua + duyệt kế hoạch 2 đợt
ALTER TABLE "Order" ADD COLUMN     "customerCccd" TEXT,
ADD COLUMN     "installmentApprovalStatus" "InstallmentApprovalStatus",
ADD COLUMN     "installmentRequestedById" TEXT,
ADD COLUMN     "installmentApprovedById" TEXT,
ADD COLUMN     "installmentApprovedAt" TIMESTAMPTZ(6),
ADD COLUMN     "installmentRejectReason" TEXT;

-- AlterTable: TrialEnrollment (LD3) — buổi học thử cụ thể được chọn khi xếp con vào lớp.
-- Scalar nullable (validate "buổi thuộc lớp" ở action boundary; không FK để giữ blast radius nhỏ).
ALTER TABLE "TrialEnrollment" ADD COLUMN     "scheduledSessionId" TEXT;

-- CreateIndex
CREATE INDEX "TrialEnrollment_scheduledSessionId_idx" ON "TrialEnrollment"("scheduledSessionId");
