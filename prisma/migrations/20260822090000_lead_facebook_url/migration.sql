-- Ô "Link Facebook" của biểu mẫu /nhap-khach-hang (22/08/2026).
--
-- CHỈ THÊM 1 CỘT NULLABLE trên bảng đang có dữ liệu PROD: không backfill, không
-- đổi/bỏ cột nào (luật cứng #4). Rollback = ngừng ghi, cột nằm im — dữ liệu cũ
-- không suy suyển.
--
-- Vì sao là CỘT chứ không phải một dòng trong `note`: lead từ quảng cáo Facebook
-- thường CHỈ có link FB (chưa xin được số), nên đây là đường liên hệ chính của
-- Sale — phải bấm được, lọc được, chứ không lẫn trong khối ghi chú tự do.

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "facebookUrl" TEXT;
