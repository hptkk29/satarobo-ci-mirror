-- 06/10/2026 — Đơn "Chỉnh công" (TIMESHEET_FIX) nâng lên 4 mốc: vào 1 · ra 1 · vào 2 · ra 2.
--
-- Chủ dự án yêu cầu: "ca có 4 lần check in/out thì QLCS hoặc admin cũng ghi đè được đủ 4 mốc
-- (chỉ vào + ra thì không biết lúc nào với lúc nào)". Hai mốc đầu GIỮ cột cũ
-- (`requestedInAt` / `requestedOutAt`), hai mốc sau là hai cột MỚI cùng kiểu ("HH:mm" giờ VN).
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): hai cột NULLABLE, không DEFAULT, không backfill. Đơn cũ
-- giữ NULL = "đơn hai mốc như trước". Rollback = ngừng ghi; cột nằm im.
-- Bảng đã có RLS từ trước — không bảng mới nên không cần ENABLE.
-- Tên 20261006180000: đo 06/10 bằng `git ls-tree` mọi origin/* + nhánh cục bộ + mọi worktree —
-- lớn nhất đang có là 20261006160000_pos_gd2_nhat_ky_kiem.
-- Viết TAY (CẤM `prisma migrate dev`). Chạy lại được (IF NOT EXISTS).

ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "requestedIn2At" TEXT;
ALTER TABLE "WorkRequest" ADD COLUMN IF NOT EXISTS "requestedOut2At" TEXT;
