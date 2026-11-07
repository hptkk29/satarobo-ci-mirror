-- S-2b (27/08/2026) — SỔ ĐỐI SOÁT LƯỢT GỬI TIN MESSENGER RA META.
--
-- Vì sao: trước đợt này `recordOutgoingMessage()` chỉ ghi một dòng `MessengerMessage`
-- rồi thôi — không có lời gọi nào ra Meta Send API. Người trực bấm "Trả lời", hệ thống
-- báo thành công, khách không nhận gì. Nay đường gửi đã nối (lib/crm/messenger-send.ts)
-- nên phải có chỗ ghi lượt gửi ĐÃ ĐI HAY CHƯA, và hỏng vì lý do gì.
--
-- CHỈ THÊM CỘT — không sửa, không bỏ, không đổi kiểu cột nào đang có (luật cứng #4 +
-- mẫu 2 pha của kho). Mọi cột nullable, không DEFAULT: hàng cũ và tin ĐẾN giữ NULL,
-- đọc ra đúng nghĩa "không có thông tin", KHÔNG phải "đã gửi thành công".
--
-- ⚠️ CHƯA CHẠY TRÊN BẤT KỲ DB NÀO (kể cả dev/test) — người vận hành chạy tay.
--    Nhắc: DB của môi trường `test` CHÍNH LÀ DB dev (CLAUDE.md).

ALTER TABLE "MessengerMessage" ADD COLUMN IF NOT EXISTS "sendStatus" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN IF NOT EXISTS "sentByUserId" TEXT;

-- Đối soát: "còn lượt gửi nào kẹt PENDING / hỏng FAILED không".
CREATE INDEX IF NOT EXISTS "MessengerMessage_sendStatus_sentAt_idx"
  ON "MessengerMessage" ("sendStatus", "sentAt");
