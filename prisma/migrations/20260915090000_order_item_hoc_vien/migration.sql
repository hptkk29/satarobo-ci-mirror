-- Chủ dự án 15/09/2026: "phụ huynh có 2 con và học 2 khoá khác nhau thì phải tạo 2 đơn
-- à? làm thêm phần này."
--
-- ĐO TRƯỚC KHI SỬA. `Order` đã có `items OrderItem[]` và cổng server
-- `createOrderManualAction` đã nhận `items: z.array(orderItemSchema).min(1).max(20)` —
-- tức NHIỀU DÒNG HÀNG vốn đã chạy được. Nút thắt nằm ở hai chỗ:
--   1. Form `/orders/new` chốt cứng MỘT dòng (`// Single item` — một itemRefId, một
--      unitPrice, một coachFormat).
--   2. `OrderItem` có `enrollmentId` · `packageId` · `examAttemptId` · `productId` nhưng
--      KHÔNG có chỗ nào nói dòng này là của CON NÀO. Lúc tạo đơn thủ công thì ghi danh
--      CHƯA tồn tại (nó do convert-lead sinh sau), nên `enrollmentId` luôn null ⇒ một
--      đơn hai con là hai dòng không phân biệt được.
--
-- Cột này vá đúng điểm 2.
--
-- ⚠️ NULLABLE và KHÔNG backfill. Ba lý do, không phải sự lười:
--   · Đơn SẢN PHẨM (mua bộ robot) không thuộc về học viên nào — null là câu trả lời ĐÚNG,
--     không phải dữ liệu thiếu.
--   · Khách vãng lai: con chưa có bản ghi `Student` lúc tạo đơn. Tên con lúc đó nằm ở
--     `itemName`/`itemDescription`; gán bừa một `studentId` là bịa một quan hệ.
--   · 493 đơn cũ trên DB nghiệm thu đều một con — suy ngược từ `Order.studentId` thì
--     ĐÚNG với chúng, nhưng viết một backfill đoán-hộ cho dữ liệu cũ là mở đường cho
--     lần sau ai đó tin con số suy ra như con số khai.
--
-- ⚠️ `onDelete: SetNull` chứ KHÔNG Cascade/Restrict — theo đúng nếp `productId` ngay
-- trên nó. Xoá một học viên KHÔNG được kéo theo dòng hàng (đó là sổ tiền), và cũng không
-- được CHẶN việc xoá học viên (`Enrollment.deletedAt` mới là sổ sách, xem memory
-- "Enrollment.deletedAt là sổ sách").
--
-- ⚠️ KHÔNG đụng `Order.studentId`. Đơn NHIỀU CON để cột đó null — và đó là giá trị hợp
-- lệ sẵn có, mọi đường đọc đã xử null (`ensureParentAccountForOrder` lấy SĐT từ
-- `customerPhone`, `chonGhiDanhChoKhoan` rơi về nhánh "mơ hồ ⇒ để người quyết"). Ép một
-- con làm "con chính" là dựng một sự thật không có thật.

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "studentId" TEXT;

CREATE INDEX IF NOT EXISTS "OrderItem_studentId_idx" ON "OrderItem"("studentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_studentId_fkey'
  ) THEN
    ALTER TABLE "OrderItem"
      ADD CONSTRAINT "OrderItem_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
