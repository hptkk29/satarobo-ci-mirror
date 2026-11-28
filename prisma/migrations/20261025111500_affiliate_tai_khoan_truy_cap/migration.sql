-- AFF-L3a (closeout Affiliate, 13/10/2026) — TÀI KHOẢN TRUY CẬP CỔNG CỦA ĐỐI TÁC (User ↔ AffiliateParty, nhiều–nhiều) + CÔNG TẮC HIỆN SỐ TIỀN Ở CỔNG.
-- docs/source-commission/closeout/l3a-doi-tac-tai-khoan.md.
--
-- ADDITIVE, CHẠY LẠI ĐƯỢC ([MIG-01]): 1 bảng + 2 enum MỚI; 2 cột MỚI (nullable) trên AffiliateCampaign / AffiliateType. KHÔNG đụng/bỏ cột cũ — `Affiliate.userId` GIỮ NGUYÊN (2-phase: cột "legacy, chỉ đồng bộ
-- từ bảng nối"; xoá là việc của một đợt sau khi mọi nơi đọc đã chuyển — xem notes). Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này.
--
-- Vì sao một bảng nối thay cho cột đơn: `User` = danh tính đăng nhập, `AffiliateParty` = danh tính kinh doanh. Một Party tổ chức có NHIỀU User thành viên; một User có thể đại diện NHIỀU Party.
-- Cột đơn `Affiliate.userId` không biểu diễn được quan hệ đó (và không có chỉ mục).
--
-- ── MỘT trạng thái truy cập, không hai ─────────────────────────────────────────────────────────────────────
-- `status` = ACTIVE (vào cổng được) | SUSPENDED (TẠM NGỪNG cổng — dữ liệu giữ nguyên, mở lại được) | REVOKED (đã gỡ liên kết — dòng giữ lại làm vết; liên kết lại = mở lại chính dòng này).
-- KHÔNG có cột `portalSuspended` riêng: hai nguồn sự thật cho «user này vào cổng được không» là bẫy.
--
-- ── Cái Prisma KHÔNG biểu diễn được (CHECK) ────────────────────────────────────────────────────────────────
-- · «Mỗi đối tác tối đa MỘT người đại diện chưa gỡ» KHÔNG đặt thành chỉ mục duy nhất từng phần (Prisma không mô hình hoá được ⇒ `migrate diff` sẽ in một dòng nhắc bảng này). Luật nằm ở tầng ghi:
--   `lib/affiliate/tai-khoan-truy-cap-ghi.ts` khoá hàng Affiliate (`FOR UPDATE`) rồi mới đọc/ghi các dòng truy cập; ca DB [ATK-DB-*] canh.
-- · Tạm ngừng / gỡ BẮT BUỘC có lý do ≥ 10 ký tự; gỡ ⇔ có `revokedAt`.

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateAccessRole') THEN
    CREATE TYPE "AffiliateAccessRole" AS ENUM ('REPRESENTATIVE', 'MEMBER');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateAccessStatus') THEN
    CREATE TYPE "AffiliateAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AffiliatePartyUser" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AffiliateAccessRole" NOT NULL DEFAULT 'MEMBER',
    "status" "AffiliateAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMPTZ(6),
    "statusChangedById" TEXT,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AffiliatePartyUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AffiliatePartyUser_partyId_userId_key" ON "AffiliatePartyUser"("partyId", "userId");

-- CreateIndex — «tài khoản này vào được những đối tác nào»: điểm vào của cổng /portal/gioi-thieu (đóng nợ «Affiliate.userId chưa có chỉ mục»).
CREATE INDEX IF NOT EXISTS "AffiliatePartyUser_userId_status_idx" ON "AffiliatePartyUser"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AffiliatePartyUser_partyId_status_idx" ON "AffiliatePartyUser"("partyId", "status");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliatePartyUser_partyId_fkey' AND conrelid = '"AffiliatePartyUser"'::regclass) THEN
    ALTER TABLE "AffiliatePartyUser" ADD CONSTRAINT "AffiliatePartyUser_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey — xoá User thì dòng truy cập đi theo (Party KHÔNG bị xoá: Party có sổ/lead/attribution trỏ vào, Restrict ở phía Party).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliatePartyUser_userId_fkey' AND conrelid = '"AffiliatePartyUser"'::regclass) THEN
    ALTER TABLE "AffiliatePartyUser" ADD CONSTRAINT "AffiliatePartyUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── CHECK — thứ Prisma không biết ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliatePartyUser_ly_do_chk' AND conrelid = '"AffiliatePartyUser"'::regclass) THEN
    ALTER TABLE "AffiliatePartyUser" ADD CONSTRAINT "AffiliatePartyUser_ly_do_chk" CHECK ("status" = 'ACTIVE' OR char_length(btrim(COALESCE("statusReason", ''))) >= 10);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliatePartyUser_go_chk' AND conrelid = '"AffiliatePartyUser"'::regclass) THEN
    ALTER TABLE "AffiliatePartyUser" ADD CONSTRAINT "AffiliatePartyUser_go_chk" CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL));
  END IF;
END $$;

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "AffiliatePartyUser" ENABLE ROW LEVEL SECURITY;

-- ── Công tắc hiện SỐ TIỀN hoa hồng ở cổng đối tác: NULL = «theo cấp trên» (campaign → loại → mặc định ẨN) ───────
ALTER TABLE "AffiliateCampaign" ADD COLUMN IF NOT EXISTS "partnerCanViewAmount" BOOLEAN;
ALTER TABLE "AffiliateType" ADD COLUMN IF NOT EXISTS "partnerCanViewAmount" BOOLEAN;

-- ── BACKFILL từ `Affiliate.userId` ─────────────────────────────────────────────────────────────────────────
-- Chỉ dòng có userId HỢP LỆ (tồn tại trong "User"). Người đã gắn bằng SQL thành người ĐẠI DIỆN đang hoạt động. Chạy lại không đổi gì (ON CONFLICT) và KHÔNG đè dòng đã bị gỡ/tạm ngừng.
-- Id cố định theo cặp (party,user) ⇒ chạy lại cho cùng kết quả.
-- BACKFILL:BEGIN
INSERT INTO "AffiliatePartyUser" ("id", "partyId", "userId", "role", "status", "grantedAt", "createdAt", "updatedAt")
SELECT 'apu_' || substr(md5(a."id" || ':' || a."userId"), 1, 24), a."id", a."userId", 'REPRESENTATIVE', 'ACTIVE', a."createdAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Affiliate" a
JOIN "User" u ON u."id" = a."userId"
WHERE a."userId" IS NOT NULL
ON CONFLICT ("partyId", "userId") DO NOTHING;
-- BACKFILL:END
