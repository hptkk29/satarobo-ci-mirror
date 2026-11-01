-- Notification v2 (kế hoạch docs/notification/00-ke-hoach-notification.md, 19/08/2026)
--
-- THUẦN THÊM CỘT + THÊM INDEX trên bảng đang có dữ liệu. KHÔNG đổi kiểu, KHÔNG bỏ cột,
-- KHÔNG đụng dữ liệu cũ (luật cứng Nền Hệ thống #4). Mọi cột mới đều nullable hoặc có
-- DEFAULT ⇒ code CŨ đang chạy song song vẫn ghi/đọc bình thường, không cần dừng app.
--
-- Vì sao không tách bảng `notifications` + `notification_recipients` như PRD gợi ý:
-- `StaffNotification` VỐN ĐÃ là bảng fan-out (mỗi dòng = một người nhận) và có ~15 nguồn
-- đang ghi vào nó trên prod. Tách đôi = migrate toàn bộ nguồn, đổi lấy một lợi ích
-- (khử trùng phần nội dung) mà quy mô hiện tại không cần.

ALTER TABLE "StaffNotification"
  ADD COLUMN IF NOT EXISTS "groupKey"       TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "priority"       INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "seenAt"         TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "entityType"     TEXT,
  ADD COLUMN IF NOT EXISTS "entityId"       TEXT,
  ADD COLUMN IF NOT EXISTS "aggregateCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "expiresAt"      TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "state"          TEXT NOT NULL DEFAULT 'ACTIVE';

-- Đường đọc chính của chuông: đếm badge + liệt kê panel theo trạng thái.
CREATE INDEX IF NOT EXISTS "StaffNotification_userId_state_readAt_createdAt_idx"
  ON "StaffNotification"("userId", "state", "readAt", "createdAt" DESC);

-- Đếm chưa đọc theo từng nhóm cho hàng chip lọc của panel.
CREATE INDEX IF NOT EXISTS "StaffNotification_userId_groupKey_readAt_idx"
  ON "StaffNotification"("userId", "groupKey", "readAt");
