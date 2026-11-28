-- ĐƠN TỪ · ĐỢT 1 — THU HỒI ĐƠN CHƯA DUYỆT (08/10/2026, docs/cham-cong/KE-HOACH-DON-TU-THEO-BA.md).
--
-- Chủ dự án chốt (Q-2): CHỈ người nộp thu hồi được, và chỉ khi đơn còn PENDING.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): một giá trị enum nối cuối + một cột NULLABLE. Rollback = ngừng ghi.
-- Giá trị enum vừa ADD VALUE chưa dùng được trong cùng giao dịch ⇒ file này KHÔNG nhắc 'WITHDRAWN' ở
-- câu nào khác (không default, không backfill). Khuôn: 20260930100000_hoa_don_misa_trang_thai.
-- Tên 20261008140000: đo 08/10 bằng git ls-tree mọi origin/* — lớn nhất là 20261008100000.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).
ALTER TYPE "WorkRequestStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "withdrawnAt" TIMESTAMPTZ(6);
