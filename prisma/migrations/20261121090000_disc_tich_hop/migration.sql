-- DISC × SataRobo — lưu kết quả DISC của gia đình, chờ nhận (claim) bằng OTP + mã nhận.
--
-- HOÀN TOÀN ADDITIVE: 3 enum + 2 bảng MỚI, không đụng bảng có dữ liệu PROD (luật cứng #4).
-- Không backfill. Rollback = ngừng ghi (cờ DISC_ENABLED tắt); bảng nằm im.
-- Chạy lại được (MIG-01): CREATE TYPE bọc DO $$ … pg_type …, CREATE TABLE/INDEX có IF NOT EXISTS.
-- Bảng KHÔNG theo cơ sở ⇒ không centerId/orgUnitId (CLAUDE.md "Nền Hệ thống" luật 3).
-- ⚠️ Chứa dữ liệu cá nhân của trẻ: bật RLS, không policy ⇒ chỉ vai dịch vụ của ứng dụng đọc được.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscClaimStatus') THEN
    CREATE TYPE "DiscClaimStatus" AS ENUM ('PENDING_CLAIM', 'CLAIMED', 'EXPIRED', 'REVOKED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscSubjectRole') THEN
    CREATE TYPE "DiscSubjectRole" AS ENUM ('PARENT', 'STUDENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscEmailStatus') THEN
    CREATE TYPE "DiscEmailStatus" AS ENUM ('NONE', 'VERIFICATION_REQUIRED', 'QUEUED', 'SENT', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DiscSubmission" (
  "id"                   TEXT NOT NULL,
  "idempotencyKey"       TEXT NOT NULL,
  "phoneKey"             TEXT NOT NULL,
  "claimStatus"          "DiscClaimStatus" NOT NULL DEFAULT 'PENDING_CLAIM',
  "claimedUserId"        TEXT,
  "claimedAt"            TIMESTAMPTZ(6),
  "leadId"               TEXT,
  "campaign"             TEXT NOT NULL DEFAULT 'DISC',
  "consentVersion"       TEXT NOT NULL,
  "consentMarketing"     BOOLEAN NOT NULL DEFAULT false,
  "consentAt"            TIMESTAMPTZ(6) NOT NULL,
  "engineVersion"        TEXT NOT NULL,
  "reportSnapshot"       JSONB NOT NULL,
  "downloadTokenHash"    TEXT,
  "downloadTokenExpires" TIMESTAMPTZ(6),
  "emailTo"              TEXT,
  "emailStatus"          "DiscEmailStatus" NOT NULL DEFAULT 'NONE',
  "emailVerifiedAt"      TIMESTAMPTZ(6),
  "emailVerifyTokenHash" TEXT,
  "retainUntil"          TIMESTAMPTZ(6) NOT NULL,
  "deletedAt"            TIMESTAMPTZ(6),
  "createdAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiscSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DiscSubject" (
  "id"                 TEXT NOT NULL,
  "submissionId"       TEXT NOT NULL,
  "role"               "DiscSubjectRole" NOT NULL,
  "fullName"           TEXT NOT NULL,
  "birthYear"          INTEGER NOT NULL,
  "grade"              TEXT,
  "observedByAdult"    BOOLEAN NOT NULL DEFAULT false,
  "questionSetVersion" TEXT NOT NULL,
  "result"             JSONB NOT NULL,
  "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscSubject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiscSubmission_idempotencyKey_key" ON "DiscSubmission"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "DiscSubmission_phoneKey_claimStatus_idx" ON "DiscSubmission"("phoneKey", "claimStatus");
CREATE INDEX IF NOT EXISTS "DiscSubmission_claimedUserId_idx" ON "DiscSubmission"("claimedUserId");
CREATE INDEX IF NOT EXISTS "DiscSubmission_retainUntil_idx" ON "DiscSubmission"("retainUntil");
CREATE INDEX IF NOT EXISTS "DiscSubject_submissionId_idx" ON "DiscSubject"("submissionId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscSubject_submissionId_fkey') THEN
    ALTER TABLE "DiscSubject" ADD CONSTRAINT "DiscSubject_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "DiscSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "DiscSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscSubject" ENABLE ROW LEVEL SECURITY;
