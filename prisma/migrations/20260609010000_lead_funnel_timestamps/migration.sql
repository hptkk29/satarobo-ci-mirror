-- R1-04/05 — mốc phễu SR.QD.217 + commissionSource trên Lead. Additive.

-- CreateEnum
CREATE TYPE "CommissionSource" AS ENUM ('MARKETING_ADMIN', 'SALE_SELF', 'REFERRAL');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "qualifiedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "handedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "receivedConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "firstContactAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "commissionSource" "CommissionSource";
ALTER TABLE "Lead" ADD COLUMN "adminId" TEXT;
