-- P2.2 — XÁC NHẬN CÔNG + KHIẾU NẠI CÔNG (11/10/2026). Additive: 3 enum + 3 bảng mới, không đụng bảng cũ.
--
-- Xác nhận gắn với (người × cơ sở × kỳ) — đúng tập ngày `lockPeriod` đóng băng — và mang VÂN TAY các cột
-- giá trị của bảng công lúc xác nhận. Tính lại sau đó làm vân tay lệch ⇒ màn hình tự thấy "cần xác nhận
-- lại", không cần móc vào mọi đường ghi.
-- Khiếu nại KHÔNG có đường ghi công riêng: nó là một luồng trao đổi + một cái chặn khoá kỳ.
-- Chạy lại được (luật [MIG-01]): TYPE/khoá ngoại bọc kiểm pg_type/pg_constraint, bảng/chỉ mục IF NOT EXISTS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttendanceConfirmationStatus') THEN
    CREATE TYPE "AttendanceConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'OVERRIDDEN');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttendanceDisputeStatus') THEN
    CREATE TYPE "AttendanceDisputeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'WAITING_EMPLOYEE', 'RESOLVED', 'REJECTED', 'CLOSED');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttendanceDisputeCategory') THEN
    CREATE TYPE "AttendanceDisputeCategory" AS ENUM ('MISSING_CHECKIN', 'MISSING_CHECKOUT', 'WRONG_SHIFT', 'WRONG_LEAVE', 'WRONG_OT', 'WRONG_WORKING_MINUTES', 'WRONG_LATE_EARLY', 'OTHER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AttendanceConfirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "periodKey" TEXT NOT NULL,
    "status" "AttendanceConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "snapshotHash" TEXT,
    "snapshotJson" JSONB,
    "confirmedAt" TIMESTAMPTZ(6),
    "confirmedById" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AttendanceConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceConfirmation_userId_centerId_periodKey_key" ON "AttendanceConfirmation"("userId", "centerId", "periodKey");
CREATE INDEX IF NOT EXISTS "AttendanceConfirmation_centerId_periodKey_idx" ON "AttendanceConfirmation"("centerId", "periodKey");
CREATE INDEX IF NOT EXISTS "AttendanceConfirmation_orgUnitId_idx" ON "AttendanceConfirmation"("orgUnitId");

CREATE TABLE IF NOT EXISTS "AttendanceDispute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "periodKey" TEXT NOT NULL,
    "workDate" DATE,
    "category" "AttendanceDisputeCategory" NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "status" "AttendanceDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "resolutionNote" TEXT,
    "linkedRequestId" TEXT,
    "handledById" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AttendanceDispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AttendanceDispute_centerId_periodKey_status_idx" ON "AttendanceDispute"("centerId", "periodKey", "status");
CREATE INDEX IF NOT EXISTS "AttendanceDispute_userId_periodKey_idx" ON "AttendanceDispute"("userId", "periodKey");
CREATE INDEX IF NOT EXISTS "AttendanceDispute_orgUnitId_idx" ON "AttendanceDispute"("orgUnitId");

CREATE TABLE IF NOT EXISTS "AttendanceDisputeMessage" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "statusFrom" "AttendanceDisputeStatus",
    "statusTo" "AttendanceDisputeStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDisputeMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AttendanceDisputeMessage_disputeId_createdAt_idx" ON "AttendanceDisputeMessage"("disputeId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceDisputeMessage_disputeId_fkey') THEN
    ALTER TABLE "AttendanceDisputeMessage" ADD CONSTRAINT "AttendanceDisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "AttendanceDispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "AttendanceConfirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceDispute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceDisputeMessage" ENABLE ROW LEVEL SECURITY;
