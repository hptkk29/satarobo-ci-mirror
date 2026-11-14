-- PHIÊN A — `Payment` có đường tới DÒNG HÀNG (tức tới CON).
--
-- Chủ dự án chốt 16/09/2026: *"Payment: đảm bảo có đường tới orderItem (thêm orderItemId
-- nullable nếu chưa có)."*
--
-- ADDITIVE thuần trên bảng đang có dữ liệu PROD (luật cứng #4): một cột NULLABLE + một FK +
-- một chỉ mục. Không backfill, không đổi kiểu, không bỏ cột. Rollback = ngừng ghi; mọi dòng cũ
-- giữ NULL và hành vi y như trước.
--
-- ═══ VÌ SAO `enrollmentId` KHÔNG ĐỦ, DÙ NÓ ĐÃ CÓ ═══
-- `Payment.enrollmentId` là đường tới ghi danh, và ghi danh ĐÚNG hạt "một con × một khoá".
-- Nhưng nó sinh ra QUÁ MUỘN: `/orders/new` không tạo `Enrollment` nào — ghi danh do
-- `convert-lead` đúc ra SAU khi chốt. Nên trong toàn bộ quãng "đơn đã tạo, chưa chốt lead" —
-- đúng quãng mà phụ huynh chuyển tiền đợt 1 — KHÔNG có gì để gắn tiền vào một đứa trẻ cụ thể.
--
-- Đo được: 18 đơn / 24 khoản / 178.544.000đ trên prod đang ở đúng tình trạng đó
-- (`Payment.enrollmentId IS NULL`).
--
-- `orderItemId` lấp đúng quãng ấy: dòng hàng có NGAY từ lúc tạo đơn.
--
-- ═══ HAI CỘT SỐNG CHUNG, KHÔNG THAY THẾ NHAU ═══
--   · `orderItemId`  — con nào trên ĐƠN. Có từ lúc tạo đơn. Là hạt của công nợ theo con.
--   · `enrollmentId` — ghi danh nào. Có sau khi chốt. Là hạt của học bạ, hoàn tiền, hoa hồng.
-- Sau khi chốt lead thì một khoản có CẢ HAI. Đừng bỏ cột nào: bỏ `enrollmentId` là cắt đường
-- tới học bạ; bỏ `orderItemId` là quay lại đúng lỗ 178 triệu.
--
-- ⚠️ `RESTRICT` chứ không `SetNull` (khác `enrollmentId` ngay bên cạnh, và khác có chủ ý):
-- `enrollmentId` để `SetNull` vì xoá ghi danh là việc học vụ, không được kéo sổ tiền theo. Còn
-- dòng hàng thì KHÔNG có đường xoá nào trong mã chạy thật (`grep "orderItem\.delete"` → chỉ
-- `scripts/cleanup-test-data.ts`), nên `RESTRICT` không chặn ai; đổi lại nó bảo đảm một khoản
-- tiền không bao giờ âm thầm mất dấu con. Con nghỉ học thì HUỶ dòng, không xoá dòng.

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "orderItemId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_orderItemId_fkey'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Payment_orderItemId_idx" ON "Payment"("orderItemId");
