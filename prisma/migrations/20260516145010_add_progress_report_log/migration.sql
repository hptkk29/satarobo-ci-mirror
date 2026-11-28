-- CreateTable
CREATE TABLE "ProgressReportLog" (
  "id"            TEXT NOT NULL,
  "studentId"     TEXT NOT NULL,
  "classId"       TEXT,
  "generatedById" TEXT,
  "generatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentToEmail"   TEXT,
  "sentAt"        TIMESTAMP(3),
  "reportTitle"   TEXT NOT NULL,
  "metadata"      JSONB,
  CONSTRAINT "ProgressReportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressReportLog_studentId_generatedAt_idx" ON "ProgressReportLog"("studentId", "generatedAt");

-- CreateIndex
CREATE INDEX "ProgressReportLog_classId_idx" ON "ProgressReportLog"("classId");

-- CreateIndex
CREATE INDEX "ProgressReportLog_generatedAt_idx" ON "ProgressReportLog"("generatedAt");

-- AddForeignKey
ALTER TABLE "ProgressReportLog" ADD CONSTRAINT "ProgressReportLog_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReportLog" ADD CONSTRAINT "ProgressReportLog_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReportLog" ADD CONSTRAINT "ProgressReportLog_generatedById_fkey"
  FOREIGN KEY ("generatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
