-- SNAPSHOT SĨ SỐ BIÊN CHẾ của buổi học (chốt chủ dự án 07/09/2026).
-- Căn cứ: SR.QD.230 PL04 §A.1 — đơn giá lớp/tháng phân bậc theo sĩ số 1-4 / 5-8 / 9-12 / ≥13.
-- Toàn bộ ADDITIVE: 1 enum mới, 3 cột nullable. Không cột nào bị đổi hay bỏ.
--
-- VÌ SAO GHI CỨNG chứ không join động từ danh sách lớp: học viên vào lớp tháng 10 mà làm đổi số
-- buổi tháng 8 là đổi cả kỳ lương ĐÃ CHỐT. Cùng loại lỗi với bút toán điều chỉnh bên thanh toán.
--
-- VÌ SAO KHÔNG dùng điểm danh: số tính tiền phải biết TRƯỚC khi buổi diễn ra. Lấy điểm danh thì
-- lương giáo viên dao động theo học viên nghỉ ốm, và tạo động cơ ngược.
--
-- VÌ SAO CÓ CỘT NGUỒN: backfill dữ liệu cũ không có cách suy nào đúng cho mọi dòng (đo 07/09) —
-- đếm ghi danh thì thừa người một chiều, đếm điểm danh thì thiếu người một chiều với buổi trước
-- 07/08/2026. Trộn số đo với số suy đoán vào một cột không nhãn là để người mở báo cáo tin nhầm.

CREATE TYPE "ClassRosterSource" AS ENUM ('SNAPSHOT', 'FROM_ATTENDANCE', 'FROM_ENROLLMENT', 'UNKNOWN');

ALTER TABLE "ClassSession" ADD COLUMN "rosterSize"   INTEGER;
ALTER TABLE "ClassSession" ADD COLUMN "rosterSource" "ClassRosterSource";
ALTER TABLE "ClassSession" ADD COLUMN "rosterAt"     TIMESTAMPTZ(6);

-- KHÔNG backfill ở đây. Suy giá trị cho buổi cũ là việc có rủi ro sai một chiều, cần chủ dự án
-- duyệt cách suy trước khi chạy, và phải chạy được ở chế độ thử trước. Nó sẽ là script riêng
-- chạy tay, không phải một câu UPDATE nằm im trong migration.
