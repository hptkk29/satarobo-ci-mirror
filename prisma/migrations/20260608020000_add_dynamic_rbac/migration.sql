-- A0-02 — RBAC động: RoleDef + RolePermission + UserOrgRole + RbacAuditLog (Doc 15 §2.2/§2.3).

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('GLOBAL', 'CENTER', 'CLASS', 'OWN', 'CHILDREN', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "AssignStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "RoleDef" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","action")
);

-- CreateTable
CREATE TABLE "UserOrgRole" (
    "userId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "status" "AssignStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOrgRole_pkey" PRIMARY KEY ("userId","orgUnitId","roleId")
);

-- CreateTable
CREATE TABLE "RbacAuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RbacAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleDef_code_key" ON "RoleDef"("code");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE INDEX "UserOrgRole_userId_idx" ON "UserOrgRole"("userId");

-- CreateIndex
CREATE INDEX "UserOrgRole_orgUnitId_idx" ON "UserOrgRole"("orgUnitId");

-- CreateIndex
CREATE INDEX "UserOrgRole_roleId_idx" ON "UserOrgRole"("roleId");

-- CreateIndex
CREATE INDEX "RbacAuditLog_entity_entityId_idx" ON "RbacAuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "RbacAuditLog_changedByUserId_idx" ON "RbacAuditLog"("changedByUserId");

-- CreateIndex
CREATE INDEX "RbacAuditLog_createdAt_idx" ON "RbacAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrgRole" ADD CONSTRAINT "UserOrgRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
