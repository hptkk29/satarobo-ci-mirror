-- NGƯỜI TẠO ĐƠN (31/08/2026) — cột danh sách /admin/orders.
--
-- Thêm ĐÚNG MỘT cột nullable, không FK (cùng lối với `confirmedByUserId`,
-- `Payment.recordedById`: xoá nhân sự không được kéo theo hay chặn đơn hàng).
-- KHÔNG backfill: đơn tạo trước ngày này không có nguồn nào suy ngược ra người tạo
-- (AuditLog chưa từng ghi sự kiện tạo đơn), nên để NULL và màn hình in "—".
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
