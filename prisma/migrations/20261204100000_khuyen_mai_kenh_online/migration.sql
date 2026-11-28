-- WORKSTREAM A — KHUYẾN MÃI THEO KÊNH ONLINE/OFFLINE (20/11/2026). CHỈ CỘNG THÊM; chạy lại được (luật [MIG-01]).
--
-- `PromotionPolicy.channel`:
--   OFFLINE (MẶC ĐỊNH) — chỉ áp cho dòng khoá học tại trung tâm (hành vi hiện có, KHÔNG đổi);
--   ONLINE             — chỉ áp cho dòng khoá E-learning Online;
--   BOTH               — áp cho cả hai (dòng offline theo `courseIds`, dòng online theo `onlineCourseIds`).
-- `PromotionPolicy.onlineCourseIds` — OnlCourse.id được áp; RỖNG = mọi khoá online (cùng nghĩa với `courseIds` của phía offline).
--   Không có FK (mảng) — như `courseIds`; tầng ghi (`lib/khuyen-mai/chinh-sach.ts`) kiểm khoá tồn tại.
--
-- Mọi chính sách ĐANG CÓ nhận `channel = 'OFFLINE'` ⇒ KHÔNG áp được cho đơn online (fail-closed): mở khuyến mãi cho online là thao tác chủ đích.
-- Cột có giá trị mặc định hằng số ⇒ PostgreSQL ≥ 11 không viết lại bảng. Không backfill.
-- Rollback (chỉ khi chưa chính sách nào dùng ONLINE/BOTH): gỡ hai cột rồi gỡ kiểu PromotionChannel.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PromotionChannel') THEN CREATE TYPE "PromotionChannel" AS ENUM ('OFFLINE', 'ONLINE', 'BOTH'); END IF;
END $$;

ALTER TABLE "PromotionPolicy" ADD COLUMN IF NOT EXISTS "channel" "PromotionChannel" NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE "PromotionPolicy" ADD COLUMN IF NOT EXISTS "onlineCourseIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
