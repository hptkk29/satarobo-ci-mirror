-- === CHAT REALTIME (Đợt 0) — US-01 ===
-- Additive thuần: 7 enum + 5 bảng mới, không đụng bảng cũ.
-- SQL sinh bằng `prisma migrate diff` rồi apply qua `prisma migrate deploy`
-- (môi trường non-interactive, theo .claude/rules/prisma-db.md).

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('CLASS_GROUP', 'DM_TEACHER_PARENT', 'DM_SALE_PARENT', 'DM_STAFF');

-- CreateEnum
CREATE TYPE "ConversationSubjectType" AS ENUM ('CLASS', 'NONE');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('OWNER', 'MODERATOR', 'MEMBER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "ParticipantSource" AS ENUM ('DERIVED', 'MANUAL');

-- CreateEnum
CREATE TYPE "DerivedFrom" AS ENUM ('CLASS_TEACHER', 'CLASS_STUDENT_PARENT', 'CENTER_MANAGER');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('CHAT', 'ANNOUNCEMENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "subjectType" "ConversationSubjectType" NOT NULL DEFAULT 'NONE',
    "subjectId" TEXT,
    "dmKey" TEXT,
    "title" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'MEMBER',
    "source" "ParticipantSource" NOT NULL DEFAULT 'DERIVED',
    "derivedFrom" "DerivedFrom",
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "kind" "MessageKind" NOT NULL DEFAULT 'CHAT',
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "clientMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletedReason" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_dmKey_key" ON "Conversation"("dmKey");

-- CreateIndex
CREATE INDEX "Conversation_centerId_status_lastMessageAt_idx" ON "Conversation"("centerId", "status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_type_subjectType_subjectId_key" ON "Conversation"("type", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_leftAt_idx" ON "ConversationParticipant"("userId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_kind_createdAt_idx" ON "Message"("conversationId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_senderId_clientMsgId_key" ON "Message"("conversationId", "senderId", "clientMsgId");

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
