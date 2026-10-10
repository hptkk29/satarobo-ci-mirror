-- ĐƠN TỪ · ĐỢT 11 bổ sung — huỷ đơn "Nghỉ buổi dạy" đã duyệt (08/10/2026).
-- Buổi BÙ do một đơn sinh ra mang id đơn đó, để lượt huỷ đơn tìm ĐÚNG buổi bù của mình — không đoán
-- "buổi cuối cùng của lớp". NULL = buổi không do đơn từ sinh (mọi buổi cũ, buổi xếp tay).
-- ADDITIVE (luật cứng #4): cột NULLABLE + chỉ mục, không backfill. Chạy lại được.
ALTER TABLE "ClassSession" ADD COLUMN IF NOT EXISTS "sourceWorkRequestId" TEXT;
CREATE INDEX IF NOT EXISTS "ClassSession_sourceWorkRequestId_idx" ON "ClassSession"("sourceWorkRequestId");
