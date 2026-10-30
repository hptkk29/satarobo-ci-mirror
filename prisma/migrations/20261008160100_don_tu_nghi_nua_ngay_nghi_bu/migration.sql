-- ĐƠN TỪ · ĐỢT 7–8 — NGHỈ NỬA NGÀY / THEO GIỜ + QUỸ NGHỈ BÙ (08/10/2026,
-- docs/cham-cong/KE-HOACH-DON-TU-THEO-BA.md).
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): một enum MỚI, một cột NULLABLE, một bảng MỚI, hai dòng danh mục
-- loại nghỉ (ON CONFLICT DO NOTHING — không đè dòng người vận hành đã sửa). Rollback = ngừng ghi.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).

-- ── Thời lượng nghỉ ─────────────────────────────────────────────────────────────────────────
-- NULL = đơn cũ = cả ngày (hành vi P/X như trước).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeaveDurationType') THEN
    CREATE TYPE "LeaveDurationType" AS ENUM ('FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM', 'HOURLY');
  END IF;
END $$;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "leaveDurationType" "LeaveDurationType";

-- ── Sổ quỹ nghỉ bù — LEDGER, không phải một con số số dư ──────────────────────────────────
-- Mỗi dòng một biến động có dấu (+ cộng quỹ, − dùng quỹ). Số dư = Σ minutes. `khoa` UNIQUE chống
-- ghi trùng cho bút toán gắn với một đơn (dùng nghỉ bù / hoàn khi huỷ); NULL cho các dòng chênh lệch
-- do tính lại công sinh ra (Postgres coi NULL khác nhau nên không đụng UNIQUE).
-- Giữ CẢ centerId (cơ chế cách ly đang đọc) và orgUnitId (hướng đích) — luật Nền Hệ thống #3.
CREATE TABLE IF NOT EXISTS "CompTimeLedger" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "centerId"    TEXT NOT NULL,
  "orgUnitId"   TEXT,
  "minutes"     INTEGER NOT NULL,
  "sourceType"  TEXT NOT NULL,
  "sourceId"    TEXT,
  "workDate"    DATE,
  "khoa"        TEXT,
  "note"        TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompTimeLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CompTimeLedger_khoa_key" ON "CompTimeLedger"("khoa");
CREATE INDEX IF NOT EXISTS "CompTimeLedger_userId_idx" ON "CompTimeLedger"("userId");
CREATE INDEX IF NOT EXISTS "CompTimeLedger_centerId_createdAt_idx" ON "CompTimeLedger"("centerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CompTimeLedger_orgUnitId_idx" ON "CompTimeLedger"("orgUnitId");
CREATE INDEX IF NOT EXISTS "CompTimeLedger_sourceType_sourceId_idx" ON "CompTimeLedger"("sourceType", "sourceId");
ALTER TABLE "CompTimeLedger" ENABLE ROW LEVEL SECURITY;

-- ── Loại nghỉ còn thiếu so với BA 4.10 (ốm con, khác) ─────────────────────────────────────────
-- Ánh xạ BA → danh mục: ANNUAL=NGHI_PHEP · UNPAID=KHONG_LUONG · SICK=BHXH · MARRIAGE=KET_HON ·
-- FUNERAL=MA_CHAY · MATERNITY=THAI_SAN · CHILD_SICK=CON_OM (mới) · OTHER=KHAC (mới).
-- Không lương mặc định (paidRatio 0) — người vận hành sửa ở màn Loại nghỉ nếu công ty trả lương.
INSERT INTO "LeaveType" ("id", "code", "name", "paidRatio", "maxDaysPerYear", "noticeDays", "countsAsWorked", "isActive", "displayOrder", "createdAt", "updatedAt")
VALUES
  ('leavetype_con_om', 'CON_OM', 'Nghỉ con ốm', 0, NULL, NULL, false, true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('leavetype_khac', 'KHAC', 'Nghỉ lý do khác', 0, NULL, 1, false, true, 99, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
