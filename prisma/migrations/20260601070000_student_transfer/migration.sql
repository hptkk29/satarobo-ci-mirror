-- Cụm C1 — Chuyển lớp / chuyển cơ sở

CREATE TYPE "TransferRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WAITLISTED', 'CANCELLED');

CREATE TABLE "StudentTransferRequest" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "fromClassId" TEXT,
  "fromCenterId" TEXT,
  "toClassId" TEXT,
  "toCenterId" TEXT,
  "status" "TransferRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "note" TEXT,
  "requestedById" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentTransferRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentTransferRequest_studentId_status_idx" ON "StudentTransferRequest"("studentId","status");
CREATE INDEX "StudentTransferRequest_status_idx" ON "StudentTransferRequest"("status");
CREATE INDEX "StudentTransferRequest_toCenterId_idx" ON "StudentTransferRequest"("toCenterId");
ALTER TABLE "StudentTransferRequest" ADD CONSTRAINT "StudentTransferRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudentCenterHistory" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "centerId" TEXT NOT NULL,
  "fromDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "toDate" TIMESTAMP(3),
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentCenterHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentCenterHistory_studentId_idx" ON "StudentCenterHistory"("studentId");
CREATE INDEX "StudentCenterHistory_centerId_idx" ON "StudentCenterHistory"("centerId");
ALTER TABLE "StudentCenterHistory" ADD CONSTRAINT "StudentCenterHistory_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
