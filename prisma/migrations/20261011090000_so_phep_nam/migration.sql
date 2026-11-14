-- P2.1A — SỔ PHÉP NĂM (LeaveLedger) · 11/10/2026 · roadmap chấm công Phase 2.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): một bảng MỚI, không đụng bảng có dữ liệu. Chưa ghi gì cho tới khi
-- người vận hành bật `phep.batSoPhep` (mặc định TẮT) — chính sách quỹ phép (Q-6/Q-7) CHƯA chốt.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được.
--
-- Khuôn của `CompTimeLedger` (quỹ nghỉ bù): LEDGER theo PHÚT, mỗi dòng một biến động có dấu, số dư = Σ
-- minutes trong (người × loại nghỉ × năm phép). `khoa` UNIQUE chống ghi trùng khi thử lại (duyệt hai lần,
-- huỷ hai lần). `balanceBefore`/`balanceAfter` chụp DƯỚI khoá theo người để đối soát chuỗi về sau.
-- Giữ CẢ centerId (cơ chế cách ly đang đọc) và orgUnitId (hướng đích) — luật Nền Hệ thống #3.
CREATE TABLE IF NOT EXISTS "LeaveLedger" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "centerId"        TEXT NOT NULL,
  "orgUnitId"       TEXT,
  "leaveTypeId"     TEXT NOT NULL,
  "year"            INTEGER NOT NULL,
  "minutes"         INTEGER NOT NULL,
  "transactionType" TEXT NOT NULL,
  "sourceType"      TEXT,
  "sourceId"        TEXT,
  "khoa"            TEXT,
  "effectiveDate"   DATE NOT NULL,
  "balanceBefore"   INTEGER NOT NULL,
  "balanceAfter"    INTEGER NOT NULL,
  "note"            TEXT,
  "createdById"     TEXT,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeaveLedger_khoa_key" ON "LeaveLedger"("khoa");
CREATE INDEX IF NOT EXISTS "LeaveLedger_userId_leaveTypeId_year_idx" ON "LeaveLedger"("userId", "leaveTypeId", "year");
CREATE INDEX IF NOT EXISTS "LeaveLedger_centerId_createdAt_idx" ON "LeaveLedger"("centerId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeaveLedger_orgUnitId_idx" ON "LeaveLedger"("orgUnitId");
CREATE INDEX IF NOT EXISTS "LeaveLedger_sourceType_sourceId_idx" ON "LeaveLedger"("sourceType", "sourceId");
ALTER TABLE "LeaveLedger" ENABLE ROW LEVEL SECURITY;
