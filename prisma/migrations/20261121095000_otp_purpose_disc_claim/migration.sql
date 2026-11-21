-- DISC × SataRobo — thêm mục đích OTP "nhận bài DISC".
-- Tách file riêng vì ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong CÙNG transaction
-- với câu lệnh dùng nó; migration này chỉ thêm giá trị, không đụng dữ liệu nào.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'DISC_CLAIM';
