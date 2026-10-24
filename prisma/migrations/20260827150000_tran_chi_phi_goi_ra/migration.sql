-- TRẦN CHI PHÍ THÁNG cho lời gọi ra ngoài (chốt 27/08/2026).
-- Zalo 2tr · cước gọi 3tr · chấm điểm AI 1tr. Ba con số nằm ở SystemSetting
-- (outbound.*MonthlyCapVnd), KHÔNG ở đây — bảng này chỉ giữ SỐ ĐÃ TIÊU.
--
-- Thuần THÊM MỚI: không đụng bảng nào đang có dữ liệu (luật cứng #4 Nền Hệ thống).
-- DB trống ⇒ mọi trục coi như đã tiêu 0đ, nên chạy migration này không đổi hành vi
-- của bất cứ luồng nào đang chạy.

CREATE TABLE "OutboundSpendCounter" (
    "period" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "spentVnd" INTEGER NOT NULL DEFAULT 0,
    "chargeCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "warnedAt" TIMESTAMPTZ(6),
    "blockedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundSpendCounter_pkey" PRIMARY KEY ("period","axis")
);

-- Khoá chính (period, axis) đã phục vụ đường ĐẶT CHỖ (khoá đúng một dòng).
-- Index này cho đường ĐỌC báo cáo "cả kỳ" (`docTinhHinhNganSach`).
CREATE INDEX "OutboundSpendCounter_period_idx" ON "OutboundSpendCounter"("period");
