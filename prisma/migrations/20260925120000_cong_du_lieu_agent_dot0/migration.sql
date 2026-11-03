-- CỔNG DỮ LIỆU AGENT — ĐỢT 0 (tài liệu CEO 25/09/2026 §11).
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 6 bảng MỚI + 4 enum MỚI + 1 cột mới trên "User".
-- Không đổi kiểu, không bỏ cột, không backfill. Rollback = ngừng dùng cổng (tắt công tắc
-- `agentGateway.enabled`); bảng nằm im, dữ liệu cũ không suy suyển.
--
-- Cột "User"."isServiceAccount" có DEFAULT hằng số ⇒ Postgres ≥ 11 chỉ ghi siêu dữ liệu,
-- không viết lại bảng, không khoá lâu. Mọi user hiện có nhận `false` — đúng nghĩa: chưa có
-- user dịch vụ nào trước migration này.
--
-- Không bảng nào mang centerId/orgUnitId: đây là cấu hình + nhật ký của cổng, không phải
-- dữ liệu nghiệp vụ thuộc một cơ sở (BA §5 X5).

-- ─── 1 · Enum ──────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE "AgentStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AgentClientKind" AS ENUM ('EXTERNAL', 'INTERNAL', 'MCP_WORKSHOP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AgentEnvironment" AS ENUM ('TEST', 'LIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AgentAccessMode" AS ENUM ('READ', 'WRITE_DRAFT', 'WRITE_DIRECT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2 · Cột mới trên User ─────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- ─── 3 · Bảng ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AgentClientKind" NOT NULL DEFAULT 'EXTERNAL',
    "environment" "AgentEnvironment" NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "allowedIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "suspendedAt" TIMESTAMPTZ(6),
    "suspendReason" TEXT,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" TEXT,
    "lastUsedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AgentClient_pkey" PRIMARY KEY ("id")
);

-- Mật khẩu client: CHỈ bản băm HMAC-SHA256(pepper, secret).
CREATE TABLE IF NOT EXISTS "AgentClientSecret" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentClientSecret_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentGrant" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "mode" "AgentAccessMode" NOT NULL DEFAULT 'READ',
    "centerCodes" TEXT[],
    "viewRawData" BOOLEAN NOT NULL DEFAULT false,
    "dailyRowLimit" INTEGER,
    "reason" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AgentGrant_pkey" PRIMARY KEY ("id")
);

-- Token truy cập: CHỈ bản băm, làm luôn khoá chính (tra theo băm, không bao giờ theo bản rõ).
CREATE TABLE IF NOT EXISTS "AgentAccessToken" (
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scopes" TEXT[],
    "environment" "AgentEnvironment" NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAccessToken_pkey" PRIMARY KEY ("tokenHash")
);

-- Nhật ký: cố ý KHÔNG có khoá ngoại tới AgentClient (phải ghi được cả lượt gọi bằng mã
-- client không tồn tại, và phải sống sau khi client bị thu hồi).
CREATE TABLE IF NOT EXISTS "AgentToolCall" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "agentRunId" TEXT,
    "tool" TEXT NOT NULL,
    "mode" "AgentAccessMode",
    "paramsHash" TEXT,
    "centerCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "viewedRaw" BOOLEAN NOT NULL DEFAULT false,
    "resultCode" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "ip" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- Bí mật TOTP: MÃ HOÁ AES-256-GCM (khoá ở env), không phải bản rõ.
CREATE TABLE IF NOT EXISTS "UserTotp" (
    "userId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "enabledAt" TIMESTAMPTZ(6),
    "lastUsedStep" INTEGER,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserTotp_pkey" PRIMARY KEY ("userId")
);

-- ─── 4 · Chỉ mục ───────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "AgentClient_serviceUserId_key" ON "AgentClient"("serviceUserId");
CREATE INDEX IF NOT EXISTS "AgentClient_status_idx" ON "AgentClient"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentClientSecret_secretHash_key" ON "AgentClientSecret"("secretHash");
CREATE INDEX IF NOT EXISTS "AgentClientSecret_clientId_idx" ON "AgentClientSecret"("clientId");
CREATE INDEX IF NOT EXISTS "AgentGrant_clientId_status_idx" ON "AgentGrant"("clientId", "status");
CREATE INDEX IF NOT EXISTS "AgentAccessToken_clientId_idx" ON "AgentAccessToken"("clientId");
CREATE INDEX IF NOT EXISTS "AgentAccessToken_expiresAt_idx" ON "AgentAccessToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "AgentToolCall_clientId_createdAt_idx" ON "AgentToolCall"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentToolCall_createdAt_idx" ON "AgentToolCall"("createdAt");
CREATE INDEX IF NOT EXISTS "AgentToolCall_resultCode_createdAt_idx" ON "AgentToolCall"("resultCode", "createdAt");

-- ─── 5 · Khoá ngoại ────────────────────────────────────────────────────────────────
-- RESTRICT (không CASCADE) ở mọi bảng của cổng: xoá một client/user dịch vụ là xoá dấu vết
-- ai đã cấp gì cho agent nào. Thu hồi = đổi trạng thái, không xoá dòng.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentClient_serviceUserId_fkey') THEN
    ALTER TABLE "AgentClient" ADD CONSTRAINT "AgentClient_serviceUserId_fkey"
      FOREIGN KEY ("serviceUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentClientSecret_clientId_fkey') THEN
    ALTER TABLE "AgentClientSecret" ADD CONSTRAINT "AgentClientSecret_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "AgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentGrant_clientId_fkey') THEN
    ALTER TABLE "AgentGrant" ADD CONSTRAINT "AgentGrant_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "AgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentAccessToken_clientId_fkey') THEN
    ALTER TABLE "AgentAccessToken" ADD CONSTRAINT "AgentAccessToken_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "AgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Riêng TOTP đi theo người: xoá user thì bí mật 2 lớp của họ không còn nghĩa gì.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserTotp_userId_fkey') THEN
    ALTER TABLE "UserTotp" ADD CONSTRAINT "UserTotp_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── 6 · RLS ───────────────────────────────────────────────────────────────────────
-- Bảng MỚI ra đời với RLS TẮT (sự cố 09/08: 31 bảng từng nằm trần qua PostgREST). Sáu
-- bảng này giữ bản băm khoá, bí mật TOTP đã mã hoá và nhật ký truy cập — càng không được
-- phơi. Chỉ ENABLE, không FORCE, không policy (khuôn `20260825120000_lead_status_history`).
ALTER TABLE "AgentClient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentClientSecret" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentAccessToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentToolCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserTotp" ENABLE ROW LEVEL SECURITY;
