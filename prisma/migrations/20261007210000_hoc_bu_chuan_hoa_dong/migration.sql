-- T05 (Học bù · chuẩn hoá MakeupLine) — CHỈ THÊM, không đổi/xoá cột hay hàng nào đang có. CHẠY LẠI ĐƯỢC (luật [MIG-01]).
--
-- Ba cột mới trên "MakeupNeed" (= MakeupLine của bản BA):
--   · "sourceType"           — nguồn của dòng. Dòng CŨ mang 'SYSTEM_MIGRATION': không có lịch sử nào cho biết nó từ đâu tới
--                              (cột `note` là chuỗi tự do và bị ghi đè) nên KHÔNG đoán. Phân loại lại bằng chứng cứ (có điểm danh
--                              vắng ⇒ ABSENCE, v.v.) là việc có dry-run + `--expect` ở T15, không nằm trong migration.
--                              DEFAULT chỉ để lấp dòng cũ rồi BỊ GỠ NGAY: ghi mới phải khai tường minh (`tsc` bắt chỗ quên).
--   · "originalAttendanceId" — điểm danh gốc làm phát sinh dòng. Nullable, FK SET NULL (xoá điểm danh không được kéo theo mất
--                              nghĩa vụ bù). KHÔNG backfill: liên kết cho dòng cũ làm ở T15 cùng phân loại nguồn.
--   · "courseId"             — khoá của lớp lúc tạo dòng. Backfill TẤT ĐỊNH từ "Class"."courseId" (NOT NULL, và "classId" là FK ⇒
--                              mọi dòng đều có lớp). Sau backfill đặt NOT NULL; nếu còn hàng NULL thì DỪNG (RAISE) chứ không
--                              nuốt: đó là dấu hiệu dữ liệu hỏng cần người xem.
--
-- CHƯA thêm FK cho missedSessionId / missedLessonId / feeOrderItemId: cần dọn dòng mồ côi trước (T15) và `ON DELETE` của khoản
-- phí là quyết định nghiệp vụ. Unique ("studentId","missedSessionId") ĐÃ có từ 01/06/2026 nên không thêm lại.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MakeupSourceType') THEN
    CREATE TYPE "MakeupSourceType" AS ENUM ('ABSENCE', 'ORDER_CONVERSION', 'MANUAL', 'SYSTEM_MIGRATION', 'OTHER');
  END IF;
END $$;

ALTER TABLE "MakeupNeed"
  ADD COLUMN IF NOT EXISTS "sourceType"           "MakeupSourceType" NOT NULL DEFAULT 'SYSTEM_MIGRATION',
  ADD COLUMN IF NOT EXISTS "originalAttendanceId" TEXT,
  ADD COLUMN IF NOT EXISTS "courseId"             TEXT;

ALTER TABLE "MakeupNeed" ALTER COLUMN "sourceType" DROP DEFAULT;

UPDATE "MakeupNeed" n
SET "courseId" = c."courseId"
FROM "Class" c
WHERE c."id" = n."classId" AND n."courseId" IS NULL;

DO $$
DECLARE
  con_null integer;
BEGIN
  SELECT COUNT(*) INTO con_null FROM "MakeupNeed" WHERE "courseId" IS NULL;
  IF con_null > 0 THEN
    RAISE EXCEPTION 'T05: % dòng MakeupNeed không có lớp để suy courseId — dữ liệu hỏng, DỪNG (không đặt NOT NULL).', con_null;
  END IF;
END $$;

ALTER TABLE "MakeupNeed" ALTER COLUMN "courseId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupNeed_originalAttendanceId_fkey') THEN
    ALTER TABLE "MakeupNeed"
      ADD CONSTRAINT "MakeupNeed_originalAttendanceId_fkey"
      FOREIGN KEY ("originalAttendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupNeed_courseId_fkey') THEN
    ALTER TABLE "MakeupNeed"
      ADD CONSTRAINT "MakeupNeed_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MakeupNeed_courseId_idx" ON "MakeupNeed"("courseId");
CREATE INDEX IF NOT EXISTS "MakeupNeed_originalAttendanceId_idx" ON "MakeupNeed"("originalAttendanceId");
