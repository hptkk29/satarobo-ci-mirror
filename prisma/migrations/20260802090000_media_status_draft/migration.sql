-- Kho ảnh buổi học: DRAFT = GV upload cả loạt vào kho, CHƯA chọn gửi phụ huynh.
-- Additive-only (2-phase); portal chỉ query APPROVED nên DRAFT không bao giờ lộ.
ALTER TYPE "MediaStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
