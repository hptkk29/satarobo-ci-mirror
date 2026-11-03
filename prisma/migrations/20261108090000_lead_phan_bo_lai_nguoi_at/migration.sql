-- Lead nguội: đánh dấu lead được QLCS phân bổ lại để Sale thấy ở đầu danh sách /leads.
-- Chỉ THÊM cột trống — không đụng dữ liệu cũ, không cần backfill.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "phanBoLaiNguoiAt" TIMESTAMPTZ(6);
