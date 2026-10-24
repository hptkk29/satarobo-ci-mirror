-- T3.2 (QĐ-7) — "Sale phụ trách" gắn ở cấp GHI DANH (Enrollment), không phải Student:
-- 1 học viên học nhiều khoá/lớp có thể do sale khác chăm.
-- Additive + nullable → không phá dữ liệu cũ; backfill từ Lead.assignedToId ở bước 2.

-- Bước 1 — cột + FK + index
ALTER TABLE "Enrollment" ADD COLUMN "saleId" TEXT;

ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Enrollment_saleId_idx" ON "Enrollment"("saleId");

-- Bước 2 — BACKFILL cho ghi danh đã convert từ lead: lấy Lead.assignedToId qua
-- LeadChild (đường truy vết per-child của R7-06). Ghi danh tạo tay (leadChildId NULL)
-- giữ NULL — giáo vụ gán tay ở màn "Học sinh trong lớp".
UPDATE "Enrollment" e
SET "saleId" = l."assignedToId"
FROM "LeadChild" lc
JOIN "Lead" l ON l."id" = lc."leadId"
WHERE e."leadChildId" = lc."id"
  AND e."saleId" IS NULL
  AND l."assignedToId" IS NOT NULL;
