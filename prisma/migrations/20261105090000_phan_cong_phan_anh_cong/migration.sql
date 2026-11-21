-- Phân công gộp GĐ6 (docs/phan-cong-gop/KHAO-SAT.md · CHỐT GĐ0 số 4, 5, 8). CHỈ THÊM — không đụng dòng nào đang có.
--
-- 1. Bảng MỚI "PhanAnhCong": giáo viên Parttime PHẢN ÁNH một ô công (người × ngày × ca) bị "cần xem" (thiếu / trễ lượt quét).
--    Hạn: tới lúc chốt kỳ (`chanSuaKyDaChot`). Chỉ kỳ đi LUẬT MỚI (≥ 2026-11, `luatKy`) — kỳ 10 không có đường phản ánh này.
--    Duyệt ⇒ GHI THÊM lượt quét (`sua-gio-quet.ts`, GHI_THEM) gắn id phản ánh — không sửa thẳng kết quả ô (chốt 5).
-- 2. Cột MỚI "StaffTimeLog"."phanAnhId" (nullable, không backfill): căn cứ của lượt ghi thêm khi duyệt phản ánh — như "adjustRequestId"
--    của đơn chỉnh công. Lượt quét đang có giữ NULL.
--
-- Chỉ mục duy nhất TỪNG PHẦN (mỗi ô tối đa MỘT phản ánh đang chờ) + CHECK chỉ có ở SQL (Prisma 5 không biểu diễn được).
-- ⚠️ IDEMPOTENT (`[MIG-01]`): chạy lại được.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PhanAnhCongStatus') THEN
    CREATE TYPE "PhanAnhCongStatus" AS ENUM ('CHO_DUYET', 'DA_DUYET', 'KHONG_DUYET', 'RUT_LAI');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PhanAnhCong" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "ngay" DATE NOT NULL,
    "ca" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "lyDo" TEXT NOT NULL,
    "moc" JSONB NOT NULL,
    "status" "PhanAnhCongStatus" NOT NULL DEFAULT 'CHO_DUYET',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PhanAnhCong_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PhanAnhCong_centerId_status_idx" ON "PhanAnhCong"("centerId", "status");
CREATE INDEX IF NOT EXISTS "PhanAnhCong_userId_ngay_idx" ON "PhanAnhCong"("userId", "ngay");
CREATE INDEX IF NOT EXISTS "PhanAnhCong_periodKey_idx" ON "PhanAnhCong"("periodKey");
CREATE INDEX IF NOT EXISTS "PhanAnhCong_orgUnitId_idx" ON "PhanAnhCong"("orgUnitId");

-- Mỗi ô (người × ngày × ca) tối đa MỘT phản ánh đang chờ: bấm hai lần không đẻ hai phản ánh.
CREATE UNIQUE INDEX IF NOT EXISTS "PhanAnhCong_o_cho_duyet_key"
  ON "PhanAnhCong"("userId", "ngay", "ca") WHERE "status" = 'CHO_DUYET';

DO $$
BEGIN
  -- Đang chờ / rút lại ⇔ chưa có người quyết; đã quyết ⇒ biết ai và lúc nào.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhanAnhCong_decision_chk') THEN
    ALTER TABLE "PhanAnhCong" ADD CONSTRAINT "PhanAnhCong_decision_chk"
      CHECK (
        ("status" IN ('CHO_DUYET', 'RUT_LAI') AND "decidedById" IS NULL AND "decidedAt" IS NULL)
        OR ("status" IN ('DA_DUYET', 'KHONG_DUYET') AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
      );
  END IF;
  -- Không duyệt bắt buộc có lý do (≥ 10 ký tự) — giáo viên phải biết vì sao.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhanAnhCong_khong_duyet_ly_do_chk') THEN
    ALTER TABLE "PhanAnhCong" ADD CONSTRAINT "PhanAnhCong_khong_duyet_ly_do_chk"
      CHECK ("status" <> 'KHONG_DUYET' OR char_length(btrim(COALESCE("decisionNote", ''))) >= 10);
  END IF;
END
$$;

ALTER TABLE "StaffTimeLog" ADD COLUMN IF NOT EXISTS "phanAnhId" TEXT;
CREATE INDEX IF NOT EXISTS "StaffTimeLog_phanAnhId_idx" ON "StaffTimeLog"("phanAnhId");

-- RLS: bảng mới phải tự bật (chỉ ENABLE, không FORCE, không policy).
ALTER TABLE "PhanAnhCong" ENABLE ROW LEVEL SECURITY;
