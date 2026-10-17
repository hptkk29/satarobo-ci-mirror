-- EL-05 — hai cột thu hồi cho lượt ghi danh.
--
-- Đặc tả TrnEnrollment (§ bảng phải đúng nhất) có `revokedAt` + `revokeReason`
-- nhưng migration EL-03 sót mất. Phát hiện khi viết action thu hồi: trình biên
-- dịch báo cột không tồn tại.
--
-- CHỈ ADD, nullable, không đụng dữ liệu đang có (luật cứng #4).
--
-- Vì sao KHÔNG thêm trạng thái mới cho "rời tập luật ĐỘNG": hai đường thu hồi
-- (rời tập tự động / thu hồi tay) khác nhau ở LÝ DO, không khác ở trạng thái.
-- Đẻ thêm giá trị enum là bắt mọi câu truy vấn về sau phải nhớ cả hai.
ALTER TABLE "TrnEnrollment" ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMPTZ(6);
