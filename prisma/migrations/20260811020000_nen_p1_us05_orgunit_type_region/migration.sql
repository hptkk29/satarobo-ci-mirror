-- Nền Hệ thống P1 · US-05 — thêm giá trị enum REGION + DEPARTMENT vào OrgUnitType.
--
-- VÌ SAO ĐỨNG RIÊNG MỘT MIGRATION: Postgres cho phép `ALTER TYPE ... ADD VALUE` bên trong
-- transaction (PG 12+), NHƯNG giá trị vừa thêm KHÔNG dùng được cho tới khi transaction đó
-- commit. Prisma chạy mỗi file migration trong MỘT transaction ⇒ nếu gộp chung với
-- migration thêm cột / backfill có nhắc tới 'REGION' thì sẽ ném
-- `unsafe use of new value "REGION" of enum type "OrgUnitType"`.
-- ⇒ File này CHỈ được chứa ALTER TYPE. Đừng thêm gì vào đây.
--
-- IF NOT EXISTS có chủ đích (cùng lý do 20260808183000 / 20260809120000 / 20260809160000):
-- DB dev dùng chung nhiều nhánh, SQL có thể đã được áp bằng `prisma db execute` trước khi
-- `migrate deploy` record migration này — chạy lại phải no-op, không được fail.
--
-- ADD VALUE là thao tác THÊM thuần: không viết lại bảng, không khoá dữ liệu, không đảo
-- ngược được (Postgres không có DROP VALUE). Đây là lý do phải chốt tên giá trị trước:
-- REGION = khối quản lý tỉnh/TP (BA §1.1), DEPARTMENT = phòng ban (BA §2.2).
-- KHÔNG thêm 'FRANCHISEE' vào đây — sở hữu là TRỤC RIÊNG (enum OrgRelationshipType,
-- xem migration 20260811030000), đúng thứ BA §0.2 điểm 5 nói AMIS không có.

ALTER TYPE "OrgUnitType" ADD VALUE IF NOT EXISTS 'REGION';
ALTER TYPE "OrgUnitType" ADD VALUE IF NOT EXISTS 'DEPARTMENT';
