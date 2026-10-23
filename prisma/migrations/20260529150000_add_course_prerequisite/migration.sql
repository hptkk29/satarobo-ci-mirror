-- FIX 7 — CoursePrerequisite (khoá tiên quyết, cấu hình qua UI admin)
CREATE TABLE "CoursePrerequisite" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "requiredCourseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoursePrerequisite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoursePrerequisite_courseId_requiredCourseId_key" ON "CoursePrerequisite"("courseId", "requiredCourseId");
CREATE INDEX "CoursePrerequisite_courseId_idx" ON "CoursePrerequisite"("courseId");
CREATE INDEX "CoursePrerequisite_requiredCourseId_idx" ON "CoursePrerequisite"("requiredCourseId");

ALTER TABLE "CoursePrerequisite" ADD CONSTRAINT "CoursePrerequisite_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePrerequisite" ADD CONSTRAINT "CoursePrerequisite_requiredCourseId_fkey" FOREIGN KEY ("requiredCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
