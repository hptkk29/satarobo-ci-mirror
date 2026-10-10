-- Phase NHÓM 3 — Đánh giá của phụ huynh.
CREATE TABLE "ParentFeedback" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT,
    "parentName" TEXT,
    "studentId" TEXT,
    "studentName" TEXT,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ParentFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParentFeedback_createdAt_idx" ON "ParentFeedback"("createdAt");
CREATE INDEX "ParentFeedback_studentId_idx" ON "ParentFeedback"("studentId");
