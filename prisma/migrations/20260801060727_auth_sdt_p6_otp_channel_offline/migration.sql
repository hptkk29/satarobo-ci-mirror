-- AUTH-SĐT P6 — kênh OTP "cấp tại quầy" (mã đọc trực tiếp cho phụ huynh khi ZNS chết).
-- Additive thuần: chỉ thêm một value vào enum, không đụng bảng nào.
--
-- ⚠️ `prisma migrate dev` sinh kèm 12 lệnh `ALTER COLUMN ... SET DATA TYPE
-- TIMESTAMP(3)` trên các bảng LMS — đó là DRIFT của DB test local, KHÔNG phải
-- thay đổi của phase này. Đã gỡ bằng tay: để nguyên là đổi kiểu cột trên PROD
-- một cách âm thầm khi deploy.
ALTER TYPE "OtpChannel" ADD VALUE IF NOT EXISTS 'OFFLINE';
