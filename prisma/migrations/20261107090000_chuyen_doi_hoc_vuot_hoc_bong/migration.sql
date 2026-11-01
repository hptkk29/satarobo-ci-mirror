-- 27/10/2026 — CHUYỂN ĐỔI ĐƠN: (1) YÊU CẦU HỌC VƯỢT BÙ chờ QLCS duyệt, (2) HỌC BỔNG 100% đánh dấu trên ĐƠN.
--
-- Chủ dự án chốt 27/10/2026 (chat): khi chuyển đổi học viên vào lớp đã học trước n buổi, Sale điền số buổi học vượt (học bù) để Quản lý cơ sở duyệt;
-- duyệt xong, trần buổi học bù miễn phí của học viên cộng thêm đúng số buổi đó. Học bổng 100% chỉ Quản trị tối cao cấp, thực hiện trên trang đơn.
--
-- ── ĐÂY LÀ CÁI GÌ, VÀ KHÔNG PHẢI CÁI GÌ ─────────────────────────────────────────────────────────────
-- MỘT bảng MỚI ("EnrollmentCatchUpRequest") + MỘT enum MỚI + BỐN cột MỚI NULLABLE/DEFAULT trên "Order". KHÔNG backfill, KHÔNG UPDATE/DELETE dòng nào,
-- KHÔNG ADD VALUE vào enum có sẵn. Bảng sinh ra RỖNG; đơn hiện có giữ `hocBong100 = false`.
-- Con trỏ (orderId · orderItemId · enrollmentId · studentId · classId · courseId) là CON TRỎ MỀM (không FK): yêu cầu là bản ghi ĐỐI SOÁT, sống lâu hơn dòng nó nói tới.
-- Mỗi ghi danh tối đa MỘT yêu cầu (UNIQUE "enrollmentId"): Quản trị tối cao đổi buổi bắt đầu thì SỬA yêu cầu đó tại chỗ, không đẻ yêu cầu thứ hai.
--
-- ⚠️ IDEMPOTENT (`[MIG-01]`): chạy tay trên prod, có thể bấm lại.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EnrollmentCatchUpStatus') THEN
    CREATE TYPE "EnrollmentCatchUpStatus" AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "EnrollmentCatchUpRequest" (
    "id" TEXT NOT NULL,
    "status" "EnrollmentCatchUpStatus" NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "startLesson" INTEGER NOT NULL,
    "sessionsToCatchUp" INTEGER NOT NULL,
    "makeupSessions" INTEGER NOT NULL,
    "creditEntryKey" TEXT,
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMPTZ(6) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "EnrollmentCatchUpRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EnrollmentCatchUpRequest_enrollmentId_key" ON "EnrollmentCatchUpRequest"("enrollmentId");
CREATE INDEX IF NOT EXISTS "EnrollmentCatchUpRequest_centerId_status_idx" ON "EnrollmentCatchUpRequest"("centerId", "status");
CREATE INDEX IF NOT EXISTS "EnrollmentCatchUpRequest_orderId_idx" ON "EnrollmentCatchUpRequest"("orderId");
CREATE INDEX IF NOT EXISTS "EnrollmentCatchUpRequest_studentId_idx" ON "EnrollmentCatchUpRequest"("studentId");
CREATE INDEX IF NOT EXISTS "EnrollmentCatchUpRequest_orgUnitId_idx" ON "EnrollmentCatchUpRequest"("orgUnitId");

DO $$
BEGIN
  -- Đang chờ ⇔ chưa có người quyết; đã quyết ⇒ biết ai và lúc nào.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EnrollmentCatchUpRequest_decision_chk') THEN
    ALTER TABLE "EnrollmentCatchUpRequest" ADD CONSTRAINT "EnrollmentCatchUpRequest_decision_chk"
      CHECK (
        ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
        OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EnrollmentCatchUpRequest_reject_reason_chk') THEN
    ALTER TABLE "EnrollmentCatchUpRequest" ADD CONSTRAINT "EnrollmentCatchUpRequest_reject_reason_chk"
      CHECK ("status" <> 'REJECTED' OR char_length(btrim(COALESCE("decisionReason", ''))) >= 10);
  END IF;
  -- Số buổi hợp lệ: bắt đầu từ buổi ≥ 1; cần bù ≥ 1; số buổi bù ∈ [1, cần bù].
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EnrollmentCatchUpRequest_sessions_chk') THEN
    ALTER TABLE "EnrollmentCatchUpRequest" ADD CONSTRAINT "EnrollmentCatchUpRequest_sessions_chk"
      CHECK ("startLesson" >= 1 AND "sessionsToCatchUp" >= 1 AND "makeupSessions" >= 1 AND "makeupSessions" <= "sessionsToCatchUp");
  END IF;
END
$$;

-- RLS: bảng mới phải tự bật (chỉ ENABLE, không FORCE, không policy).
ALTER TABLE "EnrollmentCatchUpRequest" ENABLE ROW LEVEL SECURITY;

-- ── HỌC BỔNG 100% TRÊN ĐƠN ────────────────────────────────────────────────────────────────────────────
-- Chỉ Quản trị tối cao đặt (lib/crm/scholarship.ts · canGrantFullScholarship). Cờ cho đơn qua cổng "đã có tiền" của màn chuyển đổi; KHÔNG sinh Payment.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "hocBong100" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "hocBongById" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "hocBongAt" TIMESTAMPTZ(6);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "hocBongLyDo" TEXT;
