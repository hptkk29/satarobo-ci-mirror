-- Lộ trình chuyển cấp (Course.nextCourseId) + đề xuất hoàn thành khoá (site GV).
ALTER TABLE "Course" ADD COLUMN "nextCourseId" TEXT;
ALTER TABLE "Course" ADD CONSTRAINT "Course_nextCourseId_fkey" FOREIGN KEY ("nextCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "CourseCompletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "CourseCompletionRequest" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "centerId" TEXT,
  "requesterId" TEXT NOT NULL,
  "status" "CourseCompletionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "nextCourseId" TEXT,
  "note" TEXT,
  "reviewedById" TEXT,
  "reviewedByName" TEXT,
  "reviewedAt" TIMESTAMPTZ(6),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CourseCompletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseCompletionRequest_enrollmentId_status_idx" ON "CourseCompletionRequest"("enrollmentId", "status");
CREATE INDEX "CourseCompletionRequest_centerId_status_idx" ON "CourseCompletionRequest"("centerId", "status");
CREATE INDEX "CourseCompletionRequest_requesterId_status_idx" ON "CourseCompletionRequest"("requesterId", "status");
