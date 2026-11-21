-- FL Wave 0 (W0-DB) — Foundation FixLMS. Tất cả ADDITIVE (an toàn 2-phase, không drop).
-- Nguồn: BA #07 mục 5 (delta model) + plan FL-fixlms-testday.md.
--   • Role +TRAINING (QĐ-T1) · EvalScope +SESSION_EVAL (FL4-01)
--   • Question +curriculumId/courseId/points/timeLimitSec (FL1-03)
--   • CoursePackage +courseId (FL1-05) · Assignment +templateId + model AssignmentTemplate (FL1-06)
--   • EvalResponse +classSessionId (FL4-01)
-- LƯU Ý: 2 ADD VALUE không được DÙNG trong chính migration này (an toàn trong transaction PG12+).

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'TRAINING';

-- AlterEnum
ALTER TYPE "EvalScope" ADD VALUE 'SESSION_EVAL';

-- AlterTable
ALTER TABLE "CoursePackage" ADD COLUMN     "courseId" TEXT;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "curriculumId" TEXT,
ADD COLUMN     "points" DOUBLE PRECISION,
ADD COLUMN     "timeLimitSec" INTEGER;

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "EvalResponse" ADD COLUMN     "classSessionId" TEXT;

-- CreateTable
CREATE TABLE "AssignmentTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT,
    "kind" "AssignmentKind" NOT NULL DEFAULT 'HOMEWORK',
    "lessonId" TEXT,
    "curriculumId" TEXT,
    "totalPoints" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "allowText" BOOLEAN NOT NULL DEFAULT true,
    "allowFile" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssignmentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentTemplate_lessonId_idx" ON "AssignmentTemplate"("lessonId");

-- CreateIndex
CREATE INDEX "AssignmentTemplate_curriculumId_idx" ON "AssignmentTemplate"("curriculumId");

-- CreateIndex
CREATE INDEX "CoursePackage_courseId_idx" ON "CoursePackage"("courseId");

-- CreateIndex
CREATE INDEX "Question_curriculumId_idx" ON "Question"("curriculumId");

-- CreateIndex
CREATE INDEX "Question_courseId_idx" ON "Question"("courseId");

-- CreateIndex
CREATE INDEX "Assignment_templateId_idx" ON "Assignment"("templateId");

-- CreateIndex
CREATE INDEX "EvalResponse_classSessionId_idx" ON "EvalResponse"("classSessionId");

-- AddForeignKey
ALTER TABLE "CoursePackage" ADD CONSTRAINT "CoursePackage_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssignmentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentTemplate" ADD CONSTRAINT "AssignmentTemplate_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentTemplate" ADD CONSTRAINT "AssignmentTemplate_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE SET NULL ON UPDATE CASCADE;
