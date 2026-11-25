-- Học bù đời mới — Phiên A (docs/hoc-bu/DAC-TA.md). Chỉ THÊM, không đổi/bỏ cột nào.
-- Chạy lại được ([MIG-01]): mọi lệnh tạo đều có IF NOT EXISTS / kiểm pg_constraint.

-- Khoá có cho học bù không (Sata 8 học đủ ⇒ tắt).
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "choPhepHocBu" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Course" SET "choPhepHocBu" = false WHERE "slug" = 'sata8';

-- Lượt bù theo học phần.
CREATE TABLE IF NOT EXISTS "CourseModuleMakeupQuota" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "luotBu" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CourseModuleMakeupQuota_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CourseModuleMakeupQuota_courseId_moduleCode_key" ON "CourseModuleMakeupQuota"("courseId", "moduleCode");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CourseModuleMakeupQuota_courseId_fkey') THEN
    ALTER TABLE "CourseModuleMakeupQuota" ADD CONSTRAINT "CourseModuleMakeupQuota_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Huỷ không bù + lượt đã tiêu.
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "waivedAt" TIMESTAMPTZ(6);
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "waivedById" TEXT;
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "waivedReason" TEXT;
ALTER TABLE "MakeupNeed" ADD COLUMN IF NOT EXISTS "usedQuota" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CourseModuleMakeupQuota" ENABLE ROW LEVEL SECURITY;
