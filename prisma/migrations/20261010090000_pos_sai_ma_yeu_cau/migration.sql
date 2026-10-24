-- 09/10/2026 — VIỆC 3 (POS): YÊU CẦU XÁC NHẬN GIAO DỊCH THẺ NHẬP SAI MÃ. Thiết kế: docs/pos-hai-nut-khai-may.md §5.
--
-- Sale gõ sai mã trên máy POS, khách đã quẹt thành công ⇒ giao dịch nằm hàng chờ (UNMATCHED) còn phiếu POS vẫn CHO_QUET.
-- Ghi chú của giao dịch KHÔNG sửa được (bản ghi của ngân hàng), nên "sửa" = GẮN giao dịch vào đúng phiếu qua một YÊU CẦU có vòng
-- đời: sale xác nhận là đủ (TU_GHI_NHAN) hoặc kế toán duyệt (CHO_KE_TOAN). Bảng này giữ vòng đời + bộ nhớ "cặp (phiếu, giao
-- dịch) đã bị bác"; liên hệ phiếu POS ↔ giao dịch vẫn ở PosPaymentIntent.bankTransactionId.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): hai enum MỚI + một bảng MỚI. PosPaymentIntent / BankTransaction / User chỉ nhận khoá ngoại
-- TRỎ VÀO chúng từ bảng mới — không thêm cột, không đổi kiểu, không bỏ gì. Rollback = ngừng ghi; bảng nằm im, không mã nào đọc.
-- ⚠️ Phụ thuộc 20261006140000_pos_payment_intent (khoá ngoại sang PosPaymentIntent): lên main CÙNG/SAU GĐ1.
-- Tên 20261010090000: đổi 10/10 từ 20261015090000 theo chủ dự án. `migrate deploy` áp theo thứ tự TÊN, nên tên phải LỚN HƠN
-- migration cuối của origin/test (20261008190000_buoi_hoc_nguon_don_tu) và LỚN HƠN 20261006140000_pos_payment_intent (khoá ngoại).
-- Migration này độc lập về dữ liệu với các migration Nguồn/hoa hồng (20261009…20261014): thứ tự áp giữa chúng không ảnh hưởng.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).
-- Lưới: lib/payments/pos/khai-bao-sai-ma.test.ts ([HN3-DECL-*]) + tests/finance/pos-sai-ma-schema.test.ts ([HN3-MIG-*] — đo
--       HÀNH VI của hai UNIQUE từng phần và năm CHECK trên Postgres thật; `prisma migrate diff` KHÔNG in chúng — F5 của GĐ1).

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosSaiMaKieu') THEN
    CREATE TYPE "PosSaiMaKieu" AS ENUM ('TU_GHI_NHAN', 'CHO_KE_TOAN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosSaiMaTrangThai') THEN
    CREATE TYPE "PosSaiMaTrangThai" AS ENUM ('CHO_DUYET', 'DANG_GHI', 'DA_GHI_NHAN', 'TU_CHOI');
  END IF;
END $$;

-- ─── Bảng ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosSaiMaYeuCau" (
  "id"                TEXT NOT NULL,
  "intentId"          TEXT NOT NULL,
  "bankTransactionId" TEXT NOT NULL,
  "centerId"          TEXT NOT NULL,
  "orgUnitId"         TEXT,
  "kieu"              "PosSaiMaKieu" NOT NULL,
  "trangThai"         "PosSaiMaTrangThai" NOT NULL DEFAULT 'CHO_DUYET',
  "lyDo"              TEXT NOT NULL DEFAULT '',
  "nguoiGuiId"        TEXT NOT NULL,
  -- APP đặt = `now` (khuôn T18, luật 19) — cố ý KHÔNG có default.
  "createdAt"         TIMESTAMPTZ(6) NOT NULL,
  "dangGhiLuc"        TIMESTAMPTZ(6),
  "nguoiQuyetId"      TEXT,
  "quyetLuc"          TIMESTAMPTZ(6),
  "lyDoTuChoi"        TEXT,
  "updatedAt"         TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosSaiMaYeuCau_pkey" PRIMARY KEY ("id"),
  -- Prisma không biểu diễn CHECK ⇒ chỉ có ở đây; tồn tại do [HN3-MIG-04] hỏi pg_constraint + đo hành vi (F5 GĐ1).
  -- Từ chối phải có NGƯỜI, LÚC và LÝ DO ≥ 5 ký tự (cùng ngưỡng Q-H của đóng cảnh báo).
  CONSTRAINT "PosSaiMaYeuCau_tu_choi_check" CHECK (
    "trangThai" <> 'TU_CHOI'
    OR ("nguoiQuyetId" IS NOT NULL AND "quyetLuc" IS NOT NULL AND char_length(btrim(COALESCE("lyDoTuChoi", ''))) >= 5)
  ),
  -- Người quyết ≠ người gửi — lưới cuối của luật "không tự duyệt" (ứng dụng chặn trước bằng chanTuDuyet).
  CONSTRAINT "PosSaiMaYeuCau_khac_nguoi_check" CHECK ("nguoiQuyetId" IS NULL OR "nguoiQuyetId" <> "nguoiGuiId"),
  -- Chờ kế toán thì phải nói VÌ SAO.
  CONSTRAINT "PosSaiMaYeuCau_ly_do_check" CHECK ("kieu" <> 'CHO_KE_TOAN' OR char_length("lyDo") > 0),
  -- Đang ghi tiền thì phải có mốc (để biết khi nào coi là KẸT).
  CONSTRAINT "PosSaiMaYeuCau_dang_ghi_check" CHECK ("trangThai" <> 'DANG_GHI' OR "dangGhiLuc" IS NOT NULL),
  -- Yêu cầu CHO_KE_TOAN đã đi qua bước duyệt (đang ghi / đã ghi) thì phải nêu NGƯỜI duyệt.
  CONSTRAINT "PosSaiMaYeuCau_nguoi_duyet_check" CHECK (
    "kieu" <> 'CHO_KE_TOAN' OR "trangThai" NOT IN ('DANG_GHI', 'DA_GHI_NHAN') OR "nguoiQuyetId" IS NOT NULL
  )
);

-- Một cặp (phiếu, giao dịch) chỉ được đề nghị MỘT lần — chặn vòng lặp "gửi lại đúng cặp kế toán vừa bác".
CREATE UNIQUE INDEX IF NOT EXISTS "PosSaiMaYeuCau_intentId_bankTransactionId_key"
  ON "PosSaiMaYeuCau"("intentId", "bankTransactionId");

-- MỘT giao dịch / MỘT phiếu chỉ có một yêu cầu SỐNG hoặc ĐÃ DÙNG — bị bác (TU_CHOI) thì nhả. Prisma không biểu diễn WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS "PosSaiMaYeuCau_giao_dich_giu_key"
  ON "PosSaiMaYeuCau"("bankTransactionId") WHERE "trangThai" <> 'TU_CHOI';
CREATE UNIQUE INDEX IF NOT EXISTS "PosSaiMaYeuCau_phieu_giu_key"
  ON "PosSaiMaYeuCau"("intentId") WHERE "trangThai" <> 'TU_CHOI';

CREATE INDEX IF NOT EXISTS "PosSaiMaYeuCau_centerId_trangThai_createdAt_idx" ON "PosSaiMaYeuCau"("centerId", "trangThai", "createdAt");
CREATE INDEX IF NOT EXISTS "PosSaiMaYeuCau_bankTransactionId_idx" ON "PosSaiMaYeuCau"("bankTransactionId");
CREATE INDEX IF NOT EXISTS "PosSaiMaYeuCau_orgUnitId_idx" ON "PosSaiMaYeuCau"("orgUnitId");

-- ─── Khoá ngoại ──────────────────────────────────────────────────────────────
-- Cả bốn RESTRICT: phiếu / giao dịch / người không bao giờ xoá khi còn yêu cầu trỏ vào (xoá mà còn yêu cầu là mất dấu
-- một khoản tiền thật). Không CASCADE, không SET NULL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosSaiMaYeuCau_intentId_fkey') THEN
    ALTER TABLE "PosSaiMaYeuCau" ADD CONSTRAINT "PosSaiMaYeuCau_intentId_fkey"
      FOREIGN KEY ("intentId") REFERENCES "PosPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosSaiMaYeuCau_bankTransactionId_fkey') THEN
    ALTER TABLE "PosSaiMaYeuCau" ADD CONSTRAINT "PosSaiMaYeuCau_bankTransactionId_fkey"
      FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosSaiMaYeuCau_nguoiGuiId_fkey') THEN
    ALTER TABLE "PosSaiMaYeuCau" ADD CONSTRAINT "PosSaiMaYeuCau_nguoiGuiId_fkey"
      FOREIGN KEY ("nguoiGuiId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosSaiMaYeuCau_nguoiQuyetId_fkey') THEN
    ALTER TABLE "PosSaiMaYeuCau" ADD CONSTRAINT "PosSaiMaYeuCau_nguoiQuyetId_fkey"
      FOREIGN KEY ("nguoiQuyetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Chỉ ENABLE, không FORCE, không policy (khuôn 20261006140000_pos_payment_intent / 20261006160000_pos_gd2_nhat_ky_kiem).
ALTER TABLE "PosSaiMaYeuCau" ENABLE ROW LEVEL SECURITY;
