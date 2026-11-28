-- 19/11/2026 (B-LMS2) — LỊCH SỬ PHIÊN BẢN bài nộp bài tập. CỘNG THÊM (bảng mới), chạy lại được ([MIG-01]). Chạy TAY trên TEST/PROD (luật cứng #4).
-- Hoàn tác: DROP TABLE "AssignmentSubmissionVersion";  (không ai đọc bảng này ngoài API di động mới).

CREATE TABLE IF NOT EXISTS "AssignmentSubmissionVersion" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "textAnswer" TEXT,
    "status" "SubmissionStatus" NOT NULL,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL,
    "idempotencyKey" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MOBILE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentSubmissionVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssignmentSubmissionVersion_versionNo_positive_chk" CHECK ("versionNo" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentSubmissionVersion_submissionId_versionNo_key" ON "AssignmentSubmissionVersion"("submissionId", "versionNo");
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentSubmissionVersion_submissionId_idempotencyKey_key" ON "AssignmentSubmissionVersion"("submissionId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "AssignmentSubmissionVersion_submissionId_idx" ON "AssignmentSubmissionVersion"("submissionId");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentSubmissionVersion_submissionId_fkey') THEN ALTER TABLE "AssignmentSubmissionVersion" ADD CONSTRAINT "AssignmentSubmissionVersion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- Bảng MỚI phải tự bật RLS (chỉ ENABLE, không FORCE, không policy).
ALTER TABLE "AssignmentSubmissionVersion" ENABLE ROW LEVEL SECURITY;
