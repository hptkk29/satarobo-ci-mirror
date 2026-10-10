-- LMS-2 — StudentSessionFeedback (nhận xét từng HS mỗi buổi)
CREATE TABLE "StudentSessionFeedback" (
    "id" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "rating" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentSessionFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentSessionFeedback_classSessionId_studentId_key" ON "StudentSessionFeedback"("classSessionId", "studentId");
CREATE INDEX "StudentSessionFeedback_studentId_idx" ON "StudentSessionFeedback"("studentId");
ALTER TABLE "StudentSessionFeedback" ADD CONSTRAINT "StudentSessionFeedback_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentSessionFeedback" ADD CONSTRAINT "StudentSessionFeedback_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
