-- Phase 5.4.0 — Audit log foundation: 5 domain-specific audit log tables.
-- Pattern follows existing RoleAuditLog + EnrollmentAuditLog:
-- FK Cascade to target entity, nullable changedByUserId (no FK — defensive),
-- changedByName snapshot, reason Text + metadata Json for extensibility.

-- CreateTable UserAuditLog
CREATE TABLE "UserAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex UserAuditLog
CREATE INDEX "UserAuditLog_userId_createdAt_idx" ON "UserAuditLog"("userId", "createdAt");
CREATE INDEX "UserAuditLog_createdAt_idx" ON "UserAuditLog"("createdAt");
CREATE INDEX "UserAuditLog_changedByUserId_idx" ON "UserAuditLog"("changedByUserId");

-- AddForeignKey UserAuditLog
ALTER TABLE "UserAuditLog" ADD CONSTRAINT "UserAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable PermissionGrantAuditLog
CREATE TABLE "PermissionGrantAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantId" TEXT,
    "actionKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldGrant" TEXT,
    "newGrant" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionGrantAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex PermissionGrantAuditLog
CREATE INDEX "PermissionGrantAuditLog_userId_createdAt_idx" ON "PermissionGrantAuditLog"("userId", "createdAt");
CREATE INDEX "PermissionGrantAuditLog_createdAt_idx" ON "PermissionGrantAuditLog"("createdAt");
CREATE INDEX "PermissionGrantAuditLog_changedByUserId_idx" ON "PermissionGrantAuditLog"("changedByUserId");

-- AddForeignKey PermissionGrantAuditLog
ALTER TABLE "PermissionGrantAuditLog" ADD CONSTRAINT "PermissionGrantAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable LeadAuditLog
CREATE TABLE "LeadAuditLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex LeadAuditLog
CREATE INDEX "LeadAuditLog_leadId_createdAt_idx" ON "LeadAuditLog"("leadId", "createdAt");
CREATE INDEX "LeadAuditLog_createdAt_idx" ON "LeadAuditLog"("createdAt");
CREATE INDEX "LeadAuditLog_changedByUserId_idx" ON "LeadAuditLog"("changedByUserId");

-- AddForeignKey LeadAuditLog
ALTER TABLE "LeadAuditLog" ADD CONSTRAINT "LeadAuditLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ClassAuditLog
CREATE TABLE "ClassAuditLog" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex ClassAuditLog
CREATE INDEX "ClassAuditLog_classId_createdAt_idx" ON "ClassAuditLog"("classId", "createdAt");
CREATE INDEX "ClassAuditLog_createdAt_idx" ON "ClassAuditLog"("createdAt");
CREATE INDEX "ClassAuditLog_changedByUserId_idx" ON "ClassAuditLog"("changedByUserId");

-- AddForeignKey ClassAuditLog
ALTER TABLE "ClassAuditLog" ADD CONSTRAINT "ClassAuditLog_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable StudentAuditLog
CREATE TABLE "StudentAuditLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex StudentAuditLog
CREATE INDEX "StudentAuditLog_studentId_createdAt_idx" ON "StudentAuditLog"("studentId", "createdAt");
CREATE INDEX "StudentAuditLog_createdAt_idx" ON "StudentAuditLog"("createdAt");
CREATE INDEX "StudentAuditLog_changedByUserId_idx" ON "StudentAuditLog"("changedByUserId");

-- AddForeignKey StudentAuditLog
ALTER TABLE "StudentAuditLog" ADD CONSTRAINT "StudentAuditLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
