-- P2 · US-08 — Position + PositionRole + PositionAssignment (BA §2.4).
-- ADDITIVE hoàn toàn: chỉ CREATE, không đụng bảng nào đang có dữ liệu (luật cứng #4).

CREATE TYPE "PositionAssignmentKind" AS ENUM ('PRIMARY', 'CONCURRENT', 'DELEGATED');

CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isManagerial" BOOLEAN NOT NULL DEFAULT false,
    "reportsToPositionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PositionRole" (
    "positionId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionRole_pkey" PRIMARY KEY ("positionId","roleId")
);

CREATE TABLE "PositionAssignment" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PositionAssignmentKind" NOT NULL DEFAULT 'PRIMARY',
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "status" "AssignStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PositionAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Position_orgUnitId_isActive_idx" ON "Position"("orgUnitId", "isActive");
CREATE INDEX "Position_reportsToPositionId_idx" ON "Position"("reportsToPositionId");
CREATE INDEX "PositionRole_roleId_idx" ON "PositionRole"("roleId");
CREATE INDEX "PositionAssignment_userId_status_idx" ON "PositionAssignment"("userId", "status");
CREATE INDEX "PositionAssignment_positionId_status_idx" ON "PositionAssignment"("positionId", "status");

ALTER TABLE "Position" ADD CONSTRAINT "Position_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Position" ADD CONSTRAINT "Position_reportsToPositionId_fkey" FOREIGN KEY ("reportsToPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PositionRole" ADD CONSTRAINT "PositionRole_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PositionRole" ADD CONSTRAINT "PositionRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠️ RLS BẮT BUỘC cho bảng mới (luật rút ra 09/08: migration 20260617 chỉ chạy MỘT LẦN,
-- bảng tạo sau ra đời với RLS TẮT mà anon/authenticated có sẵn đủ DML).
ALTER TABLE "Position" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PositionRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PositionAssignment" ENABLE ROW LEVEL SECURITY;
