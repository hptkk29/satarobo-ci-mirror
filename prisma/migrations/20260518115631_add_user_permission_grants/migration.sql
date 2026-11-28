-- Phase 5.3.0 — Per-user permission override system foundation.
-- Adds GrantType enum, User.tokenVersion/lastLoginAt, UserPermissionGrant model.

-- CreateEnum
CREATE TYPE "GrantType" AS ENUM ('ALLOW', 'DENY');

-- AlterTable User: thêm tokenVersion (force-logout) + lastLoginAt (audit)
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateTable UserPermissionGrant
CREATE TABLE "UserPermissionGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "grant" "GrantType" NOT NULL,
    "reason" TEXT,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionGrant_userId_action_key" ON "UserPermissionGrant"("userId", "action");
CREATE INDEX "UserPermissionGrant_userId_idx" ON "UserPermissionGrant"("userId");
CREATE INDEX "UserPermissionGrant_grantedBy_idx" ON "UserPermissionGrant"("grantedBy");

-- AddForeignKey
ALTER TABLE "UserPermissionGrant" ADD CONSTRAINT "UserPermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPermissionGrant" ADD CONSTRAINT "UserPermissionGrant_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
