-- 29/09/2026 — IMPORT & ĐỐI SOÁT GIAO DỊCH THẺ SMARTPOS TECHCOMBANK.
-- Thiết kế + 4 quyết định chủ dự án: docs/pos-the-smartpos.md.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): một enum MỚI + ba bảng MỚI. Không đụng cột nào
-- của bảng đang có dữ liệu PROD. `BankTransaction` chỉ nhận thêm một khoá ngoại TRỎ
-- VÀO nó (từ bảng mới) — không thêm cột, không đổi kiểu.
-- Rollback = ngừng ghi; ba bảng nằm im.
--
-- Viết TAY (CẤM `prisma migrate dev` — drift 14 bảng, CLAUDE.md mục 6).

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosMatchStatus') THEN
    CREATE TYPE "PosMatchStatus" AS ENUM ('TU_KHOP', 'CAN_XU_LY', 'BO_QUA');
  END IF;
END $$;

-- ─── Máy POS ⇒ cơ sở ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosTerminal" (
  "id"          TEXT NOT NULL,
  "maThietBi"   TEXT NOT NULL,
  "maQuay"      TEXT,
  "ten"         TEXT,
  "centerId"    TEXT NOT NULL,
  "orgUnitId"   TEXT,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosTerminal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PosTerminal_maThietBi_key" ON "PosTerminal"("maThietBi");
CREATE INDEX IF NOT EXISTS "PosTerminal_centerId_idx" ON "PosTerminal"("centerId");
CREATE INDEX IF NOT EXISTS "PosTerminal_orgUnitId_idx" ON "PosTerminal"("orgUnitId");

-- ─── Lô import ───────────────────────────────────────────────────────────────
-- KHÔNG theo cơ sở: một file chứa giao dịch của mọi máy.
CREATE TABLE IF NOT EXISTS "PosImportBatch" (
  "id"           TEXT NOT NULL,
  "tenFile"      TEXT NOT NULL,
  "importedById" TEXT NOT NULL,
  "soDong"       INTEGER NOT NULL DEFAULT 0,
  "soMoi"        INTEGER NOT NULL DEFAULT 0,
  "soCapNhat"    INTEGER NOT NULL DEFAULT 0,
  "soTuKhop"     INTEGER NOT NULL DEFAULT 0,
  "soCanXuLy"    INTEGER NOT NULL DEFAULT 0,
  "soBoQua"      INTEGER NOT NULL DEFAULT 0,
  "soLoi"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PosImportBatch_importedById_idx" ON "PosImportBatch"("importedById");
CREATE INDEX IF NOT EXISTS "PosImportBatch_createdAt_idx" ON "PosImportBatch"("createdAt");

-- ─── Dòng giao dịch thẻ ──────────────────────────────────────────────────────
-- KHÔNG có cột tên chủ thẻ (cố ý) — chỉ số thẻ đã che.
-- `centerId` NULL = chưa biết cơ sở (máy chưa khai) — như BankTransaction.
CREATE TABLE IF NOT EXISTS "PosCardTransaction" (
  "id"                 TEXT NOT NULL,
  "maGiaoDich"         TEXT NOT NULL,
  "loaiGiaoDich"       TEXT NOT NULL,
  "hinhThuc"           TEXT NOT NULL,
  "trangThai"          TEXT NOT NULL,
  "soTien"             INTEGER NOT NULL,
  "thoiGianGiaoDich"   TIMESTAMPTZ(6) NOT NULL,
  "dienGiai"           TEXT NOT NULL,
  "maChuanChi"         TEXT,
  "maGiaoDichThe"      TEXT,
  "maGiaoDichGoc"      TEXT,
  "trangThaiHoanHuy"   TEXT,
  "maDonHang"          TEXT,
  "maQuay"             TEXT,
  "maThietBi"          TEXT,
  "soTheMasked"        TEXT,
  "loaiThe"            TEXT,
  "maHachToan"         TEXT,
  "phiGiaoDich"        INTEGER,
  "centerId"           TEXT,
  "orgUnitId"          TEXT,
  "matchStatus"        "PosMatchStatus" NOT NULL,
  "matchReason"        TEXT,
  "maPhieu"            TEXT,
  "bankTransactionId"  TEXT,
  "importBatchId"      TEXT NOT NULL,
  "lastImportBatchId"  TEXT,
  "canhBaoHuy"         BOOLEAN NOT NULL DEFAULT false,
  "canhBaoDaXuLyLuc"   TIMESTAMPTZ(6),
  "canhBaoDaXuLyBoiId" TEXT,
  "canhBaoGhiChu"      TEXT,
  "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosCardTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PosCardTransaction_maGiaoDich_key"
  ON "PosCardTransaction"("maGiaoDich");
CREATE UNIQUE INDEX IF NOT EXISTS "PosCardTransaction_bankTransactionId_key"
  ON "PosCardTransaction"("bankTransactionId");
CREATE INDEX IF NOT EXISTS "PosCardTransaction_maGiaoDichGoc_idx"
  ON "PosCardTransaction"("maGiaoDichGoc");
CREATE INDEX IF NOT EXISTS "PosCardTransaction_matchStatus_thoiGianGiaoDich_idx"
  ON "PosCardTransaction"("matchStatus", "thoiGianGiaoDich");
CREATE INDEX IF NOT EXISTS "PosCardTransaction_centerId_thoiGianGiaoDich_idx"
  ON "PosCardTransaction"("centerId", "thoiGianGiaoDich");
CREATE INDEX IF NOT EXISTS "PosCardTransaction_orgUnitId_idx"
  ON "PosCardTransaction"("orgUnitId");
CREATE INDEX IF NOT EXISTS "PosCardTransaction_canhBaoHuy_idx"
  ON "PosCardTransaction"("canhBaoHuy");
CREATE INDEX IF NOT EXISTS "PosCardTransaction_importBatchId_idx"
  ON "PosCardTransaction"("importBatchId");

-- ─── Khoá ngoại ──────────────────────────────────────────────────────────────
-- RESTRICT cả bốn: xoá cơ sở / người nhập / giao dịch ngân hàng / lô import mà còn
-- dòng POS trỏ tới là mất dấu vết tiền — phải chặn, không cascade.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosTerminal_centerId_fkey') THEN
    ALTER TABLE "PosTerminal"
      ADD CONSTRAINT "PosTerminal_centerId_fkey"
      FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosImportBatch_importedById_fkey') THEN
    ALTER TABLE "PosImportBatch"
      ADD CONSTRAINT "PosImportBatch_importedById_fkey"
      FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCardTransaction_bankTransactionId_fkey') THEN
    ALTER TABLE "PosCardTransaction"
      ADD CONSTRAINT "PosCardTransaction_bankTransactionId_fkey"
      FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCardTransaction_importBatchId_fkey') THEN
    ALTER TABLE "PosCardTransaction"
      ADD CONSTRAINT "PosCardTransaction_importBatchId_fkey"
      FOREIGN KEY ("importBatchId") REFERENCES "PosImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS: bảng MỚI ra đời với RLS TẮT (sự cố 09/08 — 31 bảng từng nằm trần cho
-- anon/authenticated qua PostgREST). Chỉ ENABLE, không FORCE, không policy.
ALTER TABLE "PosTerminal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosCardTransaction" ENABLE ROW LEVEL SECURITY;
