-- CreateEnum
CREATE TYPE "HomeworkAssignmentStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'GRADED', 'MISSED');

-- AlterTable
ALTER TABLE "ClassSessionMedia" ADD COLUMN     "classSessionId" TEXT,
ADD COLUMN     "takenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HomeworkAssignment" (
    "id" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "HomeworkAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignMode" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeworkAssignment_studentId_idx" ON "HomeworkAssignment"("studentId");

-- CreateIndex
CREATE INDEX "HomeworkAssignment_examId_idx" ON "HomeworkAssignment"("examId");

-- CreateIndex
CREATE INDEX "HomeworkAssignment_classSessionId_idx" ON "HomeworkAssignment"("classSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkAssignment_classSessionId_examId_studentId_key" ON "HomeworkAssignment"("classSessionId", "examId", "studentId");

-- CreateIndex
CREATE INDEX "ClassSessionMedia_classSessionId_idx" ON "ClassSessionMedia"("classSessionId");

