-- PHIÊN D · DỪNG HỌC MỘT CON  [21/09/2026]
--
-- Ca gốc: đơn hai con, đợt 1 đóng cho cả hai, đợt 2 chỉ còn một con học. Hệ thống phải
-- quyết toán phần đã học của con nghỉ, ngừng đòi phần chưa học, và phân HẾT khoản dư.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THUẦN THÊM. Không bỏ cột, không bỏ bảng, không đổi kiểu cột đang có dữ liệu.
-- Hai phép "nới" (DROP NOT NULL + ADD CHECK) giải thích ngay tại chỗ ở mục 3.
--
-- ⚠️ Mọi câu đều IDEMPOTENT (`IF NOT EXISTS` / `DO$$ … duplicate_object`). Bài học c06
-- (20260825230000): migration chỉ-có-trên-`test` mang dấu thời gian SỚM hơn migration
-- cuối của `main`, nên thứ tự áp dụng trên prod KHÁC trên test và một câu lệnh TRẦN sẽ
-- đâm vào đối tượng đã tồn tại. Viết idempotent từ đầu thì thứ tự không còn quan trọng.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · Hai enum của lượt dừng học ──────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE "OrderItemStatus" AS ENUM ('ACTIVE', 'STOPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OrderItemStopReason" AS ENUM ('PH_CHU_DONG', 'TRUNG_TAM_HUY', 'KHAC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2 · Bản ghi QUYẾT TOÁN nằm TRÊN dòng đơn ────────────────────────────────
--
-- ⚠️ KHÔNG sửa `totalPrice` / `discountAmount` của dòng. Hai cột đó là lời khai lúc BÁN
-- (`Order.subtotal` = Σ `totalPrice`, cổng soát giá so `unitPrice` với giá niêm yết); sửa
-- chúng là đổi một chứng từ đã ký. Phần "con này rốt cuộc phải trả bao nhiêu" là một SỰ
-- KIỆN KHÁC xảy ra sau, nên nó có chỗ riêng.
--
-- ⚠️ `committedSessions` + `unitPrice` là SNAPSHOT, cố ý KHÔNG đọc lại `Course.totalSessions`
-- về sau (chủ dự án chốt 21/09): admin sửa số buổi cam kết của khoá sang năm không được làm
-- đổi một khoản quyết toán đã chốt hôm nay.
--
-- `status` NOT NULL DEFAULT 'ACTIVE': Postgres 11+ ghi default vào catalog, không quét bảng.

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "status" "OrderItemStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stoppedAt"         TIMESTAMPTZ(6);
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stoppedById"       TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "lastSessionDate"   TIMESTAMPTZ(6);
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "usedSessions"      INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "committedSessions" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stopUnitPrice"     INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "usedValue"         INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stopReason"        "OrderItemStopReason";
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stopNote"          TEXT;

-- Màn đơn lọc "con nào đã dừng"; đơn chỉ vài dòng nên index này phục vụ báo cáo gom
-- theo trạng thái, không phải màn chi tiết.
CREATE INDEX IF NOT EXISTS "OrderItem_status_idx" ON "OrderItem"("status");

-- ── 3 · Yêu cầu hoàn tiền gắn được vào DÒNG ĐƠN, không chỉ vào GHI DANH ──────
--
-- Vì sao phải nới: phần DƯ sau khi dừng học phải phân HẾT (chuyển sang con còn lại và/hoặc
-- kế toán hoàn). Nhưng một dòng đơn CHƯA gắn ghi danh (`enrollmentId IS NULL` — đơn tạo
-- thủ công trước lúc convert lead) thì không có `Enrollment` nào để treo yêu cầu hoàn vào,
-- và khoản dư sẽ không có cửa nào đi ra. Chủ dự án chốt 21/09: KHÔNG chặn ca đó.
--
-- ⚠️ DROP NOT NULL là phép NỚI (mọi dòng đang có vẫn hợp lệ), không phải phép đổi kiểu —
-- nó không quét bảng và không làm hỏng dòng nào. Cái nó làm hỏng là MÃ đang coi cột này
-- là bắt buộc; ba chỗ đó sửa cùng lượt này (`listRefundRequests`, `RefundRow`,
-- `refund-table.tsx`).
--
-- CHECK thay cho NOT NULL: một yêu cầu hoàn PHẢI biết nó hoàn cho ai. Mất cả hai đầu mối
-- là một dòng tiền mồ côi.

ALTER TABLE "RefundRequest" ALTER COLUMN "enrollmentId" DROP NOT NULL;

ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "orderItemId" TEXT;

DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "RefundRequest_orderItemId_idx" ON "RefundRequest"("orderItemId");

-- ⚠️ `NOT VALID`: chỉ gác dòng MỚI, không quét 0 → n dòng đang có. Bảng prod hôm nay
-- không thể vi phạm (cột `enrollmentId` vừa còn là NOT NULL), nhưng `NOT VALID` giữ cho
-- migration chạy trong thời gian hằng số kể cả khi bảng đã lớn.
DO $$
BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_co_nguon_check"
    CHECK ("enrollmentId" IS NOT NULL OR "orderItemId" IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
