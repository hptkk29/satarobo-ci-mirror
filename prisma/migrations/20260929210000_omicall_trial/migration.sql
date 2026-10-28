-- [MIG-01] (01/10/2026): thêm IF NOT EXISTS / bọc CREATE TYPE bằng pg_type để tệp CHẠY LẠI
-- được — cùng cách #462 làm cho 3 migration kế toán. KHÔNG đổi ngữ nghĩa câu nào; migration
-- này mới có trên DB test (chưa lên prod).
-- TÍCH HỢP OMICALL — ĐỢT DÙNG THỬ 7 NGÀY (29/09/2026).
-- Đặc tả: docs/goi-dien/THIET-KE-TICH-HOP-OMICALL.md mục 3.
--
-- CHỈ THÊM (luật cứng #4): 3 enum + 4 bảng MỚI + 6 cột NULLABLE/có mặc định trên hai
-- bảng đã có (`CallLog`, `CallExtension`). KHÔNG đổi kiểu, KHÔNG bỏ cột, KHÔNG backfill.
-- Rollback = ngừng ghi; bảng/cột mới nằm im, dữ liệu cũ không suy suyển.
--
-- Dấu thời gian 20260929210000: LỚN HƠN mọi migration đang có trên origin/test,
-- origin/main VÀ các nhánh đang mở (đo 29/09 — nhánh khác đã có 20260929120000 và
-- 20260929180000, nên không lấy mốc 12h như bản nháp đặc tả).

-- ─── Enum ────────────────────────────────────────────────────────────────────
-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallIntentStatus') THEN
    CREATE TYPE "CallIntentStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'MATCHED', 'SIMULATED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallRecordingJobStatus') THEN
    CREATE TYPE "CallRecordingJobStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED', 'FAILED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallEventLeg') THEN
    CREATE TYPE "CallEventLeg" AS ENUM ('AGENT', 'CUSTOMER');
  END IF;
END $$;

-- ─── Cột mới trên CallLog ────────────────────────────────────────────────────
-- `recordSeconds`: `record_seconds` của CDR. Có link ghi âm mà 0 giây ⇒ không tạo job tải.
-- `providerAgentId`: `create_by.id` / `agent_id` — mã nhân viên phía OmiCall.
-- `providerUpdatedAt`: `last_updated_date` / `created_date` — CDR mới hơn mới được ghi đè.
-- `isAutoCall`: `is_auto_call` / `is_callbot` — không tính KPI Sale, không ghi activity.
--   DEFAULT false trên bảng có dữ liệu: Postgres ≥ 11 thêm cột có mặc định HẰNG mà không
--   viết lại bảng, và mọi cuộc gọi cũ đúng là cuộc gọi người bấm (chưa có callbot nào).
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "recordSeconds" INTEGER;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "providerAgentId" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "providerUpdatedAt" TIMESTAMPTZ(6);
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "isAutoCall" BOOLEAN NOT NULL DEFAULT false;

-- ─── Cột mới trên CallExtension ──────────────────────────────────────────────
ALTER TABLE "CallExtension" ADD COLUMN IF NOT EXISTS "providerAgentId" TEXT;
ALTER TABLE "CallExtension" ADD COLUMN IF NOT EXISTS "note" TEXT;

-- ─── CallIntent — ý định gọi ra, ghi TRƯỚC khi bấm click2call ────────────────
-- Mang dữ liệu theo cơ sở ⇒ CẢ HAI cột `centerId` + `orgUnitId` (luật Nền #3 bản
-- đính chính 27/08), khai đủ SCOPED_MODELS + getModelPrefixes + BACKFILL_SPECS.
-- CreateTable
CREATE TABLE IF NOT EXISTS "CallIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "peerPhone" TEXT NOT NULL,
    "hotline" TEXT,
    "leadId" TEXT,
    "studentId" TEXT,
    "purpose" "CallPurpose" NOT NULL,
    "providerCallId" TEXT,
    "status" "CallIntentStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "matchedCallLogId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CallIntent_pkey" PRIMARY KEY ("id")
);

-- ─── CallHotline — hotline ↔ cơ sở (bảng cấu hình, cùng nhóm CallExtension) ──
-- CreateTable
CREATE TABLE IF NOT EXISTS "CallHotline" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CallHotline_pkey" PRIMARY KEY ("id")
);

-- ─── CallRecordingJob — hàng đợi tải ghi âm (nội bộ, KHÔNG mang dữ liệu cơ sở) ─
-- Đặc tả §11.4: link ghi âm của OmiCall tải được KHÔNG cần xác thực ⇒ nó là BÍ MẬT và
-- KHÔNG được lưu ở bất kỳ đâu — CỐ Ý không có cột `sourceUrl`. Job chỉ giữ `callLogId`;
-- worker lấy link MỚI qua `chiTietCuocGoi(transaction_id)` lúc thử lại.
-- CreateTable
CREATE TABLE IF NOT EXISTS "CallRecordingJob" (
    "id" TEXT NOT NULL,
    "callLogId" TEXT NOT NULL,
    "status" "CallRecordingJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CallRecordingJob_pkey" PRIMARY KEY ("id")
);

-- ─── CallEvent — sự kiện tức thời (đặc tả §11.3, đảo D8 một phần) ─────────────
-- Nội bộ, KHÔNG cách ly cơ sở (như CallRecordingJob) — chỉ trang Kết nối đọc; cron dọn
-- sau 30 ngày. KHÔNG tạo CallLog từ đây. UNIQUE(uniqueId, eventName) khử trùng cả hai
-- leg lẫn lượt gửi lại. `rawPayload` phải ĐÃ CHE trước khi ghi (`cheBanGhiTho`).
-- CreateTable
CREATE TABLE IF NOT EXISTS "CallEvent" (
    "id" TEXT NOT NULL,
    "callUuid" TEXT NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "extension" TEXT,
    "hotline" TEXT,
    "peerPhone" TEXT,
    "leg" "CallEventLeg" NOT NULL,
    "device" TEXT,
    "eventAt" TIMESTAMPTZ(6) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id")
);

-- ─── Chỉ mục ─────────────────────────────────────────────────────────────────
-- Khớp intent ↔ CDR: theo `call_uuid` trước, rồi theo (máy lẻ, số khách, ±3 phút).
CREATE INDEX IF NOT EXISTS "CallIntent_extension_peerPhone_createdAt_idx" ON "CallIntent"("extension", "peerPhone", "createdAt");

CREATE INDEX IF NOT EXISTS "CallIntent_providerCallId_idx" ON "CallIntent"("providerCallId");

CREATE INDEX IF NOT EXISTS "CallIntent_userId_createdAt_idx" ON "CallIntent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "CallIntent_centerId_idx" ON "CallIntent"("centerId");

CREATE INDEX IF NOT EXISTS "CallIntent_orgUnitId_idx" ON "CallIntent"("orgUnitId");

CREATE UNIQUE INDEX IF NOT EXISTS "CallHotline_number_key" ON "CallHotline"("number");

CREATE INDEX IF NOT EXISTS "CallHotline_centerId_idx" ON "CallHotline"("centerId");

CREATE INDEX IF NOT EXISTS "CallHotline_orgUnitId_idx" ON "CallHotline"("orgUnitId");

-- Một cuộc gọi — một job tải. Chống trùng khi CDR được gửi lại (OC-1 ở tầng job).
CREATE UNIQUE INDEX IF NOT EXISTS "CallRecordingJob_callLogId_key" ON "CallRecordingJob"("callLogId");

CREATE INDEX IF NOT EXISTS "CallRecordingJob_status_nextAttemptAt_idx" ON "CallRecordingJob"("status", "nextAttemptAt");

-- Hai leg / gửi lại cùng một sự kiện ⇒ đúng một dòng.
CREATE UNIQUE INDEX IF NOT EXISTS "CallEvent_uniqueId_eventName_key" ON "CallEvent"("uniqueId", "eventName");

CREATE INDEX IF NOT EXISTS "CallEvent_callUuid_idx" ON "CallEvent"("callUuid");

-- Dòng thời gian của một cuộc / lọc theo lúc sự kiện xảy ra (`event_time`).
CREATE INDEX IF NOT EXISTS "CallEvent_eventAt_idx" ON "CallEvent"("eventAt");

-- Nhật ký gần đây trên trang Kết nối + cron dọn 30 ngày.
CREATE INDEX IF NOT EXISTS "CallEvent_createdAt_idx" ON "CallEvent"("createdAt");

-- RLS: bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT
-- LẦN — sự cố 09/08). Thiếu các dòng này thì SĐT khách trong CallIntent/CallEvent phơi
-- qua PostgREST.
ALTER TABLE "CallIntent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallHotline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallRecordingJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallEvent" ENABLE ROW LEVEL SECURITY;
