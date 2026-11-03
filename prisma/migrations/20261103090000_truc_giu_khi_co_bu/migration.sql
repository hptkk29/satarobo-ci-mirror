-- PR6 lưới phân công GV (chủ dự án 24/10/2026): GV đang trực được book học bù ⇒ QLCS quyết "GV còn trực phần còn lại của ca không".
-- Giữ trực ⇒ id case học bù được ghi vào mảng này (ô lưới thành TD). Bỏ trực ⇒ dòng trực bị huỷ qua `huyTruc` (không dùng cột này).
-- Chưa ai quyết ⇒ lưới KHÔNG tự suy TD (cảnh báo CAN_QUYET_TRUC). Chỉ THÊM cột, mặc định rỗng — không đổi dữ liệu có sẵn.
ALTER TABLE "OperationsDutyAssignment" ADD COLUMN IF NOT EXISTS "keepWithMakeupCaseIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
