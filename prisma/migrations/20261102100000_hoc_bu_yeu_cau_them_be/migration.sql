-- 24/10/2026 — HỌC BÙ: THÊM HỌC VIÊN KHÁC VÀO CASE CÓ SẴN PHẢI QUA QUẢN LÝ CƠ SỞ DUYỆT. CHỈ THÊM.
-- Thiết kế: docs/hoc-bu/T17-duyet-case.md, mục "Thêm học viên vào case có sẵn".
--
-- Chủ dự án chốt 24/10/2026: "mỗi lần thêm học viên khác vào case có sẵn cũng phải qua qlcs duyệt".
--
-- ── ĐÂY LÀ CÁI GÌ, VÀ KHÔNG PHẢI CÁI GÌ ─────────────────────────────────────────────────────────────
-- MỘT bảng MỚI ("MakeupCaseAddRequest") + MỘT enum MỚI. KHÔNG đụng bảng nào đang có, KHÔNG ADD VALUE vào enum có sẵn, KHÔNG backfill,
-- KHÔNG UPDATE/DELETE dòng nào. Bảng sinh ra RỖNG. Case đang chạy KHÔNG bị chạm: một yêu cầu thêm bé chỉ là một ghi chú "xin thêm"; case chỉ đổi
-- khi quản lý cơ sở duyệt (lúc đó đi đúng đường `xepVaoCaseCoSan` hiện có, kiểm lại toàn bộ luật).
--
-- MỘT DÒNG = MỘT dòng cần bù (makeupNeedId) bị xin thêm vào case. Các dòng cùng một lần bấm chung `batchId` — duyệt / từ chối / rút theo LÔ,
-- vì luật "tối đa 3 bài" là phép tính tổ hợp trên cả lô.
--
-- Các con trỏ (caseId · makeupNeedId · studentId) là CON TRỎ MỀM (không FK), như "DiscountProgramChangeRequest": yêu cầu là bản ghi ĐỐI SOÁT, phải
-- sống lâu hơn dòng mà nó nói tới.
--
-- Chỉ mục duy nhất TỪNG PHẦN "…_makeupNeedId_pending_key" (mỗi dòng cần bù tối đa MỘT yêu cầu đang chờ) và các ràng buộc CHECK không biểu diễn được trong
-- schema.prisma (Prisma 5 bỏ qua chỉ mục từng phần, không đọc CHECK) — chúng chỉ có trong SQL.
--
-- ⚠️ IDEMPOTENT (`[MIG-01]`): chạy tay trên prod, có thể bấm lại.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MakeupCaseAddRequestStatus') THEN
    CREATE TYPE "MakeupCaseAddRequestStatus" AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MakeupCaseAddRequest" (
    "id" TEXT NOT NULL,
    "status" "MakeupCaseAddRequestStatus" NOT NULL DEFAULT 'PENDING',
    "batchId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "makeupNeedId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "moRongBai" BOOLEAN NOT NULL DEFAULT false,
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMPTZ(6) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "MakeupCaseAddRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MakeupCaseAddRequest_centerId_status_idx" ON "MakeupCaseAddRequest"("centerId", "status");
CREATE INDEX IF NOT EXISTS "MakeupCaseAddRequest_caseId_status_idx" ON "MakeupCaseAddRequest"("caseId", "status");
CREATE INDEX IF NOT EXISTS "MakeupCaseAddRequest_batchId_idx" ON "MakeupCaseAddRequest"("batchId");
CREATE INDEX IF NOT EXISTS "MakeupCaseAddRequest_makeupNeedId_idx" ON "MakeupCaseAddRequest"("makeupNeedId");
CREATE INDEX IF NOT EXISTS "MakeupCaseAddRequest_orgUnitId_idx" ON "MakeupCaseAddRequest"("orgUnitId");

-- Mỗi dòng cần bù tối đa MỘT yêu cầu đang chờ: hai người bấm cùng lúc không đẻ hai yêu cầu, và dòng đó không thể vừa chờ vào case A vừa vào case B.
CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCaseAddRequest_makeupNeedId_pending_key"
  ON "MakeupCaseAddRequest"("makeupNeedId") WHERE "status" = 'PENDING';

DO $$
BEGIN
  -- Đang chờ ⇔ chưa có người quyết; đã quyết ⇒ biết ai và lúc nào.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseAddRequest_decision_chk') THEN
    ALTER TABLE "MakeupCaseAddRequest" ADD CONSTRAINT "MakeupCaseAddRequest_decision_chk"
      CHECK (
        ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
        OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
      );
  END IF;
  -- Từ chối bắt buộc có lý do (≥ 10 ký tự, cùng ngưỡng `LY_DO_TOI_THIEU`).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCaseAddRequest_reject_reason_chk') THEN
    ALTER TABLE "MakeupCaseAddRequest" ADD CONSTRAINT "MakeupCaseAddRequest_reject_reason_chk"
      CHECK ("status" <> 'REJECTED' OR char_length(btrim(COALESCE("decisionReason", ''))) >= 10);
  END IF;
END
$$;

-- RLS: bảng mới phải tự bật (chỉ ENABLE, không FORCE, không policy).
ALTER TABLE "MakeupCaseAddRequest" ENABLE ROW LEVEL SECURITY;
