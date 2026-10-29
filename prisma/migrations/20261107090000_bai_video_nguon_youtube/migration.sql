-- 07/11/2026: BÀI VIDEO DÙNG LINK YOUTUBE (không công khai) — người soạn dán link thay vì tải MP4 lên R2.
--
-- ⚠️ CHỈ THÊM HAI CỘT vào TrnLesson, không đổi/bỏ cột nào đang có (luật cứng #4), không backfill, không seed.
--    Bài cũ giữ nguyên: youtubeId = NULL, youtubePhuDe = false ⇒ vẫn phát từ videoKey như trước.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): ADD COLUMN IF NOT EXISTS — một lượt bị ngắt giữa chừng không để lại dòng FAILED chặn
--    mọi `migrate deploy` sau đó (P3009).
-- ⚠️ DEFAULT false trên cột NOT NULL: Postgres >= 11 thêm cột như vậy chỉ ghi metadata, không viết lại bảng.
-- ⚠️ Không có quyền mới ⇒ không phải chạy seed-prod-roles. Không có chỉ mục: không truy vấn nào lọc theo youtubeId.

ALTER TABLE "TrnLesson" ADD COLUMN IF NOT EXISTS "youtubeId" TEXT;
ALTER TABLE "TrnLesson" ADD COLUMN IF NOT EXISTS "youtubePhuDe" BOOLEAN NOT NULL DEFAULT false;
