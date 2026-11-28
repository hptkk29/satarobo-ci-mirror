-- 20/11/2026 — E-learning ONLINE: ĐÁNH GIÁ (câu hỏi · bài kiểm tra/bài tập/thi cuối · lượt làm bài có SNAPSHOT) + CHỨNG NHẬN (ADR 0005).
-- CHỈ THÊM: enum + bảng mới (tiền tố `Onl`), không đụng bảng đang có, không backfill. Bảng mới đã bật RLS (chỉ ENABLE).
-- Tách bạch với `Trn*` (Nội bộ) và `Exam*` (LMS Offline): không dùng chung ngân hàng câu hỏi, lượt thi, điểm, chứng nhận.
-- Chạy lại được (luật [MIG-01]): CREATE TYPE bọc pg_type, bảng/chỉ mục IF NOT EXISTS, FK bọc pg_constraint.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlQuestionType') THEN CREATE TYPE "OnlQuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_TEXT', 'ESSAY'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlQuestionStatus') THEN CREATE TYPE "OnlQuestionStatus" AS ENUM ('ACTIVE', 'ARCHIVED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlAssessmentStatus') THEN CREATE TYPE "OnlAssessmentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlAttemptStatus') THEN CREATE TYPE "OnlAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'EXPIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlCertificateStatus') THEN CREATE TYPE "OnlCertificateStatus" AS ENUM ('ISSUED', 'REVOKED'); END IF;
END $$;

-- ─── Câu hỏi ───
CREATE TABLE IF NOT EXISTS "OnlQuestion" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "type" "OnlQuestionType" NOT NULL,
  "stem" TEXT NOT NULL,
  "optionsJson" JSONB NOT NULL DEFAULT '[]',
  "answerKeyJson" JSONB NOT NULL DEFAULT '{}',
  "explanation" TEXT,
  "points" INTEGER NOT NULL DEFAULT 1,
  "status" "OnlQuestionStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OnlQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlQuestion_diem_check" CHECK ("points" BETWEEN 1 AND 1000)
);
CREATE INDEX IF NOT EXISTS "OnlQuestion_courseId_status_idx" ON "OnlQuestion"("courseId", "status");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlQuestion_courseId_fkey') THEN ALTER TABLE "OnlQuestion" ADD CONSTRAINT "OnlQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- ─── Bài kiểm tra / bài tập / thi cuối khoá ───
CREATE TABLE IF NOT EXISTS "OnlAssessment" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "kind" "OnlLessonKind" NOT NULL,
  "title" TEXT NOT NULL,
  "instructions" TEXT,
  "passPercent" INTEGER NOT NULL DEFAULT 70,
  "timeLimitMin" INTEGER,
  "maxAttempts" INTEGER,
  "shuffle" BOOLEAN NOT NULL DEFAULT false,
  "status" "OnlAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OnlAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlAssessment_kind_check" CHECK ("kind" IN ('ASSIGNMENT', 'QUIZ', 'FINAL_EXAM')),
  CONSTRAINT "OnlAssessment_dat_check" CHECK ("passPercent" BETWEEN 0 AND 100),
  CONSTRAINT "OnlAssessment_gioi_han_check" CHECK (("timeLimitMin" IS NULL OR "timeLimitMin" BETWEEN 1 AND 600) AND ("maxAttempts" IS NULL OR "maxAttempts" BETWEEN 1 AND 100))
);
CREATE INDEX IF NOT EXISTS "OnlAssessment_courseId_status_idx" ON "OnlAssessment"("courseId", "status");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAssessment_courseId_fkey') THEN ALTER TABLE "OnlAssessment" ADD CONSTRAINT "OnlAssessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

CREATE TABLE IF NOT EXISTS "OnlAssessmentQuestion" (
  "assessmentId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "points" INTEGER,
  CONSTRAINT "OnlAssessmentQuestion_pkey" PRIMARY KEY ("assessmentId", "questionId"),
  CONSTRAINT "OnlAssessmentQuestion_diem_check" CHECK ("points" IS NULL OR "points" BETWEEN 1 AND 1000)
);
CREATE INDEX IF NOT EXISTS "OnlAssessmentQuestion_assessmentId_orderIndex_idx" ON "OnlAssessmentQuestion"("assessmentId", "orderIndex");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAssessmentQuestion_assessmentId_fkey') THEN ALTER TABLE "OnlAssessmentQuestion" ADD CONSTRAINT "OnlAssessmentQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "OnlAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAssessmentQuestion_questionId_fkey') THEN ALTER TABLE "OnlAssessmentQuestion" ADD CONSTRAINT "OnlAssessmentQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "OnlQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- ─── Lượt làm bài (có SNAPSHOT đề + quy tắc chấm) ───
CREATE TABLE IF NOT EXISTS "OnlAttempt" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "lessonStableId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" "OnlAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt" TIMESTAMPTZ(6) NOT NULL,
  "dueAt" TIMESTAMPTZ(6),
  "submittedAt" TIMESTAMPTZ(6),
  "snapshotJson" JSONB NOT NULL,
  "answersJson" JSONB NOT NULL DEFAULT '{}',
  "earnedPoints" INTEGER,
  "totalPoints" INTEGER,
  "scorePercent" INTEGER,
  "passed" BOOLEAN,
  "manualJson" JSONB,
  "feedback" TEXT,
  "gradedAt" TIMESTAMPTZ(6),
  "gradedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OnlAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlAttempt_luot_check" CHECK ("number" >= 1),
  CONSTRAINT "OnlAttempt_diem_check" CHECK ("scorePercent" IS NULL OR "scorePercent" BETWEEN 0 AND 100),
  -- ĐÃ CHẤM ⇒ phải có điểm + kết luận đạt/không; chưa chấm ⇒ không được có kết luận.
  CONSTRAINT "OnlAttempt_cham_check" CHECK (("status" = 'GRADED' AND "scorePercent" IS NOT NULL AND "passed" IS NOT NULL AND "gradedAt" IS NOT NULL) OR ("status" <> 'GRADED' AND "passed" IS NULL) OR "status" = 'EXPIRED')
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlAttempt_entitlementId_assessmentId_number_key" ON "OnlAttempt"("entitlementId", "assessmentId", "number");
CREATE INDEX IF NOT EXISTS "OnlAttempt_assessmentId_status_idx" ON "OnlAttempt"("assessmentId", "status");
CREATE INDEX IF NOT EXISTS "OnlAttempt_studentId_idx" ON "OnlAttempt"("studentId");
-- Một quyền chỉ có MỘT lượt ĐANG LÀM cho mỗi bài đánh giá (hai thiết bị cùng bấm "Bắt đầu" không đẻ hai lượt).
CREATE UNIQUE INDEX IF NOT EXISTS "OnlAttempt_mot_luot_dang_lam_key" ON "OnlAttempt"("entitlementId", "assessmentId") WHERE "status" = 'IN_PROGRESS';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttempt_assessmentId_fkey') THEN ALTER TABLE "OnlAttempt" ADD CONSTRAINT "OnlAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "OnlAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttempt_entitlementId_fkey') THEN ALTER TABLE "OnlAttempt" ADD CONSTRAINT "OnlAttempt_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "OnlEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttempt_studentId_fkey') THEN ALTER TABLE "OnlAttempt" ADD CONSTRAINT "OnlAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- ─── Chứng nhận ───
CREATE TABLE IF NOT EXISTS "OnlCertificate" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "OnlCertificateStatus" NOT NULL DEFAULT 'ISSUED',
  "studentName" TEXT NOT NULL,
  "courseName" TEXT NOT NULL,
  "courseCode" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "finalScore" INTEGER,
  "issuedAt" TIMESTAMPTZ(6) NOT NULL,
  "issuedByUserId" TEXT,
  "revokedAt" TIMESTAMPTZ(6),
  "revokedReason" TEXT,
  "revokedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnlCertificate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlCertificate_ma_check" CHECK ("code" ~ '^[A-Z0-9]{8,32}$'),
  -- Thu hồi bắt buộc có thời điểm + lý do ≥ 10 ký tự; đang hiệu lực thì không có dấu vết thu hồi.
  CONSTRAINT "OnlCertificate_thu_hoi_check" CHECK (
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedReason" IS NOT NULL AND length(btrim("revokedReason")) >= 10)
    OR ("status" = 'ISSUED' AND "revokedAt" IS NULL AND "revokedReason" IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCertificate_code_key" ON "OnlCertificate"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCertificate_studentId_courseId_key" ON "OnlCertificate"("studentId", "courseId");
CREATE INDEX IF NOT EXISTS "OnlCertificate_courseId_status_idx" ON "OnlCertificate"("courseId", "status");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCertificate_studentId_fkey') THEN ALTER TABLE "OnlCertificate" ADD CONSTRAINT "OnlCertificate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCertificate_courseId_fkey') THEN ALTER TABLE "OnlCertificate" ADD CONSTRAINT "OnlCertificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCertificate_entitlementId_fkey') THEN ALTER TABLE "OnlCertificate" ADD CONSTRAINT "OnlCertificate_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "OnlEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- ─── RLS (bảng mới ⇒ bật; chỉ ENABLE, không FORCE, không policy) ───
ALTER TABLE "OnlQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlAssessmentQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlCertificate" ENABLE ROW LEVEL SECURITY;
