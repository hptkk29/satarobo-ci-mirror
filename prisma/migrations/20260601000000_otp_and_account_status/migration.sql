-- Cụm A1 — OTP service + trạng thái kích hoạt tài khoản

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED');
CREATE TYPE "OtpChannel" AS ENUM ('EMAIL', 'SMS');
CREATE TYPE "OtpPurpose" AS ENUM ('ACTIVATION', 'RESET', 'CHANGE_CONTACT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "OtpRequest" (
  "id" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "channel" "OtpChannel" NOT NULL DEFAULT 'EMAIL',
  "purpose" "OtpPurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "verifiedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpDeliveryLog" (
  "id" TEXT NOT NULL,
  "otpRequestId" TEXT NOT NULL,
  "channel" "OtpChannel" NOT NULL,
  "target" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpRequest_target_purpose_createdAt_idx" ON "OtpRequest"("target", "purpose", "createdAt");
CREATE INDEX "OtpRequest_expiresAt_idx" ON "OtpRequest"("expiresAt");
CREATE INDEX "OtpDeliveryLog_otpRequestId_idx" ON "OtpDeliveryLog"("otpRequestId");
CREATE INDEX "OtpDeliveryLog_target_createdAt_idx" ON "OtpDeliveryLog"("target", "createdAt");

-- AddForeignKey
ALTER TABLE "OtpDeliveryLog" ADD CONSTRAINT "OtpDeliveryLog_otpRequestId_fkey" FOREIGN KEY ("otpRequestId") REFERENCES "OtpRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
