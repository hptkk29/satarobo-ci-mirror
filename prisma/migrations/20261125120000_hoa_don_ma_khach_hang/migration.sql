-- Hoá đơn điện tử — MÃ KHÁCH HÀNG (kế toán yêu cầu 05/11/2026): "xuất hoá đơn cần mã KH để nhập vào, sau xuất ra đối chiếu cho dễ".
--
-- 1. `Order.invoiceCustomerCode` — mã khách hàng của người mua trên hoá đơn. NULL = chưa khai. Form tự điền sẵn từ mã học viên
--    (`Student.studentCode`), kế toán sửa được; tờ hoá đơn / nhà cung cấp CHỈ đọc thứ đã lưu ở cột này.
-- 2. `HoaDonDienTu.nguoiMuaMa` — bản chụp mã khách hàng LÚC CHỐT, để đối chiếu với phần mềm hoá đơn kể cả khi đơn sửa mã về sau.
--
-- CHỈ THÊM hai cột nullable, không default, không backfill. Idempotent. Không đụng bảng mới nên không có RLS cần bật.
-- ROLLBACK (an toàn khi chưa có hoá đơn nào mang mã; cột chỉ là dữ liệu bổ sung, mã cũ không đọc nó):
--   ALTER TABLE "HoaDonDienTu" DROP COLUMN IF EXISTS "nguoiMuaMa";
--   ALTER TABLE "Order"        DROP COLUMN IF EXISTS "invoiceCustomerCode";

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceCustomerCode" TEXT;
ALTER TABLE "HoaDonDienTu" ADD COLUMN IF NOT EXISTS "nguoiMuaMa" TEXT;
