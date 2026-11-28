-- Site giáo viên 25/08 — 3 nhóm cột ADDITIVE (tất cả nullable, không đụng dữ liệu cũ).
--
-- (1) Assignment — quá hạn tự đóng + GV mở cửa gia hạn "nộp trễ".
--     Trạng thái đóng/mở SUY Ở LÚC ĐỌC (lib/lms/assignment-window.ts), không cron,
--     không cột closedAt. `lateUntil` là hạn của cửa gia hạn; `dueAt` KHÔNG bị sửa nên
--     cờ SubmissionStatus.LATE vẫn đúng.
ALTER TABLE "Assignment" ADD COLUMN "lateUntil" TIMESTAMPTZ(6);
ALTER TABLE "Assignment" ADD COLUMN "lateReason" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "lateGrantedById" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "lateGrantedAt" TIMESTAMPTZ(6);

-- (2) TrialEnrollment — dời lịch học thử. Trước 25/08 `scheduledSessionId` bất biến sau
--     khi xếp con vào lớp, nên không có dữ liệu nào để hiện trạng thái "Bị dời lịch".
ALTER TABLE "TrialEnrollment" ADD COLUMN "rescheduledFromSessionId" TEXT;
ALTER TABLE "TrialEnrollment" ADD COLUMN "rescheduledAt" TIMESTAMPTZ(6);
ALTER TABLE "TrialEnrollment" ADD COLUMN "rescheduleReason" TEXT;

-- (3) CommissionLine — hoa hồng GV dạy trial (tier TRIAL_TEACHER, 1% học phí khi học
--     viên học thử nhập học). Sinh TỪNG DÒNG trong transaction convert ⇒ cần khoá chống
--     ghi trùng. 4 tầng Sale để enrollmentId NULL và không vướng khoá này (NULL không
--     bằng NULL trong UNIQUE của Postgres).
ALTER TABLE "CommissionLine" ADD COLUMN "enrollmentId" TEXT;
ALTER TABLE "CommissionLine" ADD COLUMN "note" TEXT;
CREATE UNIQUE INDEX "CommissionLine_statementId_tier_recipientId_enrollmentId_key"
  ON "CommissionLine"("statementId", "tier", "recipientId", "enrollmentId");
CREATE INDEX "CommissionLine_enrollmentId_idx" ON "CommissionLine"("enrollmentId");
