-- BGĐ 31/07 — (1) file GV đính kèm trực tiếp khi soạn đề/giao bài;
-- (2) HV nộp NHIỀU file+ảnh mỗi bài nộp (2-phase: cột đơn trên AssignmentSubmission giữ nguyên).

CREATE TABLE "AssignmentAttachment" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "assignmentId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssignmentAttachment_templateId_idx" ON "AssignmentAttachment"("templateId");
CREATE INDEX "AssignmentAttachment_assignmentId_idx" ON "AssignmentAttachment"("assignmentId");

ALTER TABLE "AssignmentAttachment" ADD CONSTRAINT "AssignmentAttachment_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "AssignmentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentAttachment" ADD CONSTRAINT "AssignmentAttachment_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AssignmentSubmissionFile" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentSubmissionFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssignmentSubmissionFile_submissionId_idx" ON "AssignmentSubmissionFile"("submissionId");

ALTER TABLE "AssignmentSubmissionFile" ADD CONSTRAINT "AssignmentSubmissionFile_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
