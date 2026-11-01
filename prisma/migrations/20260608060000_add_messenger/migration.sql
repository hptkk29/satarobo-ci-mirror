-- R1-01 — CRM Messenger models (SR.QD.217). Additive.

-- CreateTable
CREATE TABLE "FacebookPageMapping" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT,
    "scopeType" "OrgUnitType" NOT NULL,
    "centerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookPageMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerConversation" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "psid" TEXT NOT NULL,
    "parentName" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "centerId" TEXT,
    "firstMessageAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessengerConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT,
    "attachments" JSONB,
    "externalEventId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessengerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacebookPageMapping_pageId_key" ON "FacebookPageMapping"("pageId");

-- CreateIndex
CREATE INDEX "FacebookPageMapping_scopeType_idx" ON "FacebookPageMapping"("scopeType");

-- CreateIndex
CREATE UNIQUE INDEX "MessengerConversation_pageId_psid_key" ON "MessengerConversation"("pageId", "psid");

-- CreateIndex
CREATE INDEX "MessengerConversation_centerId_idx" ON "MessengerConversation"("centerId");

-- CreateIndex
CREATE INDEX "MessengerConversation_status_idx" ON "MessengerConversation"("status");

-- CreateIndex
CREATE INDEX "MessengerConversation_leadId_idx" ON "MessengerConversation"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "MessengerMessage_externalEventId_key" ON "MessengerMessage"("externalEventId");

-- CreateIndex
CREATE INDEX "MessengerMessage_conversationId_sentAt_idx" ON "MessengerMessage"("conversationId", "sentAt");

-- AddForeignKey
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessengerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
