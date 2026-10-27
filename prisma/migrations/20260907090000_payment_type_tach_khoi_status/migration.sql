-- Tách LOẠI bút toán ra khỏi TRẠNG THÁI kế toán (07/09/2026).
--
-- Vì sao: `ADJUSTED` nằm trong enum `PaymentAccountantStatus`, tức nó chiếm chỗ của một
-- TRẠNG THÁI. Hệ quả là mọi truy vấn lọc `accountantStatus = 'CONFIRMED'` (công nợ,
-- cổng phụ huynh, học phí, báo cáo) đều bỏ qua bút toán điều chỉnh ⇒ số tiền kế toán vừa
-- sửa không bao giờ tới phụ huynh. Nay loại bút toán có cột riêng.
--
-- An toàn: đo 07/09 trên cả ba môi trường — local 0, dev/test 0, PROD 0 bút toán
-- ADJUSTED (prod chỉ có đúng 1 dòng Payment, CONFIRMED 3.686.000đ). Bước 3 vẫn giữ
-- nguyên phòng hờ, chi phí bằng 0.
--
-- Đảo ngược: xem `down.sql` cùng thư mục (Prisma KHÔNG tự chạy, phải gọi tay).

-- 1. Enum mới cho loại bút toán.
CREATE TYPE "PaymentType" AS ENUM ('PAYMENT', 'ADJUSTMENT');

-- 2. Cột mới. `NOT NULL DEFAULT 'PAYMENT'` backfill luôn mọi dòng cũ trong một lượt.
ALTER TABLE "Payment" ADD COLUMN "paymentType" "PaymentType" NOT NULL DEFAULT 'PAYMENT';

-- 3. Chuyển các dòng ADJUSTED cũ (nếu có) sang cột mới TRƯỚC khi bỏ giá trị enum.
--    Đưa về PENDING chứ không CONFIRMED: `amount` của chúng vẫn đang là SỐ TUYỆT ĐỐI
--    (mô hình cũ), cộng vào tổng đã xác nhận là nhân đôi tiền. Bước 3 viết lại theo delta.
UPDATE "Payment"
   SET "paymentType" = 'ADJUSTMENT', "accountantStatus" = 'PENDING'
 WHERE "accountantStatus" = 'ADJUSTED';

-- 4. Bỏ 'ADJUSTED' khỏi enum trạng thái. Postgres không có DROP VALUE nên phải dựng lại
--    kiểu. Chỉ đúng MỘT cột dùng kiểu này (`Payment.accountantStatus`) — đã kiểm.
ALTER TYPE "PaymentAccountantStatus" RENAME TO "PaymentAccountantStatus_old";

CREATE TYPE "PaymentAccountantStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED');

ALTER TABLE "Payment" ALTER COLUMN "accountantStatus" DROP DEFAULT;

ALTER TABLE "Payment"
  ALTER COLUMN "accountantStatus" TYPE "PaymentAccountantStatus"
  USING ("accountantStatus"::text::"PaymentAccountantStatus");

ALTER TABLE "Payment" ALTER COLUMN "accountantStatus" SET DEFAULT 'PENDING';

DROP TYPE "PaymentAccountantStatus_old";
