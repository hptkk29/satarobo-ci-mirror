-- Module Quản lý lớp PHẦN 1 — ClassStatus PENDING_APPROVAL + approval fields
ALTER TYPE "ClassStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' BEFORE 'ACTIVE';

ALTER TABLE "Class" ADD COLUMN "submittedForApprovalAt" TIMESTAMP(3);
ALTER TABLE "Class" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Class" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "Class" ADD COLUMN "approvedByName" TEXT;
