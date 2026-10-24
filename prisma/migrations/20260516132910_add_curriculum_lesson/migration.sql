-- CreateTable
CREATE TABLE "Curriculum" (
  "id"          TEXT NOT NULL,
  "courseId"    TEXT NOT NULL,
  "version"     INTEGER NOT NULL DEFAULT 1,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Curriculum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Curriculum_courseId_version_key" ON "Curriculum"("courseId", "version");

-- CreateIndex
CREATE INDEX "Curriculum_courseId_isActive_idx" ON "Curriculum"("courseId", "isActive");

-- AddForeignKey
ALTER TABLE "Curriculum"
  ADD CONSTRAINT "Curriculum_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Lesson" (
  "id"           TEXT NOT NULL,
  "curriculumId" TEXT NOT NULL,
  "order"        INTEGER NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "content"      TEXT,
  "duration"     INTEGER NOT NULL DEFAULT 90,
  "objectives"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "materials"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_curriculumId_order_key" ON "Lesson"("curriculumId", "order");

-- CreateIndex
CREATE INDEX "Lesson_curriculumId_idx" ON "Lesson"("curriculumId");

-- AddForeignKey
ALTER TABLE "Lesson"
  ADD CONSTRAINT "Lesson_curriculumId_fkey"
  FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
