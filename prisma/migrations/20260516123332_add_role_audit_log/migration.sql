-- CreateTable
CREATE TABLE "RoleAuditLog" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromRole" TEXT NOT NULL,
    "toRole" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleAuditLog_employeeId_createdAt_idx" ON "RoleAuditLog"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "RoleAuditLog_createdAt_idx" ON "RoleAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RoleAuditLog" ADD CONSTRAINT "RoleAuditLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
