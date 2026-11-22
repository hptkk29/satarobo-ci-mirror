-- 18/10/2026 — CHỌN CHƯƠNG TRÌNH GIẢM Ở DÒNG ĐƠN PHẠM VI HỌC: điều kiện số buổi / thứ tự con / thứ tự sản phẩm 48 trên mã,
-- và cho MỘT DÒNG mang NHIỀU mã (mỗi mã một thành phần giảm). Thiết kế: docs/thu-hoc-phi-pham-vi/CHON-CHUONG-TRINH-GIAM.md.
--
-- Chủ dự án chốt D1 phương án (a) ngày 18/10/2026 (bằng lời trong phiên làm việc): nới khoá VoucherRedemption.
--
-- ── ĐÂY LÀ CÁI GÌ, VÀ KHÔNG PHẢI CÁI GÌ ─────────────────────────────────────────────────────────────
-- 1) THÊM 5 cột vào "Voucher" — mặc định = KHÔNG giới hạn, nên mã hiện có hành xử y như cũ.
-- 2) NỚI khoá lượt dùng từ (orderId, orderItemId) thành (orderId, orderItemId, voucherId): một dòng có thể dùng nhiều mã KHÁC NHAU,
--    nhưng cùng một mã hai lần trên cùng một dòng VẪN va khoá (khoá chống ghi đôi còn nguyên).
-- Cố ý KHÔNG có: cột nhóm giảm BASE/ADD_ON, trần của văn bản (D3 — cách cộng/trần xử lý ở tầng ứng dụng theo SR.QD.233), và bất kỳ
-- việc nối vào form / máy chủ của PHẦN GỢI Ý.
--
-- ⚠️ HỆ QUẢ ĐÃ BIẾT (rà soát độc lập 19/10/2026 — bản trước của chú thích này nói SAI "vẫn một-mã-một-dòng"): trước migration này khoá DB
-- (orderId, orderItemId) tự làm LỖI đơn khi một dòng gắn hai mã KHÁC nhau; `createOrderManualAction` không có kiểm riêng. Sau migration, hai mã/dòng LƯU ĐƯỢC.
-- Lưới đỡ còn lại là `orders.maxDiscountItems` (mặc định 1 ⇒ đơn vào hàng chờ duyệt, không xuất được QR); Quản lý cơ sở nâng tham số này (tới 5) thì chồng mã
-- KHÔNG cần duyệt. Chủ dự án chọn D1(a) 18/10/2026 và D8 (thành phần cùng văn bản có tính vào số ưu đãi tối đa không) vẫn MỞ.
--
-- ── LUẬT CỨNG #4 ────────────────────────────────────────────────────────────────────────────────────
-- Đổi RÀNG BUỘC trên bảng "VoucherRedemption" (prod có thể có dữ liệu): người vận hành CHẠY TAY trên prod, có dry-run. Khoá mới YẾU HƠN
-- khoá cũ (mọi tập dòng thoả khoá cũ đều thoả khoá mới) nên lệnh KHÔNG thể chết vì dữ liệu hiện có.
-- Thứ tự ADD khoá mới TRƯỚC rồi mới DROP khoá cũ có chủ đích: không có quãng nào bảng thiếu khoá chống ghi đôi.
--
-- ⚠️ IDEMPOTENT (`[MIG-01]`): chạy tay trên prod, có thể bấm lại.

-- 1) Cột điều kiện trên "Voucher". `ADD COLUMN` với mặc định HẰNG chỉ đổi metadata từ PostgreSQL 11.
ALTER TABLE "Voucher"
  ADD COLUMN IF NOT EXISTS "applicableSessionCounts" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN IF NOT EXISTS "childOrderMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "childOrderMax" INTEGER,
  ADD COLUMN IF NOT EXISTS "product48OrderMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "product48OrderMax" INTEGER;

-- 2) Khoảng thứ tự 1-based; max trống = "từ min trở đi". Chặn giá trị rác ngay ở DB (đường ghi thô cũng không lọt).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Voucher_childOrder_range_chk') THEN
    ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_childOrder_range_chk"
      CHECK (("childOrderMin" IS NULL OR "childOrderMin" >= 1)
         AND ("childOrderMax" IS NULL OR ("childOrderMin" IS NOT NULL AND "childOrderMax" >= "childOrderMin")));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Voucher_product48Order_range_chk') THEN
    ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_product48Order_range_chk"
      CHECK (("product48OrderMin" IS NULL OR "product48OrderMin" >= 1)
         AND ("product48OrderMax" IS NULL OR ("product48OrderMin" IS NOT NULL AND "product48OrderMax" >= "product48OrderMin")));
  END IF;
END
$$;

-- 3) Khoá lượt dùng: ADD khoá mới (yếu hơn) TRƯỚC, rồi DROP khoá cũ.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VoucherRedemption_orderId_orderItemId_voucherId_key') THEN
    ALTER TABLE "VoucherRedemption"
      ADD CONSTRAINT "VoucherRedemption_orderId_orderItemId_voucherId_key"
      UNIQUE ("orderId", "orderItemId", "voucherId");
  END IF;
END
$$;

ALTER TABLE "VoucherRedemption" DROP CONSTRAINT IF EXISTS "VoucherRedemption_orderId_orderItemId_key";
DROP INDEX IF EXISTS "VoucherRedemption_orderId_orderItemId_key";
