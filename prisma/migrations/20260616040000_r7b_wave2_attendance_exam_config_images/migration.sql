-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttendanceStatus" ADD VALUE 'ABSENT_EXCUSED';
ALTER TYPE "AttendanceStatus" ADD VALUE 'ABSENT_UNEXCUSED';

-- AlterTable
ALTER TABLE "Choice" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "defaultDueDays" INTEGER,
ADD COLUMN     "maxAttempts" INTEGER,
ADD COLUMN     "scoringMode" TEXT,
ADD COLUMN     "showResultAfterSubmit" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "imageUrl" TEXT;

