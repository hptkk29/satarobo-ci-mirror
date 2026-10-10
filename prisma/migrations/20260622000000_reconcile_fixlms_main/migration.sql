-- Reconcile FixLMS→main (PR #22, Strategy A). Biến đổi DB sống (lineage FixLMS) khớp
-- schema target. LOẠI các ALTER timestamptz→timestamp (drift schema-vs-DB CÓ SẴN từ
-- trước, không thuộc reconcile; giữ nguyên cột timestamptz của DB sống).
-- Bảng bị xoá/đổi cấu trúc đều RỖNG (đã verify: ScormAttempt/MessageThread/Message/
-- RevenueTarget = 0 row). Cột thêm vào đều nullable (an toàn cho bảng có data).

-- CreateEnum
CREATE TYPE "ScormCompletion" AS ENUM ('NOT_ATTEMPTED', 'INCOMPLETE', 'COMPLETED', 'PASSED', 'FAILED', 'BROWSED');
CREATE TYPE "RefundTrigger" AS ENUM ('WITHDRAW', 'TRANSFER', 'CLASS_CANCELLED', 'MANUAL');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');
CREATE TYPE "ConversationSide" AS ENUM ('PARENT', 'STAFF');

-- DropForeignKey (messaging FixLMS — D6 dùng ConversationMessage)
ALTER TABLE "Message" DROP CONSTRAINT "Message_threadId_fkey";
ALTER TABLE "MessageThread" DROP CONSTRAINT "MessageThread_studentId_fkey";

-- DropIndex
DROP INDEX "RevenueTarget_period_idx";
DROP INDEX "ScormAttempt_packageId_userId_key";

-- AlterTable — thêm centerId/roomId (nullable, W5f + W2-4b)
ALTER TABLE "Attendance" ADD COLUMN     "centerId" TEXT;
ALTER TABLE "ClassSession" ADD COLUMN     "centerId" TEXT,
ADD COLUMN     "roomId" TEXT;
ALTER TABLE "Enrollment" ADD COLUMN     "centerId" TEXT;

-- AlterTable — RevenueTarget: amount → targetAmount (bảng rỗng)
ALTER TABLE "RevenueTarget" DROP COLUMN "amount",
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "targetAmount" INTEGER NOT NULL;

-- AlterTable — ScormAttempt: bản FixLMS ghi-điểm → bản main tracking GV (bảng rỗng)
ALTER TABLE "ScormAttempt" DROP COLUMN "lessonStatus",
DROP COLUMN "rawCmi",
DROP COLUMN "scoreMax",
ADD COLUMN     "lastAccessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lessonLocation" TEXT,
ADD COLUMN     "sessionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalTimeSec" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "scoreRaw" SET DATA TYPE DOUBLE PRECISION,
DROP COLUMN "completion",
ADD COLUMN     "completion" "ScormCompletion" NOT NULL DEFAULT 'NOT_ATTEMPTED';

-- DropTable (messaging FixLMS — rỗng)
DROP TABLE "Message";
DROP TABLE "MessageThread";

-- CreateTable RefundRequest (D1 — main)
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "centerId" TEXT,
    "trigger" "RefundTrigger" NOT NULL,
    "reason" TEXT NOT NULL,
    "paidConfirmed" INTEGER NOT NULL,
    "sessionsTotal" INTEGER NOT NULL,
    "sessionsLearned" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "proposedAmount" INTEGER NOT NULL,
    "approvedAmount" INTEGER,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable ConversationMessage (D6 — main, per-enrollment)
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorSide" "ConversationSide" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readByParentAt" TIMESTAMPTZ(6),
    "readByStaffAt" TIMESTAMPTZ(6),

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundRequest_enrollmentId_idx" ON "RefundRequest"("enrollmentId");
CREATE INDEX "RefundRequest_status_idx" ON "RefundRequest"("status");
CREATE INDEX "RefundRequest_centerId_idx" ON "RefundRequest"("centerId");
CREATE INDEX "ConversationMessage_enrollmentId_createdAt_idx" ON "ConversationMessage"("enrollmentId", "createdAt");
CREATE INDEX "Attendance_centerId_idx" ON "Attendance"("centerId");
CREATE INDEX "ClassSession_roomId_idx" ON "ClassSession"("roomId");
CREATE INDEX "ClassSession_centerId_idx" ON "ClassSession"("centerId");
CREATE INDEX "Enrollment_centerId_idx" ON "Enrollment"("centerId");
CREATE INDEX "RevenueTarget_centerId_idx" ON "RevenueTarget"("centerId");
CREATE INDEX "ScormAttempt_userId_idx" ON "ScormAttempt"("userId");
CREATE INDEX "ScormAttempt_classSessionId_idx" ON "ScormAttempt"("classSessionId");

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudentSkillAssessment" ADD CONSTRAINT "StudentSkillAssessment_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudentSkillAssessment" ADD CONSTRAINT "StudentSkillAssessment_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
