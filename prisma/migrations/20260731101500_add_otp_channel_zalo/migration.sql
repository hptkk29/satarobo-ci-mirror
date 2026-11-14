-- AUTH-SĐT P3 — thêm kênh ZALO cho OTP (provider cắm ở P4).
--
-- Postgres rule: enum value mới KHÔNG dùng được trong CÙNG transaction tạo ra
-- nó → migration này CHỈ ADD value, tách riêng khỏi migration đổi bảng User
-- (tiền lệ: 20260516153636_add_adjustment_enum_values).
ALTER TYPE "OtpChannel" ADD VALUE IF NOT EXISTS 'ZALO';
