-- SataCoin (M2-SC, 19/11/2026): khoá chống ghi trùng cho MỘT sự kiện cộng/trừ coin.
-- Additive: thêm 1 cột nullable + 1 chỉ mục duy nhất. KHÔNG backfill — giao dịch cũ giữ eventKey NULL (= "không khoá").
-- Postgres coi NULL là khác nhau ⇒ nhiều giao dịch eventKey NULL của cùng học viên vẫn hợp lệ.
-- Sổ cái vẫn BẤT BIẾN: migration này không sửa/xoá dòng nào.
ALTER TABLE "SataCoinTransaction" ADD COLUMN IF NOT EXISTS "eventKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SataCoinTransaction_studentId_eventKey_key" ON "SataCoinTransaction"("studentId", "eventKey");
