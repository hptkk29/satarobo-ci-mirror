-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContractType" ADD VALUE 'THU_VIEC';
ALTER TYPE "ContractType" ADD VALUE 'CHINH_THUC_XAC_DINH';
ALTER TYPE "ContractType" ADD VALUE 'CHINH_THUC_KHONG_XAC_DINH';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Department" ADD VALUE 'TUYEN_SINH';
ALTER TYPE "Department" ADD VALUE 'GIAO_VU';
ALTER TYPE "Department" ADD VALUE 'GIANG_DAY';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "address" TEXT,
ADD COLUMN     "bhxhBase" DOUBLE PRECISION,
ADD COLUMN     "emergencyContact" TEXT,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT;
