-- FL-R2 (E2-TRIAL) — slot tái sử dụng (QĐ-R2-1) + lịch sử học thử (item 6)

-- TrialClassV2.startDate → nullable: slot không gắn ngày bắt đầu cố định.
ALTER TABLE "TrialClassV2" ALTER COLUMN "startDate" DROP NOT NULL;

-- LeadTrialHistory: lịch sử "đã từng học thử" của 1 con (giữ kể cả khi lead rời pipeline).
CREATE TABLE "LeadTrialHistory" (
    "id" TEXT NOT NULL,
    "leadChildId" TEXT NOT NULL,
    "trialClassId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "attendedCount" INTEGER NOT NULL DEFAULT 0,
    "totalSessions" INTEGER NOT NULL,
    "firstAttendedAt" TIMESTAMPTZ(6),
    "lastAttendedAt" TIMESTAMPTZ(6),
    "outcome" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LeadTrialHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadTrialHistory_leadChildId_trialClassId_key" ON "LeadTrialHistory"("leadChildId", "trialClassId");
CREATE INDEX "LeadTrialHistory_leadChildId_idx" ON "LeadTrialHistory"("leadChildId");
CREATE INDEX "LeadTrialHistory_trialClassId_idx" ON "LeadTrialHistory"("trialClassId");
CREATE INDEX "LeadTrialHistory_centerId_idx" ON "LeadTrialHistory"("centerId");

ALTER TABLE "LeadTrialHistory" ADD CONSTRAINT "LeadTrialHistory_leadChildId_fkey" FOREIGN KEY ("leadChildId") REFERENCES "LeadChild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadTrialHistory" ADD CONSTRAINT "LeadTrialHistory_trialClassId_fkey" FOREIGN KEY ("trialClassId") REFERENCES "TrialClassV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
