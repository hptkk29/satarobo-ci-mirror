-- V8.4 (20/11/2026) — NGƯỜI ĐƯỢC PHÉP ĐÓN CON do phụ huynh khai trên app. CỘNG THÊM (1 bảng mới), idempotent, không đụng dữ liệu hiện có.
-- Gỡ = thu hồi (trangThai REVOKED), không xoá dòng. Giới hạn 5 người sống/bé + không trùng SĐT sống do ỨNG DỤNG giữ bằng khoá advisory (không có chỉ mục từng phần).

CREATE TABLE IF NOT EXISTS "StudentPickupContact" (
  "id"              TEXT NOT NULL,
  "studentId"       TEXT NOT NULL,
  "hoTen"           TEXT NOT NULL,
  "quanHe"          TEXT NOT NULL,
  "soDienThoai"     TEXT NOT NULL,
  "ghiChu"          TEXT,
  "trangThai"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "taoBoiUserId"    TEXT NOT NULL,
  "thuHoiLuc"       TIMESTAMPTZ(6),
  "thuHoiBoiUserId" TEXT,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "StudentPickupContact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StudentPickupContact_studentId_trangThai_idx" ON "StudentPickupContact"("studentId", "trangThai");
DO $$ BEGIN
  ALTER TABLE "StudentPickupContact" ADD CONSTRAINT "StudentPickupContact_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "StudentPickupContact" ENABLE ROW LEVEL SECURITY;
