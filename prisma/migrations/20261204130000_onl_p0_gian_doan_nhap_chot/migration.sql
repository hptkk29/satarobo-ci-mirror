-- P0 Mobile (Agent E) — (1) bảo toàn lượt bị Admin thu hồi giữa chừng + bồi hoàn CÓ KIỂM SOÁT, (2) nháp đáp án phía máy chủ (autosave), (3) tự chốt lượt quá hạn.
-- Cộng thêm: cột NULL/DEFAULT trên OnlAttempt + bảng mới (bật RLS). Không đụng dữ liệu có sẵn. Không dùng bảng Offline/Nội bộ. CHẠY LẠI ĐƯỢC (luật MIG-01).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlInterruptionStatus') THEN
    CREATE TYPE "OnlInterruptionStatus" AS ENUM ('OPEN', 'COMPENSATED', 'NO_COMPENSATION_NEEDED', 'CAP_REACHED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlCompensationStatus') THEN
    CREATE TYPE "OnlCompensationStatus" AS ENUM ('AVAILABLE', 'USED');
  END IF;
END
$$;

ALTER TABLE "OnlAttempt" ADD COLUMN IF NOT EXISTS "draftRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OnlAttempt" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMPTZ(6);
-- SUBMIT = học viên nộp · DEADLINE_AUTO = máy chủ tự chốt khi quá hạn · NO_DRAFT_EXPIRED = quá hạn, không có nháp nào (giữ hành vi cũ: EXPIRED, tính một lượt)
ALTER TABLE "OnlAttempt" ADD COLUMN IF NOT EXISTS "finalizeReason" TEXT;
ALTER TABLE "OnlAttempt" ADD COLUMN IF NOT EXISTS "versionNumber" INTEGER;

CREATE TABLE IF NOT EXISTS "OnlAttemptDraft" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "versionNumber" INTEGER,
    "questionId" TEXT NOT NULL,
    "questionType" "OnlQuestionType" NOT NULL,
    "answerJson" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,
    "deviceId" TEXT,
    "savedAt" TIMESTAMPTZ(6) NOT NULL,
    "finalizedAt" TIMESTAMPTZ(6),
    CONSTRAINT "OnlAttemptDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlAttemptDraft_attemptId_questionId_key" ON "OnlAttemptDraft"("attemptId", "questionId");
CREATE INDEX IF NOT EXISTS "OnlAttemptDraft_studentId_idx" ON "OnlAttemptDraft"("studentId");

-- Sổ thao tác lưu nháp: (lượt × requestId) duy nhất ⇒ gọi lại cùng khoá trả đúng kết quả cũ, không ghi hai lần; cũng là nguồn đếm tần suất.
CREATE TABLE IF NOT EXISTS "OnlAttemptDraftOp" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "OnlAttemptDraftOp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlAttemptDraftOp_attemptId_requestId_key" ON "OnlAttemptDraftOp"("attemptId", "requestId");
CREATE INDEX IF NOT EXISTS "OnlAttemptDraftOp_attemptId_createdAt_idx" ON "OnlAttemptDraftOp"("attemptId", "createdAt");

-- Sự kiện GIÁN ĐOẠN: mỗi lượt tối đa MỘT (attemptId duy nhất) ⇒ "một sự kiện gián đoạn chỉ bồi hoàn tối đa một lần".
CREATE TABLE IF NOT EXISTS "OnlAttemptInterruption" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "status" "OnlInterruptionStatus" NOT NULL DEFAULT 'OPEN',
    "revokeEventId" TEXT,
    "revokedByUserId" TEXT,
    "interruptedAt" TIMESTAMPTZ(6) NOT NULL,
    "dueAtAtInterrupt" TIMESTAMPTZ(6),
    "draftCount" INTEGER NOT NULL DEFAULT 0,
    "draftRevisionAtInterrupt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnlAttemptInterruption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlAttemptInterruption_attemptId_key" ON "OnlAttemptInterruption"("attemptId");
CREATE INDEX IF NOT EXISTS "OnlAttemptInterruption_entitlementId_status_idx" ON "OnlAttemptInterruption"("entitlementId", "status");

-- Quyền dùng MỘT lượt thay thế, gắn với đúng một sự kiện gián đoạn (interruptionId duy nhất ⇒ không cấp trùng dù cấp lại nhiều lần / hai request song song).
CREATE TABLE IF NOT EXISTS "OnlAttemptCompensation" (
    "id" TEXT NOT NULL,
    "interruptionId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "status" "OnlCompensationStatus" NOT NULL DEFAULT 'AVAILABLE',
    "grantEventId" TEXT,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAttemptId" TEXT,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnlAttemptCompensation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlAttemptCompensation_interruptionId_key" ON "OnlAttemptCompensation"("interruptionId");
CREATE INDEX IF NOT EXISTS "OnlAttemptCompensation_entitlementId_assessmentId_idx" ON "OnlAttemptCompensation"("entitlementId", "assessmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttemptDraft_attemptId_fkey') THEN
    ALTER TABLE "OnlAttemptDraft" ADD CONSTRAINT "OnlAttemptDraft_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "OnlAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttemptDraftOp_attemptId_fkey') THEN
    ALTER TABLE "OnlAttemptDraftOp" ADD CONSTRAINT "OnlAttemptDraftOp_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "OnlAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttemptInterruption_attemptId_fkey') THEN
    ALTER TABLE "OnlAttemptInterruption" ADD CONSTRAINT "OnlAttemptInterruption_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "OnlAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttemptInterruption_entitlementId_fkey') THEN
    ALTER TABLE "OnlAttemptInterruption" ADD CONSTRAINT "OnlAttemptInterruption_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "OnlEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttemptCompensation_interruptionId_fkey') THEN
    ALTER TABLE "OnlAttemptCompensation" ADD CONSTRAINT "OnlAttemptCompensation_interruptionId_fkey" FOREIGN KEY ("interruptionId") REFERENCES "OnlAttemptInterruption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlAttemptCompensation_entitlementId_fkey') THEN
    ALTER TABLE "OnlAttemptCompensation" ADD CONSTRAINT "OnlAttemptCompensation_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "OnlEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

ALTER TABLE "OnlAttemptDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlAttemptDraftOp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlAttemptInterruption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlAttemptCompensation" ENABLE ROW LEVEL SECURITY;
