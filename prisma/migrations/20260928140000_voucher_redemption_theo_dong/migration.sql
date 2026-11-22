-- 28/09/2026 — LƯỢT DÙNG MÃ KHUYẾN MÃI GHI THEO **DÒNG ĐƠN**, không phải theo đơn.
--
-- Chủ dự án chốt (28/09): mã khuyến mãi áp **theo DÒNG khoá học**, vì
-- `PromotionPolicy.courseIds` khai chương trình áp cho khoá nào. Một đơn hai con học hai
-- khoá khác nhau thì hai dòng có thể ăn hai chương trình khác nhau — và schema cũ
-- (`orderId @unique`, "1 order = 1 voucher max") không diễn đạt được điều đó.
--
-- ── VÌ SAO ĐỔI KHOÁ LÀ AN TOÀN, ĐO CHỨ KHÔNG ĐOÁN ─────────────────────────────────────
-- `SELECT count(*) FROM "VoucherRedemption"` ngày 28/09/2026:
--     satarobo_local 0 · satarobo_test 0 · ci_test 0 · **PROD 0**
-- Không dòng nào phải di trú, không dòng nào có thể va khoá mới. Luật cứng #4 cấm tự ý
-- sinh migration đổi/bỏ cột **trên bảng đang có dữ liệu PROD** — bảng này không có.
--
-- (Và trên prod, bảng `PromotionPolicy` còn CHƯA TỒN TẠI: module khuyến mãi mới ở nhánh
-- `test`. Nên migration này phải chạy SAU khi module ấy lên `main`.)
--
-- ⚠️ `orderItemId` để **NOT NULL**: mọi dòng từ nay đều gắn một dòng đơn cụ thể. Cho phép
-- NULL là mở lại đúng chỗ mập mờ vừa đóng — và tệ hơn, Postgres coi hai NULL là KHÁC
-- nhau, nên khoá ghép `(orderId, orderItemId)` sẽ KHÔNG chặn được hai lượt dùng cùng một
-- đơn khi cả hai để trống. Cùng bài học đã ghi cho `PaymentMethod.code` trong CLAUDE.md.
--
-- ⚠️ IDEMPOTENT — migration này chạy TAY trên prod (luật cứng #4), tức có người bấm, có
-- thể ngắt giữa chừng, có thể bấm lại. Một lượt chạy lại mà chết để lại dòng FAILED trong
-- `_prisma_migrations`, và từ đó MỌI `migrate deploy` sau bị chặn bằng `P3009`. Lưới
-- `[MIG-01]` (`prisma/migration-chay-lai-duoc.test.ts`) gác luật này từ 28/09.

-- 1) Cột mới. Thêm cho phép NULL trước để lệnh chạy được trên bảng đã có dòng (không có,
--    nhưng đừng viết SQL chỉ đúng với một trạng thái dữ liệu), rồi mới siết NOT NULL.
ALTER TABLE "VoucherRedemption" ADD COLUMN IF NOT EXISTS "orderItemId" TEXT;

-- 2) Bảng rỗng ⇒ siết được ngay. Nếu ai đó chạy migration này trên một bản sao CÓ dòng cũ
--    thì lệnh dưới sẽ NÉM — đúng ý: dừng lại để người vận hành quyết, thay vì lặng lẽ
--    gán bừa một `orderItemId` không có thật.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'VoucherRedemption' AND column_name = 'orderItemId'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "VoucherRedemption" ALTER COLUMN "orderItemId" SET NOT NULL;
  END IF;
END
$$;

-- 3) Khoá ngoại tới dòng đơn. `CASCADE` khớp với quan hệ `orderId` đã có: xoá đơn là xoá
--    dòng là xoá lượt dùng — không để lại lượt dùng mồ côi trỏ vào hư không.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VoucherRedemption_orderItemId_fkey'
  ) THEN
    ALTER TABLE "VoucherRedemption"
      ADD CONSTRAINT "VoucherRedemption_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 4) Đổi khoá duy nhất: 1 ĐƠN 1 MÃ  →  1 DÒNG 1 MÃ.
--    Thứ tự DROP trước ADD có chủ đích: giữ cả hai một lúc là khoá cũ vẫn chặn đúng ca
--    mà khoá mới sinh ra để cho phép.
ALTER TABLE "VoucherRedemption" DROP CONSTRAINT IF EXISTS "VoucherRedemption_orderId_key";
DROP INDEX IF EXISTS "VoucherRedemption_orderId_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VoucherRedemption_orderId_orderItemId_key'
  ) THEN
    ALTER TABLE "VoucherRedemption"
      ADD CONSTRAINT "VoucherRedemption_orderId_orderItemId_key"
      UNIQUE ("orderId", "orderItemId");
  END IF;
END
$$;

-- 5) Chỉ mục tra theo dòng — màn chi tiết đơn đọc lượt dùng theo từng dòng hàng.
CREATE INDEX IF NOT EXISTS "VoucherRedemption_orderItemId_idx"
  ON "VoucherRedemption" ("orderItemId");
