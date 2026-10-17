-- Phase T1.1 — mở rộng LeadStatus (pipeline chi tiết) + map DEMO_SCHEDULED -> TRIAL_SCHEDULED.
-- Atomic type-recreate (transactional). Giữ DEMO_SCHEDULED trong enum cho back-compat.

ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";

CREATE TYPE "LeadStatus" AS ENUM (
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'NO_ANSWER',
  'CONSULTING',
  'TRIAL_SCHEDULED',
  'TRIAL_ATTENDED',
  'AWAITING_DECISION',
  'ENROLLED',
  'NURTURING',
  'LOST',
  'DUPLICATE',
  'DEMO_SCHEDULED'
);

ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Lead" ALTER COLUMN "status" TYPE "LeadStatus" USING (
  CASE "status"::text
    WHEN 'DEMO_SCHEDULED' THEN 'TRIAL_SCHEDULED'
    ELSE "status"::text
  END::"LeadStatus"
);

ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'NEW';

DROP TYPE "LeadStatus_old";
