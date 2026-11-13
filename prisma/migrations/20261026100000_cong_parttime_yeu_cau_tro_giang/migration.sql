-- CÔNG PARTTIME — SR.QD.238 · P2: QLCS ghi đè "lớp có bắt buộc trợ giảng không" (PL02 "trường hợp khác do QLCS quyết").
-- ADDITIVE: 1 bảng mới. Chạy lại được ([MIG-01]).

CREATE TABLE IF NOT EXISTS "ClassStaffingRequirement" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "taRequired" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ClassStaffingRequirement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClassStaffingRequirement_classId_key" ON "ClassStaffingRequirement"("classId");
CREATE INDEX IF NOT EXISTS "ClassStaffingRequirement_centerId_idx" ON "ClassStaffingRequirement"("centerId");
CREATE INDEX IF NOT EXISTS "ClassStaffingRequirement_orgUnitId_idx" ON "ClassStaffingRequirement"("orgUnitId");

ALTER TABLE "ClassStaffingRequirement" ENABLE ROW LEVEL SECURITY;
