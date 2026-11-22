-- Phase T0.2 — ClassGroup (lớp cố định, nhóm đi cùng nhau qua các khoá)

-- CreateEnum
CREATE TYPE "ClassGroupStatus" AS ENUM ('ACTIVE', 'GRADUATED', 'DISBANDED');

-- CreateTable
CREATE TABLE "ClassGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "name" TEXT,
    "centerId" TEXT NOT NULL,
    "status" "ClassGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassGroup_code_key" ON "ClassGroup"("code");
CREATE INDEX "ClassGroup_centerId_idx" ON "ClassGroup"("centerId");
CREATE INDEX "ClassGroup_status_idx" ON "ClassGroup"("status");
CREATE INDEX "ClassGroup_deletedAt_idx" ON "ClassGroup"("deletedAt");

-- AddForeignKey
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Class.classGroupId
ALTER TABLE "Class" ADD COLUMN "classGroupId" TEXT;
CREATE INDEX "Class_classGroupId_idx" ON "Class"("classGroupId");
ALTER TABLE "Class" ADD CONSTRAINT "Class_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
