-- Nền Hệ thống P1 · US-05 (OrgUnit materialized path) + US-06 (LegalEntity).
--
-- ADDITIVE TUYỆT ĐỐI. Không RENAME, không DROP, không đổi kiểu cột nào đang có dữ liệu
-- (luật cứng #4). Cụ thể:
--   · KHÔNG đổi tên `OrgUnit.type` thành `unitType` dù BA §2.2 gọi thế — 13 call-site TS
--     đang đọc `.type`, và DB của môi trường `test` CHÍNH LÀ DB dev đang có người dùng.
--     Ánh xạ tên nằm ở tầng domain (lib/org/types.ts), không ở DB.
--   · KHÔNG đụng `isActive` / `deletedAt`. Cột `status` mới là GƯƠNG của `isActive`
--     (ACTIVE ⇔ isActive=true, SUSPENDED ⇔ isActive=false); nguồn sự thật vẫn là cặp cũ
--     cho tới P4. Mọi câu hỏi "đơn vị còn sống không" đi qua lib/org/status.ts.
--   · KHÔNG dời node nào. Việc dời CS1/CS2 xuống dưới REGION (US-05 AC2, chủ dự án chốt
--     11/08 theo BA 08/08 §1.1) làm bằng script dry-run `scripts/nen-p1-reshape-org-tree.ts`
--     do người vận hành chạy tay trên PROD — README bàn giao §5.
--
-- IF NOT EXISTS / DO-block guard: DB dev dùng chung nhiều nhánh (xem 20260809160000).
-- Người vận hành áp tay; KHÔNG apply tự động từ máy dev.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enum trục SỞ HỮU + trục VÒNG ĐỜI (BA §2.2)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "OrgRelationshipType" AS ENUM ('OWNED', 'FRANCHISEE', 'AFFILIATE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "OrgUnitStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. US-06 — LegalEntity (pháp nhân tách khỏi đơn vị vận hành, BA §2.3)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LegalEntity" (
    "id" TEXT NOT NULL,
    "taxCode" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "address" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- ⚠️ ENABLE ROW LEVEL SECURITY là BẮT BUỘC với mọi bảng mới trong schema public:
-- migration 20260617000000 chỉ bật RLS cho bảng TỒN TẠI LÚC ĐÓ; bảng sinh sau ra đời với
-- RLS TẮT trong khi Supabase đã cấp sẵn anon/authenticated đủ DML (lỗ đã phải vá ở
-- 20260809130000 / 20260809140000). Chỉ ENABLE (không FORCE): Prisma là owner nên bypass,
-- app không đổi hành vi; không tạo policy = deny-all cho anon/authenticated.
-- Bảng pháp nhân mang MST + tên pháp lý ⇒ tuyệt đối không để lộ qua PostgREST.
ALTER TABLE "LegalEntity" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS "LegalEntity_taxCode_key" ON "LegalEntity"("taxCode");
CREATE INDEX IF NOT EXISTS "LegalEntity_deletedAt_idx" ON "LegalEntity"("deletedAt");

-- US-06 AC2 — "pháp nhân gốc isPrimary DUY NHẤT". Ép ở DB bằng partial unique index chứ
-- không bằng kỷ luật code: Prisma không biểu diễn được partial index, nên NGUỒN SỰ THẬT
-- của ràng buộc này là chính file SQL này (cùng kiểu với UserGroup_name partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS "LegalEntity_isPrimary_unique"
    ON "LegalEntity"(("isPrimary")) WHERE "isPrimary" AND "deletedAt" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. US-05 — cột mới trên OrgUnit
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "OrgUnit"
    ADD COLUMN IF NOT EXISTS "path" TEXT,
    ADD COLUMN IF NOT EXISTS "depth" INTEGER,
    ADD COLUMN IF NOT EXISTS "relationshipType" "OrgRelationshipType" NOT NULL DEFAULT 'OWNED',
    ADD COLUMN IF NOT EXISTS "status" "OrgUnitStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "effectiveTo" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT,
    ADD COLUMN IF NOT EXISTS "templateId" TEXT;

DO $$ BEGIN
    ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_legalEntityId_fkey"
        FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Index prefix cho `path LIKE '/ho/danang/%'` (BA §2.5 UNIT_AND_BELOW O(1)).
-- text_pattern_ops là thứ làm LIKE 'prefix%' dùng được index kể cả khi collation của DB
-- không phải "C" — index B-tree mặc định KHÔNG phục vụ LIKE trên collation vi_VN/en_US.
CREATE INDEX IF NOT EXISTS "OrgUnit_path_idx" ON "OrgUnit"("path" text_pattern_ops);
CREATE INDEX IF NOT EXISTS "OrgUnit_legalEntityId_idx" ON "OrgUnit"("legalEntityId");
CREATE INDEX IF NOT EXISTS "OrgUnit_status_idx" ON "OrgUnit"("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill path/depth cho cây ĐANG CÓ (hình dạng nào cũng đúng — không giả định)
--
-- Idempotent: tính lại toàn bộ từ parentId mỗi lần chạy, không phụ thuộc giá trị cũ.
-- Segment = lower(code) với "_" đổi thành "-" (khớp slugOf() trong lib/org/path.ts —
-- hai chỗ này PHẢI cùng công thức, có test [US-05-U-05] gim).
-- CYCLE ... SET is_cycle: dữ liệu bẩn có vòng cha-con sẽ làm CTE đệ quy chạy vô hạn;
-- mệnh đề CYCLE (PG 14+) dừng nhánh lặp thay vì treo migration. Node trong vòng sẽ
-- không được backfill ⇒ path NULL ⇒ script đối soát US-07 nhặt ra được.
-- ─────────────────────────────────────────────────────────────────────────────
WITH RECURSIVE tree AS (
    SELECT
        "id",
        "parentId",
        '/' || replace(lower(btrim("code")), '_', '-') || '/' AS "path",
        0 AS "depth"
    FROM "OrgUnit"
    WHERE "parentId" IS NULL

    UNION ALL

    SELECT
        c."id",
        c."parentId",
        t."path" || replace(lower(btrim(c."code")), '_', '-') || '/',
        t."depth" + 1
    FROM "OrgUnit" c
    JOIN tree t ON c."parentId" = t."id"
) CYCLE "id" SET is_cycle USING cycle_path
UPDATE "OrgUnit" o
SET "path" = t."path", "depth" = t."depth"
FROM tree t
WHERE o."id" = t."id" AND NOT t.is_cycle;

-- status = GƯƠNG của isActive (không phải nguồn sự thật mới — xem đầu file).
--
-- CHỈ hạ từ ACTIVE. Viết `status <> 'SUSPENDED'` là SAI: 'CLOSED' cũng thoả, nên lần chạy
-- lại thứ hai (đúng kịch bản mà header file này mô tả là chuyện thường) sẽ kéo đơn vị đã
-- ĐÓNG VĨNH VIỄN tụt về "tạm dừng, sẽ mở lại" — hai nghĩa mà softDeleteOrgUnit phân biệt
-- có chủ đích.
UPDATE "OrgUnit" SET "status" = 'SUSPENDED'
WHERE "isActive" = false AND "status" = 'ACTIVE';

-- Đơn vị đã xoá mềm là CLOSED, không phải SUSPENDED. Câu này phải đứng SAU câu trên:
-- mọi dòng xoá mềm trên DB đang chạy đều có isActive=false (softDeleteOrgUnit luôn set),
-- nên nếu không có nó thì migration tự đẻ ra tổ hợp deletedAt != NULL + SUSPENDED —
-- đúng tổ hợp mâu thuẫn mà lib/org/status.ts tuyên bố là bất biến.
UPDATE "OrgUnit" SET "status" = 'CLOSED'
WHERE "deletedAt" IS NOT NULL AND "status" <> 'CLOSED';
