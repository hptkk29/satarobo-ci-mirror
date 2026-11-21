-- R7-11/R7-12 — SCORM package + access log.

-- CreateEnum
CREATE TYPE "ScormVersion" AS ENUM ('SCORM_12', 'SCORM_2004');

-- CreateEnum
CREATE TYPE "ScormPackageStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'FAILED', 'TESTING', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ScormPackage" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scormVersion" "ScormVersion",
    "storagePrefix" TEXT NOT NULL,
    "uploadKey" TEXT,
    "launchUrl" TEXT,
    "sizeBytes" INTEGER,
    "fileCount" INTEGER,
    "status" "ScormPackageStatus" NOT NULL DEFAULT 'UPLOADING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActiveForLesson" BOOLEAN NOT NULL DEFAULT false,
    "entryCursor" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScormPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScormAccessLog" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "classSessionId" TEXT,
    "userId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "ScormAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScormPackage_lessonId_idx" ON "ScormPackage"("lessonId");

-- CreateIndex
CREATE INDEX "ScormPackage_status_idx" ON "ScormPackage"("status");

-- CreateIndex
CREATE INDEX "ScormAccessLog_packageId_openedAt_idx" ON "ScormAccessLog"("packageId", "openedAt");

-- CreateIndex
CREATE INDEX "ScormAccessLog_userId_idx" ON "ScormAccessLog"("userId");

-- Partial unique: chỉ 1 bản active mỗi buổi (Prisma không khai báo partial index native).
CREATE UNIQUE INDEX "ScormPackage_active_per_lesson_key" ON "ScormPackage"("lessonId") WHERE "isActiveForLesson";

-- AddForeignKey
ALTER TABLE "ScormPackage" ADD CONSTRAINT "ScormPackage_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScormAccessLog" ADD CONSTRAINT "ScormAccessLog_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ScormPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
