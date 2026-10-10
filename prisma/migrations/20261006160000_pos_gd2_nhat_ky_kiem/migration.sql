-- 06/10/2026 — GĐ2 POS: NHẬT KÝ KIỂM phiếu thu thẻ (PosCheckLog) + nguồn QUET_SACH + 3 cột mã TCB
-- cho PosTerminal. Thiết kế: docs/pos-gd2-thiet-ke.md §1.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): một giá trị enum nối cuối, một enum MỚI, ba cột NULLABLE trên
-- PosTerminal (bảng chưa có trên main — #459), một bảng MỚI. Không đổi kiểu, không bỏ cột.
-- Rollback = ngừng ghi; bảng/cột nằm im.
-- ⚠️ Phụ thuộc 20261006140000_pos_payment_intent (FK sang PosPaymentIntent): lên main CÙNG/SAU GĐ1.
-- Tên 20261006160000: đo 06/10 bằng git ls-tree mọi origin/* + nhánh cục bộ + mọi worktree — lớn
-- nhất đang có là 20261006140000_pos_payment_intent.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).
-- Lưới: lib/payments/pos/khai-bao-nhat-ky-pos.test.ts ([POS2-MIG-01]) +
--       tests/finance/pos-gd2-schema.test.ts ([POS2-MIG-02/03] — đo hành vi trên Postgres thật).
-- ⚠️ Giá trị enum vừa ADD VALUE CHƯA dùng được trong cùng giao dịch ⇒ tên nguồn quét sạch chỉ được
--    xuất hiện ở đúng một câu ADD VALUE dưới đây (lưới đếm).

-- ─── Enum ────────────────────────────────────────────────────────────────────
ALTER TYPE "PosCheckTrigger" ADD VALUE IF NOT EXISTS 'QUET_SACH';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosCheckLogKind') THEN
    CREATE TYPE "PosCheckLogKind" AS ENUM
      ('PAID', 'PAID_AMOUNT_MISMATCH', 'FAILED', 'NOT_FOUND', 'CANCELLED_AFTER_PAID', 'PROVIDER_ERROR', 'CACHE');
  END IF;
END $$;

-- ─── PosTerminal: ba mã do Techcombank cấp (cho GĐ4 agent) ───────────────────
ALTER TABLE "PosTerminal" ADD COLUMN IF NOT EXISTS "maCuaHang" TEXT;
ALTER TABLE "PosTerminal" ADD COLUMN IF NOT EXISTS "maNhaCungCap" TEXT;
ALTER TABLE "PosTerminal" ADD COLUMN IF NOT EXISTS "maTcbQuay" TEXT;

-- ─── Bảng nhật ký ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosCheckLog" (
  "id"            TEXT NOT NULL,
  "intentId"      TEXT NOT NULL,
  "centerId"      TEXT NOT NULL,
  "orgUnitId"     TEXT,
  "triggeredBy"   "PosCheckTrigger" NOT NULL,
  "kind"          "PosCheckLogKind" NOT NULL,
  "errorCode"     TEXT,
  "durationMs"    INTEGER NOT NULL,
  "providerTxnId" TEXT,
  "statusSau"     "PosIntentStatus",
  "createdById"   TEXT,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosCheckLog_pkey" PRIMARY KEY ("id"),
  -- Prisma không biểu diễn CHECK ⇒ chỉ có ở đây; tồn tại do [POS2-MIG-02] hỏi pg_constraint (F5 GĐ1).
  CONSTRAINT "PosCheckLog_durationMs_check" CHECK ("durationMs" >= 0),
  CONSTRAINT "PosCheckLog_errorCode_check" CHECK ("errorCode" IS NULL OR char_length("errorCode") <= 64),
  CONSTRAINT "PosCheckLog_cache_check"
    CHECK ("kind" <> 'CACHE' OR ("durationMs" = 0 AND "providerTxnId" IS NULL))
);

CREATE INDEX IF NOT EXISTS "PosCheckLog_intentId_createdAt_idx" ON "PosCheckLog"("intentId", "createdAt");
CREATE INDEX IF NOT EXISTS "PosCheckLog_centerId_createdAt_idx" ON "PosCheckLog"("centerId", "createdAt");
CREATE INDEX IF NOT EXISTS "PosCheckLog_createdAt_idx" ON "PosCheckLog"("createdAt");
CREATE INDEX IF NOT EXISTS "PosCheckLog_orgUnitId_idx" ON "PosCheckLog"("orgUnitId");

-- ─── Khoá ngoại ──────────────────────────────────────────────────────────────
-- Phiếu POS RESTRICT (phiếu không bao giờ xoá; xoá mà còn nhật ký là mất dấu). Người bấm SET NULL
-- (nhật ký máy không được chặn việc xoá cứng tài khoản; dòng còn, chỉ mất tên).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCheckLog_intentId_fkey') THEN
    ALTER TABLE "PosCheckLog" ADD CONSTRAINT "PosCheckLog_intentId_fkey"
      FOREIGN KEY ("intentId") REFERENCES "PosPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCheckLog_createdById_fkey') THEN
    ALTER TABLE "PosCheckLog" ADD CONSTRAINT "PosCheckLog_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Chỉ ENABLE, không FORCE, không policy (khuôn 20261006140000_pos_payment_intent).
ALTER TABLE "PosCheckLog" ENABLE ROW LEVEL SECURITY;
