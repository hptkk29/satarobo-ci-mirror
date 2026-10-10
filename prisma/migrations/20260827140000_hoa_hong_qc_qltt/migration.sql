-- Hoa hồng QC 1% + Quản lý trung tâm 2% — người hưởng gắn theo CƠ SỞ, CÓ HIỆU LỰC
-- THEO THỜI GIAN (chủ dự án chốt 27/08/2026).
--
-- THUẦN THÊM (additive), KHÔNG đụng dữ liệu đang có:
--   • `Center.managerUserId` nullable — cơ sở cũ chưa khai; "bắt buộc khi tạo cơ sở
--     mới" ép ở tầng validator, KHÔNG phải NOT NULL ở DB (NOT NULL sẽ chặn deploy vì
--     3 cơ sở PROD đang có giá trị NULL).
--   • `Center.managerName` GIỮ NGUYÊN — nếp hai pha: thêm cột liên kết trước, bỏ chuỗi
--     tên sau khi ổn định. ĐỪNG drop trong migration này.
--   • `CenterCommissionAssignee` là bảng MỚI, rỗng khi lên ⇒ không cần backfill. Hệ quả
--     ngay sau deploy: hai tầng đó vẫn TREO (đúng như trước) cho tới khi người vận hành
--     nhập phân công ở /admin/crm/commission/nguoi-huong.
--
-- Bảng mới mang CẢ HAI cột đơn vị (`centerId` + `orgUnitId`) theo luật cứng Nền Hệ
-- thống #3; `orgUnitId` được điền tự động bởi lib/org/dual-write.ts nên không có bước
-- backfill nào ở đây.

-- CreateEnum
CREATE TYPE "CenterCommissionRole" AS ENUM ('QC', 'QL_TT');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "managerUserId" TEXT;

-- CreateTable
CREATE TABLE "CenterCommissionAssignee" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "role" "CenterCommissionRole" NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CenterCommissionAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CenterCommissionAssignee_centerId_role_effectiveFrom_idx" ON "CenterCommissionAssignee"("centerId", "role", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CenterCommissionAssignee_userId_idx" ON "CenterCommissionAssignee"("userId");

-- CreateIndex
CREATE INDEX "CenterCommissionAssignee_orgUnitId_idx" ON "CenterCommissionAssignee"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "CenterCommissionAssignee_centerId_role_userId_effectiveFrom_key" ON "CenterCommissionAssignee"("centerId", "role", "userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Center_managerUserId_idx" ON "Center"("managerUserId");

-- AddForeignKey
ALTER TABLE "Center" ADD CONSTRAINT "Center_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterCommissionAssignee" ADD CONSTRAINT "CenterCommissionAssignee_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterCommissionAssignee" ADD CONSTRAINT "CenterCommissionAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
