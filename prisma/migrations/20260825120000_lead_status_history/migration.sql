-- GĐ1 — SỔ ĐỔI TRẠNG THÁI LEAD.
--
-- HOÀN TOÀN ADDITIVE trên bảng đang có dữ liệu PROD (luật cứng #4): một bảng MỚI
-- và ba CỘT NULLABLE. Không backfill, không đổi kiểu, không bỏ cột nào.
-- Rollback = ngừng ghi; bảng và cột nằm im, dữ liệu cũ không suy suyển.
--
-- Vì sao cần bảng riêng dù đã có `LeadActivity` loại STATUS_CHANGE:
--   1. `LeadActivity` là dòng thời gian cho NGƯỜI ĐỌC — nội dung tự do, ai cũng chèn
--      được, không ràng buộc cấu trúc. Tính tỷ lệ chuyển đổi trên đó là đếm văn xuôi.
--   2. Hai đường ghi của module học thử (`lib/trial/service.ts`) đổi trạng thái lead
--      mà CHƯA BAO GIỜ ghi activity — đúng đường có lưu lượng cao nhất. Lịch sử hiện
--      tại khuyết ngay ở chỗ đông nhất.
--   3. Tỷ lệ chuyển đổi đang được suy từ TRẠNG THÁI HIỆN TẠI, nên lead đã rớt biến
--      mất khỏi mọi bậc và mẫu số các bậc đầu bị thiếu.
--
-- ⚠️ Lịch sử QUÁ KHỨ không backfill được đầy đủ: chỉ dựng lại được phần đã có
-- `LeadActivity` type STATUS_CHANGE. Đừng hứa báo cáo hồi tố trọn vẹn.

-- ─── Cột mới trên Lead ───────────────────────────────────────────────────────
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMPTZ(6);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "droppedAtStage" "LeadStatus";
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "dropReason" TEXT;

-- Mốc đổi trạng thái ĐẦU TIÊN = lúc lead ra đời (bậc "Mới").
--
-- ⚠️ CỐ Ý tách khỏi câu ADD COLUMN ở trên, không viết `ADD COLUMN ... DEFAULT ...`:
-- gộp vào thì Postgres BACKFILL default cho toàn bộ lead CŨ, tức khai man rằng mọi
-- lead vừa đổi trạng thái đúng lúc chạy migration — hỏng luôn cái đồng hồ "nằm im bao
-- lâu ở bậc hiện tại" mà cột này sinh ra để đo. Tách ra thì dòng cũ giữ NULL (đúng:
-- không suy ngược được), chỉ dòng INSERT MỚI mới nhận mốc.
--
-- Vì sao đặt ở DB chứ không sửa code: không đường `lead.create` nào set field này, mà
-- chúng nằm rải nhiều nơi (form admin, import Excel, webhook, biểu mẫu công khai) —
-- sửa từng chỗ là chắc chắn sót một đường. Default ở DB phủ cả đường ghi SQL thô.
ALTER TABLE "Lead" ALTER COLUMN "statusChangedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- ─── Bảng sổ ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LeadStatusHistory" (
  "id"            TEXT NOT NULL,
  "leadId"        TEXT NOT NULL,
  "fromStatus"    "LeadStatus",
  "toStatus"      "LeadStatus" NOT NULL,
  "changedById"   TEXT,
  "changedByName" TEXT,
  "source"        TEXT NOT NULL,
  "reason"        TEXT,
  "centerId"      TEXT,
  "orgUnitId"     TEXT,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadStatusHistory_pkey" PRIMARY KEY ("id")
);

-- Xoá lead thì sổ đi theo — sổ không có ý nghĩa độc lập với lead.
-- Cố ý KHÔNG có FK tới User: `changedById` null khi hệ thống tự đổi (cron, webhook,
-- tiến độ điểm danh), và xoá nhân sự không được phép cascade mất lịch sử.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LeadStatusHistory_leadId_fkey'
  ) THEN
    ALTER TABLE "LeadStatusHistory"
      ADD CONSTRAINT "LeadStatusHistory_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LeadStatusHistory_leadId_createdAt_idx"
  ON "LeadStatusHistory"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadStatusHistory_toStatus_createdAt_idx"
  ON "LeadStatusHistory"("toStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadStatusHistory_centerId_idx"
  ON "LeadStatusHistory"("centerId");
CREATE INDEX IF NOT EXISTS "LeadStatusHistory_orgUnitId_idx"
  ON "LeadStatusHistory"("orgUnitId");

-- RLS: bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT
-- LẦN, và 31 bảng sinh sau nó đã từng nằm trần cho anon/authenticated — sự cố
-- 09/08). Không có dòng này thì sổ trạng thái lead phơi qua PostgREST.
ALTER TABLE "LeadStatusHistory" ENABLE ROW LEVEL SECURITY;
