-- CÔNG PARTTIME — SR.QD.238 · nền CUTOVER (PARTTIME-CUTOVER-ARCHITECTURE, 18/10/2026). docs/cham-cong/parttime/13-CUTOVER-DECISIONS.md.
-- ADDITIVE, KHÔNG BACKFILL, KHÔNG UPDATE/DELETE dữ liệu nào, chạy lại được ([MIG-01]). Chạy tay trên prod (luật Nền #4) — KHÔNG trong task này.
--
--   1. giá trị `CUTOVER` cho `StaffAssignmentType` — phân công nhập từ lịch đang chạy lúc chuyển đổi (Q5). File này KHÔNG dùng giá trị mới
--      (`ALTER TYPE … ADD VALUE` không dùng được trong cùng transaction): không DEFAULT, không CHECK, không INSERT.
--   2. enum `TeachingUnitScope` + bảng `TeachingUnitPolicyOverride` (Q1): buổi lệch chuẩn quy bao nhiêu TIẾT. Không cột tiền. Bảng RỖNG.
--      CHECK giới hạn số tiết (0 < teachingUnits ≤ 4) + khoảng hiệu lực hợp lệ. FK tới bản chính sách (RESTRICT — không xoá chính sách đang được trỏ).

ALTER TYPE "StaffAssignmentType" ADD VALUE IF NOT EXISTS 'CUTOVER';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TeachingUnitScope') THEN
    CREATE TYPE "TeachingUnitScope" AS ENUM ('CLASS', 'COURSE', 'SESSION_TYPE', 'SESSION');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TeachingUnitPolicyOverride" (
    "id" TEXT NOT NULL,
    "scopeType" "TeachingUnitScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "teachingDurationMinutes" INTEGER,
    "teachingUnits" DECIMAL(5,2) NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TeachingUnitPolicyOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeachingUnitPolicyOverride_teachingUnits_check" CHECK ("teachingUnits" > 0 AND "teachingUnits" <= 4),
    CONSTRAINT "TeachingUnitPolicyOverride_duration_check" CHECK ("teachingDurationMinutes" IS NULL OR "teachingDurationMinutes" > 0),
    CONSTRAINT "TeachingUnitPolicyOverride_effective_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
    CONSTRAINT "TeachingUnitPolicyOverride_reason_check" CHECK (length(btrim("reason")) >= 5)
);
CREATE INDEX IF NOT EXISTS "TeachingUnitPolicyOverride_scopeType_scopeId_idx" ON "TeachingUnitPolicyOverride"("scopeType", "scopeId");
CREATE INDEX IF NOT EXISTS "TeachingUnitPolicyOverride_policyVersionId_idx" ON "TeachingUnitPolicyOverride"("policyVersionId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeachingUnitPolicyOverride_policyVersionId_fkey') THEN
    ALTER TABLE "TeachingUnitPolicyOverride" ADD CONSTRAINT "TeachingUnitPolicyOverride_policyVersionId_fkey"
      FOREIGN KEY ("policyVersionId") REFERENCES "CompensationPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "TeachingUnitPolicyOverride" ENABLE ROW LEVEL SECURITY;
