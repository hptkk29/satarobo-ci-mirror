-- Nền Hệ thống P0 · US-03 — bảng UserGroup + UserGroupMember (nhóm người dùng, TS-02).
-- SQL gốc sinh bằng `prisma migrate diff --from-empty` rồi trích 2 bảng + thêm guard.
-- IF NOT EXISTS có chủ đích (cùng lý do 20260808183000 / 20260809120000): DB dev dùng
-- chung nhiều nhánh nên SQL có thể được áp bằng `prisma db execute` trước khi migration
-- này được record bởi `migrate deploy` — chạy lại phải no-op, không được fail.
-- Người vận hành áp tay; KHÔNG apply tự động từ máy dev.
--
-- Thiết kế duyệt 09/08/2026:
--   · UserGroup SOFT DELETE (deletedAt) — nhóm xoá thì grant GROUP của nó vô hiệu ở
--     lần resolve actor kế, không cần dọn PermissionGrant.
--   · UserGroupMember HARD DELETE (gỡ member mất ngay; audit ở RbacAuditLog).
--   · Unique tên nhóm CHỈ giữa nhóm còn sống → PARTIAL UNIQUE INDEX (Prisma không
--     biểu diễn được trong schema — nguồn sự thật của index này là file SQL này).

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserGroupMember" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroupMember_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateIndex — PARTIAL UNIQUE: trùng tên chỉ bị chặn giữa các nhóm CHƯA xoá mềm
-- (tên nhóm đã xoá được tái sử dụng). Viết tay vì Prisma schema không hỗ trợ WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS "UserGroup_name_active_key" ON "UserGroup"("name") WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserGroupMember_groupId_idx" ON "UserGroupMember"("groupId");

-- AddForeignKey (idempotent — constraint không có IF NOT EXISTS nên bọc DO $$)
DO $$ BEGIN
    ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
