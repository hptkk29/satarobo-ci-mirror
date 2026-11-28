-- WP8 / HS2-D4 (19/11/2026) — hạn mức SataCoin theo giáo viên (Admin đặt). CỘNG THÊM: 1 bảng mới, không backfill.
-- Không có dòng ⇒ giáo viên KHÔNG được cộng/trừ (fail-closed). Bảng mới ⇒ bật RLS (chỉ ENABLE).
CREATE TABLE IF NOT EXISTS "TeacherCoinQuota" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capPerMonth" INTEGER NOT NULL,
    "setById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "TeacherCoinQuota_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherCoinQuota_capPerMonth_nonneg_chk" CHECK ("capPerMonth" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeacherCoinQuota_userId_key" ON "TeacherCoinQuota"("userId");

ALTER TABLE "TeacherCoinQuota" ENABLE ROW LEVEL SECURITY;
