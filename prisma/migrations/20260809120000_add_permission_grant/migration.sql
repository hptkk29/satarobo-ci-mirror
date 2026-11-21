-- Nền Hệ thống P0 · US-02 — bảng PermissionGrant (engine can() hợp nhất, TS-02).
-- Ship RỖNG: không grant khớp → engine fallback NGUYÊN TRẠNG đường cũ (v1/v2/shadow/flag).
-- IF NOT EXISTS có chủ đích (cùng lý do 20260808183000_add_permission_descriptor): DB dev
-- dùng chung nhiều nhánh nên SQL có thể được áp bằng `prisma db execute` trước khi
-- migration này được record bởi `migrate deploy` — chạy lại phải no-op, không được fail.
-- Người vận hành áp tay; KHÔNG apply tự động từ máy dev.

-- CreateEnum (idempotent — enum không có IF NOT EXISTS nên bọc DO $$)
DO $$ BEGIN
    CREATE TYPE "GrantSubjectType" AS ENUM ('ROLE', 'GROUP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DataScope" AS ENUM ('ALL', 'UNIT_AND_BELOW', 'UNIT_ONLY', 'OWN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PermissionGrant" (
    "id" TEXT NOT NULL,
    "subjectType" "GrantSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "effect" "GrantType" NOT NULL,
    "dataScope" "DataScope" NOT NULL,
    "fieldMask" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "derivedFrom" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PermissionGrant_subjectType_subjectId_idx" ON "PermissionGrant"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PermissionGrant_permissionKey_idx" ON "PermissionGrant"("permissionKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PermissionGrant_subjectType_subjectId_permissionKey_effect_key" ON "PermissionGrant"("subjectType", "subjectId", "permissionKey", "effect");

-- AddForeignKey (idempotent — constraint không có IF NOT EXISTS nên bọc DO $$)
DO $$ BEGIN
    ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "PermissionDescriptor"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
