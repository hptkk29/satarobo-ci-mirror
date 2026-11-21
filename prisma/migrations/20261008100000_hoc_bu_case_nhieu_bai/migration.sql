-- T07 (08/10/2026) — CASE DẠY BÙ NHIỀU BÀI + ĐIỂM DANH HAI TẦNG.
--
-- Mô hình mới:  MakeupCase ─< MakeupCaseLesson (1..3 bài)
--                         ─< MakeupCaseParticipant (mỗi bé 1 dòng — điểm danh TẦNG 1: có mặt / vắng buổi bù)
--                              ─< MakeupCaseStudent (= "mục" — mỗi mục một buổi vắng cần bù — kết quả TẦNG 2: đã bù / chưa bù)
--
-- ADDITIVE hoàn toàn, không xoá / đổi kiểu cột nào đang có dữ liệu (luật cứng #4):
--   · `MakeupCase.lessonId` GIỮ NGUYÊN (= bài đầu tiên của case, để mọi chỗ đọc cũ còn chạy).
--   · `MakeupCaseStudent.status` GIỮ NGUYÊN làm bản gương của `result` (PLANNED→PLACED, COMPLETED→PRESENT, NOT_COMPLETED→ABSENT,
--     RELEASED→RELEASED/ABSENT); checker T01, sổ lượt T06 và lõi trùng lịch T09 vẫn đọc nó.
--   · Dữ liệu cũ KHÔNG được suy đoán ở đây: chỉ `result` được đặt tất định từ `status`. Participant / Lesson của case cũ do
--     `scripts/hoc-bu-case-v2-backfill.ts` (dry-run mặc định) hoặc phép nâng cấp tại chỗ của service tạo ra.

-- ── Enum ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MakeupParticipantAttendance') THEN
    CREATE TYPE "MakeupParticipantAttendance" AS ENUM ('PENDING', 'PRESENT', 'ABSENT', 'REMOVED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MakeupItemResult') THEN
    CREATE TYPE "MakeupItemResult" AS ENUM ('PLANNED', 'COMPLETED', 'NOT_COMPLETED', 'RELEASED');
  END IF;
END $$;

-- Giá trị enum mới KHÔNG dùng được trong cùng giao dịch tạo ra nó ⇒ migration này không ghi giá trị nào trong số này.
ALTER TYPE "MakeupCaseStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';
ALTER TYPE "MakeupCaseStudentStatus" ADD VALUE IF NOT EXISTS 'RELEASED';

-- ── MakeupCase: phiên bản (khoá lạc quan khi sửa case) ───────────────────────────────────────────────────────────────
ALTER TABLE "MakeupCase" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- ── Bài của case ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MakeupCaseLesson" (
  "id"        TEXT NOT NULL,
  "caseId"    TEXT NOT NULL,
  "lessonId"  TEXT NOT NULL,
  "order"     INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MakeupCaseLesson_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MakeupCaseLesson_order_check" CHECK ("order" BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCaseLesson_caseId_lessonId_key" ON "MakeupCaseLesson"("caseId", "lessonId");
CREATE INDEX IF NOT EXISTS "MakeupCaseLesson_lessonId_idx" ON "MakeupCaseLesson"("lessonId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseLesson_caseId_fkey') THEN
    ALTER TABLE "MakeupCaseLesson" ADD CONSTRAINT "MakeupCaseLesson_caseId_fkey"
      FOREIGN KEY ("caseId") REFERENCES "MakeupCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseLesson_lessonId_fkey') THEN
    ALTER TABLE "MakeupCaseLesson" ADD CONSTRAINT "MakeupCaseLesson_lessonId_fkey"
      FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "MakeupCaseLesson" ENABLE ROW LEVEL SECURITY;

-- ── Học viên tham gia case (điểm danh tầng 1) ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MakeupCaseParticipant" (
  "id"               TEXT NOT NULL,
  "caseId"           TEXT NOT NULL,
  "studentId"        TEXT NOT NULL,
  "centerId"         TEXT NOT NULL,
  "orgUnitId"        TEXT,
  "attendanceStatus" "MakeupParticipantAttendance" NOT NULL DEFAULT 'PENDING',
  "generalComment"   TEXT,
  "attendedAt"       TIMESTAMPTZ(6),
  "processedById"    TEXT,
  "version"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MakeupCaseParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCaseParticipant_caseId_studentId_key" ON "MakeupCaseParticipant"("caseId", "studentId");
CREATE INDEX IF NOT EXISTS "MakeupCaseParticipant_studentId_idx" ON "MakeupCaseParticipant"("studentId");
CREATE INDEX IF NOT EXISTS "MakeupCaseParticipant_centerId_idx" ON "MakeupCaseParticipant"("centerId");
CREATE INDEX IF NOT EXISTS "MakeupCaseParticipant_orgUnitId_idx" ON "MakeupCaseParticipant"("orgUnitId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseParticipant_caseId_fkey') THEN
    ALTER TABLE "MakeupCaseParticipant" ADD CONSTRAINT "MakeupCaseParticipant_caseId_fkey"
      FOREIGN KEY ("caseId") REFERENCES "MakeupCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseParticipant_studentId_fkey') THEN
    ALTER TABLE "MakeupCaseParticipant" ADD CONSTRAINT "MakeupCaseParticipant_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "MakeupCaseParticipant" ENABLE ROW LEVEL SECURITY;

-- ── Mục (MakeupCaseStudent) = một buổi vắng cần bù trong case (kết quả tầng 2) ───────────────────────────────────────
ALTER TABLE "MakeupCaseStudent"
  ADD COLUMN IF NOT EXISTS "participantId"        TEXT,
  ADD COLUMN IF NOT EXISTS "lessonId"             TEXT,
  ADD COLUMN IF NOT EXISTS "originalSessionId"    TEXT,
  ADD COLUMN IF NOT EXISTS "originalAttendanceId" TEXT,
  ADD COLUMN IF NOT EXISTS "result"               "MakeupItemResult" NOT NULL DEFAULT 'PLANNED',
  ADD COLUMN IF NOT EXISTS "completedAt"          TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "teacherEvaluation"    TEXT,
  ADD COLUMN IF NOT EXISTS "evaluatedById"        TEXT,
  ADD COLUMN IF NOT EXISTS "evaluatedAt"          TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "releasedAt"           TIMESTAMPTZ(6);

-- `result` của dòng cũ: tất định từ `status` (chỉ đúng một cách đọc). Dòng ABSENT cũ = bé vắng buổi bù ⇒ mục đã được nhả.
UPDATE "MakeupCaseStudent"
   SET "result" = CASE "status"::text
                    WHEN 'PRESENT' THEN 'COMPLETED'
                    WHEN 'ABSENT'  THEN 'RELEASED'
                    ELSE 'PLANNED'
                  END::"MakeupItemResult"
 WHERE "result" = 'PLANNED' AND "status"::text <> 'PLACED';

CREATE INDEX IF NOT EXISTS "MakeupCaseStudent_participantId_idx" ON "MakeupCaseStudent"("participantId");
CREATE INDEX IF NOT EXISTS "MakeupCaseStudent_lessonId_idx" ON "MakeupCaseStudent"("lessonId");
CREATE INDEX IF NOT EXISTS "MakeupCaseStudent_originalSessionId_idx" ON "MakeupCaseStudent"("originalSessionId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseStudent_participantId_fkey') THEN
    ALTER TABLE "MakeupCaseStudent" ADD CONSTRAINT "MakeupCaseStudent_participantId_fkey"
      FOREIGN KEY ("participantId") REFERENCES "MakeupCaseParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Nhả mục KHÔNG xoá nó (lịch sử) ⇒ bé có thể được xếp lại vào CHÍNH case đó sau khi đã bị gỡ: unique chỉ áp cho mục CÒN SỐNG.
-- (Điều kiện theo `result`, không theo `status`: ép enum → text trong điều kiện chỉ mục không phải IMMUTABLE, và giá trị enum
-- `RELEASED` của `status` vừa thêm ở trên chưa dùng được trong cùng giao dịch.)
-- Chỉ mục này nằm ngoài schema.prisma (Prisma không biểu diễn được `WHERE`), cùng họ với `MakeupCaseStudent_need_placed_key`.
DROP INDEX IF EXISTS "MakeupCaseStudent_caseId_makeupNeedId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCaseStudent_case_need_song_key"
  ON "MakeupCaseStudent"("caseId", "makeupNeedId") WHERE "result" <> 'RELEASED';
CREATE INDEX IF NOT EXISTS "MakeupCaseStudent_caseId_makeupNeedId_idx" ON "MakeupCaseStudent"("caseId", "makeupNeedId");

-- ── Sổ lượt: cho phép ĐẢO một lần tiêu (sửa điểm danh) mà không xoá bút toán ───────────────────────────────────────
-- Bản cũ: ADJUSTMENT chỉ đổi `granted`. Nay thêm dạng thứ hai: trả lại ĐÚNG MỘT lượt đã tiêu (consumed −1) kèm lý do.
-- Nới ràng buộc chứ không đổi dữ liệu nào: mọi bút toán đang có vẫn thoả bản mới.
ALTER TABLE "MakeupCreditEntry" DROP CONSTRAINT IF EXISTS "MakeupCreditEntry_dang_check";
ALTER TABLE "MakeupCreditEntry" ADD CONSTRAINT "MakeupCreditEntry_dang_check" CHECK (
  ("type" = 'GRANT'      AND "grantedDelta" > 0 AND "heldDelta" = 0 AND "consumedDelta" = 0) OR
  ("type" = 'HOLD'       AND "grantedDelta" = 0 AND "heldDelta" = 1 AND "consumedDelta" = 0) OR
  ("type" = 'RELEASE'    AND "grantedDelta" = 0 AND "heldDelta" = -1 AND "consumedDelta" = 0) OR
  ("type" = 'CONSUME'    AND "grantedDelta" = 0 AND "heldDelta" IN (0, -1) AND "consumedDelta" = 1) OR
  ("type" = 'ADJUSTMENT' AND "grantedDelta" <> 0 AND "heldDelta" = 0 AND "consumedDelta" = 0 AND "reason" IS NOT NULL) OR
  ("type" = 'ADJUSTMENT' AND "grantedDelta" = 0 AND "heldDelta" = 0 AND "consumedDelta" = -1 AND "reason" IS NOT NULL)
);
