-- === CHAT REALTIME (Đợt 0) — US-04: job đối soát thành viên hằng đêm ===
-- Additive thuần: 1 enum + 2 bảng log kỹ thuật, không đụng bảng cũ.
-- ConversationMembershipDrift: mỗi lệch một dòng (REMOVE tự thi hành / ADD chờ người).
-- ConversationReconcileRun: mỗi lần chạy một dòng — phân biệt "đêm sạch" (0/0)
-- với "job không chạy" (không có dòng) — US-04 AC4.
-- Apply qua `prisma migrate deploy` (non-interactive, theo .claude/rules/prisma-db.md).

-- CreateEnum
CREATE TYPE "MembershipDriftType" AS ENUM ('REMOVE', 'ADD');

-- CreateTable
CREATE TABLE "ConversationMembershipDrift" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "driftType" "MembershipDriftType" NOT NULL,
    "detail" TEXT NOT NULL,
    "autoEnforced" BOOLEAN NOT NULL DEFAULT false,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMembershipDrift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationReconcileRun" (
    "id" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classesChecked" INTEGER NOT NULL,
    "removeCount" INTEGER NOT NULL,
    "addCount" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "ConversationReconcileRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationMembershipDrift_createdAt_idx" ON "ConversationMembershipDrift"("createdAt");

-- CreateIndex
CREATE INDEX "ConversationMembershipDrift_classId_createdAt_idx" ON "ConversationMembershipDrift"("classId", "createdAt");
