-- Phase NHÓM 4 — Chấm công QR nhân viên.
ALTER TABLE "Center" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Center" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Center" ADD COLUMN "allowedRadiusMeters" INTEGER DEFAULT 150;

CREATE TYPE "CheckinType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

CREATE TABLE "EmployeeCheckin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "centerId" TEXT,
    "type" "CheckinType" NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "withinGeofence" BOOLEAN NOT NULL DEFAULT true,
    "qrToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeCheckin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeCheckin_userId_type_qrToken_key" ON "EmployeeCheckin"("userId", "type", "qrToken");
CREATE INDEX "EmployeeCheckin_userId_checkedAt_idx" ON "EmployeeCheckin"("userId", "checkedAt");
CREATE INDEX "EmployeeCheckin_centerId_checkedAt_idx" ON "EmployeeCheckin"("centerId", "checkedAt");
