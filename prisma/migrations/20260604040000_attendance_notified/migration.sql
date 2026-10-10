-- Commit 5 — mốc đã gửi thông báo điểm danh (chống gửi trùng)
ALTER TABLE "Attendance" ADD COLUMN "notifiedAt" TIMESTAMP(3);
