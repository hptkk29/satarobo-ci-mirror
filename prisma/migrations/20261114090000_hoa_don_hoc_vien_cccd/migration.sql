-- 01/11/2026 — Khối "Người mua trên hoá đơn" nhập đủ 8 ô (chủ dự án: "đảo luật đi — lưu ở trên
-- đơn và link data sang hồ sơ học viên").
--
-- ĐẢO CÓ CHỦ ĐÍCH luật "KHÔNG lưu giấy tờ tùy thân học viên" (CLAUDE.md) CHỈ cho CCCD học viên
-- trên hoá đơn: cột được che theo `orders:view-pii` / `payments:view-pii` và nằm trong luồng
-- xoá NĐ13 (lib/compliance/erasure.ts).
--
-- Thêm (toàn bộ CỘNG THÊM, nullable, KHÔNG backfill, KHÔNG default — "để trống = chưa khai",
-- mọi đường đọc tự rơi về hồ sơ / cột customer* tương ứng):
--   Order.invoiceStudentName — tên học viên in trên hoá đơn (snapshot)
--   Order.invoiceStudentDob  — ngày sinh học viên (DATE, đọc/ghi qua lib/time/vn.ts)
--   Order.invoiceStudentCccd — CCCD học viên
--   Order.invoiceParentPhone — SĐT ba/mẹ trên hoá đơn. CỐ Ý KHÔNG dùng customerPhone: cột đó là
--                              chìa đối khớp tiền theo SĐT (payos-ingest) — sửa nó ở màn hoá đơn
--                              là đổi cách tiền về khớp đơn.
--   Student.nationalId       — CCCD học viên trên hồ sơ (cùng nghĩa Student.parentNationalId
--                              nhưng của CHÍNH em)

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceStudentName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceStudentDob"  DATE;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceStudentCccd" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceParentPhone" TEXT;

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "nationalId" TEXT;
