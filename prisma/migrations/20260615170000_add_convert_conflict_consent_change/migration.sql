-- AlterEnum (additive)
ALTER TYPE "ParentRequestType" ADD VALUE 'CONSENT_CHANGE';

-- CreateEnum
CREATE TYPE "ConvertConflictStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "ConvertConflict" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "parentAId" TEXT NOT NULL,
    "parentBId" TEXT NOT NULL,
    "status" "ConvertConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConvertConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConvertConflict_leadId_status_idx" ON "ConvertConflict"("leadId", "status");
CREATE INDEX "ConvertConflict_status_idx" ON "ConvertConflict"("status");
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");
CREATE INDEX "IdempotencyKey_scope_createdAt_idx" ON "IdempotencyKey"("scope", "createdAt");
