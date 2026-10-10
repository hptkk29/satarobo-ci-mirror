-- Add new EnrollmentStatus values for D5 workflow.
-- Must be done in a separate migration before any column default uses them
-- (Postgres rule: a newly added enum value can't be used in the same
-- transaction it was created in).
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'STUDYING';
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'WITHDREW';
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'TRANSFERRED';
