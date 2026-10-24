-- ============================================
-- Phase 4.7: Employee module + Role HR + Honor refactor
-- ============================================

-- Step 1: Add 'HR' value to Role enum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HR';

-- Step 2: Create new enums
DO $$ BEGIN
  CREATE TYPE "Department" AS ENUM (
    'BAN_GIAM_DOC',
    'DAO_TAO',
    'MARKETING',
    'KINH_DOANH',
    'IT',
    'HANH_CHANH_NHAN_SU',
    'KE_TOAN'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContractType" AS ENUM ('FULLTIME', 'PARTTIME', 'INTERN', 'FREELANCE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Step 3: Create Employee table
CREATE TABLE "Employee" (
  "id"           TEXT NOT NULL,
  "employeeCode" TEXT NOT NULL,
  "fullName"     TEXT NOT NULL,
  "jobTitle"     TEXT NOT NULL,
  "department"   "Department" NOT NULL,
  "avatarUrl"    TEXT,
  "email"        TEXT,
  "joinedAt"     TIMESTAMP(3),
  "bio"          TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "isPublic"     BOOLEAN NOT NULL DEFAULT false,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,

  "phone"        TEXT,
  "dateOfBirth"  TIMESTAMP(3),
  "gender"       "Gender",
  "contractType" "ContractType",
  "salaryRank"   INTEGER,
  "salaryLevel"  INTEGER,

  "centerId"     TEXT,
  "managerId"    TEXT,
  "isCEO"        BOOLEAN NOT NULL DEFAULT false,

  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "createdById"  TEXT,

  CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
CREATE INDEX "Employee_department_idx" ON "Employee"("department");
CREATE INDEX "Employee_isActive_idx" ON "Employee"("isActive");
CREATE INDEX "Employee_isPublic_idx" ON "Employee"("isPublic");
CREATE INDEX "Employee_isCEO_idx" ON "Employee"("isCEO");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: Link User → Employee (1-1)
ALTER TABLE "User" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_key" UNIQUE ("employeeId");
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 5: Refactor Honor — add new columns
ALTER TABLE "Honor" ADD COLUMN "employeeId"     TEXT;
ALTER TABLE "Honor" ADD COLUMN "jobTitleAtTime" TEXT;
ALTER TABLE "Honor" ADD COLUMN "yearsAtTime"    INTEGER;

-- Step 6: Make old Honor fields nullable (giữ data, cho phép new honors không cần fill)
ALTER TABLE "Honor" ALTER COLUMN "fullName" DROP NOT NULL;
ALTER TABLE "Honor" ALTER COLUMN "jobTitle" DROP NOT NULL;

-- Step 7: Backfill — Create Employee từ Honor data
DO $$
DECLARE
  honor_record RECORD;
  new_employee_id TEXT;
  emp_counter INT := 1;
  emp_code TEXT;
BEGIN
  FOR honor_record IN
    SELECT DISTINCT ON ("fullName")
      "fullName",
      "jobTitle",
      "avatarUrl",
      "yearsAtCompany",
      "category",
      "createdAt"
    FROM "Honor"
    WHERE "fullName" IS NOT NULL
    ORDER BY "fullName", "createdAt"
  LOOP
    -- Generate cuid-like ID (Prisma cuid format: 'c' + 24 random chars).
    -- Dùng md5(random()) đủ unique cho 5 records, không xung đột với cuid().
    new_employee_id := 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24);

    emp_code := 'SR.NV.E' || LPAD(emp_counter::TEXT, 3, '0');

    INSERT INTO "Employee" (
      "id",
      "employeeCode",
      "fullName",
      "jobTitle",
      "department",
      "avatarUrl",
      "joinedAt",
      "isActive",
      "isPublic",
      "displayOrder",
      "createdAt",
      "updatedAt"
    ) VALUES (
      new_employee_id,
      emp_code,
      honor_record."fullName",
      COALESCE(honor_record."jobTitle", 'Nhân viên'),
      CASE honor_record."category"::TEXT
        WHEN 'GRAND_CHAMPION' THEN 'DAO_TAO'::"Department"
        WHEN 'IMPACT' THEN 'MARKETING'::"Department"
        WHEN 'GROWTH' THEN 'DAO_TAO'::"Department"
        WHEN 'SPARK' THEN 'IT'::"Department"
        ELSE 'DAO_TAO'::"Department"
      END,
      honor_record."avatarUrl",
      CASE
        WHEN honor_record."yearsAtCompany" IS NOT NULL
        THEN CURRENT_DATE - (honor_record."yearsAtCompany" || ' years')::INTERVAL
        ELSE NULL
      END,
      TRUE,
      TRUE,
      emp_counter,
      NOW(),
      NOW()
    );

    -- Link tất cả Honor của fullName này → employeeId + snapshot
    UPDATE "Honor"
    SET
      "employeeId"    = new_employee_id,
      "jobTitleAtTime" = "jobTitle",
      "yearsAtTime"   = "yearsAtCompany"
    WHERE "fullName" = honor_record."fullName";

    emp_counter := emp_counter + 1;
  END LOOP;

  RAISE NOTICE 'Phase 4.7 migration: created % Employee records from Honor data', emp_counter - 1;
END $$;

-- Step 8: Add Honor.employeeId index + FK
CREATE INDEX "Honor_employeeId_idx" ON "Honor"("employeeId");

ALTER TABLE "Honor" ADD CONSTRAINT "Honor_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTE: Old columns Honor.fullName, jobTitle, avatarUrl, yearsAtCompany are KEPT (nullable)
-- for safe 2-phase rollback. DROP at Phase 4.7.1 sau khi confirm production stable.
