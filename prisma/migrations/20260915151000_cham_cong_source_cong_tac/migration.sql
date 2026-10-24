-- PHẦN A — nguồn lượt chấm `CONG_TAC`.
--
-- Chốt của chủ dự án: "Đường công tác là ĐƯỜNG THỨ HAI, không sửa đường QR; có source
-- riêng trong StaffTimeLog để phân biệt được."
--
-- Không có nó thì lượt công tác lẫn với lượt QR ở mọi phép đo về sau, và câu hỏi "ai bấm
-- tay, ai quét thật" không trả lời được bằng dữ liệu — đúng lớp lỗi `completedById` đã mắc
-- (một cột trông như phân biệt được mà không phân biệt gì).
--
-- `ADD VALUE` không khoá bảng và không đụng dòng nào đang có.

ALTER TYPE "StaffTimeLogSource" ADD VALUE IF NOT EXISTS 'CONG_TAC';
