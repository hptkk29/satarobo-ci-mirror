-- 09/11/2026 — Form QR thu thập thông tin người mua: PHỤ HUYNH CÓ NHIỀU CON (chủ dự án: "làm c — danh sách từng con").
--
-- Khối học viên của đơn từ trước chỉ chứa MỘT em (Order.invoiceStudentName/Dob/Cccd = em thứ nhất, giữ nguyên). Các em còn lại
-- lưu ở cột JSON này: mảng [{ "ten": "...", "ngaySinh": "yyyy-mm-dd"|null, "cccd": "..."|null }], tối đa 5 phần tử, do lib/finance/hoa-don/hoc-vien-them.ts kiểm.
--
-- CỘNG THÊM, nullable, KHÔNG default, KHÔNG backfill ("NULL = chưa khai thêm em nào"). Chứa CCCD ⇒ PII: che theo orders:view-pii như invoiceStudentCccd.
-- Không bảng mới ⇒ không cần RLS, không đụng SCOPED_MODELS / BACKFILL_SPECS (cột thuộc Order, đã nằm trong cách ly cơ sở của Order).
-- Chạy TAY trên PROD (luật cứng #4) TRƯỚC khi deploy bản mã dùng cột này.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceHocVienThem" JSONB;
