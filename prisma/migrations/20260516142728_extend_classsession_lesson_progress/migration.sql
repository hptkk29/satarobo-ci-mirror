-- AlterTable: link ClassSession to curriculum Lesson for E6 progress
-- tracking. Both columns nullable so existing sessions stay valid.
ALTER TABLE "ClassSession"
  ADD COLUMN "lessonId"    TEXT,
  ADD COLUMN "lessonNotes" TEXT;

-- CreateIndex
CREATE INDEX "ClassSession_lessonId_idx" ON "ClassSession"("lessonId");

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
