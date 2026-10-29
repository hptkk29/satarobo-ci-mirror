-- Phase T0.1 — Rename roles + add PARENT
-- MANAGER -> CENTER_MANAGER, SALES -> SALES_CSM, thêm PARENT.
-- Atomic type-recreate (transactional, an toàn — không dùng ALTER TYPE ADD VALUE
-- để tránh giới hạn "unsafe use of new enum value in same transaction").
-- Chỉ cột User.role dùng enum Role.

ALTER TYPE "Role" RENAME TO "Role_old";

CREATE TYPE "Role" AS ENUM (
  'SUPER_ADMIN',
  'CENTER_MANAGER',
  'HR',
  'SALES_CSM',
  'TEACHER',
  'MARKETING',
  'ACCOUNTANT',
  'PARENT'
);

-- Drop default trước khi đổi type
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

-- Convert + map dữ liệu cũ sang giá trị mới
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING (
  CASE "role"::text
    WHEN 'MANAGER' THEN 'CENTER_MANAGER'
    WHEN 'SALES' THEN 'SALES_CSM'
    ELSE "role"::text
  END::"Role"
);

-- Default mới
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'SALES_CSM';

DROP TYPE "Role_old";
