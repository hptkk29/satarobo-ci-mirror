-- Phase NHÓM 3 — Yêu cầu phụ huynh (báo vắng/học bù/chuyển lớp/chuyển cơ sở/bảo lưu).
CREATE TYPE "ParentRequestType" AS ENUM ('ABSENCE', 'MAKEUP', 'TRANSFER_CLASS', 'TRANSFER_CENTER', 'RESERVE', 'OTHER');
CREATE TYPE "ParentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "ParentRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "parentUserId" TEXT,
    "type" "ParentRequestType" NOT NULL,
    "content" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3),
    "status" "ParentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "response" TEXT,
    "handledById" TEXT,
    "handledByName" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParentRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParentRequest_studentId_idx" ON "ParentRequest"("studentId");
CREATE INDEX "ParentRequest_status_createdAt_idx" ON "ParentRequest"("status", "createdAt");
CREATE INDEX "ParentRequest_parentUserId_idx" ON "ParentRequest"("parentUserId");

ALTER TABLE "ParentRequest"
  ADD CONSTRAINT "ParentRequest_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
