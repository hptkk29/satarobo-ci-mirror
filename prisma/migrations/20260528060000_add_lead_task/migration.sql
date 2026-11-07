-- Phase T1.2 — LeadTask (việc follow-up có deadline)

CREATE TYPE "LeadTaskStatus" AS ENUM ('OPEN', 'DONE', 'SKIPPED');

CREATE TABLE "LeadTask" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "assignedToName" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "LeadTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadTask_leadId_idx" ON "LeadTask"("leadId");
CREATE INDEX "LeadTask_assignedToId_status_dueAt_idx" ON "LeadTask"("assignedToId", "status", "dueAt");
CREATE INDEX "LeadTask_status_dueAt_idx" ON "LeadTask"("status", "dueAt");

ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
