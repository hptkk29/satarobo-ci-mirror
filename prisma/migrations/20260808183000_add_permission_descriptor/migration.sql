-- Nền Hệ thống P0 · US-01 — Registry quyền tập trung (bảng PermissionDescriptor).
-- IF NOT EXISTS có chủ đích: DB dev dùng chung nhiều nhánh (chat + nền P0) nên bảng
-- được áp bằng `prisma db execute` trước khi migration này được record bởi
-- `migrate deploy` lúc nhánh merge — chạy lại phải no-op, không được fail.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PermissionDescriptor" (
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scopable" BOOLEAN NOT NULL DEFAULT true,
    "sensitiveFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PermissionDescriptor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PermissionDescriptor_module_idx" ON "PermissionDescriptor"("module");
