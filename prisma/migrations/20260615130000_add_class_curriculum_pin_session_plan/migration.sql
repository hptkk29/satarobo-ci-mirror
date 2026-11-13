-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'CANCELLED';

-- AlterTable Class — pin curriculum version (snapshot)
ALTER TABLE "Class" ADD COLUMN "curriculumId" TEXT;
ALTER TABLE "Class" ADD COLUMN "curriculumVersion" INTEGER;

-- AlterTable ClassSession — trỏ tới ClassSessionPlan
ALTER TABLE "ClassSession" ADD COLUMN "planId" TEXT;

-- CreateTable
CREATE TABLE "ClassSessionPlan" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "lessonId" TEXT,
    "customTitle" TEXT,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSessionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassSessionPlan_classId_order_idx" ON "ClassSessionPlan"("classId", "order");

-- CreateIndex
CREATE INDEX "ClassSession_planId_idx" ON "ClassSession"("planId");

-- AddForeignKey
ALTER TABLE "ClassSessionPlan" ADD CONSTRAINT "ClassSessionPlan_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ClassSessionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
