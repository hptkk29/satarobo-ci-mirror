-- Thống kê chấm công tháng + % trừ nội quy (đợt 2, chốt 07/09/2026).
--
-- CHỈ THÊM, không đổi/bỏ cột nào đang có dữ liệu — theo luật cứng #4 của Nền Hệ thống.
-- Chạy tay trên PROD sau khi nghiệm thu trên test.
--
-- 1. `arrivalDeltaMinutes`: số phút đến muộn THÔ so với giờ bắt đầu đoạn đầu ca.
--    KHÁC `lateMinutes`, vốn chỉ cộng khi đã vượt dung sai `shift.lateGraceMinutes` (mặc
--    định 30′). Chủ dự án chốt tính "1 lần trễ" từ phút thứ 15 — không có cột này thì
--    người trễ 20′ đang lưu thành 0 và không đếm được theo bất kỳ ngưỡng nào dưới 30′.
--    Mặc định 0 nên dòng cũ không sai lệch; số thật xuất hiện dần khi tính lại từng ngày.
--
-- 2. Bốn cột `absence*`: kết luận của QUẢN LÝ về một ngày vắng mặt. Chủ dự án chốt không
--    tự động trừ từ cờ `KHONG_CO_LUOT`, vì cờ đó còn do quên quét / quầy hỏng / đi công
--    tác — nhân thẳng nó với 2% là phạt oan có hệ thống. Do NGƯỜI ghi, không do engine.

CREATE TYPE "AttendanceAbsenceStatus" AS ENUM ('UNAUTHORISED', 'EXCUSED');

ALTER TABLE "StaffAttendanceDay"
  ADD COLUMN "arrivalDeltaMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "absenceStatus" "AttendanceAbsenceStatus",
  ADD COLUMN "absenceById" TEXT,
  ADD COLUMN "absenceAt" TIMESTAMPTZ(6),
  ADD COLUMN "absenceNote" TEXT;

-- Chỉ đánh chỉ mục cho dòng ĐÃ được kết luận: bảng thống kê tháng luôn hỏi
-- "ngày nào bị chốt là không phép", và số dòng đó rất nhỏ so với cả bảng.
CREATE INDEX "StaffAttendanceDay_absenceStatus_idx"
  ON "StaffAttendanceDay" ("absenceStatus")
  WHERE "absenceStatus" IS NOT NULL;
