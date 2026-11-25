-- Cụm C6 — MISA AMIS sync (skeleton) + IntegrationLog/IntegrationConfig

CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING', 'SUCCESS', 'SKIPPED', 'FAILED');
CREATE TYPE "IntegrationDirection" AS ENUM ('PUSH', 'PULL');

CREATE TABLE "IntegrationConfig" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntegrationConfig_provider_key" ON "IntegrationConfig"("provider");

CREATE TABLE "IntegrationLog" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "direction" "IntegrationDirection" NOT NULL DEFAULT 'PUSH',
  "action" TEXT NOT NULL,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING',
  "requestPayload" JSONB NOT NULL DEFAULT '{}',
  "responsePayload" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntegrationLog_provider_status_createdAt_idx" ON "IntegrationLog"("provider","status","createdAt");
