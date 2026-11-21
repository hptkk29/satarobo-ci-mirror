-- 06/10/2026 — GĐ1 POS: PHIẾU THU THẺ (PosPaymentIntent). Thiết kế: docs/pos-gd1-thiet-ke.md §1.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): ba enum MỚI + một bảng MỚI. PaymentBill, PosTerminal,
-- BankTransaction, User chỉ nhận khoá ngoại TRỎ VÀO chúng từ bảng mới — không thêm cột, không
-- đổi kiểu. Rollback = ngừng ghi; bảng nằm im.
-- ⚠️ Phụ thuộc 20261001130000_pos_the_smartpos (bảng PosTerminal): lên main CÙNG/SAU #459.
-- ⚠️ Tên 20261006140000 (không phải 120000 như bản thiết kế): `20261006120000_q4_nhom_vi_tri`
-- đã có trên origin/hptkk29/module-hethong — đo git ls-tree 06/10.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).
-- Lưới: lib/payments/pos/khai-bao-phieu-pos.test.ts ([POS1-MIG-01]) +
--       tests/finance/pos-gd1-schema.test.ts ([POS1-MIG-02] — đo hành vi trên Postgres thật).

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosIntentStatus') THEN
    CREATE TYPE "PosIntentStatus" AS ENUM
      ('CHO_QUET', 'THAT_BAI', 'DA_THU', 'LECH_TIEN', 'CAN_XU_LY', 'HET_HAN', 'HUY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosCheckKind') THEN
    CREATE TYPE "PosCheckKind" AS ENUM
      ('PAID', 'PAID_AMOUNT_MISMATCH', 'FAILED', 'NOT_FOUND', 'CANCELLED_AFTER_PAID', 'PROVIDER_ERROR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosCheckTrigger') THEN
    CREATE TYPE "PosCheckTrigger" AS ENUM ('SALE', 'POLLER', 'AGENT', 'IMPORT');
  END IF;
END $$;

-- ─── Bảng ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosPaymentIntent" (
  "id"                TEXT NOT NULL,
  "paymentBillId"     TEXT NOT NULL,
  "code5"             TEXT NOT NULL,
  "amount"            INTEGER NOT NULL,
  "centerId"          TEXT NOT NULL,
  "orgUnitId"         TEXT,
  "posTerminalId"     TEXT,
  "provider"          TEXT NOT NULL DEFAULT 'CARD_POS',
  "status"            "PosIntentStatus" NOT NULL DEFAULT 'CHO_QUET',
  "lastCheckAt"       TIMESTAMPTZ(6),
  "lastResultKind"    "PosCheckKind",
  "lastResultMessage" TEXT,
  "lastTriggeredBy"   "PosCheckTrigger",
  "bankTransactionId" TEXT,
  "createdById"       TEXT NOT NULL,
  "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"         TIMESTAMPTZ(6) NOT NULL,
  "updatedAt"         TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosPaymentIntent_pkey" PRIMARY KEY ("id"),
  -- Prisma không biểu diễn CHECK ⇒ chỉ có ở đây (kiểm drift KHÔNG hiện — F5).
  CONSTRAINT "PosPaymentIntent_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PosPaymentIntent_code5_check" CHECK (char_length("code5") = 5),
  CONSTRAINT "PosPaymentIntent_expiresAt_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PosPaymentIntent_bankTransactionId_key"
  ON "PosPaymentIntent"("bankTransactionId");
CREATE INDEX IF NOT EXISTS "PosPaymentIntent_paymentBillId_idx" ON "PosPaymentIntent"("paymentBillId");
CREATE INDEX IF NOT EXISTS "PosPaymentIntent_code5_idx" ON "PosPaymentIntent"("code5");
CREATE INDEX IF NOT EXISTS "PosPaymentIntent_centerId_createdAt_idx"
  ON "PosPaymentIntent"("centerId", "createdAt");
CREATE INDEX IF NOT EXISTS "PosPaymentIntent_orgUnitId_idx" ON "PosPaymentIntent"("orgUnitId");
CREATE INDEX IF NOT EXISTS "PosPaymentIntent_status_createdAt_idx"
  ON "PosPaymentIntent"("status", "createdAt");

-- MỘT phiếu POS ĐANG MỞ cho mỗi phiếu gộp — DB gác (khuôn PaymentBill_orderId_open_key).
-- Prisma không biểu diễn WHERE ⇒ chỉ có ở đây; tồn tại của nó do ca [POS1-MIG-02b] hỏi pg_indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "PosPaymentIntent_paymentBillId_mo_key" ON "PosPaymentIntent"("paymentBillId")
  WHERE "status" IN ('CHO_QUET', 'THAT_BAI');

-- ─── Khoá ngoại ──────────────────────────────────────────────────────────────
-- RESTRICT cả bốn: xoá phiếu gộp / máy / giao dịch / người tạo mà còn phiếu POS trỏ tới là mất dấu vết.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosPaymentIntent_paymentBillId_fkey') THEN
    ALTER TABLE "PosPaymentIntent" ADD CONSTRAINT "PosPaymentIntent_paymentBillId_fkey"
      FOREIGN KEY ("paymentBillId") REFERENCES "PaymentBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosPaymentIntent_posTerminalId_fkey') THEN
    ALTER TABLE "PosPaymentIntent" ADD CONSTRAINT "PosPaymentIntent_posTerminalId_fkey"
      FOREIGN KEY ("posTerminalId") REFERENCES "PosTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosPaymentIntent_bankTransactionId_fkey') THEN
    ALTER TABLE "PosPaymentIntent" ADD CONSTRAINT "PosPaymentIntent_bankTransactionId_fkey"
      FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosPaymentIntent_createdById_fkey') THEN
    ALTER TABLE "PosPaymentIntent" ADD CONSTRAINT "PosPaymentIntent_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Chỉ ENABLE, không FORCE, không policy (khuôn 20261001130000_pos_the_smartpos).
ALTER TABLE "PosPaymentIntent" ENABLE ROW LEVEL SECURITY;
