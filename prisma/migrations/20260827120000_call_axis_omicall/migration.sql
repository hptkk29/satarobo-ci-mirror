-- TRỤC GỌI ĐIỆN + GHI ÂM (OmiCall) — spec `plan/20-SPEC-TICH-HOP-ZALO-OMICALL-AI.md` §5.
--
-- CHỈ THÊM: 6 enum + 3 bảng MỚI. KHÔNG ALTER, KHÔNG DROP, KHÔNG đụng bảng nào
-- đang có dữ liệu (luật cứng #4). Rollback = DROP 3 bảng + 6 enum.
--
-- ⚠️ NGƯỜI VẬN HÀNH CHẠY TAY. Agent KHÔNG chạy migration trên bất kỳ DB nào.
--    Nhớ: DB của môi trường `test` CHÍNH LÀ DB dev (CLAUDE.md) — chạy ở local là
--    hiện luôn trên test.satarobo.vn.
--
-- CreateEnum
CREATE TYPE "CallProvider" AS ENUM ('OMICALL');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CallTechStatus" AS ENUM ('INITIATED', 'RINGING', 'ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('INTERESTED', 'CALL_BACK', 'REFUSED', 'WRONG_NUMBER', 'WRONG_PERSON');

-- CreateEnum
CREATE TYPE "CallPurpose" AS ENUM ('CARE', 'ADVERTISING');

-- CreateEnum
CREATE TYPE "CallRecordingNotice" AS ENUM ('NOT_ANNOUNCED', 'ANNOUNCED', 'REFUSED');

-- CreateEnum
CREATE TYPE "CallDncSource" AS ENUM ('CUSTOMER_REQUEST', 'PROVIDER', 'MANUAL');

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "provider" "CallProvider" NOT NULL DEFAULT 'OMICALL',
    "providerCallId" TEXT NOT NULL,
    "userId" TEXT,
    "extension" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "leadId" TEXT,
    "studentId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "peerPhone" TEXT,
    "didNumber" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "answeredAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),
    "talkSeconds" INTEGER,
    "billSeconds" INTEGER,
    "techStatus" "CallTechStatus" NOT NULL DEFAULT 'INITIATED',
    "statusRank" INTEGER NOT NULL DEFAULT 0,
    "outcome" "CallOutcome",
    "note" TEXT,
    "purpose" "CallPurpose",
    "purposeSetById" TEXT,
    "purposeSetAt" TIMESTAMPTZ(6),
    "hasRecording" BOOLEAN NOT NULL DEFAULT false,
    "recordingKey" TEXT,
    "recordingBytes" INTEGER,
    "recordingNotice" "CallRecordingNotice" NOT NULL DEFAULT 'NOT_ANNOUNCED',
    "recordingPurgeAfterAt" TIMESTAMPTZ(6),
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "providerEventSeq" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "costAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallExtension" (
    "id" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "defaultDidNumber" TEXT,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CallExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallDoNotCall" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" "CallDncSource" NOT NULL DEFAULT 'CUSTOMER_REQUEST',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "CallDoNotCall_pkey" PRIMARY KEY ("id")
);

-- OC-1 — KHOÁ CHỐNG TRÙNG. Tài liệu OMICall tự ghi `transaction_id` "có thể gửi
-- nhiều lần"; thiếu chỉ mục này thì mỗi lần gửi lại là một dòng KPI mới.
CREATE UNIQUE INDEX "CallLog_provider_providerCallId_key" ON "CallLog"("provider", "providerCallId");

CREATE INDEX "CallLog_centerId_startedAt_idx" ON "CallLog"("centerId", "startedAt");

CREATE INDEX "CallLog_leadId_startedAt_idx" ON "CallLog"("leadId", "startedAt");

CREATE INDEX "CallLog_userId_startedAt_idx" ON "CallLog"("userId", "startedAt");

CREATE INDEX "CallLog_needsReview_startedAt_idx" ON "CallLog"("needsReview", "startedAt");

CREATE INDEX "CallLog_peerPhone_idx" ON "CallLog"("peerPhone");

CREATE INDEX "CallLog_orgUnitId_idx" ON "CallLog"("orgUnitId");

CREATE INDEX "CallLog_hasRecording_recordingPurgeAfterAt_idx" ON "CallLog"("hasRecording", "recordingPurgeAfterAt");

CREATE INDEX "CallExtension_extension_effectiveFrom_idx" ON "CallExtension"("extension", "effectiveFrom");

CREATE INDEX "CallExtension_userId_idx" ON "CallExtension"("userId");

CREATE INDEX "CallExtension_centerId_idx" ON "CallExtension"("centerId");

CREATE INDEX "CallExtension_orgUnitId_idx" ON "CallExtension"("orgUnitId");

CREATE UNIQUE INDEX "CallDoNotCall_phone_key" ON "CallDoNotCall"("phone");

-- RLS: bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT
-- LẦN, và 31 bảng sinh sau nó đã từng nằm trần cho anon/authenticated — sự cố 09/08).
-- Không có ba dòng này thì lịch sử cuộc gọi + số điện thoại phụ huynh + khoá tệp ghi
-- âm phơi qua PostgREST.
ALTER TABLE "CallLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallExtension" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallDoNotCall" ENABLE ROW LEVEL SECURITY;
