-- ĐƠN TỪ · ĐỢT 9 — phút LÀM NGÀY LỄ / LÀM NGÀY NGHỈ theo đơn đã duyệt (08/10/2026,
-- docs/cham-cong/KE-HOACH-DON-TU-THEO-BA.md). Cột RIÊNG, không cộng vào công thường hay OT (BA 4.6):
-- = phút làm thật (cặp vào–ra đã đóng) NẰM TRONG khung đơn đã duyệt. Chỉ ghi PHÚT — hệ số / tiền do
-- bảng lương quyết, không tính ở đây.
-- ADDITIVE (luật cứng #4): hai cột NOT NULL DEFAULT 0 trên bảng có dữ liệu — Postgres 11+ thêm cột có
-- DEFAULT hằng số không ghi lại bảng. Dòng cũ = 0 = "không có đơn" — đúng nghĩa. Chạy lại được.
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "holidayWorkMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "restDayWorkMinutes" INTEGER NOT NULL DEFAULT 0;
