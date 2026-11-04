-- D-02 — chỉ tiêu NGÂN SÁCH QUẢNG CÁO theo tháng × cơ sở.
--
-- Migration ADD-ONLY: đúng một bảng MỚI. Không đụng cột nào của bảng đang có dữ liệu
-- (luật cứng #4). Bảng thứ ba của bộ ba chỉ tiêu, cùng hình dạng "RevenueTarget"
-- (tiền THU) và "LeadTarget" (đầu NGƯỜI); ở đây đo tiền CHI cho quảng cáo.
--
-- KHÔNG đụng "AdsInsightDaily" / "MarketingCostPeriod": bảng này chứa con số NGƯỜI ĐẶT
-- RA, hai bảng kia chứa con số ĐÃ TIÊU. Trộn vào nhau là mất khả năng nói "tiêu vượt".
--
-- "centerId" NULL = chỉ tiêu TOÀN HỆ THỐNG (không phải "chưa gán cơ sở", và cũng không
-- phải nhóm CHƯA PHÂN BỔ của D-06). Postgres coi NULL là DISTINCT trong unique index,
-- nên hai dòng "toàn hệ thống" của cùng một kỳ vẫn lọt được qua ràng buộc dưới — đường
-- ghi phải findFirst + update thay vì upsert.
--
-- "targetAmount" là INTEGER (int4, trần 2.147.483.647 đồng). Đường ghi chặn trước ở
-- ADS_BUDGET_TARGET_AMOUNT_MAX để người nhập thấy lỗi ngay tại ô, không phải ở tầng DB.

-- CreateTable
CREATE TABLE "AdsBudgetTarget" (
    "id" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "period" TEXT NOT NULL,
    "targetAmount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AdsBudgetTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdsBudgetTarget_centerId_period_key" ON "AdsBudgetTarget"("centerId", "period");
CREATE INDEX "AdsBudgetTarget_period_idx" ON "AdsBudgetTarget"("period");
CREATE INDEX "AdsBudgetTarget_centerId_idx" ON "AdsBudgetTarget"("centerId");
CREATE INDEX "AdsBudgetTarget_orgUnitId_idx" ON "AdsBudgetTarget"("orgUnitId");
