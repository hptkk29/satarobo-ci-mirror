-- AI LEAD GATEWAY — BỘ QUY TẮC CÓ VERSION (Rule Builder, 10/11/2026).
-- Bối cảnh: cấu hình nghiệp vụ của Gateway (Page→cơ sở, tự tạo lead theo Page, SLA, người nhận thông báo/leo thang) trước đây ghi đè tại chỗ, không có lịch sử/khôi phục.
-- `AiLeadRuleSet` là ẢNH CHỤP BẤT BIẾN của toàn bộ cấu hình đó sau mỗi lần đổi (khuôn `AiLeadCatalogSnapshot`): chỉ INSERT, không UPDATE/DELETE. Khôi phục = tạo version MỚI mang nội dung cũ.
--
-- ⚠️ CHỈ THÊM: một bảng mới + một cột nullable. Không backfill, không DROP/ALTER cột cũ, không đụng bảng có dữ liệu PROD ngoài `AiLeadDraft` (bảng của chính gói này, chưa có dòng nào trên PROD).
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): `IF NOT EXISTS` cho cả bảng, chỉ mục và cột.
-- Bảng cấu hình TOÀN CỤC (như AiLeadCatalogSnapshot): không `centerId`/`orgUnitId`, không vào db-scope. Bật RLS (chỉ ENABLE).

CREATE TABLE IF NOT EXISTS "AiLeadRuleSet" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "reason" TEXT NOT NULL,
    "savedFromVersion" INTEGER,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AiLeadRuleSet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiLeadRuleSet_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadRuleSet_version_key" ON "AiLeadRuleSet"("version");

-- Phiên bản bộ quy tắc đã áp lúc hồ sơ được tạo (truy vết: hồ sơ/lead này theo luật nào). NULL = chưa có bộ quy tắc nào lúc đó.
ALTER TABLE "AiLeadDraft" ADD COLUMN IF NOT EXISTS "ruleSetVersion" INTEGER;

ALTER TABLE "AiLeadRuleSet" ENABLE ROW LEVEL SECURITY;
