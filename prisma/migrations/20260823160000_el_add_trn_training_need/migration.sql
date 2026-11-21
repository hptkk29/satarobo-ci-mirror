-- EL-08 — phiếu nhu cầu đào tạo (B1, §8.1).
--
-- CHỈ ADD: 1 enum + 1 bảng + index + 1 khoá ngoại trên cột `TrnProgram.needId`
-- vốn ĐÃ TỒN TẠI từ EL-03 (khi đó là cột trần vì bảng đích chưa có).
--
-- Vì sao bảng này phải có ở GĐ1 chứ không lùi: BA §22.1 xếp bước "Nhu cầu" sang
-- giai đoạn sau, trong khi chính §8.1 viết "không được tạo chương trình nếu
-- không gắn phiếu nhu cầu đã duyệt". Không có bảng thì luật kia không thi hành
-- được, và nó sẽ lặng lẽ thành một câu chữ không ai theo.
--
-- Khoá ngoại dùng ON DELETE SET NULL: xoá một phiếu nhu cầu KHÔNG được kéo theo
-- chương trình đã dựng trên nó — chương trình là thứ có người đang học.

-- CreateEnum
CREATE TYPE "TrnTrainingNeedStatus" AS ENUM ('NEW', 'APPROVED');

-- CreateTable
CREATE TABLE "TrnTrainingNeed" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "targetGroupText" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expectedOutcome" TEXT NOT NULL,
    "proposedQuarter" TEXT NOT NULL,
    "status" "TrnTrainingNeedStatus" NOT NULL DEFAULT 'NEW',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrnTrainingNeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrnTrainingNeed_code_key" ON "TrnTrainingNeed"("code");

-- CreateIndex
CREATE INDEX "TrnTrainingNeed_status_createdAt_idx" ON "TrnTrainingNeed"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TrnTrainingNeed_orgUnitId_idx" ON "TrnTrainingNeed"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnTrainingNeed_centerId_idx" ON "TrnTrainingNeed"("centerId");

-- AddForeignKey
ALTER TABLE "TrnProgram" ADD CONSTRAINT "TrnProgram_needId_fkey" FOREIGN KEY ("needId") REFERENCES "TrnTrainingNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
