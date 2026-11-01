-- CỔNG DỮ LIỆU AGENT — ĐỢT 2 (cổng MCP + máy chủ cấp quyền OAuth 2.1), THIET-KE-DOT2 mục D.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 3 bảng MỚI + 1 enum MỚI + 4 cột mới trên "UserTotp" +
-- 2 cột mới trên "AgentToolCall". Không đổi kiểu, không bỏ cột, không backfill. Rollback =
-- ngừng dùng MCP (khoá hồ sơ MCP_WORKSHOP hoặc tắt `agentGateway.enabled`); bảng nằm im.
--
-- Cột mới có DEFAULT hằng số ("soLanKhoa" = 0) hoặc cho phép NULL ⇒ Postgres ≥ 11 chỉ ghi siêu
-- dữ liệu, không viết lại bảng. "UserTotp" và "AgentToolCall" mới có từ Đợt 0 (chưa lên main).
--
-- Không bảng nào mang centerId/orgUnitId: phạm vi cơ sở của người nối MCP được tính lại mỗi
-- lượt gọi (grant hồ sơ ∩ quyền của người), không lưu. Client OAuth KHÔNG có bảng — client_id
-- tự ký, phiên chỉ giữ bản băm của nó.

-- ─── 1 · Enum ──────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE "AgentMcpTokenKind" AS ENUM ('ACCESS', 'REFRESH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2 · Bảng ──────────────────────────────────────────────────────────────────────
-- Phiếu cài 2FA: CHỈ bản băm HMAC(pepper, "ph|" + mã). Người phát ≠ người nhận (ép ở tầng
-- quản trị); "phatBoiId" cố ý không khoá ngoại, như "createdById" của Đợt 0.
CREATE TABLE IF NOT EXISTS "AgentPhieuHaiLop" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maHash" TEXT NOT NULL,
    "phatBoiId" TEXT NOT NULL,
    "lyDo" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPhieuHaiLop_pkey" PRIMARY KEY ("id")
);

-- Một lần đồng ý = một phiên = một mã ủy quyền (dùng MỘT lần) + một chuỗi refresh.
CREATE TABLE IF NOT EXISTS "AgentMcpSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileClientId" TEXT NOT NULL,
    "oauthClientKey" TEXT NOT NULL,
    "clientName" TEXT,
    "redirectUri" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "environment" "AgentEnvironment" NOT NULL,
    "tools" TEXT[],
    "codeHash" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "codeUsedAt" TIMESTAMPTZ(6),
    "userTokenVersion" INTEGER NOT NULL,
    "matKhauDauVet" TEXT NOT NULL,
    "totpEnabledAt" TIMESTAMPTZ(6) NOT NULL,
    "kichHoatAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedReason" TEXT,
    "revokedById" TEXT,
    "lastUsedAt" TIMESTAMPTZ(6),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AgentMcpSession_pkey" PRIMARY KEY ("id")
);

-- Token MCP ("srm_…"): CHỈ bản băm, làm luôn khoá chính (tra theo băm, không bao giờ theo bản rõ).
CREATE TABLE IF NOT EXISTS "AgentMcpToken" (
    "tokenHash" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "AgentMcpTokenKind" NOT NULL,
    "environment" "AgentEnvironment" NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "parentHash" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMcpToken_pkey" PRIMARY KEY ("tokenHash")
);

-- ─── 3 · Cột mới trên bảng Đợt 0 ───────────────────────────────────────────────────
-- 2FA gắn phiếu (null = đường Đợt 0, không dùng được cho MCP) + khoá leo thang (câu 17).
ALTER TABLE "UserTotp" ADD COLUMN IF NOT EXISTS "phieuId" TEXT;
ALTER TABLE "UserTotp" ADD COLUMN IF NOT EXISTS "soLanKhoa" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserTotp" ADD COLUMN IF NOT EXISTS "demKhoaTu" TIMESTAMPTZ(6);
ALTER TABLE "UserTotp" ADD COLUMN IF NOT EXISTS "khoaCungAt" TIMESTAMPTZ(6);

-- Nhật ký lượt gọi MCP mang người thật + phiên. Vẫn KHÔNG khoá ngoại (nhật ký sống sau phiên).
ALTER TABLE "AgentToolCall" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "AgentToolCall" ADD COLUMN IF NOT EXISTS "mcpSessionId" TEXT;

-- ─── 4 · Chỉ mục ───────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "AgentPhieuHaiLop_maHash_key" ON "AgentPhieuHaiLop"("maHash");
CREATE INDEX IF NOT EXISTS "AgentPhieuHaiLop_userId_createdAt_idx" ON "AgentPhieuHaiLop"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMcpSession_codeHash_key" ON "AgentMcpSession"("codeHash");
CREATE INDEX IF NOT EXISTS "AgentMcpSession_userId_revokedAt_idx" ON "AgentMcpSession"("userId", "revokedAt");
CREATE INDEX IF NOT EXISTS "AgentMcpSession_profileClientId_idx" ON "AgentMcpSession"("profileClientId");
CREATE INDEX IF NOT EXISTS "AgentMcpSession_oauthClientKey_idx" ON "AgentMcpSession"("oauthClientKey");
CREATE INDEX IF NOT EXISTS "AgentMcpToken_sessionId_idx" ON "AgentMcpToken"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserTotp_phieuId_key" ON "UserTotp"("phieuId");
CREATE INDEX IF NOT EXISTS "AgentToolCall_userId_createdAt_idx" ON "AgentToolCall"("userId", "createdAt");

-- ─── 5 · Khoá ngoại ────────────────────────────────────────────────────────────────
-- RESTRICT (không CASCADE), như Đợt 0: xoá user/hồ sơ là xoá dấu vết ai đã nối gì, bằng phiếu
-- nào. Thu hồi = đổi trạng thái, không xoá dòng. "UserTotp"."phieuId" cũng RESTRICT: phiếu đã
-- kích hoạt một 2FA thì không xoá được khi 2FA đó còn (đặt lại 2FA = xoá dòng UserTotp trước).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentPhieuHaiLop_userId_fkey') THEN
    ALTER TABLE "AgentPhieuHaiLop" ADD CONSTRAINT "AgentPhieuHaiLop_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentMcpSession_userId_fkey') THEN
    ALTER TABLE "AgentMcpSession" ADD CONSTRAINT "AgentMcpSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentMcpSession_profileClientId_fkey') THEN
    ALTER TABLE "AgentMcpSession" ADD CONSTRAINT "AgentMcpSession_profileClientId_fkey"
      FOREIGN KEY ("profileClientId") REFERENCES "AgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentMcpToken_sessionId_fkey') THEN
    ALTER TABLE "AgentMcpToken" ADD CONSTRAINT "AgentMcpToken_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "AgentMcpSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserTotp_phieuId_fkey') THEN
    ALTER TABLE "UserTotp" ADD CONSTRAINT "UserTotp_phieuId_fkey"
      FOREIGN KEY ("phieuId") REFERENCES "AgentPhieuHaiLop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── 6 · RLS ───────────────────────────────────────────────────────────────────────
-- Bảng MỚI ra đời với RLS TẮT (sự cố 09/08: 31 bảng từng nằm trần qua PostgREST). Ba bảng này
-- giữ bản băm token MCP, mã ủy quyền, dấu vết mật khẩu và bản băm phiếu 2FA — càng không được
-- phơi. Chỉ ENABLE, không FORCE, không policy (khuôn `20260825120000_lead_status_history`).
-- "UserTotp" và "AgentToolCall" đã bật RLS ở Đợt 0.
ALTER TABLE "AgentPhieuHaiLop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentMcpSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentMcpToken" ENABLE ROW LEVEL SECURITY;
