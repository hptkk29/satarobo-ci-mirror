-- BGĐ 31/07 — cấp/reset mật khẩu bởi admin → bắt đổi mật khẩu lần đăng nhập kế tiếp.
-- Additive, default false → không ảnh hưởng user hiện hữu.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
