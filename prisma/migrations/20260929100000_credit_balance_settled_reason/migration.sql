-- Gỡ gắn giao dịch ⇒ tiền thừa của giao dịch đó được ĐÁNH DẤU "đã xử lý — do gỡ gắn"
-- (chủ dự án chốt 29/09/2026). `settledAt` + `settledById` đã có; thiếu LÝ DO.
-- CHỈ THÊM một cột cho phép trống ⇒ mọi dòng cũ giữ nguyên, không đổi ý nghĩa dòng nào.
ALTER TABLE "CreditBalance" ADD COLUMN IF NOT EXISTS "settledReason" TEXT;
