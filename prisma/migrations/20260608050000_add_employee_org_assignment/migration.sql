-- A0-08 — EmployeeOrgAssignment (Doc 15 §2.2). Bảng mới, additive. KHÔNG sinh quyền.

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('PRIMARY', 'SECONDARY', 'SUPPORT', 'SUBSTITUTE', 'SHARED');

-- CreateTable
CREATE TABLE "EmployeeOrgAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "roleInOrg" TEXT,
    "assignmentType" "AssignmentType" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "status" "AssignStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocationPercent" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeOrgAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeOrgAssignment_employeeId_status_idx" ON "EmployeeOrgAssignment"("employeeId", "status");

-- CreateIndex
CREATE INDEX "EmployeeOrgAssignment_orgUnitId_status_idx" ON "EmployeeOrgAssignment"("orgUnitId", "status");
