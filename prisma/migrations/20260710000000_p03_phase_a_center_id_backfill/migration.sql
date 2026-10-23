-- #03 Pha A — thêm centerId cho ConversationMessage + backfill ReportCard.centerId.
--
-- ADDITIVE ONLY. Không đưa model nào vào SCOPED_MODELS trong pha này: scopedDb inject
-- `centerId IN (...)` sẽ ẨN NHẦM mọi dòng còn null. Pha B chỉ chạy sau khi prod đã
-- xác nhận 0 null (giống deploy-gate của #04 với Attendance).
--
-- EvaluationRound KHÔNG đụng: `centerId = NULL` ở đó là HỢP LỆ (vòng đánh giá toàn hệ
-- thống, scope != CENTER). Muốn scope nó cần semantics "null = global", làm ở pha B.

-- 1. ConversationMessage: thêm cột + index.
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "centerId" TEXT;
CREATE INDEX IF NOT EXISTS "ConversationMessage_centerId_idx" ON "ConversationMessage"("centerId");

-- 2. Backfill từ Enrollment (quan hệ bắt buộc, onDelete: Cascade → không mồ côi).
UPDATE "ConversationMessage" AS m
SET "centerId" = e."centerId"
FROM "Enrollment" AS e
WHERE m."enrollmentId" = e."id"
  AND m."centerId" IS NULL
  AND e."centerId" IS NOT NULL;

-- 3. Backfill ReportCard.centerId (cột đã tồn tại; đường tạo mới đã set từ enrollment,
--    dòng cũ có thể còn null).
UPDATE "ReportCard" AS r
SET "centerId" = e."centerId"
FROM "Enrollment" AS e
WHERE r."enrollmentId" = e."id"
  AND r."centerId" IS NULL
  AND e."centerId" IS NOT NULL;
