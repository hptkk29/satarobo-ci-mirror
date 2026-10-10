-- ĐẢO NGƯỢC migration `20260907090000_payment_type_tach_khoi_status`.
--
-- ⚠️ Prisma KHÔNG tự chạy file này. Chạy tay khi cần lùi:
--     psql "$DIRECT_URL" -f prisma/migrations/20260907090000_payment_type_tach_khoi_status/down.sql
--     rồi xoá dòng tương ứng trong bảng `_prisma_migrations`.
--
-- Thứ tự ngược lại với `migration.sql`: trả `ADJUSTED` vào enum TRƯỚC, rồi mới chuyển
-- dữ liệu ngược, cuối cùng mới bỏ cột — nếu làm ngược thì bước UPDATE không có giá trị
-- enum để ghi vào.

-- 1. Trả 'ADJUSTED' vào enum trạng thái.
ALTER TYPE "PaymentAccountantStatus" RENAME TO "PaymentAccountantStatus_new";

CREATE TYPE "PaymentAccountantStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED', 'ADJUSTED');

ALTER TABLE "Payment" ALTER COLUMN "accountantStatus" DROP DEFAULT;

ALTER TABLE "Payment"
  ALTER COLUMN "accountantStatus" TYPE "PaymentAccountantStatus"
  USING ("accountantStatus"::text::"PaymentAccountantStatus");

ALTER TABLE "Payment" ALTER COLUMN "accountantStatus" SET DEFAULT 'PENDING';

DROP TYPE "PaymentAccountantStatus_new";

-- 2. Dữ liệu ngược: bút toán điều chỉnh quay về trạng thái ADJUSTED như mô hình cũ.
UPDATE "Payment"
   SET "accountantStatus" = 'ADJUSTED'
 WHERE "paymentType" = 'ADJUSTMENT';

-- 3. Bỏ cột và kiểu mới.
ALTER TABLE "Payment" DROP COLUMN "paymentType";

DROP TYPE "PaymentType";
