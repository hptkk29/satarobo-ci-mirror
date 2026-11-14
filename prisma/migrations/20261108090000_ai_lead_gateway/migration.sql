-- AI LEAD GATEWAY (07/11/2026): cổng nhận lead từ AI Agent Messenger. Thiết kế: docs/ai-lead-admin/03-Architecture/design.md §2.
-- Agent CHỈ GHI (không đọc lại lead/liên hệ/sale/nguồn); lead chính thức chỉ tạo qua ingestIntakeLead ở lớp dịch vụ.
--
-- ⚠️ CHỈ THÊM: 13 enum + 11 bảng MỚI + ràng buộc/chỉ mục của chúng. KHÔNG đụng bảng đang có dữ liệu PROD (luật cứng #4: không ALTER/DROP
--    cột nào của bảng cũ; khoá ngoại duy nhất vào bảng cũ là AiLeadCampusPublication → "Center", nằm ở bảng mới), không backfill, không seed.
--    Bảng rỗng ⇒ Gateway tắt (cờ AI_LEAD_GATEWAY_ENABLED) và các màn trống cho tới khi HO cấu hình Page.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): mọi câu có IF NOT EXISTS / kiểm pg_type, pg_constraint — một lượt bị ngắt giữa chừng không để lại
--    dòng FAILED chặn mọi `migrate deploy` sau đó (P3009).
-- ⚠️ Chỉ mục TỪNG PHẦN (`AiLeadDraft_conversationId_intent_open_key`) và các CHECK chỉ có ở SQL — Prisma không biểu diễn được.
--    Hệ quả đã biết, cùng loại với `PaymentBill_orderId_open_key`: `prisma migrate diff` có thể liệt kê chỉ mục đó như "thừa".
-- ⚠️ Quyền mới (ai-leads:*, ai-integration:*) ⇒ lên `main` phải bấm `seed-prod-roles.yml`.

-- ─── Enum ───────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadEnvironment') THEN
        CREATE TYPE "AiLeadEnvironment" AS ENUM ('TEST', 'PROD');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadContractStatus') THEN
        CREATE TYPE "AiLeadContractStatus" AS ENUM ('COMPATIBLE', 'DEPRECATED', 'INCOMPATIBLE');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadPageState') THEN
        CREATE TYPE "AiLeadPageState" AS ENUM ('ENABLED', 'PAUSED');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadFbNameSource') THEN
        CREATE TYPE "AiLeadFbNameSource" AS ENUM ('META_PROFILE_API', 'WEBHOOK_PAYLOAD', 'CUSTOMER_STATED');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadOwnerState') THEN
        CREATE TYPE "AiLeadOwnerState" AS ENUM ('AI_ACTIVE', 'HANDOFF_REQUESTED', 'TAKEOVER_PENDING', 'HUMAN_ACTIVE', 'PAUSED');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadTakeoverSource') THEN
        CREATE TYPE "AiLeadTakeoverSource" AS ENUM ('AGENT_REPORTED', 'STAFF_ATTESTED');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadIntent') THEN
        CREATE TYPE "AiLeadIntent" AS ENUM ('CONSULTATION_REQUEST', 'ENROLLMENT_REQUEST', 'TRIAL_CLASS_REQUEST');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadDraftState') THEN
        CREATE TYPE "AiLeadDraftState" AS ENUM ('COLLECTING', 'PENDING_INFO', 'WAITING_QLCS', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'COMPLETED', 'REJECTED', 'EXPIRED', 'SYSTEM_EXCEPTION', 'ASSIGNMENT_PENDING');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadSeverity') THEN
        CREATE TYPE "AiLeadSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadIncidentState') THEN
        CREATE TYPE "AiLeadIncidentState" AS ENUM ('OPEN', 'ACKED', 'RESOLVED');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadVerificationLevel') THEN
        CREATE TYPE "AiLeadVerificationLevel" AS ENUM ('L1', 'L2', 'L3', 'L4');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadVerificationStatus') THEN
        CREATE TYPE "AiLeadVerificationStatus" AS ENUM ('PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'MOCK_ONLY', 'STALE');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLeadVerificationKind') THEN
        CREATE TYPE "AiLeadVerificationKind" AS ENUM ('CONTRACT', 'PROBE', 'E2E', 'PILOT');
    END IF;
END $$;

-- ─── AiLeadAgent ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" "AiLeadEnvironment" NOT NULL,
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "contractStatus" "AiLeadContractStatus" NOT NULL DEFAULT 'COMPATIBLE',
    "lastHeartbeatAt" TIMESTAMPTZ(6),
    "lastAgentVersion" TEXT,
    "lastBuildSha" TEXT,
    "lastContractHash" TEXT,
    "lastHeartbeatPayload" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AiLeadAgent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiLeadAgent_secretVersion_check" CHECK ("secretVersion" >= 1)
);

CREATE INDEX IF NOT EXISTS "AiLeadAgent_active_environment_idx" ON "AiLeadAgent"("active", "environment");

-- ─── AiLeadAgentPage ────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadAgentPage" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "state" "AiLeadPageState" NOT NULL DEFAULT 'ENABLED',
    "routingCenterId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AiLeadAgentPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadAgentPage_agentId_pageId_key" ON "AiLeadAgentPage"("agentId", "pageId");
CREATE INDEX IF NOT EXISTS "AiLeadAgentPage_pageId_idx" ON "AiLeadAgentPage"("pageId");

-- ─── AiLeadCampusPublication ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadCampusPublication" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "campusCenterId" TEXT NOT NULL,
    "acceptingLeads" BOOLEAN NOT NULL DEFAULT true,
    "publicVisible" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AiLeadCampusPublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadCampusPublication_pageId_campusCenterId_key" ON "AiLeadCampusPublication"("pageId", "campusCenterId");
CREATE INDEX IF NOT EXISTS "AiLeadCampusPublication_campusCenterId_idx" ON "AiLeadCampusPublication"("campusCenterId");

-- ─── AiLeadCatalogSnapshot ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadCatalogSnapshot" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "payload" JSONB NOT NULL,
    "etag" TEXT NOT NULL,

    CONSTRAINT "AiLeadCatalogSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiLeadCatalogSnapshot_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadCatalogSnapshot_version_key" ON "AiLeadCatalogSnapshot"("version");

-- ─── AiLeadNonce ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadNonce" (
    "agentId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLeadNonce_pkey" PRIMARY KEY ("agentId", "nonce")
);

CREATE INDEX IF NOT EXISTS "AiLeadNonce_createdAt_idx" ON "AiLeadNonce"("createdAt");

-- ─── AiLeadRequest ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLeadRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadRequest_agentId_idempotencyKey_key" ON "AiLeadRequest"("agentId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "AiLeadRequest_createdAt_idx" ON "AiLeadRequest"("createdAt");

-- ─── AiLeadConversation ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadConversation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "psid" TEXT NOT NULL,
    "fbName" TEXT,
    "fbNameSource" "AiLeadFbNameSource",
    "inboxThreadId" TEXT,
    "claimSource" TEXT NOT NULL DEFAULT 'AGENT_ASSERTED',
    "ownerState" "AiLeadOwnerState" NOT NULL DEFAULT 'AI_ACTIVE',
    "holdingSentAt" TIMESTAMPTZ(6),
    "staffClaimedById" TEXT,
    "staffClaimedAt" TIMESTAMPTZ(6),
    "takeoverConfirmedAt" TIMESTAMPTZ(6),
    "takeoverConfirmSource" "AiLeadTakeoverSource",
    "lastEventAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AiLeadConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadConversation_agentId_pageId_psid_key" ON "AiLeadConversation"("agentId", "pageId", "psid");
CREATE INDEX IF NOT EXISTS "AiLeadConversation_pageId_ownerState_idx" ON "AiLeadConversation"("pageId", "ownerState");
CREATE INDEX IF NOT EXISTS "AiLeadConversation_lastEventAt_idx" ON "AiLeadConversation"("lastEventAt");

-- ─── AiLeadDraft ────────────────────────────────────────────────────────────────────────────────────────────────
-- Bảng DUY NHẤT mang cột cách ly cơ sở. `centerId` NULL = chưa biết cơ sở ⇒ chỉ cấp Hội sở thấy (KHÔNG phải dùng chung).
CREATE TABLE IF NOT EXISTS "AiLeadDraft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "intent" "AiLeadIntent" NOT NULL,
    "state" "AiLeadDraftState" NOT NULL DEFAULT 'COLLECTING',
    "fbName" TEXT,
    "fbNameSource" "AiLeadFbNameSource",
    "phoneRaw" TEXT,
    "phoneCanonical" TEXT,
    "campusCode" TEXT,
    "campusCenterId" TEXT,
    "consentAllowed" BOOLEAN NOT NULL DEFAULT false,
    "consentMid" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMPTZ(6),
    "slaClaimDueAt" TIMESTAMPTZ(6),
    "slaResolveDueAt" TIMESTAMPTZ(6),
    "leadId" TEXT,
    "resultNote" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "closedAt" TIMESTAMPTZ(6),

    CONSTRAINT "AiLeadDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiLeadDraft_version_check" CHECK ("version" >= 1)
);

CREATE INDEX IF NOT EXISTS "AiLeadDraft_centerId_state_idx" ON "AiLeadDraft"("centerId", "state");
CREATE INDEX IF NOT EXISTS "AiLeadDraft_orgUnitId_idx" ON "AiLeadDraft"("orgUnitId");
CREATE INDEX IF NOT EXISTS "AiLeadDraft_conversationId_idx" ON "AiLeadDraft"("conversationId");
CREATE INDEX IF NOT EXISTS "AiLeadDraft_state_slaClaimDueAt_idx" ON "AiLeadDraft"("state", "slaClaimDueAt");

-- MỘT hồ sơ MỞ mỗi (hội thoại, ý định). "Mở" = chưa vào trạng thái cuối (COMPLETED / REJECTED / EXPIRED / ASSIGNMENT_PENDING — design §4.1;
-- ASSIGNMENT_PENDING = lead đã tạo, chỉ còn chờ chia chủ, nên yêu cầu mới của khách phải mở hồ sơ MỚI).
-- Chỉ mục TỪNG PHẦN: đây là cái gác thật khi hai lượt /lead-intakes đồng thời cho cùng một hội thoại (lớp dịch vụ bắt P2002 và gộp vào hồ sơ có sẵn).
CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadDraft_conversationId_intent_open_key"
    ON "AiLeadDraft"("conversationId", "intent")
    WHERE "state" NOT IN ('COMPLETED', 'REJECTED', 'EXPIRED', 'ASSIGNMENT_PENDING');

-- ─── AiLeadIncident ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadIncident" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "detailCode" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "severity" "AiLeadSeverity" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" "AiLeadIncidentState" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "lastCorrelationId" TEXT,

    CONSTRAINT "AiLeadIncident_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiLeadIncident_count_check" CHECK ("count" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadIncident_agentId_pageId_category_detailCode_day_key" ON "AiLeadIncident"("agentId", "pageId", "category", "detailCode", "day");
CREATE INDEX IF NOT EXISTS "AiLeadIncident_state_lastSeenAt_idx" ON "AiLeadIncident"("state", "lastSeenAt");

-- ─── AiLeadProbe ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadProbe" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "probeId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "ackedAt" TIMESTAMPTZ(6),

    CONSTRAINT "AiLeadProbe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadProbe_probeId_key" ON "AiLeadProbe"("probeId");
CREATE INDEX IF NOT EXISTS "AiLeadProbe_agentId_expiresAt_idx" ON "AiLeadProbe"("agentId", "expiresAt");

-- ─── AiLeadVerificationRun ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiLeadVerificationRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "level" "AiLeadVerificationLevel" NOT NULL,
    "status" "AiLeadVerificationStatus" NOT NULL,
    "kind" "AiLeadVerificationKind" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "contractHash" TEXT,
    "buildSha" TEXT,
    "correlationId" TEXT,
    "runById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLeadVerificationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiLeadVerificationRun_agentId_level_createdAt_idx" ON "AiLeadVerificationRun"("agentId", "level", "createdAt");

-- ─── Khoá ngoại (kiểm pg_constraint để chạy lại được) ───────────────────────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadAgentPage_agentId_fkey') THEN
        ALTER TABLE "AiLeadAgentPage" ADD CONSTRAINT "AiLeadAgentPage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiLeadAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadCampusPublication_campusCenterId_fkey') THEN
        ALTER TABLE "AiLeadCampusPublication" ADD CONSTRAINT "AiLeadCampusPublication_campusCenterId_fkey" FOREIGN KEY ("campusCenterId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadNonce_agentId_fkey') THEN
        ALTER TABLE "AiLeadNonce" ADD CONSTRAINT "AiLeadNonce_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiLeadAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadRequest_agentId_fkey') THEN
        ALTER TABLE "AiLeadRequest" ADD CONSTRAINT "AiLeadRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiLeadAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadConversation_agentId_fkey') THEN
        ALTER TABLE "AiLeadConversation" ADD CONSTRAINT "AiLeadConversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiLeadAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadDraft_conversationId_fkey') THEN
        ALTER TABLE "AiLeadDraft" ADD CONSTRAINT "AiLeadDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiLeadConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadIncident_agentId_fkey') THEN
        ALTER TABLE "AiLeadIncident" ADD CONSTRAINT "AiLeadIncident_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiLeadAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadProbe_agentId_fkey') THEN
        ALTER TABLE "AiLeadProbe" ADD CONSTRAINT "AiLeadProbe_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiLeadAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiLeadVerificationRun_agentId_fkey') THEN
        ALTER TABLE "AiLeadVerificationRun" ADD CONSTRAINT "AiLeadVerificationRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiLeadAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ─── RLS: bảng MỚI tự bật (chỉ ENABLE, không FORCE, không policy) — khuôn 20260825120000_lead_status_history. Chạy lại vô hại. ───
ALTER TABLE "AiLeadAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadAgentPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadCampusPublication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadCatalogSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadNonce" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadIncident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadProbe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLeadVerificationRun" ENABLE ROW LEVEL SECURITY;
