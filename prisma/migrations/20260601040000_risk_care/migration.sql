-- Cụm B2 — cảnh báo rủi ro + care task

CREATE TYPE "RiskAlertType" AS ENUM ('CONSECUTIVE_ABSENCE','HIGH_ABSENCE','MISSED_SUBMISSIONS','NEEDS_SUPPORT','NEARING_END_NO_RENEWAL','OVERDUE_PAYMENT');
CREATE TYPE "RiskSeverity" AS ENUM ('LOW','MEDIUM','HIGH');
CREATE TYPE "RiskStatus" AS ENUM ('OPEN','RESOLVED','ESCALATED');
CREATE TYPE "CareTaskStatus" AS ENUM ('OPEN','DONE','CANCELLED');

CREATE TABLE "StudentRiskAlert" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "centerId" TEXT,
  "type" "RiskAlertType" NOT NULL,
  "severity" "RiskSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
  "detail" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentRiskAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentRiskAlert_studentId_status_idx" ON "StudentRiskAlert"("studentId","status");
CREATE INDEX "StudentRiskAlert_centerId_status_idx" ON "StudentRiskAlert"("centerId","status");
ALTER TABLE "StudentRiskAlert" ADD CONSTRAINT "StudentRiskAlert_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudentCareTask" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "centerId" TEXT,
  "assignedToId" TEXT,
  "riskAlertId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "CareTaskStatus" NOT NULL DEFAULT 'OPEN',
  "completedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentCareTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentCareTask_assignedToId_status_dueAt_idx" ON "StudentCareTask"("assignedToId","status","dueAt");
CREATE INDEX "StudentCareTask_centerId_status_idx" ON "StudentCareTask"("centerId","status");
CREATE INDEX "StudentCareTask_studentId_idx" ON "StudentCareTask"("studentId");
ALTER TABLE "StudentCareTask" ADD CONSTRAINT "StudentCareTask_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentCareTask" ADD CONSTRAINT "StudentCareTask_riskAlertId_fkey" FOREIGN KEY ("riskAlertId") REFERENCES "StudentRiskAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
