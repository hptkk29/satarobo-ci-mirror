-- 13/10/2026 — HOA HỒNG THEO NGUỒN · KHIẾU NẠI (PR11, phần khiếu nại): bảng `CommissionDispute` + 2 enum.
-- Đặc tả: docs/source-commission/02 §5, §9.5, §10.2 · 04 §15 · 05 AC-DSP.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 2 enum + 1 bảng MỚI. KHÔNG cột nào trên bảng có sẵn, KHÔNG backfill. Bảng sinh ra rỗng.
-- Rollback = ngừng gọi service khiếu nại (cờ `hoaHong.engineBat` tắt thì tab 404); bảng nằm im.
--
-- Khác 02 §9.5 ở HAI điểm, cả hai là THÊM (không bỏ gì của đặc tả):
--   (1) cột `assignedAt` (khi nào HR nhận) — để màn hiện "đang xem xét N ngày" mà không phải suy từ AuditLog;
--   (2) TRIGGER CỘT `commission_dispute_bat_bien` — 02 §9.5 ghi "không dùng trigger vì trạng thái và người duyệt vẫn phải đổi được".
--       Trigger này KHÔNG cấm đổi trạng thái: nó chỉ cấm (a) DELETE, (b) sửa `reason`/`evidence`/`raisedByUserId`/đích/`createdAt`,
--       (c) đi sai đồ thị trạng thái (nhảy cóc, lùi), (d) sửa lại các cột quyết định sau khi đã có `decidedAt`. Lý do thêm: AC DSP-04
--       đòi "nội dung đã gửi bất biến, không xoá" mà lưới ghim mã nguồn chỉ canh được MÃ CỦA REPO NÀY, không canh được SQL tay.
--
-- Chạy lại được ([MIG-01]): enum kiểm pg_type, bảng/chỉ mục IF NOT EXISTS, FK/CHECK kiểm pg_constraint, hàm CREATE OR REPLACE,
-- trigger DROP IF EXISTS rồi CREATE.

-- ─── Enum ───────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionDisputeStatus') THEN
    CREATE TYPE "CommissionDisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionDisputeResolution') THEN
    CREATE TYPE "CommissionDisputeResolution" AS ENUM ('SOURCE_CORRECTION', 'MONEY_ADJUSTMENT');
  END IF;
END $$;

-- ─── CommissionDispute (02 §9.5) ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionDispute" (
  "id"                TEXT NOT NULL,
  "transactionId"     TEXT,
  "paymentId"         TEXT,
  "raisedByUserId"    TEXT NOT NULL,
  "reason"            TEXT NOT NULL,
  "evidence"          JSONB NOT NULL,
  "status"            "CommissionDisputeStatus" NOT NULL DEFAULT 'OPEN',
  "assignedToUserId"  TEXT,
  "assignedAt"        TIMESTAMPTZ(6),
  "resolution"        "CommissionDisputeResolution",
  "decisionReason"    TEXT,
  "decidedById"       TEXT,
  "decidedAt"         TIMESTAMPTZ(6),
  "closedAt"          TIMESTAMPTZ(6),
  "resolutionEntryId" TEXT,
  "centerId"          TEXT NOT NULL,
  "orgUnitId"         TEXT NOT NULL,
  "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommissionDispute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionDispute_resolutionEntryId_key" ON "CommissionDispute"("resolutionEntryId");
CREATE INDEX IF NOT EXISTS "CommissionDispute_status_createdAt_idx" ON "CommissionDispute"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "CommissionDispute_transactionId_idx" ON "CommissionDispute"("transactionId");
CREATE INDEX IF NOT EXISTS "CommissionDispute_paymentId_idx" ON "CommissionDispute"("paymentId");
CREATE INDEX IF NOT EXISTS "CommissionDispute_raisedByUserId_idx" ON "CommissionDispute"("raisedByUserId");
CREATE INDEX IF NOT EXISTS "CommissionDispute_assignedToUserId_idx" ON "CommissionDispute"("assignedToUserId");
CREATE INDEX IF NOT EXISTS "CommissionDispute_centerId_status_idx" ON "CommissionDispute"("centerId", "status");
CREATE INDEX IF NOT EXISTS "CommissionDispute_orgUnitId_idx" ON "CommissionDispute"("orgUnitId");

-- ─── Khoá ngoại: RESTRICT khắp nơi (dòng sổ / khoản thu / người đã được khiếu nại tham chiếu không xoá cứng được) ───
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_transactionId_fkey') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_transactionId_fkey"
      FOREIGN KEY ("transactionId") REFERENCES "CommissionTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_paymentId_fkey') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_raisedByUserId_fkey') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_raisedByUserId_fkey"
      FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_assignedToUserId_fkey') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_assignedToUserId_fkey"
      FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_resolutionEntryId_fkey') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_resolutionEntryId_fkey"
      FOREIGN KEY ("resolutionEntryId") REFERENCES "CommissionTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── CHECK (02 §10.2 + bổ sung). Prisma 5 KHÔNG đọc CHECK ⇒ drift không thấy; lưới duy nhất là ca DB [NHH-DSP-SC-*]. ───
DO $$ BEGIN
  -- Đích: đúng MỘT trong hai (dòng sổ XOR khoản thu).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_dich_chk') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_dich_chk"
      CHECK (("transactionId" IS NULL) <> ("paymentId" IS NULL));
  END IF;
  -- Lý do ≥ 10 ký tự (sau trim) và bằng chứng là MẢNG có ≥ 1 mục — "bắt buộc" của 04 §15 không chỉ là tầng ghi.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_ly_do_chk') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_ly_do_chk"
      CHECK (char_length(btrim("reason")) >= 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_bang_chung_chk') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_bang_chung_chk"
      CHECK (jsonb_typeof("evidence") = 'array' AND jsonb_array_length("evidence") >= 1);
  END IF;
  -- Cột theo trạng thái: mỗi trạng thái đòi đúng những cột nó ngụ ý (không có APPROVED mà thiếu người quyết, không có OPEN mà đã có người nhận).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_trang_thai_chk') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_trang_thai_chk" CHECK (
      CASE "status"
        WHEN 'OPEN' THEN "assignedToUserId" IS NULL AND "assignedAt" IS NULL AND "resolution" IS NULL
                         AND "decidedAt" IS NULL AND "decidedById" IS NULL AND "decisionReason" IS NULL AND "closedAt" IS NULL
        WHEN 'UNDER_REVIEW' THEN "assignedToUserId" IS NOT NULL AND "resolution" IS NULL
                         AND "decidedAt" IS NULL AND "decidedById" IS NULL AND "decisionReason" IS NULL AND "closedAt" IS NULL
        WHEN 'APPROVED' THEN "resolution" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL
                         AND "decisionReason" IS NOT NULL AND char_length(btrim("decisionReason")) >= 10 AND "closedAt" IS NULL
        WHEN 'REJECTED' THEN "resolution" IS NULL AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL
                         AND "decisionReason" IS NOT NULL AND char_length(btrim("decisionReason")) >= 10 AND "closedAt" IS NULL
        WHEN 'CLOSED' THEN "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL AND "closedAt" IS NOT NULL
        ELSE false
      END
    );
  END IF;
  -- Dòng điều chỉnh chỉ có khi cách giải là điều chỉnh tiền.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_dong_dieu_chinh_chk') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_dong_dieu_chinh_chk"
      CHECK ("resolutionEntryId" IS NULL OR "resolution" = 'MONEY_ADJUSTMENT');
  END IF;
  -- Người nhận / người quyết KHÁC người khiếu nại (04 §15). Tầng ghi chặn trước bằng câu lỗi riêng; đây là lớp dưới.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionDispute_khac_nguoi_chk') THEN
    ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_khac_nguoi_chk" CHECK (
      ("assignedToUserId" IS NULL OR "assignedToUserId" <> "raisedByUserId")
      AND ("decidedById" IS NULL OR "decidedById" <> "raisedByUserId")
    );
  END IF;
END $$;

-- ─── TRIGGER CỘT: nội dung đã gửi BẤT BIẾN, không xoá, trạng thái đi đúng đồ thị ────────────────────────────
-- Đồ thị (04 §15): OPEN → UNDER_REVIEW → APPROVED | REJECTED → CLOSED. Cùng trạng thái → cùng trạng thái được (giao lại HR, đổi cột
-- không thuộc nhóm bất biến). Ngoài các cặp đó ⇒ ném.
CREATE OR REPLACE FUNCTION commission_dispute_bat_bien() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CommissionDispute không bao giờ bị xoá (id=%)', OLD."id";
  END IF;
  IF NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."evidence" IS DISTINCT FROM OLD."evidence"
     OR NEW."raisedByUserId" IS DISTINCT FROM OLD."raisedByUserId"
     OR NEW."transactionId" IS DISTINCT FROM OLD."transactionId"
     OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Nội dung khiếu nại đã gửi (lý do, bằng chứng, người khiếu nại, đích) là bất biến (id=%)', OLD."id";
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'OPEN' AND NEW."status" = 'UNDER_REVIEW')
    OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('APPROVED', 'REJECTED'))
    OR (OLD."status" IN ('APPROVED', 'REJECTED') AND NEW."status" = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'Khiếu nại không đi % → % (id=%)', OLD."status", NEW."status", OLD."id";
  END IF;
  -- Đã có quyết định thì không sửa lại quyết định.
  IF OLD."decidedAt" IS NOT NULL AND (
       NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
    OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById"
    OR NEW."resolution" IS DISTINCT FROM OLD."resolution"
    OR NEW."decisionReason" IS DISTINCT FROM OLD."decisionReason"
    OR NEW."resolutionEntryId" IS DISTINCT FROM OLD."resolutionEntryId"
  ) THEN
    RAISE EXCEPTION 'Quyết định khiếu nại đã chốt, không sửa lại (id=%)', OLD."id";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "CommissionDispute_bat_bien_bud" ON "CommissionDispute";
CREATE TRIGGER "CommissionDispute_bat_bien_bud" BEFORE UPDATE OR DELETE ON "CommissionDispute"
  FOR EACH ROW EXECUTE FUNCTION commission_dispute_bat_bien();

-- ─── RLS: bảng MỚI ra đời với RLS TẮT (sự cố 09/08). Chỉ ENABLE, không FORCE, không policy. ─────
ALTER TABLE "CommissionDispute" ENABLE ROW LEVEL SECURITY;
