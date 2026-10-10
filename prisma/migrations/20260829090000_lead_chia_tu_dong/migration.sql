-- CHIA LEAD TỰ ĐỘNG (29/08/2026) — pool bật/tắt được, sổ chia lead, mốc nhập lại.
--
-- Toàn bộ migration này là THÊM: thêm cột (đều nullable hoặc có default), thêm bảng,
-- thêm index, và hai lượt backfill chỉ ghi vào cột/hàng vừa tạo. KHÔNG đổi kiểu, KHÔNG
-- bỏ cột nào — luật cứng Nền Hệ thống #4.

-- ─── 1. Đường nào đưa lead tới chủ của nó ────────────────────────────────────
CREATE TYPE "LeadAssignSource" AS ENUM ('AUTO', 'SELF', 'MANAGER', 'IMPORT', 'AFFILIATE', 'DUPLICATE');

-- ─── 2. Pool: tư cách thành viên nằm CHUNG HÀNG với bộ đếm lượt ──────────────
-- Chung hàng vì luật "bật lại thì seed turns = MIN(pool đang bật)" là đọc `isActive`
-- rồi ghi `turns` nguyên tử. Một hàng ⇒ một UPDATE; hai bảng ⇒ hai thứ phải khoá
-- đúng thứ tự, và sẽ có người khoá sai thứ tự.
ALTER TABLE "LeadRotationTurn" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LeadRotationTurn" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMPTZ(6);
ALTER TABLE "LeadRotationTurn" ADD COLUMN IF NOT EXISTS "pausedReason" TEXT;
CREATE INDEX IF NOT EXISTS "LeadRotationTurn_orgUnitId_isActive_turns_idx"
  ON "LeadRotationTurn" ("orgUnitId", "isActive", "turns");

-- ─── 3. Bốn cột mới trên Lead ────────────────────────────────────────────────
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "assignmentSource" "LeadAssignSource";
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "assignedById" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMPTZ(6);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "inboundCount" INTEGER NOT NULL DEFAULT 1;

-- Backfill mốc nhập lại = ngày tạo. Lead cũ chưa từng được đếm lần nhập nào, nên
-- `inboundCount` giữ mặc định 1 — bịa số lần nhập là làm hỏng đúng con số mà bảng
-- này sinh ra để trả lời.
UPDATE "Lead" SET "lastInboundAt" = "createdAt" WHERE "lastInboundAt" IS NULL;

-- ─── 4. Sổ chia lead + nhật ký thay đổi pool ─────────────────────────────────
CREATE TABLE "LeadAssignmentLog" (
  "id"             TEXT NOT NULL,
  "leadId"         TEXT,
  "orgUnitId"      TEXT NOT NULL,
  "assignedToId"   TEXT,
  "createdById"    TEXT,
  "source"         "LeadAssignSource" NOT NULL,
  "consumedTurn"   BOOLEAN NOT NULL,
  "turnCountAfter" INTEGER,
  "poolSnapshot"   JSONB,
  "note"           TEXT,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadAssignmentLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadAssignmentLog_orgUnitId_createdAt_idx" ON "LeadAssignmentLog" ("orgUnitId", "createdAt");
CREATE INDEX "LeadAssignmentLog_assignedToId_createdAt_idx" ON "LeadAssignmentLog" ("assignedToId", "createdAt");
CREATE INDEX "LeadAssignmentLog_leadId_idx" ON "LeadAssignmentLog" ("leadId");

CREATE TABLE "LeadAssignmentPoolEvent" (
  "id"        TEXT NOT NULL,
  "orgUnitId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "fromValue" JSONB,
  "toValue"   JSONB,
  "reason"    TEXT,
  "actorId"   TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadAssignmentPoolEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadAssignmentPoolEvent_orgUnitId_createdAt_idx" ON "LeadAssignmentPoolEvent" ("orgUnitId", "createdAt");
CREATE INDEX "LeadAssignmentPoolEvent_userId_createdAt_idx" ON "LeadAssignmentPoolEvent" ("userId", "createdAt");

-- ─── 5. BACKFILL POOL — dựng hàng cho sale CHƯA TỪNG nhận lượt ───────────────
--
-- Vì sao bắt buộc: trước đây hàng `LeadRotationTurn` chỉ sinh ra lúc ai đó được chia
-- LẦN ĐẦU. Nghĩa là màn cấu hình pool sẽ không liệt kê nổi sale mới vào — người vận
-- hành không bật/tắt được ai chưa từng nhận lead, đúng nhóm cần thao tác nhất.
--
-- `turns` = MIN của vòng đang bật (0 nếu vòng còn rỗng) — KHÔNG phải 0 khi vòng đã
-- chạy: seed 0 giữa vòng 100 lượt là người mới hút sạch lead cho tới khi đuổi kịp.
-- `seedTurns` = `turns` để "số lead thật sự nhận qua vòng" của họ khởi điểm bằng 0.
--
-- Nối User → đơn vị theo `lib/org/center-bridge.ts`: khớp `OrgUnit.code = Center.code`.
-- Người không có `centerId`, hoặc cơ sở không có OrgUnit tương ứng, bị BỎ QUA — thà
-- thiếu một dòng để người vận hành tự thêm còn hơn đoán nhầm đơn vị rồi chia lead
-- sang cơ sở khác.
INSERT INTO "LeadRotationTurn" ("id", "orgUnitId", "userId", "turns", "seedTurns", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  ou."id",
  u."id",
  COALESCE(m."minTurns", 0),
  COALESCE(m."minTurns", 0),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
JOIN "Center"  c  ON c."id" = u."centerId"
JOIN "OrgUnit" ou ON ou."code" = c."code" AND ou."deletedAt" IS NULL
LEFT JOIN LATERAL (
  SELECT MIN(t."turns") AS "minTurns"
  FROM "LeadRotationTurn" t
  WHERE t."orgUnitId" = ou."id" AND t."isActive" = true
) m ON true
WHERE u."deletedAt" IS NULL
  AND u."isActive" = true
  AND 'SALES_CSM' = ANY (u."roles")
  AND NOT EXISTS (
    SELECT 1 FROM "LeadRotationTurn" x
    WHERE x."orgUnitId" = ou."id" AND x."userId" = u."id"
  );
