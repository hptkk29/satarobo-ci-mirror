-- V8.39 — SỨC KHOẺ: LƯU CÓ CHỦ ĐÍCH LÊN MÁY CHỦ (HL-01). CHỈ THÊM: 1 bảng mới. Không đổi/xoá cột nào, không backfill.
-- CHẠY LẠI ĐƯỢC (luật [MIG-01]): IF NOT EXISTS / khối DO bắt duplicate_object. Không phụ thuộc migration V8.29 (20261211).
-- Dữ liệu NHẠY CẢM của trẻ em: payload mã hoá ở tầng ứng dụng (AES-256-GCM); bảng bật RLS; xoá theo tài khoản (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS "ParentHealthRecord" (
    "id"             TEXT NOT NULL,
    "parentUserId"   TEXT NOT NULL,
    "payloadMaHoa"   TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentAt"      TIMESTAMPTZ(6) NOT NULL,
    "expiresAt"      TIMESTAMPTZ(6) NOT NULL,
    "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ParentHealthRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ParentHealthRecord_parentUserId_key" ON "ParentHealthRecord"("parentUserId");
CREATE INDEX IF NOT EXISTS "ParentHealthRecord_expiresAt_idx" ON "ParentHealthRecord"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "ParentHealthRecord" ADD CONSTRAINT "ParentHealthRecord_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ParentHealthRecord" ENABLE ROW LEVEL SECURITY;
