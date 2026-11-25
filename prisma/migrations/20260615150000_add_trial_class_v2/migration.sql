-- CreateEnum
CREATE TYPE "TrialClassV2Status" AS ENUM ('OPEN', 'RUNNING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "TrialSessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "TrialEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WITHDRAWN');
CREATE TYPE "TrialAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');

-- CreateTable
CREATE TABLE "TrialProgramConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialProgramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialClassV2" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TRIAL_ROBOSIM',
    "centerId" TEXT NOT NULL,
    "roomId" TEXT,
    "startDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "teacherId" TEXT,
    "assistantId" TEXT,
    "status" "TrialClassV2Status" NOT NULL DEFAULT 'OPEN',
    "configId" TEXT,
    "sessionCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialClassV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialClassSession" (
    "id" TEXT NOT NULL,
    "trialClassId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "roomId" TEXT,
    "teacherId" TEXT,
    "status" "TrialSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialClassSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialEnrollment" (
    "id" TEXT NOT NULL,
    "trialClassId" TEXT NOT NULL,
    "leadChildId" TEXT NOT NULL,
    "status" "TrialEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "summaryNote" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialAttendance" (
    "id" TEXT NOT NULL,
    "trialSessionId" TEXT NOT NULL,
    "trialEnrollmentId" TEXT NOT NULL,
    "status" "TrialAttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialClassV2_code_key" ON "TrialClassV2"("code");
CREATE INDEX "TrialClassV2_centerId_status_idx" ON "TrialClassV2"("centerId", "status");
CREATE INDEX "TrialClassSession_trialClassId_seq_idx" ON "TrialClassSession"("trialClassId", "seq");
CREATE INDEX "TrialEnrollment_trialClassId_idx" ON "TrialEnrollment"("trialClassId");
CREATE INDEX "TrialEnrollment_leadChildId_idx" ON "TrialEnrollment"("leadChildId");
CREATE UNIQUE INDEX "TrialAttendance_trialSessionId_trialEnrollmentId_key" ON "TrialAttendance"("trialSessionId", "trialEnrollmentId");

-- R7-02 AC3: 1 LeadChild chỉ ACTIVE ở 1 lớp trải nghiệm (partial unique).
CREATE UNIQUE INDEX "TrialEnrollment_leadChildId_active_key" ON "TrialEnrollment"("leadChildId") WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "TrialClassV2" ADD CONSTRAINT "TrialClassV2_configId_fkey" FOREIGN KEY ("configId") REFERENCES "TrialProgramConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrialClassSession" ADD CONSTRAINT "TrialClassSession_trialClassId_fkey" FOREIGN KEY ("trialClassId") REFERENCES "TrialClassV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrialEnrollment" ADD CONSTRAINT "TrialEnrollment_trialClassId_fkey" FOREIGN KEY ("trialClassId") REFERENCES "TrialClassV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrialEnrollment" ADD CONSTRAINT "TrialEnrollment_leadChildId_fkey" FOREIGN KEY ("leadChildId") REFERENCES "LeadChild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrialAttendance" ADD CONSTRAINT "TrialAttendance_trialSessionId_fkey" FOREIGN KEY ("trialSessionId") REFERENCES "TrialClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrialAttendance" ADD CONSTRAINT "TrialAttendance_trialEnrollmentId_fkey" FOREIGN KEY ("trialEnrollmentId") REFERENCES "TrialEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
