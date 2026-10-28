-- Lead.createdById — NGƯỜI NHẬP phiếu (chủ dự án chốt 23/08/2026).
--
-- Vì sao cần: Sale Hội sở được nhập lead và theo phiếu MÌNH nhập, nhưng KHÔNG
-- thấy phiếu người khác nhập. Trước đó danh tính người nhập chỉ nằm dưới dạng
-- CHỮ trong `Lead.note` ("Nhân viên nhập: HO.KD.001") ⇒ không lọc được, không
-- dựng nổi luật đó. `assignedToId` không thay thế được: phiếu do HO nhập vẫn tự
-- chia về Sale CƠ SỞ, nên người chăm khác người nhập.
--
-- THUẦN THÊM CỘT nullable trên bảng đang có dữ liệu PROD (luật cứng Nền Hệ
-- thống #4): không đổi kiểu, không bỏ cột, code cũ chạy song song vẫn ghi/đọc
-- bình thường. Quay lui = DROP COLUMN, không mất gì khác.
--
-- KHÔNG backfill: phiếu cũ để NULL. Suy ngược người nhập từ chuỗi trong `note`
-- là đoán — mã NV trong đó có thể đã đổi chủ, và đoán sai ở cột quyết định
-- QUYỀN NHÌN thì hoặc lộ phiếu người khác, hoặc giấu mất phiếu của chính họ.
-- NULL đọc đúng nghĩa: "không rõ ai nhập" ⇒ không ai nhận là của mình.
--
-- Cột TRẦN, không FK — cùng tiền lệ `orgUnitId` (PR-A).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- Đường đọc chính: "phiếu tôi nhập" (luôn kèm deletedAt IS NULL ở tầng app).
CREATE INDEX IF NOT EXISTS "Lead_createdById_idx" ON "Lead"("createdById");
