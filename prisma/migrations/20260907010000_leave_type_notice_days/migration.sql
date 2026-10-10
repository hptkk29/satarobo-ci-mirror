-- Hạn báo trước theo TỪNG LOẠI NGHỈ (đợt 2, chốt 07/09/2026). CHỈ THÊM một cột nullable.
--
-- Yêu cầu gốc là "phải xin nghỉ trước 1 ngày". Đặt một con số chung cho mọi loại thì hỏng ở
-- hai đầu: ma chay / ốm (BHXH) / thai sản không ai hẹn trước được ngày, còn nghỉ kết hôn thì
-- 1 ngày là quá ngắn để xếp người thay. Nên ngưỡng đi theo loại.
--
-- Nộp muộn hơn ngưỡng KHÔNG bị chặn — chặn chỉ làm mất dấu vết chứ không làm mất buổi nghỉ
-- (người ốm vẫn nghỉ, quản lý sẽ sửa thẳng ô trên lưới và hệ thống thôi biết đó là ốm hay
-- tang chế). Thay vào đó bắt buộc chỉ định NGƯỜI LÀM THAY, đúng mục đích chủ dự án nêu.
--
-- Giá trị mặc định cho 8 dòng đã seed do `db:seed:cham-cong --force` ghi, không đặt ở đây:
-- người vận hành có thể đã sửa tay trên màn Loại nghỉ.

ALTER TABLE "LeaveType" ADD COLUMN "noticeDays" INTEGER;
