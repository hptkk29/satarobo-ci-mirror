-- ĐƠN TỪ · ĐỢT 4 — OT VÀO BẢNG CÔNG (08/10/2026, docs/cham-cong/KE-HOACH-DON-TU-THEO-BA.md).
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): cột NULLABLE / DEFAULT hằng. Rollback = ngừng ghi.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).
--
-- WorkRequest:
--   · approvedStartTime / approvedEndTime — khung OT QUẢN LÝ DUYỆT (có thể hẹp hơn khung xin).
--   · effectVersion — DẤU "đơn này duyệt theo luật mới" (đợt 2 trở đi). Chỉ đơn mang dấu mới tác
--     động bảng công khi tính lại; đơn đã duyệt TRƯỚC bản này giữ nghĩa "căn cứ" như lúc được duyệt —
--     không tự đổi công các kỳ đang mở. NULL = đơn cũ.
--   · appliedEffect — ảnh chụp hệ quả lúc duyệt (giá trị cũ → mới, id bản ghi đã đụng) để HUỶ đơn
--     hoàn tác đúng thứ đã làm (đợt 11).
-- StaffAttendanceDay (engine ghi): phút OT trong khung đã duyệt / làm thật trong khung / được trả.
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "approvedStartTime" TEXT;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "approvedEndTime" TEXT;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "effectVersion" INTEGER;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "appliedEffect" JSONB;

ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "otApprovedMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "otActualMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "otPayableMinutes" INTEGER NOT NULL DEFAULT 0;
