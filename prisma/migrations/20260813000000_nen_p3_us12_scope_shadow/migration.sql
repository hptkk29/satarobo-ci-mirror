-- Nền Hệ thống P3 · US-12 — bảng ghi lệch resolver dataScope (shadow).
--
-- CHỈ THÊM BẢNG MỚI. Không đụng cột nào của bảng đang có dữ liệu PROD (luật cứng #4).
-- Bảng riêng chứ không dùng chung `RbacShadowDiff`: bảng kia so can() v1↔v2 và đang
-- có một cổng đọc nó (`isSafeToEnableRbacV2`) — trộn vào là cổng đó đếm nhầm.

CREATE TABLE IF NOT EXISTS "ScopeShadowDiff" (
  "id"              TEXT NOT NULL,
  "ketQua"          TEXT NOT NULL,
  "permissionKey"   TEXT NOT NULL,
  "dataScope"       TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "cu"              BOOLEAN NOT NULL,
  "moi"             BOOLEAN,
  "roleId"          TEXT,
  "targetCenterId"  TEXT,
  "targetOrgUnitId" TEXT,
  "orgUnitId"       TEXT,
  "lyDo"            TEXT,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScopeShadowDiff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScopeShadowDiff_createdAt_idx"        ON "ScopeShadowDiff"("createdAt");
CREATE INDEX IF NOT EXISTS "ScopeShadowDiff_ketQua_createdAt_idx" ON "ScopeShadowDiff"("ketQua", "createdAt");
CREATE INDEX IF NOT EXISTS "ScopeShadowDiff_permissionKey_idx"    ON "ScopeShadowDiff"("permissionKey");
CREATE INDEX IF NOT EXISTS "ScopeShadowDiff_orgUnitId_idx"        ON "ScopeShadowDiff"("orgUnitId");

-- RLS: bảng mới ra đời phải TỰ BẬT (migration 20260617 chỉ chạy một lần — 31 bảng tạo
-- sau nó ra đời với RLS TẮT mà anon/authenticated có sẵn đủ DML).
ALTER TABLE "ScopeShadowDiff" ENABLE ROW LEVEL SECURITY;
