-- V10.0 (Q6) — chấm sản phẩm Online thủ công: khung chấm (OnlRubric) + bài nộp sản phẩm (OnlSubmission).
-- Bảng MỚI, cộng thêm, không đụng dữ liệu có sẵn; Online là dữ liệu cấp công ty (không centerId). Không dùng bảng Trn*. CHẠY LẠI ĐƯỢC (luật MIG-01).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlSubmissionStatus') THEN
    CREATE TYPE "OnlSubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RESUBMIT_REQUESTED', 'SUPERSEDED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "OnlRubric" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    -- [{ id, name, max }] — tổng `max` = điểm tối đa của khung.
    "criteriaJson" JSONB NOT NULL DEFAULT '[]',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "OnlRubric_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlRubric_courseId_code_key" ON "OnlRubric"("courseId", "code");

CREATE TABLE IF NOT EXISTS "OnlSubmission" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "OnlSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    -- Khoá đối tượng trong kho video/tệp hiện có (R2), theo tiền tố online/sp/<courseId>/<studentId>/ — KHÔNG phải URL công khai.
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "rubricId" TEXT,
    -- Bản chụp khung chấm LÚC NỘP — sửa khung sau đó không đổi cách chấm bài đã nộp.
    "rubricSnapshotJson" JSONB,
    "scoresJson" JSONB,
    "points" INTEGER,
    "feedback" TEXT,
    "gradedByUserId" TEXT,
    "gradedAt" TIMESTAMPTZ(6),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "OnlSubmission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OnlSubmission_attemptId_questionId_idx" ON "OnlSubmission"("attemptId", "questionId");
CREATE INDEX IF NOT EXISTS "OnlSubmission_courseId_status_idx" ON "OnlSubmission"("courseId", "status");
CREATE INDEX IF NOT EXISTS "OnlSubmission_studentId_idx" ON "OnlSubmission"("studentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlRubric_courseId_fkey') THEN
    ALTER TABLE "OnlRubric" ADD CONSTRAINT "OnlRubric_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlSubmission_courseId_fkey') THEN
    ALTER TABLE "OnlSubmission" ADD CONSTRAINT "OnlSubmission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlSubmission_attemptId_fkey') THEN
    ALTER TABLE "OnlSubmission" ADD CONSTRAINT "OnlSubmission_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "OnlAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlSubmission_questionId_fkey') THEN
    ALTER TABLE "OnlSubmission" ADD CONSTRAINT "OnlSubmission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "OnlQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlSubmission_studentId_fkey') THEN
    ALTER TABLE "OnlSubmission" ADD CONSTRAINT "OnlSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlSubmission_rubricId_fkey') THEN
    ALTER TABLE "OnlSubmission" ADD CONSTRAINT "OnlSubmission_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "OnlRubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

ALTER TABLE "OnlRubric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlSubmission" ENABLE ROW LEVEL SECURITY;
