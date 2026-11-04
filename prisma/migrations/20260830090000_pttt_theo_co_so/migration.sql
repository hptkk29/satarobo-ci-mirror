-- PHƯƠNG THỨC THANH TOÁN THEO CƠ SỞ (30/08/2026)
--
-- Toàn bộ migration này là THÊM: hai cột nullable, một khoá ngoại, hai index. KHÔNG đổi
-- kiểu, KHÔNG bỏ cột, KHÔNG đụng `code String @unique` đang có — luật cứng Nền Hệ thống #4.
--
-- ⚠️ KHÔNG backfill dòng nào. `centerId = NULL` ở bảng này nghĩa là "phương thức DÙNG
-- CHUNG mọi cơ sở", KHÔNG phải "chưa gán" (xem BACKFILL_SPECS trong
-- lib/org/center-bridge.ts, nullMeaning = NULL_TOAN_HE_THONG). Bốn dòng seed gốc
-- (CASH / BANK_TRANSFER / VNPAY / TINGEE) và mọi dòng có trước ngày này PHẢI giữ null —
-- "điền cho đủ" là biến một phương thức toàn hệ thống thành của riêng một cơ sở, tức các
-- cơ sở còn lại mất luôn cách thu tiền đó, và mọi đơn cũ trỏ tới nó thành sai cơ sở.

ALTER TABLE "PaymentMethod" ADD COLUMN IF NOT EXISTS "centerId"  TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;

-- Khoá ngoại tới Center: RESTRICT khi xoá — mất cơ sở mà phương thức của nó còn treo thì
-- đơn cũ trỏ tới một phương thức không còn chủ. `deleteCenter` (centers/_actions.ts) vốn
-- đã đếm liên kết và chặn trước, đây là lưới thứ hai ở tầng DB.
-- ON UPDATE CASCADE vì Center.id của repo này là id GÁN TAY ("co-so-nguyen-huu-tho"),
-- không phải cuid sinh máy — đổi id là chuyện có thể xảy ra khi dựng lại dữ liệu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaymentMethod_centerId_fkey'
  ) THEN
    ALTER TABLE "PaymentMethod"
      ADD CONSTRAINT "PaymentMethod_centerId_fkey"
      FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Index phục vụ đúng truy vấn nóng: "phương thức đang bật của cơ sở X, theo thứ tự hiển
-- thị" (form tạo đơn, màn ghi nhận thanh toán, danh mục). Dòng dùng chung (centerId NULL)
-- cũng nằm trong index này — Postgres có lập chỉ mục NULL cho B-tree.
CREATE INDEX IF NOT EXISTS "PaymentMethod_centerId_isActive_displayOrder_idx"
  ON "PaymentMethod"("centerId", "isActive", "displayOrder");
CREATE INDEX IF NOT EXISTS "PaymentMethod_orgUnitId_idx"
  ON "PaymentMethod"("orgUnitId");
