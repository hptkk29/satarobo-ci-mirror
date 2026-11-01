-- AlterEnum (additive — giữ giá trị cũ)
ALTER TYPE "LeadStatus" ADD VALUE 'TRIAL_IN_PROGRESS';
ALTER TYPE "LeadStatus" ADD VALUE 'REGISTERED';

-- CreateEnum
CREATE TYPE "LeadChildTrialStatus" AS ENUM ('NONE', 'SCHEDULED', 'IN_PROGRESS', 'ATTENDED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "lastActivityAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadChild" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dob" DATE,
    "ageYears" INTEGER,
    "gender" TEXT,
    "schoolName" TEXT,
    "gradeLevel" TEXT,
    "interestedCourseId" TEXT,
    "interestedCenterId" TEXT,
    "note" TEXT,
    "trialStatus" "LeadChildTrialStatus" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadChild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadChild_leadId_idx" ON "LeadChild"("leadId");

-- AddForeignKey
ALTER TABLE "LeadChild" ADD CONSTRAINT "LeadChild_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
