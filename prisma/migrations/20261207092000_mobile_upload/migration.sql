-- 19/11/2026 (B-LMS2) — VÉ TẢI LÊN của API di động (kho riêng) + khoá riêng/vé gắn trên tệp bài nộp + ảnh chụp tệp trong lịch sử phiên bản.
-- CỘNG THÊM (bảng mới + cột NULL được), chạy lại được ([MIG-01]). Chạy TAY trên TEST/PROD (luật cứng #4).
-- Hoàn tác: gỡ bảng "MobileUpload" và các cột mới (chưa ai đọc ngoài API di động).

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MobileUploadPurpose') THEN CREATE TYPE "MobileUploadPurpose" AS ENUM ('ASSIGNMENT_SUBMISSION', 'EXAM_ANSWER'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MobileUploadStatus') THEN CREATE TYPE "MobileUploadStatus" AS ENUM ('ISSUED', 'UPLOADED', 'ATTACHED', 'REJECTED', 'EXPIRED'); END IF; END $$;

CREATE TABLE IF NOT EXISTS "MobileUpload" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "purpose" "MobileUploadPurpose" NOT NULL,
    "assignmentId" TEXT,
    "attemptId" TEXT,
    "examQuestionId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "declaredMime" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "actualSize" INTEGER,
    "status" "MobileUploadStatus" NOT NULL DEFAULT 'ISSUED',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(6),
    "attachedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MobileUpload_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MobileUpload_declaredSize_positive_chk" CHECK ("declaredSize" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "MobileUpload_storageKey_key" ON "MobileUpload"("storageKey");
CREATE INDEX IF NOT EXISTS "MobileUpload_studentId_status_idx" ON "MobileUpload"("studentId", "status");
CREATE INDEX IF NOT EXISTS "MobileUpload_parentUserId_createdAt_idx" ON "MobileUpload"("parentUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MobileUpload_expiresAt_idx" ON "MobileUpload"("expiresAt");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MobileUpload_studentId_fkey') THEN ALTER TABLE "MobileUpload" ADD CONSTRAINT "MobileUpload_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

ALTER TABLE "AssignmentSubmissionFile" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
ALTER TABLE "AssignmentSubmissionFile" ADD COLUMN IF NOT EXISTS "uploadId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentSubmissionFile_uploadId_key" ON "AssignmentSubmissionFile"("uploadId");

ALTER TABLE "AssignmentSubmissionVersion" ADD COLUMN IF NOT EXISTS "filesJson" JSONB;

-- Bảng MỚI phải tự bật RLS (chỉ ENABLE, không FORCE, không policy).
ALTER TABLE "MobileUpload" ENABLE ROW LEVEL SECURITY;
