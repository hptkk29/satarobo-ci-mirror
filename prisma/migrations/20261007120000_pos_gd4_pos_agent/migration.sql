-- 07/10/2026 — GĐ4 POS: ĐẦU NHẬN POS AGENT. Thiết kế: docs/pos-gd4-thiet-ke.md §2. Hợp đồng: docs/pos-agent-api.md.
--
-- ADDITIVE + NỚI MỘT RÀNG BUỘC (luật cứng #4): 4 enum MỚI · 5 bảng MỚI · `PosCardTransaction` thêm 2 cột
-- NULLABLE và BỎ NOT NULL của "importBatchId" (dòng do agent tạo không có lô file). `PosCardTransaction`
-- CHƯA có trên origin/main (đo 07/10/2026 — không có 20261001130000_pos_the_smartpos) ⇒ không chạm dữ liệu PROD.
-- Rollback = ngừng ghi; bảng/cột nằm im ("importBatchId" chỉ đặt lại NOT NULL được khi không còn dòng NULL).
-- ⚠️ Phụ thuộc 20261006160000_pos_gd2_nhat_ky_kiem (+ GĐ1 PosPaymentIntent, #459 PosTerminal/PosImportBatch).
-- Tên 20261007120000: đo 07/10 bằng git ls-tree 198 nhánh origin/* + nhánh cục bộ + worktree pos-gd3/pos-gd5 —
-- lớn nhất đang có là 20261006160000_pos_gd2_nhat_ky_kiem.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).
-- Lưới: lib/payments/pos/agent/khai-bao-agent.test.ts ([POS4-MIG-01]) +
--       tests/finance/pos-gd4-schema.test.ts ([POS4-MIG-02] — đo hành vi trên Postgres thật).

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosAgentSessionState') THEN
    CREATE TYPE "PosAgentSessionState" AS ENUM ('READY', 'EXPIRED', 'UNKNOWN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosAgentEventType') THEN
    CREATE TYPE "PosAgentEventType" AS ENUM ('HEARTBEAT', 'SESSION_READY', 'SESSION_EXPIRED', 'SYNC', 'ERROR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosCheckJobStatus') THEN
    CREATE TYPE "PosCheckJobStatus" AS ENUM ('PENDING', 'DONE', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosDataSource') THEN
    CREATE TYPE "PosDataSource" AS ENUM ('FILE', 'AGENT');
  END IF;
END $$;

-- ─── (1) PosCardTransaction — chạy lại vô hại: DROP NOT NULL trên cột đã nullable không lỗi. ─────────
ALTER TABLE "PosCardTransaction" ALTER COLUMN "importBatchId" DROP NOT NULL;
ALTER TABLE "PosCardTransaction" ADD COLUMN IF NOT EXISTS "maKetToan" TEXT;
ALTER TABLE "PosCardTransaction" ADD COLUMN IF NOT EXISTS "maLyDoThatBai" TEXT;

-- ─── (2) PosAgent ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosAgent" (
  "id"               TEXT NOT NULL,
  "centerId"         TEXT NOT NULL,
  "orgUnitId"        TEXT,
  "merchantCode"     TEXT NOT NULL,
  "profileName"      TEXT,
  "secretVersion"    INTEGER NOT NULL DEFAULT 1,
  "secretDoiLuc"     TIMESTAMPTZ(6),
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "lastHeartbeatAt"  TIMESTAMPTZ(6),
  "matKetNoiTuLuc"   TIMESTAMPTZ(6),
  "sessionState"     "PosAgentSessionState" NOT NULL DEFAULT 'UNKNOWN',
  "sessionDoiLuc"    TIMESTAMPTZ(6),
  "sessionLyDo"      TEXT,
  "sessionExpiresAt" TIMESTAMPTZ(6),
  "lastSyncedAt"     TIMESTAMPTZ(6),
  "extensionVersion" TEXT,
  "loiGanNhat"       TEXT,
  "loiGanNhatLuc"    TIMESTAMPTZ(6),
  "createdById"      TEXT,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosAgent_pkey" PRIMARY KEY ("id"),
  -- Prisma không biểu diễn CHECK ⇒ chỉ có ở đây; tồn tại do [POS4-MIG-02] hỏi pg_constraint (F5 GĐ1).
  CONSTRAINT "PosAgent_secretVersion_check" CHECK ("secretVersion" >= 1),
  CONSTRAINT "PosAgent_merchantCode_check" CHECK ("merchantCode" ~ '^[A-Z0-9]{4,32}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosAgent_merchantCode_key" ON "PosAgent"("merchantCode");
CREATE INDEX IF NOT EXISTS "PosAgent_centerId_idx" ON "PosAgent"("centerId");
CREATE INDEX IF NOT EXISTS "PosAgent_orgUnitId_idx" ON "PosAgent"("orgUnitId");

-- ─── (3) PosAgentEvent ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosAgentEvent" (
  "id"        TEXT NOT NULL,
  "agentId"   TEXT NOT NULL,
  "centerId"  TEXT NOT NULL,
  "orgUnitId" TEXT,
  "type"      "PosAgentEventType" NOT NULL,
  "ma"        TEXT,
  "detail"    JSONB NOT NULL DEFAULT '{}',
  "khoaGop"   TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosAgentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PosAgentEvent_ma_check" CHECK ("ma" IS NULL OR "ma" ~ '^[A-Z][A-Z0-9_]{1,63}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosAgentEvent_khoaGop_key" ON "PosAgentEvent"("khoaGop");
CREATE INDEX IF NOT EXISTS "PosAgentEvent_agentId_createdAt_idx" ON "PosAgentEvent"("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "PosAgentEvent_centerId_createdAt_idx" ON "PosAgentEvent"("centerId", "createdAt");
CREATE INDEX IF NOT EXISTS "PosAgentEvent_orgUnitId_idx" ON "PosAgentEvent"("orgUnitId");

-- ─── (4) PosCheckJob ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosCheckJob" (
  "id"        TEXT NOT NULL,
  "intentId"  TEXT NOT NULL,
  "agentId"   TEXT NOT NULL,
  "centerId"  TEXT NOT NULL,
  "orgUnitId" TEXT,
  "status"    "PosCheckJobStatus" NOT NULL DEFAULT 'PENDING',
  "tuLuc"     TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneAt"    TIMESTAMPTZ(6),
  CONSTRAINT "PosCheckJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PosCheckJob_doneAt_check" CHECK (("status" = 'DONE') = ("doneAt" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "PosCheckJob_agentId_status_createdAt_idx" ON "PosCheckJob"("agentId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PosCheckJob_intentId_status_idx" ON "PosCheckJob"("intentId", "status");
CREATE INDEX IF NOT EXISTS "PosCheckJob_centerId_createdAt_idx" ON "PosCheckJob"("centerId", "createdAt");
CREATE INDEX IF NOT EXISTS "PosCheckJob_orgUnitId_idx" ON "PosCheckJob"("orgUnitId");

-- ─── (5) PosAgentNonce — không cột đơn vị (ngoại lệ có chủ đích, khuôn AttendanceTicket). ─────────────
CREATE TABLE IF NOT EXISTS "PosAgentNonce" (
  "agentId"   TEXT NOT NULL,
  "nonce"     TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosAgentNonce_pkey" PRIMARY KEY ("agentId", "nonce")
);
CREATE INDEX IF NOT EXISTS "PosAgentNonce_createdAt_idx" ON "PosAgentNonce"("createdAt");

-- ─── (6) PosTxnSource ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PosTxnSource" (
  "id"               TEXT NOT NULL,
  "maGiaoDich"       TEXT NOT NULL,
  "nguon"            "PosDataSource" NOT NULL,
  "posAgentId"       TEXT,
  "importBatchId"    TEXT,
  "lanDauThay"       TIMESTAMPTZ(6) NOT NULL,
  "lanCuoiThay"      TIMESTAMPTZ(6) NOT NULL,
  "soLanThay"        INTEGER NOT NULL DEFAULT 1,
  "bam"              TEXT NOT NULL,
  "loaiGiaoDich"     TEXT,
  "trangThai"        TEXT,
  "soTien"           INTEGER,
  "thoiGianGiaoDich" TIMESTAMPTZ(6),
  "bamDienGiai"      TEXT,
  "trangThaiHoanHuy" TEXT,
  "maHachToan"       TEXT,
  "phiGiaoDich"      INTEGER,
  "maKetToan"        TEXT,
  "maThietBi"        TEXT,
  "maQuay"           TEXT,
  "tuChoi"           TEXT,
  "centerId"         TEXT,
  "orgUnitId"        TEXT,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosTxnSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PosTxnSource_nguon_check" CHECK (("nguon" = 'AGENT') = ("posAgentId" IS NOT NULL)),
  CONSTRAINT "PosTxnSource_tuChoi_check" CHECK ("tuChoi" IS NULL OR "nguon" = 'AGENT'),
  CONSTRAINT "PosTxnSource_bam_check" CHECK ("bam" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosTxnSource_maGiaoDich_nguon_key" ON "PosTxnSource"("maGiaoDich", "nguon");
CREATE INDEX IF NOT EXISTS "PosTxnSource_centerId_thoiGianGiaoDich_idx" ON "PosTxnSource"("centerId", "thoiGianGiaoDich");
CREATE INDEX IF NOT EXISTS "PosTxnSource_thoiGianGiaoDich_idx" ON "PosTxnSource"("thoiGianGiaoDich");
CREATE INDEX IF NOT EXISTS "PosTxnSource_orgUnitId_idx" ON "PosTxnSource"("orgUnitId");

-- ─── Khoá ngoại ──────────────────────────────────────────────────────────────
-- RESTRICT (mất dấu là lỗi), trừ người tạo (SET NULL — nhật ký máy không giữ chân tài khoản) và nonce
-- (CASCADE — sổ sách sống 15 phút, không phải dấu vết nghiệp vụ).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosAgent_centerId_fkey') THEN
    ALTER TABLE "PosAgent" ADD CONSTRAINT "PosAgent_centerId_fkey"
      FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosAgent_createdById_fkey') THEN
    ALTER TABLE "PosAgent" ADD CONSTRAINT "PosAgent_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosAgentEvent_agentId_fkey') THEN
    ALTER TABLE "PosAgentEvent" ADD CONSTRAINT "PosAgentEvent_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "PosAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCheckJob_intentId_fkey') THEN
    ALTER TABLE "PosCheckJob" ADD CONSTRAINT "PosCheckJob_intentId_fkey"
      FOREIGN KEY ("intentId") REFERENCES "PosPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCheckJob_agentId_fkey') THEN
    ALTER TABLE "PosCheckJob" ADD CONSTRAINT "PosCheckJob_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "PosAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosAgentNonce_agentId_fkey') THEN
    ALTER TABLE "PosAgentNonce" ADD CONSTRAINT "PosAgentNonce_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "PosAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosTxnSource_posAgentId_fkey') THEN
    ALTER TABLE "PosTxnSource" ADD CONSTRAINT "PosTxnSource_posAgentId_fkey"
      FOREIGN KEY ("posAgentId") REFERENCES "PosAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Chỉ ENABLE, không FORCE, không policy (khuôn 20261006160000_pos_gd2_nhat_ky_kiem).
ALTER TABLE "PosAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosAgentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosCheckJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosAgentNonce" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosTxnSource" ENABLE ROW LEVEL SECURITY;
