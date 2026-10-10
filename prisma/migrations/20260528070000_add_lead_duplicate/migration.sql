-- Phase T1.3 — LeadDuplicate (log submit trùng SĐT trong 90 ngày)
CREATE TABLE "LeadDuplicate" (
    "id" TEXT NOT NULL,
    "primaryLeadId" TEXT NOT NULL,
    "duplicatePhone" TEXT NOT NULL,
    "source" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDuplicate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadDuplicate_primaryLeadId_idx" ON "LeadDuplicate"("primaryLeadId");
CREATE INDEX "LeadDuplicate_duplicatePhone_idx" ON "LeadDuplicate"("duplicatePhone");

ALTER TABLE "LeadDuplicate" ADD CONSTRAINT "LeadDuplicate_primaryLeadId_fkey" FOREIGN KEY ("primaryLeadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
