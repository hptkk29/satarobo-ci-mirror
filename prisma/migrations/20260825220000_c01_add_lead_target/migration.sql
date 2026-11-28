-- C-01 — chỉ tiêu LEAD (số học sinh) theo tháng × cơ sở.
--
-- Migration ADD-ONLY: đúng một bảng MỚI. Không đụng cột nào của bảng đang có dữ liệu
-- (luật cứng #4). Song sinh với "RevenueTarget" — cùng hình dạng, khác đơn vị đo:
-- "targetAmount" là TIỀN, "targetCount" là SỐ HỌC SINH.
--
-- "centerId" NULL = chỉ tiêu TOÀN HỆ THỐNG (không phải "chưa gán cơ sở"). Postgres coi
-- NULL là DISTINCT trong unique index, nên hai dòng "toàn hệ thống" của cùng một kỳ vẫn
-- lọt được qua ràng buộc dưới — đường ghi phải findFirst + update thay vì upsert.

-- CreateTable
CREATE TABLE "LeadTarget" (
    "id" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "period" TEXT NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LeadTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadTarget_centerId_period_key" ON "LeadTarget"("centerId", "period");
CREATE INDEX "LeadTarget_period_idx" ON "LeadTarget"("period");
CREATE INDEX "LeadTarget_centerId_idx" ON "LeadTarget"("centerId");
CREATE INDEX "LeadTarget_orgUnitId_idx" ON "LeadTarget"("orgUnitId");
