-- Việc #1 (chủ dự án 14/09/2026): "thiếu các trường thông tin của khách hàng để xuất hoá
-- đơn khi kế toán duyệt".
--
-- ĐO TỪ BA TỜ HOÁ ĐƠN THẬT (E:\websatarobo data\hoadon). Khối "người mua" trên mẫu gồm:
--   Họ tên người mua hàng · Tên đơn vị · MST/CCCD chủ hộ · Địa chỉ · CCCD/Hộ chiếu ·
--   Hình thức thanh toán
-- `Order` đã có: customerName · customerPhone · customerEmail · customerAddress ·
-- customerWard · customerCity · customerCccd · paymentMethodId.
-- THIẾU đúng bốn thứ, thêm ở đây:
--   invoiceBuyerName  — người ĐỨNG TÊN hoá đơn có thể KHÁC người đặt đơn (bố đặt, hoá đơn
--                       ghi tên mẹ để khớp hộ khẩu/công ty). Trên 1C26MNV-13 tên người mua
--                       là "Phan Thị Hồng" còn học viên là "Nguyễn Đức Huy Hoàng".
--   invoiceCompanyName— ô "Tên đơn vị" (khách là công ty). Cả ba tờ mẫu đều TRỐNG ô này,
--                       nhưng ô tồn tại trên mẫu ⇒ có ca dùng, và thiếu cột là kế toán
--                       phải gõ tay ngoài hệ thống.
--   invoiceTaxCode    — "MST/CCCD chủ hộ" / "Mã số thuế" của NGƯỜI MUA (khác MST pháp nhân
--                       bán, thứ nằm ở cấu hình vận hành chứ không ở đơn).
--   invoiceEmail      — nơi nhận hoá đơn điện tử. Tách khỏi `customerEmail` vì email nhận
--                       hoá đơn thường là email kế toán của khách, không phải email liên hệ.
--
-- ⚠️ TẤT CẢ ĐỀU NULLABLE, KHÔNG backfill, KHÔNG default. Đây là cột SNAPSHOT giấy tờ: để
-- trống nghĩa là "chưa khai", và mọi đường đọc phải tự rơi về cột `customer*` tương ứng.
-- Đặt default (ví dụ copy `customerName`) là biến "chưa khai" thành "đã khai đúng bằng tên
-- người đặt" — sai im lặng trên một tờ giấy pháp lý.
--
-- ⚠️ KHÔNG thêm cột tiền nào. Thuế suất / quy ước giá / pháp nhân là CẤU HÌNH
-- (`lib/finance/hoa-don/phap-nhan.ts`), không phải cột trên đơn — chốt cứng vào đơn là
-- mỗi lần BGĐ đổi mức thuế lại phải chạy migration.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceBuyerName"   TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceCompanyName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceTaxCode"     TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceEmail"       TEXT;
