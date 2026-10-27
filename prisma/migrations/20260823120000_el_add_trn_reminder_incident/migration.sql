-- EL-06 — sổ lịch nhắc + sổ sự cố hệ thống.
--
-- CHỈ ADD: 3 enum + 2 bảng + index + 1 FK. Không đụng bảng nào đang có dữ liệu
-- (luật cứng #4).
--
-- Vì sao `TrnReminder` không dồn vào `EmailQueue`: bảng đó chỉ có
-- PENDING/SENT/FAILED, KHÔNG có "đã huỷ" — mà huỷ chính là vòng đời bắt buộc ở
-- đây (thu hồi / gia hạn / tạm dừng đều phải huỷ các mốc PENDING còn lại). Thêm
-- nữa AC3/AC4 của EL-06 ĐẾM số dòng SKIPPED/CANCELLED, và chỉ số T4 đo nhắc tồn
-- đọng cho CẢ in-app trong khi EmailQueue.scheduledAt chỉ phủ email.
--
-- `TrnIncident.confirmedByUserId` NOT NULL là có chủ đích (QĐ-CDA-15): không có
-- tên người trực thì không có bản ghi sự cố.

-- CreateEnum
CREATE TYPE "TrnReminderMilestone" AS ENUM ('T0', 'T_MINUS_5D', 'T_MINUS_2D', 'T_MINUS_1D', 'T_MINUS_2H', 'T_PLUS_0', 'T_PLUS_3D');

-- CreateEnum
CREATE TYPE "TrnReminderStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrnIncidentScope" AS ENUM ('ASSIGNMENT', 'GLOBAL');

-- CreateTable
CREATE TABLE "TrnReminder" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "milestone" "TrnReminderMilestone" NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "TrnReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMPTZ(6),
    "sentChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnIncident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detectedAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),
    "confirmedByUserId" TEXT NOT NULL,
    "scope" "TrnIncidentScope" NOT NULL,
    "assignmentId" TEXT,
    "extendDays" INTEGER NOT NULL,
    "appliedAt" TIMESTAMPTZ(6),
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrnReminder_status_scheduledAt_idx" ON "TrnReminder"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "TrnReminder_enrollmentId_idx" ON "TrnReminder"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnReminder_enrollmentId_milestone_key" ON "TrnReminder"("enrollmentId", "milestone");

-- CreateIndex
CREATE INDEX "TrnIncident_scope_detectedAt_idx" ON "TrnIncident"("scope", "detectedAt");

-- CreateIndex
CREATE INDEX "TrnIncident_assignmentId_idx" ON "TrnIncident"("assignmentId");

-- AddForeignKey
ALTER TABLE "TrnReminder" ADD CONSTRAINT "TrnReminder_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "TrnEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
