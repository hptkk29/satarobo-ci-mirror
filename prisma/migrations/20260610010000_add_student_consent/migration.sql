-- R3-06 — StudentConsent (đồng ý dùng hình ảnh). Additive.

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('CLASS_MEDIA');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED');

-- CreateTable
CREATE TABLE "StudentConsent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentConsent_studentId_type_key" ON "StudentConsent"("studentId", "type");

-- CreateIndex
CREATE INDEX "StudentConsent_studentId_idx" ON "StudentConsent"("studentId");
