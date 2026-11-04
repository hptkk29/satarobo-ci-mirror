-- Cụm C4 — SataCoin (sổ cái bất biến + rule)

CREATE TYPE "SataCoinTxType" AS ENUM ('EARN', 'SPEND', 'ADJUST', 'REVERSAL');

CREATE TABLE "SataCoinTransaction" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "type" "SataCoinTxType" NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "centerId" TEXT,
  "ruleCode" TEXT,
  "reversedTxId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SataCoinTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SataCoinTransaction_reversedTxId_key" ON "SataCoinTransaction"("reversedTxId");
CREATE INDEX "SataCoinTransaction_studentId_createdAt_idx" ON "SataCoinTransaction"("studentId","createdAt");
CREATE INDEX "SataCoinTransaction_centerId_idx" ON "SataCoinTransaction"("centerId");
ALTER TABLE "SataCoinTransaction" ADD CONSTRAINT "SataCoinTransaction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SataCoinRule" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "centerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SataCoinRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SataCoinRule_code_key" ON "SataCoinRule"("code");
