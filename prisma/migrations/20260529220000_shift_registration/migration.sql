-- Đợt 3E — ShiftRegistration (đăng ký ca làm việc)
CREATE TYPE "WorkShift" AS ENUM ('CA_SANG', 'CA_CHIEU', 'CA_TOI');
CREATE TYPE "ShiftRegStatus" AS ENUM ('REGISTERED', 'LEAVE_REQUESTED', 'APPROVED');

CREATE TABLE "ShiftRegistration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT,
    "date" DATE NOT NULL,
    "shifts" "WorkShift"[],
    "status" "ShiftRegStatus" NOT NULL DEFAULT 'REGISTERED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShiftRegistration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShiftRegistration_userId_date_key" ON "ShiftRegistration"("userId", "date");
CREATE INDEX "ShiftRegistration_centerId_date_idx" ON "ShiftRegistration"("centerId", "date");
CREATE INDEX "ShiftRegistration_userId_date_idx" ON "ShiftRegistration"("userId", "date");
ALTER TABLE "ShiftRegistration" ADD CONSTRAINT "ShiftRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
