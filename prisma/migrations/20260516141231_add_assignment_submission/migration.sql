-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'LATE', 'GRADED');

-- CreateTable
CREATE TABLE "Assignment" (
  "id"           TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT NOT NULL,
  "instructions" TEXT,
  "classId"      TEXT NOT NULL,
  "lessonId"     TEXT,
  "totalPoints"  DOUBLE PRECISION NOT NULL DEFAULT 10,
  "assignedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt"        TIMESTAMP(3),
  "allowText"    BOOLEAN NOT NULL DEFAULT true,
  "allowFile"    BOOLEAN NOT NULL DEFAULT true,
  "status"       "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assignment_status_classId_idx" ON "Assignment"("status", "classId");

-- CreateIndex
CREATE INDEX "Assignment_dueAt_idx" ON "Assignment"("dueAt");

-- CreateIndex
CREATE INDEX "Assignment_createdById_idx" ON "Assignment"("createdById");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AssignmentDocument" (
  "id"           TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "documentId"   TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentDocument_assignmentId_documentId_key" ON "AssignmentDocument"("assignmentId", "documentId");

-- CreateIndex
CREATE INDEX "AssignmentDocument_documentId_idx" ON "AssignmentDocument"("documentId");

-- AddForeignKey
ALTER TABLE "AssignmentDocument" ADD CONSTRAINT "AssignmentDocument_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentDocument" ADD CONSTRAINT "AssignmentDocument_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
  "id"           TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "studentId"    TEXT NOT NULL,
  "textAnswer"   TEXT,
  "fileUrl"      TEXT,
  "fileName"     TEXT,
  "fileSize"     INTEGER,
  "mimeType"     TEXT,
  "submittedAt"  TIMESTAMP(3),
  "status"       "SubmissionStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "score"        DOUBLE PRECISION,
  "feedback"     TEXT,
  "gradedAt"     TIMESTAMP(3),
  "gradedById"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_studentId_key" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_status_assignmentId_idx" ON "AssignmentSubmission"("status", "assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_studentId_idx" ON "AssignmentSubmission"("studentId");

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_gradedById_fkey"
  FOREIGN KEY ("gradedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
