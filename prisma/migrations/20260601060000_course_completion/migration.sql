-- Cụm B4 — Hoàn thành khoá + chứng chỉ

CREATE TABLE "CourseCompletion" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "classId" TEXT,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalAssessment" TEXT,
  "finalGrade" TEXT,
  "certificateCode" TEXT NOT NULL,
  "nextCourseId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseCompletion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CourseCompletion_certificateCode_key" ON "CourseCompletion"("certificateCode");
CREATE UNIQUE INDEX "CourseCompletion_studentId_courseId_key" ON "CourseCompletion"("studentId","courseId");
CREATE INDEX "CourseCompletion_studentId_idx" ON "CourseCompletion"("studentId");
CREATE INDEX "CourseCompletion_courseId_idx" ON "CourseCompletion"("courseId");
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
