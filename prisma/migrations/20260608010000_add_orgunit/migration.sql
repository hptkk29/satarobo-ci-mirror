-- A0-01 — OrgUnit tree (Doc 15 §2.1, OI-1). Additive thuần, không đụng Center/User.

-- CreateEnum
CREATE TYPE "OrgUnitType" AS ENUM ('ROOT', 'HO', 'CENTER', 'CAMPUS', 'PARTNER', 'FRANCHISE');

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "type" "OrgUnitType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "parentId" TEXT,
    "centerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_code_key" ON "OrgUnit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_centerId_key" ON "OrgUnit"("centerId");

-- CreateIndex
CREATE INDEX "OrgUnit_type_idx" ON "OrgUnit"("type");

-- CreateIndex
CREATE INDEX "OrgUnit_parentId_idx" ON "OrgUnit"("parentId");

-- CreateIndex
CREATE INDEX "OrgUnit_deletedAt_idx" ON "OrgUnit"("deletedAt");

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
