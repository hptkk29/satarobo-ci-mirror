-- Lưới phân công GV · PR4 (docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md §5): đề xuất / duyệt Rank, chứng nhận Trial, chính sách
-- hỗ trợ Trial có hiệu lực theo ngày (SR.QD.238 §3, §6 + công tắc của chủ dự án 24/10/2026).
--
-- ⚠️ CHỈ THÊM BẢNG MỚI — không đụng bảng đang có dữ liệu PROD (luật cứng #4), không backfill, không seed.
--    Chưa có dòng chính sách hỗ trợ Trial ⇒ hỗ trợ Trial = 0 kèm lý do TRIAL_POLICY_DISABLED (đúng hành vi trước PR này).
-- ⚠️ CHECK ngày / Rank chỉ có ở SQL (Prisma không biểu diễn). Chồng ngày giữa các dòng chính sách cùng phạm vi do tầng ứng dụng chặn.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TeacherRankProposalStatus') THEN
        CREATE TYPE "TeacherRankProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'CANCELLED');
    END IF;
END $$;

-- Đề xuất Rank (QLCS lập — Ban lãnh đạo duyệt). Duyệt ⇒ THÊM một dòng TeacherRankHistory (rankHistoryId); dòng lịch sử cũ không sửa.
CREATE TABLE IF NOT EXISTS "TeacherRankProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "currentRank" INTEGER NOT NULL,
    "proposedRank" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "basis" TEXT NOT NULL,
    "status" "TeacherRankProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "rankHistoryId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TeacherRankProposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherRankProposal_rank_check" CHECK ("currentRank" BETWEEN 1 AND 4 AND "proposedRank" BETWEEN 1 AND 4)
);
CREATE UNIQUE INDEX IF NOT EXISTS "TeacherRankProposal_rankHistoryId_key" ON "TeacherRankProposal"("rankHistoryId");
CREATE INDEX IF NOT EXISTS "TeacherRankProposal_userId_status_idx" ON "TeacherRankProposal"("userId", "status");
CREATE INDEX IF NOT EXISTS "TeacherRankProposal_centerId_status_idx" ON "TeacherRankProposal"("centerId", "status");
CREATE INDEX IF NOT EXISTS "TeacherRankProposal_orgUnitId_idx" ON "TeacherRankProposal"("orgUnitId");
-- Một giáo viên chỉ có MỘT đề xuất đang chờ — đề xuất thứ hai trong lúc cái đầu chưa quyết là nguồn của hai lần đổi giá.
CREATE UNIQUE INDEX IF NOT EXISTS "TeacherRankProposal_userId_dang_cho_key" ON "TeacherRankProposal"("userId") WHERE "status" = 'PROPOSED';

-- Chứng nhận Trial của giáo viên (Phòng Đào tạo Hội sở cấp / thu hồi). Thu hồi = đặt effectiveTo + người / lý do; buổi trước ngày thu hồi
-- vẫn hợp lệ. Không theo cơ sở (một giáo viên một chứng nhận, dạy được ở mọi cơ sở).
CREATE TABLE IF NOT EXISTS "TrialCertificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMPTZ(6),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrialCertificate_pkey" PRIMARY KEY ("id"),
    -- effectiveTo = NGÀY CUỐI còn hiệu lực. Thu hồi từ ngày D ⇒ effectiveTo = D − 1 (khuôn khuyến mãi); thu hồi NGAY ngày cấp ⇒
    -- effectiveTo = effectiveFrom − 1 = chưa từng hiệu lực ngày nào (khoảng rỗng) — CHECK cho phép đúng một ngày lùi đó.
    CONSTRAINT "TrialCertificate_khoang_ngay_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom" - 1)
);
CREATE INDEX IF NOT EXISTS "TrialCertificate_userId_idx" ON "TrialCertificate"("userId");

-- Chính sách hỗ trợ Trial theo ngày hiệu lực. centerId NULL = ÁP TOÀN HỆ THỐNG; dòng riêng của cơ sở thắng dòng chung cùng ngày.
-- Đổi chính sách = THÊM dòng (effectiveFrom ≥ hôm nay) và đóng dòng trước — không sửa ngày đã qua (không hồi tố).
CREATE TABLE IF NOT EXISTS "TrialSupportPolicy" (
    "id" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "amountPerStudent" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialSupportPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrialSupportPolicy_khoang_ngay_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
    CONSTRAINT "TrialSupportPolicy_muc_check" CHECK ("amountPerStudent" >= 0)
);
CREATE INDEX IF NOT EXISTS "TrialSupportPolicy_centerId_effectiveFrom_idx" ON "TrialSupportPolicy"("centerId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "TrialSupportPolicy_orgUnitId_idx" ON "TrialSupportPolicy"("orgUnitId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeacherRankProposal_centerId_fkey') THEN
        ALTER TABLE "TeacherRankProposal" ADD CONSTRAINT "TeacherRankProposal_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrialSupportPolicy_centerId_fkey') THEN
        ALTER TABLE "TrialSupportPolicy" ADD CONSTRAINT "TrialSupportPolicy_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Bảng MỚI tự bật RLS (chỉ ENABLE, không FORCE, không policy) — khuôn 20260825120000_lead_status_history.
ALTER TABLE "TeacherRankProposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrialCertificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrialSupportPolicy" ENABLE ROW LEVEL SECURITY;
