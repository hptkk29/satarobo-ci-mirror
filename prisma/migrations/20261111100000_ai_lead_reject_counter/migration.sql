-- AI LEAD GATEWAY — BỘ ĐẾM YÊU CẦU BỊ TỪ CHỐI (11/11/2026).
-- Bối cảnh: lỗi 400/401/429… bị loại TRƯỚC bảng yêu cầu nên Trung tâm kết nối không có số thật ("lỗi từ chối: chưa đo"). Bảng này chỉ chứa SỐ ĐẾM GỘP — theo ngày · endpoint · mã lỗi · Agent (chỉ khi chữ ký đúng).
-- KHÔNG có cột cho IP, header, thân yêu cầu, chữ ký, nonce, PSID hay Page: không thể bị dùng để truy ngược khách hay lộ bí mật xác thực. Bảng chỉ được GHI khi tham số `ai.rejectLogEnabled` bật (mặc định TẮT).
--
-- ⚠️ CHỈ THÊM: một bảng mới, không đụng bảng có dữ liệu. Không backfill.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): `IF NOT EXISTS`. Bảng cấu hình/đo đạc TOÀN CỤC: không `centerId`/`orgUnitId`. Bật RLS (chỉ ENABLE).

CREATE TABLE IF NOT EXISTS "AiLeadRejectCounter" (
    "day" DATE NOT NULL,
    "endpoint" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "agentId" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstAt" TIMESTAMPTZ(6) NOT NULL,
    "lastAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AiLeadRejectCounter_pkey" PRIMARY KEY ("day", "endpoint", "code", "agentId"),
    CONSTRAINT "AiLeadRejectCounter_count_check" CHECK ("count" >= 0)
);

ALTER TABLE "AiLeadRejectCounter" ENABLE ROW LEVEL SECURITY;
