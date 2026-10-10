-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('INCOMPLETE', 'COMPLETE', 'IN_USE', 'NEEDS_UPDATE', 'LOCKED');

-- CreateEnum
CREATE TYPE "LessonChangeStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');

-- AlterEnum
ALTER TYPE "CurriculumStatus" ADD VALUE 'UNPUBLISHED';

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "actualEndAt" TIMESTAMP(3),
ADD COLUMN     "actualRoomId" TEXT,
ADD COLUMN     "actualStartAt" TIMESTAMP(3),
ADD COLUMN     "actualTeacherId" TEXT,
ADD COLUMN     "classComment" TEXT,
ADD COLUMN     "completedById" TEXT;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT,
ADD COLUMN     "status" "LessonStatus" NOT NULL DEFAULT 'INCOMPLETE',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LessonChangeRequest" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "LessonChangeStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonChangeRequest_lessonId_idx" ON "LessonChangeRequest"("lessonId");

-- CreateIndex
CREATE INDEX "LessonChangeRequest_status_idx" ON "LessonChangeRequest"("status");

-- CreateIndex
CREATE INDEX "Lesson_status_idx" ON "Lesson"("status");

-- AddForeignKey
ALTER TABLE "LessonChangeRequest" ADD CONSTRAINT "LessonChangeRequest_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

