-- CỔNG DỮ LIỆU AGENT — nợ kỹ thuật #20 (28/09/2026): hạn mức bản ghi nhạy cảm CAO theo ngày
-- thành TRẦN CỨNG.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): MỘT bảng MỚI. Không đụng bảng nào đang có dữ liệu, không
-- backfill. Rollback = ngừng ghi (bảng nằm im).
--
-- Vì sao cần bảng: trước đây cổng ĐẾM trên nhật ký (`AgentToolCall`, dòng OK của hôm nay) rồi
-- mới chạy công cụ — kiểm-rồi-mới-chạy. N lượt song song cùng đọc "còn chỗ" rồi cùng chạy ⇒
-- tổng trong ngày vượt trần tối đa (N−1) × maxRowsPerCall. Nhật ký chỉ có dòng SAU khi chạy nên
-- không giữ chỗ được. Bảng này là SỔ GIỮ CHỖ: mỗi lượt CAO giữ chỗ NGUYÊN TỬ trong MỘT câu SQL
-- (`lib/agents/gateway/han-muc-cao.ts`) trước khi chạy, rồi quyết toán theo số dòng thật.
--
-- Không mang centerId/orgUnitId: như mọi bảng của cổng, đây là sổ theo CLIENT, không phải dữ
-- liệu nghiệp vụ của một cơ sở.
CREATE TABLE IF NOT EXISTS "AgentDailyRowQuota" (
    "clientId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "usedRows" INTEGER NOT NULL DEFAULT 0,
    "reservedRows" INTEGER NOT NULL DEFAULT 0,
    "lastReservation" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AgentDailyRowQuota_pkey" PRIMARY KEY ("clientId", "day")
);

-- Sổ không có nghĩa khi không còn client (client thật không bao giờ bị xoá cứng — chỉ REVOKED).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AgentDailyRowQuota_clientId_fkey'
  ) THEN
    ALTER TABLE "AgentDailyRowQuota"
      ADD CONSTRAINT "AgentDailyRowQuota_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "AgentClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS: bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT LẦN). Chỉ
-- ENABLE, không FORCE, không policy — khuôn 20260825120000_lead_status_history.
ALTER TABLE "AgentDailyRowQuota" ENABLE ROW LEVEL SECURITY;
