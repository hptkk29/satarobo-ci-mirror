-- Một bé học thử NHIỀU lớp trial (chủ dự án chốt 04/11/2026).
--
-- 1) Bỏ chỉ mục partial-unique "1 lớp ACTIVE / bé" và thay bằng "1 ghi danh ACTIVE / (bé × lớp)":
--    bé vẫn không thể ACTIVE hai lần TRONG CÙNG một lớp, nhưng được ACTIVE ở nhiều lớp khác nhau.
--    Chỉ là chỉ mục — không đụng cột hay dữ liệu nào.
-- 2) Thêm cột `courseId` (nullable): khoá học của TỪNG lượt trial, chụp lúc xếp/đổi khoá. Cần để
--    (a) chặn trial hai buổi cùng một khoá, (b) tính hoa hồng GV Trial đúng khoá PH chốt ghi danh.
--    NULL với mọi dòng cũ — không backfill, không có nguồn đáng tin để đoán.

DROP INDEX IF EXISTS "TrialEnrollment_leadChildId_active_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TrialEnrollment_leadChildId_trialClassId_active_key"
  ON "TrialEnrollment"("leadChildId", "trialClassId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "TrialEnrollment" ADD COLUMN IF NOT EXISTS "courseId" TEXT;

CREATE INDEX IF NOT EXISTS "TrialEnrollment_courseId_idx" ON "TrialEnrollment"("courseId");
