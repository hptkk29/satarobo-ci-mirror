-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "CourseCategoryDef" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCategoryDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkShiftConfig" (
    "id" TEXT NOT NULL,
    "centerId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "toleranceMinutes" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkShiftConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategoryDef_code_key" ON "CourseCategoryDef"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategoryDef_slug_key" ON "CourseCategoryDef"("slug");

-- CreateIndex
CREATE INDEX "WorkShiftConfig_centerId_isActive_idx" ON "WorkShiftConfig"("centerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkShiftConfig_centerId_code_key" ON "WorkShiftConfig"("centerId", "code");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategoryDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
