-- 28/10/2026: PHIÊN BẢN NỘI DUNG BÀI VIDEO (B1 — nền) — `mediaRevision` trên bài và trên tiến độ + bảng LƯU TRỮ BẤT BIẾN của tiến độ cũ.
--
-- Vì sao: đổi nguồn video (thay MP4, đổi link YouTube) là sửa TẠI CHỖ dòng `TrnLesson` dùng chung giữa các phiên bản khoá, và
-- tiến độ cũ (bitmap đoạn xem, DONE) vẫn nằm đó ⇒ người đã DONE video cũ vẫn DONE với video mới. `mediaRevision` đánh số
-- nội dung; tiến độ của phiên bản cũ được chụp sang bảng lưu trữ rồi dòng hiện hành bắt đầu lại (B2 làm phần chụp + bắt đầu lại;
-- B1 chỉ dựng nền: cột, bảng, vé mang phiên bản, nhịp xem từ chối phiên bản cũ).
--
-- ⚠️ CHỈ THÊM: hai cột + một bảng + một hàm/trigger MỚI. Không đổi/bỏ cột nào đang có (luật cứng #4), KHÔNG backfill, KHÔNG seed.
--    Mọi dòng cũ mang revision = 1 — đúng với MỌI bài hiện tại — nên không có bước chuyển đổi dữ liệu.
-- ⚠️ `ADD COLUMN … NOT NULL DEFAULT <hằng>` trên Postgres >= 11 chỉ ghi metadata, KHÔNG viết lại bảng (TrnLessonProgress là
--    bảng nóng nhất module).
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): IF NOT EXISTS / DO-EXCEPTION / CREATE OR REPLACE — một lượt bị ngắt giữa chừng không để
--    lại dòng FAILED chặn mọi `migrate deploy` sau đó (P3009).
-- ⚠️ Bảng mới tự bật RLS (chỉ ENABLE, không FORCE, không policy) — khuôn `20260825120000_lead_status_history`.
-- ⚠️ Không có quyền mới ⇒ không phải chạy seed-prod-roles. Mã cũ chạy bình thường trên schema mới: cột mặc định 1, bảng rỗng.
-- ⚠️ LỊCH SỬ LÀ BẤT BIẾN, ép bằng trigger: không UPDATE cột nào của bản chụp trừ dọn bitmap tầng 2 (segmentBitmap → NULL kèm
--    bitmapPurgedAt) và không DELETE trực tiếp. Xoá do khoá ngoại CASCADE (cha — ghi danh/bài — bị xoá thật) vẫn được.
-- ⚠️ ROLLBACK (không tự chạy; chạy tay nếu phải lui — chỉ an toàn khi MÃ đã lui trước):
--      DROP TRIGGER IF EXISTS "TrnLessonProgressRevision_bat_bien" ON "TrnLessonProgressRevision";
--      DROP FUNCTION IF EXISTS "TrnLessonProgressRevision_bat_bien"();
--      DROP TABLE IF EXISTS "TrnLessonProgressRevision";
--      ALTER TABLE "TrnLessonProgress" DROP COLUMN IF EXISTS "mediaRevision";
--      ALTER TABLE "TrnLesson" DROP COLUMN IF EXISTS "mediaRevision";
--    Lưu ý: DROP TABLE xoá LỊCH SỬ đã chụp — chỉ làm khi bảng còn rỗng hoặc đã sao lưu (xem docs, mục B6).

ALTER TABLE "TrnLesson" ADD COLUMN IF NOT EXISTS "mediaRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TrnLessonProgress" ADD COLUMN IF NOT EXISTS "mediaRevision" INTEGER NOT NULL DEFAULT 1;

-- Bản chụp BẤT BIẾN của MỘT dòng tiến độ ở MỘT phiên bản nội dung.
-- Cột tầng 1 (status, coveredSec, completedAt, verifiedAt…) ở lại vĩnh viễn; bitmap là tầng 2 nên theo hạn 90 ngày (cron-dem).
CREATE TABLE IF NOT EXISTS "TrnLessonProgressRevision" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaRevision" INTEGER NOT NULL,
    "segmentBitmap" BYTEA,
    "segmentSec" INTEGER NOT NULL DEFAULT 5,
    "coveredSec" INTEGER NOT NULL DEFAULT 0,
    "contentSec" INTEGER NOT NULL DEFAULT 0,
    "totalWatchSec" INTEGER NOT NULL DEFAULT 0,
    "maxPositionSec" INTEGER NOT NULL DEFAULT 0,
    "seekCount" INTEGER NOT NULL DEFAULT 0,
    "blockedSeekCount" INTEGER NOT NULL DEFAULT 0,
    "attnAskedCount" INTEGER NOT NULL DEFAULT 0,
    "attnPassedCount" INTEGER NOT NULL DEFAULT 0,
    "cueLogJson" JSONB,
    "status" "TrnLessonProgressStatus" NOT NULL,
    "firstStartedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "verifiedAt" TIMESTAMPTZ(6),
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL,
    "bitmapPurgedAt" TIMESTAMPTZ(6),
    "supersededAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededByUserId" TEXT,
    "reason" TEXT,

    CONSTRAINT "TrnLessonProgressRevision_pkey" PRIMARY KEY ("id")
);

-- Mỗi (lượt, bài, phiên bản) chỉ được chụp MỘT lần: chạy lại bước chụp (hoặc hai nhịp đổi nguồn song song) không đẻ bản trùng.
-- Tên tự đặt (không theo mặc định của Prisma) vì tên mặc định dài 65 ký tự > giới hạn 63 của Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS "TrnLessonProgressRevision_enr_les_rev_key"
    ON "TrnLessonProgressRevision"("enrollmentId", "lessonId", "mediaRevision");
CREATE INDEX IF NOT EXISTS "TrnLessonProgressRevision_lessonId_mediaRevision_idx"
    ON "TrnLessonProgressRevision"("lessonId", "mediaRevision");
CREATE INDEX IF NOT EXISTS "TrnLessonProgressRevision_userId_idx"
    ON "TrnLessonProgressRevision"("userId");
CREATE INDEX IF NOT EXISTS "TrnLessonProgressRevision_supersededAt_idx"
    ON "TrnLessonProgressRevision"("supersededAt");

DO $$ BEGIN
    ALTER TABLE "TrnLessonProgressRevision"
        ADD CONSTRAINT "TrnLessonProgressRevision_enrollmentId_fkey"
        FOREIGN KEY ("enrollmentId") REFERENCES "TrnEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "TrnLessonProgressRevision"
        ADD CONSTRAINT "TrnLessonProgressRevision_lessonId_fkey"
        FOREIGN KEY ("lessonId") REFERENCES "TrnLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "TrnLessonProgressRevision" ENABLE ROW LEVEL SECURITY;

-- BẤT BIẾN. Hai đường duy nhất được phép:
--  · UPDATE chỉ để DỌN bitmap tầng 2: segmentBitmap chỉ được đi từ có → NULL, và bitmapPurgedAt được đặt;
--  · DELETE do khoá ngoại CASCADE (`pg_trigger_depth() > 1`: câu xoá chạy bên trong trigger của ràng buộc khoá ngoại).
-- Mọi thứ khác — kể cả người có quyền ghi bảng — bị từ chối ở đây, nên bản chụp không sửa/xoá nhầm được bằng một câu UPDATE/DELETE.
CREATE OR REPLACE FUNCTION "TrnLessonProgressRevision_bat_bien"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() > 1 THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'TrnLessonProgressRevision là lịch sử bất biến: không xoá trực tiếp' USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."enrollmentId" IS DISTINCT FROM OLD."enrollmentId"
       OR NEW."lessonId" IS DISTINCT FROM OLD."lessonId"
       OR NEW."userId" IS DISTINCT FROM OLD."userId"
       OR NEW."mediaRevision" IS DISTINCT FROM OLD."mediaRevision"
       OR NEW."segmentSec" IS DISTINCT FROM OLD."segmentSec"
       OR NEW."coveredSec" IS DISTINCT FROM OLD."coveredSec"
       OR NEW."contentSec" IS DISTINCT FROM OLD."contentSec"
       OR NEW."totalWatchSec" IS DISTINCT FROM OLD."totalWatchSec"
       OR NEW."maxPositionSec" IS DISTINCT FROM OLD."maxPositionSec"
       OR NEW."seekCount" IS DISTINCT FROM OLD."seekCount"
       OR NEW."blockedSeekCount" IS DISTINCT FROM OLD."blockedSeekCount"
       OR NEW."attnAskedCount" IS DISTINCT FROM OLD."attnAskedCount"
       OR NEW."attnPassedCount" IS DISTINCT FROM OLD."attnPassedCount"
       OR NEW."cueLogJson" IS DISTINCT FROM OLD."cueLogJson"
       OR NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."firstStartedAt" IS DISTINCT FROM OLD."firstStartedAt"
       OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
       OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
       OR NEW."lastActivityAt" IS DISTINCT FROM OLD."lastActivityAt"
       OR NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt"
       OR NEW."supersededByUserId" IS DISTINCT FROM OLD."supersededByUserId"
       OR NEW."reason" IS DISTINCT FROM OLD."reason"
       OR (NEW."segmentBitmap" IS NOT NULL AND NEW."segmentBitmap" IS DISTINCT FROM OLD."segmentBitmap")
    THEN
        RAISE EXCEPTION 'TrnLessonProgressRevision là lịch sử bất biến: chỉ được dọn bitmap tầng 2' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "TrnLessonProgressRevision_bat_bien" ON "TrnLessonProgressRevision";
CREATE TRIGGER "TrnLessonProgressRevision_bat_bien"
    BEFORE UPDATE OR DELETE ON "TrnLessonProgressRevision"
    FOR EACH ROW EXECUTE FUNCTION "TrnLessonProgressRevision_bat_bien"();
