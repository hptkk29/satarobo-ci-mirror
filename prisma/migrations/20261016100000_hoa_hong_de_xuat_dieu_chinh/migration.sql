-- 16/10/2026 — HOA HỒNG · ĐỀ XUẤT ĐIỀU CHỈNH (hướng B+C): bảng `CommissionAdjustmentRequest` + 3 enum.
-- Đặc tả: docs/source-commission/08 §16 (quản trị điều chỉnh hai cấp, đổi nguồn sau thu thành đề xuất chờ duyệt).
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 3 enum + 1 bảng MỚI. KHÔNG cột nào trên bảng có sẵn, KHÔNG backfill. Bảng sinh ra rỗng.
-- Rollback = ngừng gọi service đề xuất (khiếu nại tiền quay về ghi thẳng khi ngưỡng đủ lớn); bảng nằm im.
--
-- Vì sao MỘT BẢNG riêng thay vì thêm cột/trạng thái vào `CommissionDispute` / `CommissionHold`:
--   · `commission_dispute_bat_bien` cấm đổi các cột quyết định sau `decidedAt`, và `CommissionDispute_trang_thai_chk` kết bằng `ELSE false`
--     nên thêm một giá trị trạng thái là hỏng CHECK. Khiếu nại ĐỨNG Ở `UNDER_REVIEW` trong lúc chờ cấp hai.
--   · `CommissionHold` không có chỗ cho người duyệt cấp 1 / cấp 2.
--   · Đổi nguồn sau thu cần cùng một quy trình duyệt ⇒ MỘT bảng cho hai nguồn gốc (`origin`).
--
-- SỔ HOA HỒNG VẪN APPEND-ONLY: duyệt KHÔNG sửa dòng gốc — nó sinh dòng ĐIỀU CHỈNH MỚI (`DISPUTE_ADJUSTMENT` / `SOURCE_CORRECTION`).
-- Bảng này chỉ lưu "ai đề xuất · gói gì · ai duyệt · duyệt cấp mấy · ra những dòng nào".
--
-- Chạy lại được ([MIG-01]): enum kiểm pg_type, bảng/chỉ mục IF NOT EXISTS, FK/CHECK kiểm pg_constraint, hàm CREATE OR REPLACE,
-- trigger DROP IF EXISTS rồi CREATE.

-- ─── Enum ───────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionAdjustmentOrigin') THEN
    CREATE TYPE "CommissionAdjustmentOrigin" AS ENUM ('DISPUTE', 'SOURCE_CHANGE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionAdjustmentGovernance') THEN
    CREATE TYPE "CommissionAdjustmentGovernance" AS ENUM ('SINGLE_APPROVAL', 'SECOND_APPROVAL_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionAdjustmentStatus') THEN
    CREATE TYPE "CommissionAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED_L1', 'POSTED', 'REJECTED', 'STALE');
  END IF;
END $$;

-- ─── CommissionAdjustmentRequest ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionAdjustmentRequest" (
  "id"               TEXT NOT NULL,
  "origin"           "CommissionAdjustmentOrigin" NOT NULL,
  "disputeId"        TEXT,
  "leadId"           TEXT,
  "paymentId"        TEXT NOT NULL,
  "calcSlotId"       TEXT,
  "refEventType"     TEXT NOT NULL,
  "refEventId"       TEXT NOT NULL,
  "goi"              JSONB NOT NULL,
  "absTotal"         INTEGER NOT NULL,
  "netTotal"         INTEGER NOT NULL,
  "governance"       "CommissionAdjustmentGovernance" NOT NULL,
  "governanceWhy"    JSONB NOT NULL,
  "thresholdSnapshot" INTEGER,
  "boundSnapshot"    INTEGER,
  "canhBao"          JSONB,
  "requestedById"    TEXT NOT NULL,
  "approver1Id"      TEXT,
  "approver1At"      TIMESTAMPTZ(6),
  "approver1Reason"  TEXT,
  "approver2Id"      TEXT,
  "approver2At"      TIMESTAMPTZ(6),
  "approver2Reason"  TEXT,
  "rejectedById"     TEXT,
  "rejectedAt"       TIMESTAMPTZ(6),
  "rejectedReason"   TEXT,
  "closeReason"      TEXT,
  "status"           "CommissionAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
  "postedEntryIds"   JSONB,
  "postingPeriodId"  TEXT,
  "holdId"           TEXT,
  "centerId"         TEXT NOT NULL,
  "orgUnitId"        TEXT NOT NULL,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionAdjustmentRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_status_createdAt_idx" ON "CommissionAdjustmentRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_disputeId_idx" ON "CommissionAdjustmentRequest"("disputeId");
CREATE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_paymentId_idx" ON "CommissionAdjustmentRequest"("paymentId");
CREATE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_calcSlotId_idx" ON "CommissionAdjustmentRequest"("calcSlotId");
CREATE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_requestedById_idx" ON "CommissionAdjustmentRequest"("requestedById");
CREATE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_centerId_status_idx" ON "CommissionAdjustmentRequest"("centerId", "status");
CREATE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_orgUnitId_idx" ON "CommissionAdjustmentRequest"("orgUnitId");

-- Chỉ MỘT yêu cầu ĐANG MỞ cho mỗi khiếu nại / mỗi ô đang có đề xuất đổi nguồn. Chỉ mục TỪNG PHẦN (Prisma không biểu diễn được — GIỮ trong SQL).
-- `calcSlotId` của yêu cầu khiếu nại có thể NULL (khoản chưa có ô) và Postgres coi NULL là khác nhau, nên khoá theo khiếu nại chứ không theo ô.
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_dispute_mo_key"
  ON "CommissionAdjustmentRequest"("disputeId") WHERE "origin" = 'DISPUTE' AND "status" IN ('PENDING', 'APPROVED_L1');
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_o_mo_key"
  ON "CommissionAdjustmentRequest"("calcSlotId") WHERE "origin" = 'SOURCE_CHANGE' AND "status" IN ('PENDING', 'APPROVED_L1');
-- Một SỰ KIỆN đổi nguồn chỉ sinh ĐÚNG MỘT đề xuất cho mỗi ô, KỂ CẢ khi đề xuất ấy đã bị từ chối / lỗi thời: sự kiện được giao lại (retry) không được
-- đẻ lại đề xuất đã bị người duyệt bác. (Không phải chỉ mục "đang mở" — đó là chỉ mục ở trên.)
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionAdjustmentRequest_su_kien_key"
  ON "CommissionAdjustmentRequest"("calcSlotId", "refEventId") WHERE "origin" = 'SOURCE_CHANGE';

-- ─── Khoá ngoại: RESTRICT khắp nơi. `leadId` và `holdId` CỐ Ý không có FK (đọc để hiển thị; hàng chờ đóng/mở lại độc lập). ───
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_disputeId_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_disputeId_fkey"
      FOREIGN KEY ("disputeId") REFERENCES "CommissionDispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_paymentId_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_calcSlotId_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_calcSlotId_fkey"
      FOREIGN KEY ("calcSlotId") REFERENCES "CommissionCalcSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_requestedById_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_requestedById_fkey"
      FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_approver1Id_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_approver1Id_fkey"
      FOREIGN KEY ("approver1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_approver2Id_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_approver2Id_fkey"
      FOREIGN KEY ("approver2Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_rejectedById_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_rejectedById_fkey"
      FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_postingPeriodId_fkey') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_postingPeriodId_fkey"
      FOREIGN KEY ("postingPeriodId") REFERENCES "CommissionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── CHECK. Prisma 5 KHÔNG đọc CHECK ⇒ drift không thấy; lưới duy nhất là ca DB [DXD-*]. ───
DO $$ BEGIN
  -- Khiếu nại tiền ⇔ có `disputeId`; đổi nguồn ⇔ có `leadId` và KHÔNG có `disputeId`.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_nguon_goc_chk') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_nguon_goc_chk" CHECK (
      ("origin" = 'DISPUTE' AND "disputeId" IS NOT NULL) OR ("origin" = 'SOURCE_CHANGE' AND "disputeId" IS NULL AND "leadId" IS NOT NULL AND "calcSlotId" IS NOT NULL)
    );
  END IF;
  -- Gói dòng đóng băng là MẢNG có ≥ 1 mục; số tiền tuyệt đối không âm.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_goi_chk') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_goi_chk"
      CHECK (jsonb_typeof("goi") = 'array' AND jsonb_array_length("goi") >= 1 AND "absTotal" >= 0);
  END IF;
  -- Cột theo trạng thái: mỗi trạng thái đòi đúng những cột nó ngụ ý.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_trang_thai_chk') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_trang_thai_chk" CHECK (
      CASE "status"
        WHEN 'PENDING' THEN "approver1Id" IS NULL AND "approver2Id" IS NULL AND "rejectedById" IS NULL AND "postedEntryIds" IS NULL AND "closeReason" IS NULL
        WHEN 'APPROVED_L1' THEN "governance" = 'SECOND_APPROVAL_REQUIRED'
                         AND "approver1Id" IS NOT NULL AND "approver1At" IS NOT NULL AND "approver1Reason" IS NOT NULL
                         AND "approver2Id" IS NULL AND "rejectedById" IS NULL AND "postedEntryIds" IS NULL AND "closeReason" IS NULL
        WHEN 'POSTED' THEN "approver1Id" IS NOT NULL AND "approver1At" IS NOT NULL AND "approver1Reason" IS NOT NULL
                         AND ("governance" = 'SINGLE_APPROVAL' OR ("approver2Id" IS NOT NULL AND "approver2At" IS NOT NULL AND "approver2Reason" IS NOT NULL))
                         AND "postedEntryIds" IS NOT NULL AND jsonb_typeof("postedEntryIds") = 'array' AND "postingPeriodId" IS NOT NULL
                         AND "rejectedById" IS NULL AND "closeReason" IS NULL
        WHEN 'REJECTED' THEN "rejectedById" IS NOT NULL AND "rejectedAt" IS NOT NULL AND "rejectedReason" IS NOT NULL AND "postedEntryIds" IS NULL AND "closeReason" IS NULL
        WHEN 'STALE' THEN "postedEntryIds" IS NULL AND "rejectedById" IS NULL AND "closeReason" IS NOT NULL AND char_length(btrim("closeReason")) > 0
        ELSE false
      END
    );
  END IF;
  -- Lý do của mỗi lần duyệt / từ chối ≥ 10 ký tự (sau trim) — "bắt buộc" không chỉ ở tầng ghi.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_ly_do_chk') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_ly_do_chk" CHECK (
      ("approver1Reason" IS NULL OR char_length(btrim("approver1Reason")) >= 10)
      AND ("approver2Reason" IS NULL OR char_length(btrim("approver2Reason")) >= 10)
      AND ("rejectedReason" IS NULL OR char_length(btrim("rejectedReason")) >= 10)
    );
  END IF;
  -- TÁCH NHIỆM (khuôn `CommissionDispute_khac_nguoi_chk`): người duyệt cấp 1 ≠ người đề xuất / khiếu nại; người duyệt cấp 2 ≠ cả hai.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionAdjustmentRequest_khac_nguoi_chk') THEN
    ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_khac_nguoi_chk" CHECK (
      ("approver1Id" IS NULL OR "approver1Id" <> "requestedById")
      AND ("approver2Id" IS NULL OR ("approver2Id" <> "requestedById" AND "approver2Id" IS DISTINCT FROM "approver1Id"))
      AND ("rejectedById" IS NULL OR "rejectedById" <> "requestedById")
    );
  END IF;
END $$;

-- ─── TRIGGER CỘT: gói dòng · quản trị · ngưỡng đã chụp BẤT BIẾN; không xoá; trạng thái cuối đóng băng; đồ thị trạng thái ─────────
-- Đồ thị: PENDING → APPROVED_L1 | POSTED | REJECTED | STALE ; APPROVED_L1 → POSTED | REJECTED | STALE ; POSTED / REJECTED / STALE là cuối.
-- Người duyệt đã ghi thì không đổi (cấp 1, cấp 2). `updatedAt` và `holdId` là hai cột duy nhất đổi được khi trạng thái không đổi.
CREATE OR REPLACE FUNCTION commission_adjustment_request_bat_bien() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CommissionAdjustmentRequest không bao giờ bị xoá (id=%)', OLD."id";
  END IF;
  IF NEW."origin" IS DISTINCT FROM OLD."origin"
     OR NEW."disputeId" IS DISTINCT FROM OLD."disputeId"
     OR NEW."leadId" IS DISTINCT FROM OLD."leadId"
     OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
     OR NEW."calcSlotId" IS DISTINCT FROM OLD."calcSlotId"
     OR NEW."refEventType" IS DISTINCT FROM OLD."refEventType"
     OR NEW."refEventId" IS DISTINCT FROM OLD."refEventId"
     OR NEW."goi" IS DISTINCT FROM OLD."goi"
     OR NEW."absTotal" IS DISTINCT FROM OLD."absTotal"
     OR NEW."netTotal" IS DISTINCT FROM OLD."netTotal"
     OR NEW."governance" IS DISTINCT FROM OLD."governance"
     OR NEW."governanceWhy" IS DISTINCT FROM OLD."governanceWhy"
     OR NEW."thresholdSnapshot" IS DISTINCT FROM OLD."thresholdSnapshot"
     OR NEW."boundSnapshot" IS DISTINCT FROM OLD."boundSnapshot"
     OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
     OR NEW."centerId" IS DISTINCT FROM OLD."centerId"
     OR NEW."orgUnitId" IS DISTINCT FROM OLD."orgUnitId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Gói điều chỉnh, quản trị và ngưỡng đã chụp của đề xuất là bất biến (id=%)', OLD."id";
  END IF;
  IF OLD."status" IN ('POSTED', 'REJECTED', 'STALE') THEN
    RAISE EXCEPTION 'Đề xuất đã ở trạng thái cuối % — không sửa (id=%)', OLD."status", OLD."id";
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING' AND NEW."status" IN ('APPROVED_L1', 'POSTED', 'REJECTED', 'STALE'))
    OR (OLD."status" = 'APPROVED_L1' AND NEW."status" IN ('POSTED', 'REJECTED', 'STALE'))
  ) THEN
    RAISE EXCEPTION 'Đề xuất không đi % → % (id=%)', OLD."status", NEW."status", OLD."id";
  END IF;
  IF (OLD."approver1Id" IS NOT NULL AND (NEW."approver1Id" IS DISTINCT FROM OLD."approver1Id" OR NEW."approver1At" IS DISTINCT FROM OLD."approver1At" OR NEW."approver1Reason" IS DISTINCT FROM OLD."approver1Reason"))
     OR (OLD."approver2Id" IS NOT NULL AND (NEW."approver2Id" IS DISTINCT FROM OLD."approver2Id" OR NEW."approver2At" IS DISTINCT FROM OLD."approver2At" OR NEW."approver2Reason" IS DISTINCT FROM OLD."approver2Reason")) THEN
    RAISE EXCEPTION 'Người duyệt đã ghi thì không đổi (id=%)', OLD."id";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "CommissionAdjustmentRequest_bat_bien_bud" ON "CommissionAdjustmentRequest";
CREATE TRIGGER "CommissionAdjustmentRequest_bat_bien_bud" BEFORE UPDATE OR DELETE ON "CommissionAdjustmentRequest"
  FOR EACH ROW EXECUTE FUNCTION commission_adjustment_request_bat_bien();

-- ─── RLS: bảng MỚI ra đời với RLS TẮT (sự cố 09/08). Chỉ ENABLE, không FORCE, không policy. ─────
ALTER TABLE "CommissionAdjustmentRequest" ENABLE ROW LEVEL SECURITY;
