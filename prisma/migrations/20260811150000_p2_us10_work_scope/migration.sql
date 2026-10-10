-- P2 · US-10 — WorkScope: NƠI TÁC NGHIỆP, tách khỏi NƠI TRỰC THUỘC (BA §2.4).
-- ADDITIVE hoàn toàn: chỉ CREATE, không đụng bảng nào đang có dữ liệu (luật cứng #4).

CREATE TYPE "WorkScopeReason" AS ENUM ('TEACHING', 'MAKEUP', 'TRIAL', 'SUPPORT');

CREATE TABLE "WorkScope" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "reason" "WorkScopeReason" NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "WorkScope_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkScope_assignmentId_idx" ON "WorkScope"("assignmentId");
CREATE INDEX "WorkScope_orgUnitId_idx" ON "WorkScope"("orgUnitId");

-- Cascade theo assignment: phân công bị xoá cứng thì điều động đi theo (điều động không
-- tự đứng một mình được). Đường vận hành bình thường là ĐÓNG effectiveTo, không xoá.
ALTER TABLE "WorkScope" ADD CONSTRAINT "WorkScope_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "PositionAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkScope" ADD CONSTRAINT "WorkScope_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ⚠️ RLS BẮT BUỘC cho bảng mới (luật rút ra 09/08: migration 20260617 chỉ chạy MỘT LẦN,
-- bảng tạo sau ra đời với RLS TẮT mà anon/authenticated có sẵn đủ DML).
ALTER TABLE "WorkScope" ENABLE ROW LEVEL SECURITY;
