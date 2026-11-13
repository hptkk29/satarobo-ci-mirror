-- FL3-02 — Backfill centerId cho Enrollment + ClassSession (denormalize từ Class).
-- Bắt buộc trước khi scopedDb cách ly 2 model này: centerId NULL sẽ bị inject
-- `centerId IN (...)` → ẨN NHẦM record với mọi role center-scoped (CM/Sale/Kế toán/GV).
-- Idempotent: chỉ set khi đang NULL; chạy lại an toàn.

UPDATE "Enrollment" e
SET "centerId" = c."centerId"
FROM "Class" c
WHERE e."classId" = c."id"
  AND e."centerId" IS NULL
  AND c."centerId" IS NOT NULL;

UPDATE "ClassSession" s
SET "centerId" = c."centerId"
FROM "Class" c
WHERE s."classId" = c."id"
  AND s."centerId" IS NULL
  AND c."centerId" IS NOT NULL;
