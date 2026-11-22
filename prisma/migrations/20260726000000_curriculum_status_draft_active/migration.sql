-- T5.3 — rút gọn CurriculumStatus còn 2 giá trị: DRAFT (Nháp) / ACTIVE (Đang dùng).
--
-- 2-PHASE trong 1 migration (bắt buộc): Postgres KHÔNG cho drop giá trị enum khi còn
-- row tham chiếu → phải map DATA trước, rồi mới đổi type.
-- QĐ-11: ARCHIVED / UNPUBLISHED → DRAFT (không tự "kích hoạt lại" giáo trình cũ).

-- Bước 1 — DATA
UPDATE "Curriculum"
SET "status" = 'DRAFT'
WHERE "status" IN ('ARCHIVED', 'UNPUBLISHED');

-- Bước 2 — SCHEMA (đổi type: rename → tạo mới → cast cột → drop type cũ)
ALTER TYPE "CurriculumStatus" RENAME TO "CurriculumStatus_old";

CREATE TYPE "CurriculumStatus" AS ENUM ('DRAFT', 'ACTIVE');

ALTER TABLE "Curriculum" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Curriculum"
  ALTER COLUMN "status" TYPE "CurriculumStatus"
  USING ("status"::text::"CurriculumStatus");

ALTER TABLE "Curriculum" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "CurriculumStatus_old";
