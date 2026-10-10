-- Module chấm công v3 · L1 (06/09/2026) — kế hoạch docs/cham-cong/KE-HOACH-CHAM-CONG-v3.md §3.
-- THUẦN ADDITIVE: 10 bảng mới + cột nullable/có default trên WorkRequest, Holiday, Employee.
-- Không DROP, không đổi kiểu cột đang có dữ liệu. Sinh bằng `prisma migrate diff` giữa hai bản
-- schema (không chạm DB), thêm tay partial unique cuối file (Prisma không biểu diễn được).

-- CreateEnum
CREATE TYPE "ShiftTemplateKind" AS ENUM ('TIMED', 'LOCATION_ONLY', 'FLEXIBLE', 'OFF', 'LEAVE');

-- CreateEnum
CREATE TYPE "ShiftAttendanceMode" AS ENUM ('REQUIRED', 'OPTIONAL', 'NONE');

-- CreateEnum
CREATE TYPE "ShiftPayMode" AS ENUM ('SHIFT', 'ADMIN_HOURS', 'NONE');

-- CreateEnum
CREATE TYPE "ShiftPlaceMode" AS ENUM ('AT_UNITS', 'ANY_CENTER', 'OFFSITE', 'ANYWHERE');

-- CreateEnum
CREATE TYPE "ShiftAssignmentSource" AS ENUM ('PATTERN', 'IMPORT', 'MANUAL', 'SWAP', 'LEAVE', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "ShiftAssignmentStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftPatternSection" AS ENUM ('KINH_DOANH', 'GIAO_VIEN', 'VAN_PHONG');

-- CreateEnum
CREATE TYPE "StaffTimeLogSource" AS ENUM ('TICKET', 'LEGACY_CHECKIN', 'MANUAL_ADJUST', 'KIOSK');

-- CreateEnum
CREATE TYPE "StaffTimeLogResult" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TimeLogReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AttendanceDayType" AS ENUM ('WORK', 'WEEKLY_OFF', 'LEAVE', 'HOLIDAY', 'UNSCHEDULED');

-- CreateEnum
CREATE TYPE "AttendanceDayStatus" AS ENUM ('COMPUTED', 'ADJUSTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AttendanceComputedBy" AS ENUM ('ENGINE', 'MANUAL', 'LEGACY');

-- CreateEnum
CREATE TYPE "AttendancePeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'LOCKED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ShiftBriefAudience" AS ENUM ('ALL', 'KINH_DOANH', 'GIAO_VIEN');

-- CreateEnum
CREATE TYPE "ShiftBriefMode" AS ENUM ('APPEND', 'SUPPRESS', 'REPLACE');

-- CreateEnum
CREATE TYPE "HolidayAttendanceEffect" AS ENUM ('PAID_LEAVE', 'UNPAID_OFF', 'INFO_ONLY');

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "attendanceEffect" "HolidayAttendanceEffect",
ADD COLUMN     "briefMode" "ShiftBriefMode",
ADD COLUMN     "briefText" TEXT,
ADD COLUMN     "coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "timesheetExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkRequest" ADD COLUMN     "appliedAt" TIMESTAMPTZ(6),
ADD COLUMN     "applyError" TEXT,
ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "leaveTypeId" TEXT,
ADD COLUMN     "requestedInAt" TEXT,
ADD COLUMN     "requestedOutAt" TEXT,
ADD COLUMN     "requesterNewTemplateId" TEXT,
ADD COLUMN     "submittedLate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetNewTemplateId" TEXT;

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ShiftTemplateKind" NOT NULL DEFAULT 'TIMED',
    "segments" JSONB NOT NULL,
    "defaultPlace" TEXT NOT NULL DEFAULT 'HOME',
    "attendanceMode" "ShiftAttendanceMode" NOT NULL DEFAULT 'REQUIRED',
    "dayCredit" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isLeave" BOOLEAN NOT NULL DEFAULT false,
    "nominalMinutes" INTEGER,
    "payMode" "ShiftPayMode" NOT NULL DEFAULT 'SHIFT',
    "scopeUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "effectiveFrom" DATE NOT NULL DEFAULT '2000-01-01'::date,
    "effectiveTo" DATE,
    "amStart" TEXT,
    "amEnd" TEXT,
    "pmStart" TEXT,
    "pmEnd" TEXT,
    "pmBreakStart" TEXT,
    "pmBreakEnd" TEXT,
    "note" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftWeeklyPattern" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "weekday" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "placeOverride" TEXT,
    "sheetName" TEXT,
    "section" "ShiftPatternSection" NOT NULL DEFAULT 'KINH_DOANH',
    "jobLabel" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL DEFAULT '2000-01-01'::date,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShiftWeeklyPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "workDate" DATE NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "placeMode" "ShiftPlaceMode" NOT NULL DEFAULT 'AT_UNITS',
    "allowedOrgUnitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attendanceMode" "ShiftAttendanceMode" NOT NULL DEFAULT 'REQUIRED',
    "dayCredit" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isLeave" BOOLEAN NOT NULL DEFAULT false,
    "nominalMinutes" INTEGER,
    "sourceCells" JSONB,
    "source" "ShiftAssignmentSource" NOT NULL DEFAULT 'PATTERN',
    "sourceRequestId" TEXT,
    "status" "ShiftAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER NOT NULL DEFAULT 100,
    "geofenceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTimeLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "workLocationId" TEXT,
    "direction" "CheckinType" NOT NULL,
    "loggedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workDate" DATE NOT NULL,
    "source" "StaffTimeLogSource" NOT NULL DEFAULT 'TICKET',
    "result" "StaffTimeLogResult" NOT NULL DEFAULT 'ACCEPTED',
    "rejectReason" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewStatus" "TimeLogReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNote" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "withinGeofence" BOOLEAN,
    "ticketId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "verifyMethod" TEXT,
    "verifyRefId" TEXT,
    "verifyScore" DOUBLE PRECISION,
    "adjustRequestId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendanceDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "workDate" DATE NOT NULL,
    "assignmentId" TEXT,
    "templateCode" TEXT,
    "placeMode" "ShiftPlaceMode",
    "dayType" "AttendanceDayType" NOT NULL DEFAULT 'UNSCHEDULED',
    "expectedMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "paidBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "rawPairedMinutes" INTEGER NOT NULL DEFAULT 0,
    "amExpected" INTEGER NOT NULL DEFAULT 0,
    "amWorked" INTEGER NOT NULL DEFAULT 0,
    "pmExpected" INTEGER NOT NULL DEFAULT 0,
    "pmWorked" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "missedEarlyArrival" BOOLEAN NOT NULL DEFAULT false,
    "dayCreditExpected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dayCreditEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hourCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaveUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holidayPaidUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overrideUnits" DOUBLE PRECISION,
    "overrideById" TEXT,
    "overrideAt" TIMESTAMPTZ(6),
    "overrideNote" TEXT,
    "pairs" JSONB,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AttendanceDayStatus" NOT NULL DEFAULT 'COMPUTED',
    "ruleSnapshot" JSONB,
    "computedBy" "AttendanceComputedBy" NOT NULL DEFAULT 'ENGINE',
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StaffAttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePeriod" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "periodKey" TEXT NOT NULL,
    "status" "AttendancePeriodStatus" NOT NULL DEFAULT 'OPEN',
    "standardUnits" DOUBLE PRECISION,
    "standardUnitsNote" TEXT,
    "lockedById" TEXT,
    "lockedAt" TIMESTAMPTZ(6),
    "lockReason" TEXT,
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMPTZ(6),
    "reopenReason" TEXT,
    "summaryJson" JSONB,
    "exportCount" INTEGER NOT NULL DEFAULT 0,
    "lastExportedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AttendancePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "workLocationId" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftBriefNote" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "weekday" INTEGER,
    "date" DATE,
    "audience" "ShiftBriefAudience" NOT NULL DEFAULT 'ALL',
    "mode" "ShiftBriefMode" NOT NULL DEFAULT 'APPEND',
    "text" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShiftBriefNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paidRatio" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "maxDaysPerYear" INTEGER,
    "countsAsWorked" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftTemplate_centerId_idx" ON "ShiftTemplate"("centerId");

-- CreateIndex
CREATE INDEX "ShiftTemplate_orgUnitId_idx" ON "ShiftTemplate"("orgUnitId");

-- CreateIndex
CREATE INDEX "ShiftTemplate_isActive_displayOrder_idx" ON "ShiftTemplate"("isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftTemplate_code_effectiveFrom_key" ON "ShiftTemplate"("code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShiftWeeklyPattern_centerId_idx" ON "ShiftWeeklyPattern"("centerId");

-- CreateIndex
CREATE INDEX "ShiftWeeklyPattern_orgUnitId_idx" ON "ShiftWeeklyPattern"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftWeeklyPattern_userId_centerId_weekday_effectiveFrom_key" ON "ShiftWeeklyPattern"("userId", "centerId", "weekday", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShiftAssignment_userId_workDate_idx" ON "ShiftAssignment"("userId", "workDate");

-- CreateIndex
CREATE INDEX "ShiftAssignment_centerId_workDate_idx" ON "ShiftAssignment"("centerId", "workDate");

-- CreateIndex
CREATE INDEX "ShiftAssignment_orgUnitId_idx" ON "ShiftAssignment"("orgUnitId");

-- CreateIndex
CREATE INDEX "ShiftAssignment_workDate_status_idx" ON "ShiftAssignment"("workDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLocation_code_key" ON "WorkLocation"("code");

-- CreateIndex
CREATE INDEX "WorkLocation_centerId_idx" ON "WorkLocation"("centerId");

-- CreateIndex
CREATE INDEX "WorkLocation_orgUnitId_idx" ON "WorkLocation"("orgUnitId");

-- CreateIndex
CREATE INDEX "StaffTimeLog_userId_workDate_idx" ON "StaffTimeLog"("userId", "workDate");

-- CreateIndex
CREATE INDEX "StaffTimeLog_centerId_workDate_idx" ON "StaffTimeLog"("centerId", "workDate");

-- CreateIndex
CREATE INDEX "StaffTimeLog_orgUnitId_idx" ON "StaffTimeLog"("orgUnitId");

-- CreateIndex
CREATE INDEX "StaffTimeLog_reviewStatus_workDate_idx" ON "StaffTimeLog"("reviewStatus", "workDate");

-- CreateIndex
CREATE INDEX "StaffAttendanceDay_centerId_workDate_idx" ON "StaffAttendanceDay"("centerId", "workDate");

-- CreateIndex
CREATE INDEX "StaffAttendanceDay_orgUnitId_idx" ON "StaffAttendanceDay"("orgUnitId");

-- CreateIndex
CREATE INDEX "StaffAttendanceDay_periodId_idx" ON "StaffAttendanceDay"("periodId");

-- CreateIndex
CREATE INDEX "StaffAttendanceDay_status_workDate_idx" ON "StaffAttendanceDay"("status", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendanceDay_userId_workDate_key" ON "StaffAttendanceDay"("userId", "workDate");

-- CreateIndex
CREATE INDEX "AttendancePeriod_orgUnitId_idx" ON "AttendancePeriod"("orgUnitId");

-- CreateIndex
CREATE INDEX "AttendancePeriod_periodKey_idx" ON "AttendancePeriod"("periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePeriod_centerId_periodKey_key" ON "AttendancePeriod"("centerId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceTicket_nonceHash_key" ON "AttendanceTicket"("nonceHash");

-- CreateIndex
CREATE INDEX "AttendanceTicket_userId_createdAt_idx" ON "AttendanceTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendanceTicket_expiresAt_idx" ON "AttendanceTicket"("expiresAt");

-- CreateIndex
CREATE INDEX "ShiftBriefNote_centerId_weekday_idx" ON "ShiftBriefNote"("centerId", "weekday");

-- CreateIndex
CREATE INDEX "ShiftBriefNote_centerId_date_idx" ON "ShiftBriefNote"("centerId", "date");

-- CreateIndex
CREATE INDEX "ShiftBriefNote_orgUnitId_idx" ON "ShiftBriefNote"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");

-- AddForeignKey
ALTER TABLE "ShiftWeeklyPattern" ADD CONSTRAINT "ShiftWeeklyPattern_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTimeLog" ADD CONSTRAINT "StaffTimeLog_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceTicket" ADD CONSTRAINT "AttendanceTicket_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique: mỗi người mỗi ngày chỉ MỘT ca ACTIVE; đổi ca = CANCELLED + dòng mới (tiền lệ Enrollment).

CREATE UNIQUE INDEX "ShiftAssignment_user_date_active_key" ON "ShiftAssignment"("userId", "workDate") WHERE "status" = 'ACTIVE';
