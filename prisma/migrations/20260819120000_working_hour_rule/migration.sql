-- Giờ làm việc khai trên web (Q-C, 19/08/2026).
--
-- CHỈ THÊM BẢNG MỚI. Không đụng cột nào của bảng đang có dữ liệu PROD (luật cứng #4).
-- Sentinel "*" thay cho NULL ở orgUnitId/roleCode: Postgres coi mọi NULL là khác nhau trong
-- UNIQUE, nên để NULL thì luật mặc định toàn hệ thống có thể bị tạo trùng mà DB không chặn.

CREATE TABLE IF NOT EXISTS "WorkingHourRule" (
  "id"            TEXT NOT NULL,
  "orgUnitId"     TEXT NOT NULL DEFAULT '*',
  "roleCode"      TEXT NOT NULL DEFAULT '*',
  "weekday"       INTEGER NOT NULL,
  "openTime"      TEXT,
  "closeTime"     TEXT,
  "isClosed"      BOOLEAN NOT NULL DEFAULT false,
  "note"          TEXT,
  "updatedById"   TEXT,
  "updatedByName" TEXT,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkingHourRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkingHourRule_orgUnitId_roleCode_weekday_key"
  ON "WorkingHourRule"("orgUnitId", "roleCode", "weekday");
CREATE INDEX IF NOT EXISTS "WorkingHourRule_orgUnitId_idx"
  ON "WorkingHourRule"("orgUnitId");

-- RLS: bảng mới ra đời phải TỰ BẬT (migration 20260617 chỉ chạy một lần).
ALTER TABLE "WorkingHourRule" ENABLE ROW LEVEL SECURITY;
