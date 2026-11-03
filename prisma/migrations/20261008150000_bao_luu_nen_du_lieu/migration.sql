-- Bảo lưu · Phiên 2 — NỀN DỮ LIỆU (docs/bao-luu/spec.md §F). CHỈ THÊM, chạy lại được ([MIG-01]).
--
-- Mở rộng `StudentReserve` (KHÔNG dựng bảng thứ hai) + bảng sự kiện bất biến `StudentReserveEvent`
-- + `Course.allowPause` + `MakeupNeed.nguon`. Không đổi/bỏ cột nào đang có, không đổi kiểu cột tiền.
--
-- ⚠️ PHẢI CHẠY TAY TRÊN PROD (CLAUDE.md luật cứng #4): có 3 câu UPDATE backfill trên `StudentReserve`
-- (bảng nhỏ). Mỗi câu chỉ chạm dòng chưa được backfill nên chạy lại không đổi gì thêm.

-- ── Enum ────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentReserveStatus') THEN
    CREATE TYPE "StudentReserveStatus" AS ENUM ('PENDING','APPROVED','ACTIVE','RESUME_PENDING','ENDED','REJECTED','CANCELLED','OVERDUE','NOTICE_SENT','TERMINATED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentReserveType') THEN
    CREATE TYPE "StudentReserveType" AS ENUM ('PARENT','CENTER','LEGACY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentReserveReason') THEN
    CREATE TYPE "StudentReserveReason" AS ENUM ('ILLNESS','FAMILY','RELOCATION','SCHEDULE','OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentReserveEndKind') THEN
    CREATE TYPE "StudentReserveEndKind" AS ENUM ('RESUMED','TERMINATED','REFUNDED','TRANSFERRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentReserveEventKind') THEN
    CREATE TYPE "StudentReserveEventKind" AS ENUM ('REQUEST','APPROVE','REJECT','START','EXTEND_REQUEST','EXTEND','CONTACT','NOTICE','RESUME_REQUEST','RESUME','EXPIRE','ESCALATE','TERMINATE','RESTORE','CANCEL','CONVERT_CENTER');
  END IF;
END $$;

-- ── Cột mới của StudentReserve ──────────────────────────────────────────────────
-- `status` mặc định ACTIVE: đường cũ (`reserveStudentAction` trước Phiên 3) tạo lượt có hiệu lực
-- ngay, nên không phải sửa nó để cột mới nhất quán.
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "status" "StudentReserveStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "type" "StudentReserveType" NOT NULL DEFAULT 'PARENT';
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "reasonCode" "StudentReserveReason";
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "reasonNote" TEXT;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "centerId" TEXT;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "requestedAt" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "firstAbsentDate" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "standardEndDate" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "extendedEndDate" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "extendCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "endKind" "StudentReserveEndKind";
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "officialNoticeSentAt" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "officialNoticeChannel" TEXT;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "responseDeadline" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "lastContactAt" TIMESTAMPTZ(6);
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapSessionsRemaining" INTEGER;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapUnitPrice" INTEGER;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapTuitionNet" INTEGER;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapSoBuoiMua" INTEGER;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapSoBuoiSuyRa" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapPricing" JSONB;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapStoppedAtLessonOrder" INTEGER;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "policySnapshot" JSONB;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "extendedById" TEXT;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "extendRequest" JSONB;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "applicationFileKey" TEXT;
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "evidenceFileKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "resumeClassId" TEXT;

-- ── Backfill dòng cũ ───────────────────────────────────────────────────────────
-- THỨ TỰ có nghĩa: `type` phải chạy TRƯỚC khi `requestedAt` được điền — `requestedAt IS NULL` là
-- dấu "dòng này chưa từng được backfill", nên lần chạy lại không đổi hồ sơ mới đã lập bằng mã mới.
UPDATE "StudentReserve"
   SET "type" = 'LEGACY'
 WHERE "requestedAt" IS NULL AND "enrollmentId" IS NULL AND "type" = 'PARENT';

-- Dòng đã đóng ⇒ ENDED (mặc định cột mới là ACTIVE). Chỉ chạm dòng còn mang mặc định.
UPDATE "StudentReserve"
   SET "status" = 'ENDED'
 WHERE "status" = 'ACTIVE' AND ("isActive" = false OR "endedAt" IS NOT NULL);

-- Cơ sở lấy từ học viên (cột cách ly `scopedDb` đọc). Học viên không có cơ sở ⇒ dòng giữ NULL, chỉ
-- người cấp Hội sở thấy — đúng với mọi bảng khác của học viên.
UPDATE "StudentReserve" r
   SET "centerId" = s."centerId", "orgUnitId" = s."orgUnitId"
  FROM "Student" s
 WHERE s."id" = r."studentId" AND r."centerId" IS NULL AND s."centerId" IS NOT NULL;

-- ⚠️ KHÔNG điền `approvedAt` cho dòng cũ [sửa 08/10/2026, trước khi migration này chạy ở đâu ngoài máy dev].
-- `approvedAt IS NOT NULL` là DẤU "hồ sơ đời mới" mà roster (lib/bao-luu/roster.ts), cron `/api/cron/bao-luu`, cổng phụ huynh
-- ("Tạm hoãn thu") và `reserve-expiry` đều khoá vào. Bản đầu điền `approvedAt = startedAt` cho MỌI dòng cũ — mà đường cũ
-- `reserveStudentAction` CÓ ghi `enrollmentId` — nên ngay khi migration chạy, các bé đang bảo lưu theo đường cũ sẽ rời danh sách lớp,
-- rời nhóm chat, bị cron xử lý như hồ sơ mới… BẤT KỂ cờ `pause.enabled` đang TẮT. Dòng cũ chỉ thành "đời mới" khi người có quyền
-- nhập nó qua màn "Nhập ca LEGACY" (có đơn, có ngày bắt đầu thực tế) — lúc đó `approvedAt` mới được ghi.
UPDATE "StudentReserve"
   SET "requestedAt"     = "createdAt",
       "standardEndDate" = COALESCE("standardEndDate", "expectedEndAt")
 WHERE "requestedAt" IS NULL;

-- ── Chỉ mục ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "StudentReserve_centerId_status_idx" ON "StudentReserve"("centerId", "status");
CREATE INDEX IF NOT EXISTS "StudentReserve_status_standardEndDate_idx" ON "StudentReserve"("status", "standardEndDate");
CREATE INDEX IF NOT EXISTS "StudentReserve_orgUnitId_idx" ON "StudentReserve"("orgUnitId");

-- Một ghi danh tối đa MỘT hồ sơ đang mở (BR-08/spec §B). Dòng `enrollmentId = NULL` (cả học viên,
-- hồ sơ cũ) không nằm trong chỉ mục này — Phiên 3 chặn bằng mã.
-- ⚠️ Nếu dữ liệu thật đã có hai hồ sơ mở cho cùng một ghi danh thì KHÔNG tạo chỉ mục (chỉ cảnh báo)
-- thay vì làm hỏng cả migration; người vận hành phải dọn rồi tạo lại bằng tay.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "StudentReserve"
     WHERE "enrollmentId" IS NOT NULL
       AND "status" NOT IN ('ENDED','TERMINATED','REJECTED','CANCELLED')
     GROUP BY "enrollmentId" HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'StudentReserve_enrollment_open_key: BỎ QUA — có ghi danh đang có >1 hồ sơ mở. Dọn rồi tạo chỉ mục bằng tay.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "StudentReserve_enrollment_open_key"
      ON "StudentReserve"("enrollmentId")
      WHERE "enrollmentId" IS NOT NULL AND "status" NOT IN ('ENDED','TERMINATED','REJECTED','CANCELLED');
  END IF;
END $$;

-- ── Bảng sự kiện bất biến ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudentReserveEvent" (
    "id" TEXT NOT NULL,
    "reserveId" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "kind" "StudentReserveEventKind" NOT NULL,
    "actorId" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    CONSTRAINT "StudentReserveEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StudentReserveEvent_reserveId_at_idx" ON "StudentReserveEvent"("reserveId", "at");
CREATE INDEX IF NOT EXISTS "StudentReserveEvent_centerId_kind_idx" ON "StudentReserveEvent"("centerId", "kind");
CREATE INDEX IF NOT EXISTS "StudentReserveEvent_orgUnitId_idx" ON "StudentReserveEvent"("orgUnitId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentReserveEvent_reserveId_fkey') THEN
    ALTER TABLE "StudentReserveEvent" ADD CONSTRAINT "StudentReserveEvent_reserveId_fkey"
      FOREIGN KEY ("reserveId") REFERENCES "StudentReserve"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Bất biến: chặn UPDATE. DELETE KHÔNG chặn — học viên bị xoá thì hồ sơ + sự kiện đi theo (cascade).
-- Thân hàm viết MỘT dòng: guard `prisma-migration-sanity` chỉ nhận từ khoá SQL ở cột 0 và không biết `END;` của PL/pgSQL.
CREATE OR REPLACE FUNCTION "StudentReserveEvent_chan_sua"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'StudentReserveEvent bất biến: chỉ INSERT, không UPDATE'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "StudentReserveEvent_bat_bien" ON "StudentReserveEvent";
CREATE TRIGGER "StudentReserveEvent_bat_bien" BEFORE UPDATE ON "StudentReserveEvent"
  FOR EACH ROW EXECUTE FUNCTION "StudentReserveEvent_chan_sua"();

ALTER TABLE "StudentReserveEvent" ENABLE ROW LEVEL SECURITY;

-- ── Bảng có sẵn ────────────────────────────────────────────────────────────────
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "allowPause" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "nguon" TEXT;
