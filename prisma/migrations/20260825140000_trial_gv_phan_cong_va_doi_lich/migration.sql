-- GĐ3 — HAI Ô GIÁO VIÊN (đề xuất / phân công) + NHẬT KÝ DỜI LỊCH.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): ba cột mới trên bảng có dữ liệu, một bảng mới.
-- KHÔNG đổi kiểu, KHÔNG bỏ cột, KHÔNG đụng `TrialClassV2.teacherId` hay
-- `TrialClassSession.teacherId` — hai cột đó giữ nguyên vai trò "giáo viên mặc định
-- của lớp/buổi" cho tới khi GĐ6 chuyển hẳn đường đọc.
--
-- Vì sao hai ô giáo viên nằm ở TrialEnrollment (ca của MỘT bé) chứ không ở lớp:
-- luồng đã chốt là trial 1-1 theo từng khách. Sale đề xuất cho ca của mình, Đào tạo
-- duyệt cho ca đó, và khi dời lịch thì CHỈ ca đó mất phân công. Đặt ở cấp lớp thì
-- dời lịch cho bé A sẽ gỡ luôn giáo viên của bé B và C trong cùng lớp.

ALTER TABLE "TrialEnrollment" ADD COLUMN IF NOT EXISTS "gvDeXuatId" TEXT;
ALTER TABLE "TrialEnrollment" ADD COLUMN IF NOT EXISTS "gvPhanCongId" TEXT;
ALTER TABLE "TrialEnrollment" ADD COLUMN IF NOT EXISTS "rescheduleCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "TrialEnrollment_gvPhanCongId_idx"
  ON "TrialEnrollment"("gvPhanCongId");

-- ─── Nhật ký dời lịch ────────────────────────────────────────────────────────
--
-- Vì sao là bảng riêng chứ không phải một giá trị của `TrialSessionStatus`: chủ dự án
-- chốt GIỮ enum buổi ở ba giá trị. Buổi là của cả lớp, còn dời lịch là việc của MỘT
-- bé — một buổi bốn bé thì không mang nổi bốn trạng thái.
--
-- Vì sao vẫn phải giữ vết dù trên màn bé đó "biến mất" khỏi buổi cũ: tỷ lệ dời lịch
-- phản ánh chất lượng chốt lịch của Sale, xoá thẳng là mất hẳn chỉ số, không dựng lại được.
CREATE TABLE IF NOT EXISTS "TrialReschedule" (
  "id"                TEXT NOT NULL,
  "trialEnrollmentId" TEXT NOT NULL,
  "fromSessionId"     TEXT,
  "toSessionId"       TEXT NOT NULL,
  "gvBiGoId"          TEXT,
  "reason"            TEXT,
  "changedById"       TEXT,
  "changedByName"     TEXT,
  "centerId"          TEXT,
  "orgUnitId"         TEXT,
  "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrialReschedule_pkey" PRIMARY KEY ("id")
);

-- Cố ý KHÔNG có FK tới TrialClassSession: buổi có thể bị huỷ/dọn về sau, mà nhật ký
-- thì phải sống lâu hơn buổi. Cũng KHÔNG có FK tới User vì `changedById` null khi hệ
-- thống tự dời, và xoá nhân sự không được phép cascade mất lịch sử.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TrialReschedule_trialEnrollmentId_fkey'
  ) THEN
    ALTER TABLE "TrialReschedule"
      ADD CONSTRAINT "TrialReschedule_trialEnrollmentId_fkey"
      FOREIGN KEY ("trialEnrollmentId") REFERENCES "TrialEnrollment"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TrialReschedule_trialEnrollmentId_createdAt_idx"
  ON "TrialReschedule"("trialEnrollmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "TrialReschedule_centerId_idx" ON "TrialReschedule"("centerId");
CREATE INDEX IF NOT EXISTS "TrialReschedule_orgUnitId_idx" ON "TrialReschedule"("orgUnitId");

-- RLS: bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT LẦN).
ALTER TABLE "TrialReschedule" ENABLE ROW LEVEL SECURITY;

-- ─── Backfill giáo viên đã phân công ─────────────────────────────────────────
--
-- PHƯƠNG ÁN A (an toàn cho vận hành đang chạy): coi giáo viên hiện có của lớp là ĐÃ
-- ĐƯỢC PHÂN CÔNG cho mọi ca đang học trong lớp đó. Chiều ngược lại (coi là "mới chỉ
-- đề xuất") sẽ làm MỌI lớp đang chạy biến mất khỏi màn giáo viên ngay khi GĐ6 chuyển
-- đường đọc — thiệt hại lớn hơn nhiều so với việc một vài lớp Sale vừa tạo bị coi là
-- đã duyệt dù chưa ai duyệt.
--
-- Chỉ backfill ca còn ACTIVE: ca đã xong hoặc đã gỡ thì không cần ai phụ trách nữa.
UPDATE "TrialEnrollment" e
SET "gvPhanCongId" = c."teacherId"
FROM "TrialClassV2" c
WHERE e."trialClassId" = c."id"
  AND e."status" = 'ACTIVE'
  AND e."gvPhanCongId" IS NULL
  AND c."teacherId" IS NOT NULL;
