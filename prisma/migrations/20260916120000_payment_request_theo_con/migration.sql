-- BƯỚC B — CHIỀU "CON" CHO SỔ THU TIỀN (16/09/2026).
--
-- Chủ dự án chốt: *"công nợ theo CON, QR theo ĐƠN. PaymentRequest thêm orderItemId;
-- luồng mới BẮT BUỘC có (không có đợt NULL/đợt chung). KHÔNG thêm gì vào
-- OrderInstallment. Thêm PaymentBill (+ dòng trỏ PaymentRequest) = 1 VA/QR cho gia
-- đình, mỗi đơn tối đa MỘT phiếu gộp OPEN. Webhook khớp phiếu gộp → chia đích danh
-- theo thứ tự dòng; thiếu lấp dần, thừa vào ví gia đình."*
--
-- HOÀN TOÀN ADDITIVE trên bảng đang có dữ liệu PROD (luật cứng #4): một cột NULLABLE,
-- hai bảng MỚI, một enum MỚI. Không backfill, không đổi kiểu, không bỏ cột.
-- Rollback = ngừng ghi; mọi dòng cũ giữ `orderItemId = NULL` và hành vi y như trước.
--
-- ═══ VÌ SAO KHÔNG ĐỤNG `OrderInstallment` ═══
-- Sổ kế hoạch (book B) đóng băng theo quyết định của chủ dự án. Hệ quả kiến trúc:
-- **`PaymentRequest` trở thành nguồn sự thật của kế hoạch THEO CON**, còn
-- `OrderInstallment` là bản GỘP của đợt đó (Σ các dòng cùng `installmentNo`). Hai bất
-- biến phải giữ, cả hai đều được ghim bằng test:
--   · Σ đợt của MỘT dòng = thành tiền dòng đó (`lechTongDotCuaDong`);
--   · Σ các dòng cùng một đợt = `OrderInstallment.amount` của đợt đó.
--
-- ═══ VÌ SAO KHOÁ DUY NHẤT PHẢI CHIA ĐÔI ═══
-- Khoá cũ `("orderId","installmentNo")` cấm hai phiếu cùng đợt trên một đơn — đúng khi
-- đơn một con, nhưng đơn hai con thì đợt 1 phải có HAI phiếu. Bỏ hẳn khoá thì mất luôn
-- lưới chống tạo trùng. Nên chia đôi theo đúng hai luồng:
--   · luồng CŨ  (`orderItemId IS NULL`)     → giữ nguyên khoá cũ, y hệt hành vi hôm nay;
--   · luồng MỚI (`orderItemId IS NOT NULL`) → duy nhất theo ("orderItemId","installmentNo").
--
-- ⚠️ Prisma KHÔNG khai được khoá duy nhất TỪNG PHẦN (partial unique). Nên `@@unique`
-- trong `schema.prisma` bị GỠ và hai chỉ mục dưới đây là SQL tay. Đây là drift CÓ CHỦ Ý
-- và có ghi chú tại chỗ ở `schema.prisma` — đừng "sửa" bằng cách thêm `@@unique` lại:
-- làm thế là `migrate dev` sinh câu dựng lại khoá ĐẦY ĐỦ, và đơn nhiều con hết tạo được
-- phiếu ngay lúc chạy migration, không một lỗi nào báo trước.
--
-- ⚠️ Tên `PaymentRequest_orderId_installmentNo_key` được GIỮ NGUYÊN cho nhánh NULL, có
-- lý do: mọi dòng đang có trên DB đều `orderItemId IS NULL`, nên khoá thu hẹp mà tập bị
-- ràng buộc thì KHÔNG đổi — cùng tên, cùng nghĩa với dữ liệu hiện hữu.
--
-- ═══ PHẦN CỐ Ý KHÔNG NẰM TRONG MIGRATION NÀY ═══
-- · `QrSession` vẫn buộc `paymentRequestId NOT NULL`, nên phiếu gộp CHƯA phát được QR.
--   Cho `QrSession` trỏ được vào phiếu gộp là nới NOT NULL trên bảng đang chạy + CHECK
--   "đúng một trong hai" + rà lại mọi chỗ đọc `qrSession.paymentRequestId` (tsc sẽ liệt
--   kê). Đó là một đợt riêng, làm cùng lúc với đường phát QR cho phiếu gộp.
-- · `OrderItem.cancelledAt` (con nghỉ giữa chừng) KHÔNG thêm ở đây. Bảng MỚI thì không
--   người đọc cũ nào thấy; còn một CỘT TRẠNG THÁI MỚI trên bảng cũ thì mọi chỗ đọc
--   `OrderItem` phải xét thêm một trạng thái — thêm trước khi có người xử lý là dựng sẵn
--   một lỗi câm. Thêm cùng đợt hiện thực việc huỷ dòng.

-- ─── 1. Dòng hàng nào của đơn ────────────────────────────────────────────────
-- NULL = luồng CŨ (phiếu của cả đơn, hoặc đơn một con trước 16/09). Đây là giá trị HỢP
-- LỆ với dữ liệu cũ và là thứ giữ cho migration này additive; luồng MỚI thì cổng ở tầng
-- mã bắt buộc có, không phải NOT NULL ở DB.
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "orderItemId" TEXT;

-- RESTRICT chứ không CASCADE/SetNull: phiếu thu là SỔ TIỀN. Xoá dòng hàng mà phiếu đi
-- theo là mất dấu khoản đã thu; để phiếu ở lại với `orderItemId = NULL` thì nó lặng lẽ
-- tụt về luồng cũ và tiền của một em hoá tiền chung. Con nghỉ học thì HUỶ dòng, không
-- xoá dòng (quyết định của chủ dự án).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaymentRequest_orderItemId_fkey'
  ) THEN
    ALTER TABLE "PaymentRequest"
      ADD CONSTRAINT "PaymentRequest_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PaymentRequest_orderItemId_idx"
  ON "PaymentRequest"("orderItemId");

-- ─── 2. Khoá duy nhất chia đôi theo luồng ────────────────────────────────────
DROP INDEX IF EXISTS "PaymentRequest_orderId_installmentNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRequest_orderId_installmentNo_key"
  ON "PaymentRequest"("orderId", "installmentNo")
  WHERE "orderItemId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRequest_orderItemId_installmentNo_key"
  ON "PaymentRequest"("orderItemId", "installmentNo")
  WHERE "orderItemId" IS NOT NULL;

-- ─── 3. Phiếu gộp — MỘT mã QR cho cả gia đình ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentBillStatus') THEN
    CREATE TYPE "PaymentBillStatus" AS ENUM ('OPEN', 'CLOSED', 'VOID');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentBill" (
  "id"        TEXT NOT NULL,
  "orderId"   TEXT NOT NULL,
  "centerId"  TEXT,
  "orgUnitId" TEXT,
  -- Số tiền CHỤP LẠI lúc phát phiếu = Σ dòng. Không tính lại khi đọc: mã QR khách đang
  -- cầm in số của lúc phát, và đối khớp phải so với đúng số đã in ra.
  "amountDue" INTEGER NOT NULL,
  "status"    "PaymentBillStatus" NOT NULL DEFAULT 'OPEN',
  -- Định danh đối khớp của phiếu gộp (VA/mã tham chiếu). Cùng vai trò
  -- `PaymentRequest.matchKey`, nhưng ở cấp GIA ĐÌNH.
  "matchKey"  TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- KHÔNG có DEFAULT — `@updatedAt` của Prisma không sinh default ở DB, và mọi bảng khác
  -- của repo cũng vậy. Thêm default vào là đẻ một dòng drift vĩnh viễn ở `migrate diff`
  -- (đã đo: đúng một dòng `ALTER COLUMN "updatedAt" DROP DEFAULT`), và drift giả làm
  -- người rà drift quen mắt bỏ qua — đúng cơ chế ăn mòn cổng.
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PaymentBill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentBillLine" (
  "id"               TEXT NOT NULL,
  "billId"           TEXT NOT NULL,
  "paymentRequestId" TEXT NOT NULL,
  -- Thứ tự RÓT trong phiếu gộp. Sao lại `PaymentRequest.sortOrder` lúc phát phiếu, để
  -- thứ tự đã hứa với khách không đổi khi ai đó sửa kế hoạch giữa chừng.
  "sortOrder"        INTEGER NOT NULL DEFAULT 0,
  -- Phần của phiếu gộp dành cho dòng này. Σ cột này = "PaymentBill"."amountDue".
  "amount"           INTEGER NOT NULL,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentBillLine_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentBill_orderId_fkey') THEN
    ALTER TABLE "PaymentBill"
      ADD CONSTRAINT "PaymentBill_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentBillLine_billId_fkey') THEN
    -- Dòng phiếu không có nghĩa độc lập với phiếu → CASCADE.
    ALTER TABLE "PaymentBillLine"
      ADD CONSTRAINT "PaymentBillLine_billId_fkey"
      FOREIGN KEY ("billId") REFERENCES "PaymentBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentBillLine_paymentRequestId_fkey') THEN
    -- RESTRICT: phiếu thu không được biến mất dưới chân một phiếu gộp đang mở.
    ALTER TABLE "PaymentBillLine"
      ADD CONSTRAINT "PaymentBillLine_paymentRequestId_fkey"
      FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentBill_matchKey_key" ON "PaymentBill"("matchKey");
CREATE INDEX IF NOT EXISTS "PaymentBill_orderId_idx" ON "PaymentBill"("orderId");
CREATE INDEX IF NOT EXISTS "PaymentBill_centerId_status_idx" ON "PaymentBill"("centerId", "status");
CREATE INDEX IF NOT EXISTS "PaymentBill_orgUnitId_idx" ON "PaymentBill"("orgUnitId");

-- MỖI ĐƠN TỐI ĐA MỘT PHIẾU GỘP ĐANG MỞ — và luật này phải do DB gác.
--
-- Kiểm ở tầng mã ("đếm phiếu OPEN rồi mới tạo") KHÔNG chặn được hai lượt bấm đồng thời:
-- cả hai cùng đọc thấy 0, cả hai cùng ghi. Hậu quả là hai mã QR cùng sống cho một gia
-- đình, khách quét mã cũ, tiền về khớp phiếu đã bỏ — mất dấu hoàn toàn.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentBill_orderId_open_key"
  ON "PaymentBill"("orderId")
  WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentBillLine_billId_paymentRequestId_key"
  ON "PaymentBillLine"("billId", "paymentRequestId");
CREATE INDEX IF NOT EXISTS "PaymentBillLine_paymentRequestId_idx"
  ON "PaymentBillLine"("paymentRequestId");

-- RLS: bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT LẦN;
-- 31 bảng sinh sau nó đã từng nằm trần cho anon/authenticated — sự cố 09/08). Thiếu hai
-- dòng này là sổ tiền của phụ huynh phơi qua PostgREST.
ALTER TABLE "PaymentBill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentBillLine" ENABLE ROW LEVEL SECURITY;
