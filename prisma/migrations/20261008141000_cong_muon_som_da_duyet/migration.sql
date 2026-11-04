-- ĐƠN TỪ · ĐỢT 2 — ĐI MUỘN / VỀ SỚM ĐÃ DUYỆT ĐƯỢC MIỄN TRỪ (08/10/2026, chốt Q-5).
--
-- Hai cột ENGINE ghi (cùng họ `lateMinutes`/`earlyLeaveMinutes`): phần muộn/sớm nằm TRONG khung
-- đơn LATE_EARLY đã duyệt. Engine tính lại mỗi lần `recomputeAttendanceDay` chạy — không ai ghi tay.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): hai cột NOT NULL DEFAULT 0 — Postgres 11+ thêm cột có DEFAULT
-- hằng mà không viết lại bảng. Dòng cũ = 0 = "không có phần nào được miễn", đúng với dữ liệu cũ
-- (trước đợt này chưa có miễn trừ nào). Rollback = ngừng ghi.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được ([MIG-01]).
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "lateApprovedMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "earlyLeaveApprovedMinutes" INTEGER NOT NULL DEFAULT 0;
