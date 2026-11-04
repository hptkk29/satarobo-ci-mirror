-- Đơn từ GV (site giáo viên) — WorkRequest (10 loại / 3 nhóm), duyệt CENTER_MANAGER.
CREATE TYPE "WorkRequestKind" AS ENUM ('CLASS_CHANGE', 'SUB_TEACH', 'CLASS_OFF', 'SHIFT_SWAP', 'OT', 'LATE_EARLY', 'TIMESHEET_FIX', 'LEAVE', 'REMOTE', 'BUSINESS_TRIP');
CREATE TYPE "WorkRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "WorkRequest" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "centerId" TEXT,
  "kind" "WorkRequestKind" NOT NULL,
  "status" "WorkRequestStatus" NOT NULL DEFAULT 'PENDING',
  "fromDate" DATE,
  "toDate" DATE,
  "startTime" TEXT,
  "endTime" TEXT,
  "hours" DOUBLE PRECISION,
  "className" TEXT,
  "classId" TEXT,
  "targetUserId" TEXT,
  "targetShiftId" TEXT,
  "detail" TEXT,
  "reason" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewedByName" TEXT,
  "reviewedAt" TIMESTAMPTZ(6),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WorkRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkRequest_requesterId_status_idx" ON "WorkRequest"("requesterId", "status");
CREATE INDEX "WorkRequest_centerId_status_createdAt_idx" ON "WorkRequest"("centerId", "status", "createdAt");
