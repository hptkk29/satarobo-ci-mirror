-- Free Mode (Owner F1, 25/11/2026) — TIẾN ĐỘ HỌC THỬ lưu trên server theo học viên × khoá × bài, KHÔNG dùng quyền học giả.
-- Vì sao bảng riêng: `OnlLessonProgress` gắn `entitlementId` (bắt buộc, cascade) nên không lưu được cho người chưa có quyền học; Owner cấm tạo entitlement giả để lưu tiến độ.
-- Cộng thêm: một bảng MỚI (không đụng bảng đang có dữ liệu). `transferredEntitlementId/At` đánh dấu đã chuyển sang quyền học thật khi nâng cấp (F4) ⇒ không ghi trùng, giữ lịch sử.
CREATE TABLE IF NOT EXISTS "OnlFreeLessonProgress" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonStableId" TEXT NOT NULL,
    "status" "OnlLessonProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "percent" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMPTZ(6),
    "firstAccessAt" TIMESTAMPTZ(6) NOT NULL,
    "transferredEntitlementId" TEXT,
    "transferredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OnlFreeLessonProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnlFreeLessonProgress_studentId_courseId_lessonStableId_key" ON "OnlFreeLessonProgress"("studentId", "courseId", "lessonStableId");
CREATE INDEX IF NOT EXISTS "OnlFreeLessonProgress_studentId_courseId_idx" ON "OnlFreeLessonProgress"("studentId", "courseId");

DO $$ BEGIN
  ALTER TABLE "OnlFreeLessonProgress" ADD CONSTRAINT "OnlFreeLessonProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OnlFreeLessonProgress" ADD CONSTRAINT "OnlFreeLessonProgress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OnlFreeLessonProgress" ADD CONSTRAINT "OnlFreeLessonProgress_percent_check" CHECK ("percent" BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bảng MỚI phải tự bật RLS (CLAUDE.md prisma-db.md): chỉ ENABLE, không FORCE, không policy.
ALTER TABLE "OnlFreeLessonProgress" ENABLE ROW LEVEL SECURITY;
