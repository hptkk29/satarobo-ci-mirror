-- Cụm C2 — Lịch sử phân công lead (bàn giao)

CREATE TABLE "LeadAssignmentHistory" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "fromUserId" TEXT,
  "toUserId" TEXT,
  "assignedById" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadAssignmentHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadAssignmentHistory_leadId_idx" ON "LeadAssignmentHistory"("leadId");
CREATE INDEX "LeadAssignmentHistory_fromUserId_idx" ON "LeadAssignmentHistory"("fromUserId");
CREATE INDEX "LeadAssignmentHistory_toUserId_idx" ON "LeadAssignmentHistory"("toUserId");
ALTER TABLE "LeadAssignmentHistory" ADD CONSTRAINT "LeadAssignmentHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
