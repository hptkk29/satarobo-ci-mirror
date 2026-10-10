-- HỘP THƯ ĐA KÊNH (Site Sale) — nền hội thoại với người NGOÀI hệ thống.
--
-- ⚠️ CHƯA CHẠY lên bất kỳ môi trường nào, kể cả DB dev/test. Người vận hành chạy
-- tay theo luật cứng Nền Hệ thống #4. Xem mục "Chạy thế nào" ở cuối file.
--
-- ── An toàn ─────────────────────────────────────────────────────────────────
-- THUẦN THÊM: 5 enum MỚI + 3 bảng MỚI + index. KHÔNG đụng một bảng đang có nào,
-- không đổi kiểu, không xoá, không khoá ngoại tới bảng cũ. Mã đang chạy trên prod
-- không thấy gì khác. Lăn ngược = DROP 3 bảng + 5 enum (thứ tự ngược lại), dữ liệu
-- của mọi bảng khác nguyên vẹn.
--
-- ⚠️ `test` và local DÙNG CHUNG một DB (CLAUDE.md). Migration này chỉ additive nên
-- không xoá gì của ai, nhưng vẫn phải chạy có ý thức.
--
-- ── Vì sao KHÔNG có cột `centerId` ──────────────────────────────────────────
-- Luật cứng Nền Hệ thống #3: bảng mới theo đơn vị dùng `orgUnitId`, không thêm
-- `centerId` mới. Hệ quả PHẢI NHỚ: `scopedDb` chỉ lọc `centerId`, nên ba bảng này
-- KHÔNG được cách ly tự động. Tầm nhìn ép tay ở `lib/inbox/scope.ts`, và mọi truy
-- vấn đi qua `lib/inbox/queries.ts` (có test canh cổng).
--
-- Vì không có `centerId`, ba bảng này KHÔNG cần khai vào `BACKFILL_SPECS`
-- (`lib/org/center-bridge.ts`): test [US-07-IT-08b] chỉ soi bảng có ĐỦ HAI cột.
--
-- ── Vì sao có RLS ───────────────────────────────────────────────────────────
-- Migration 20260617000000 bật RLS cho mọi bảng public tồn tại lúc đó; bảng tạo
-- SAU ra đời với RLS OFF, mà Supabase cấp sẵn anon + authenticated đủ CRUD trên
-- schema public (đó chính là lỗ mà 20260809140000 phải đi vá lại 24 bảng). Bật
-- ngay từ đầu thì không sinh nợ mới. Chỉ ENABLE, KHÔNG FORCE ⇒ owner
-- (Prisma/service_role) không đổi hành vi.

-- ── Enum ────────────────────────────────────────────────────────────────────
CREATE TYPE "InboxChannel" AS ENUM ('ZALO_OA', 'MESSENGER', 'LIVECHAT', 'MANUAL');

CREATE TYPE "InboxDirection" AS ENUM ('IN', 'OUT');

CREATE TYPE "InboxDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SIMULATED', 'SKIPPED', 'FAILED');

CREATE TYPE "InboxConversationStatus" AS ENUM ('OPEN', 'SNOOZED', 'CLOSED');

CREATE TYPE "InboxIdentityLinkSource" AS ENUM ('WEBHOOK_PROFILE', 'PHONE_MATCH', 'MANUAL');

-- ── Danh tính ngoài ─────────────────────────────────────────────────────────
-- `leadId` NULL = hội thoại MỒ CÔI. Trạng thái BÌNH THƯỜNG: webhook `user_send_text`
-- của Zalo không bao giờ kèm SĐT, và `user_id` chỉ có nghĩa trong phạm vi một OA.
-- KHÔNG có khoá ngoại tới "Lead": Lead có thể bị gộp/xoá mềm, và một FK cứng ở đây
-- biến việc dọn lead thành việc phải đụng hộp thư.
CREATE TABLE "InboxIdentity" (
    "id" TEXT NOT NULL,
    "channel" "InboxChannel" NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "leadId" TEXT,
    "linkedAt" TIMESTAMPTZ(6),
    "linkedById" TEXT,
    "linkSource" "InboxIdentityLinkSource",
    "isFollowing" BOOLEAN NOT NULL DEFAULT false,
    "followedAt" TIMESTAMPTZ(6),
    "unfollowedAt" TIMESTAMPTZ(6),
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" TEXT,
    "deletedReason" TEXT,

    CONSTRAINT "InboxIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxIdentity_channel_accountId_externalUserId_key"
    ON "InboxIdentity"("channel", "accountId", "externalUserId");
CREATE INDEX "InboxIdentity_leadId_idx" ON "InboxIdentity"("leadId");
CREATE INDEX "InboxIdentity_orgUnitId_idx" ON "InboxIdentity"("orgUnitId");
CREATE INDEX "InboxIdentity_channel_leadId_idx" ON "InboxIdentity"("channel", "leadId");

-- ── Hội thoại ───────────────────────────────────────────────────────────────
-- `externalThreadId` NOT NULL có chủ đích: cột nullable nằm trong UNIQUE là unique
-- GIẢ (Postgres coi mọi NULL là khác nhau) ⇒ hai webhook chạy song song sẽ đẻ hai
-- hội thoại cho cùng một khách. Zalo OA không có "thread" nên đường ghi đặt bằng
-- chính `externalUserId`.
CREATE TABLE "InboxConversation" (
    "id" TEXT NOT NULL,
    "channel" "InboxChannel" NOT NULL,
    "accountId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "status" "InboxConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "assignedAt" TIMESTAMPTZ(6),
    "assignedById" TEXT,
    "lastInboundAt" TIMESTAMPTZ(6),
    "lastOutboundAt" TIMESTAMPTZ(6),
    "lastMessageAt" TIMESTAMPTZ(6),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "awaitingReply" BOOLEAN NOT NULL DEFAULT false,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" TEXT,
    "deletedReason" TEXT,

    CONSTRAINT "InboxConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxConversation_channel_accountId_externalThreadId_key"
    ON "InboxConversation"("channel", "accountId", "externalThreadId");
CREATE INDEX "InboxConversation_status_lastMessageAt_idx"
    ON "InboxConversation"("status", "lastMessageAt");
CREATE INDEX "InboxConversation_assigneeId_status_idx"
    ON "InboxConversation"("assigneeId", "status");
CREATE INDEX "InboxConversation_orgUnitId_idx" ON "InboxConversation"("orgUnitId");
CREATE INDEX "InboxConversation_identityId_idx" ON "InboxConversation"("identityId");
-- Bộ lọc "chưa trả lời" là bộ lọc dùng nhiều nhất của màn hình này.
CREATE INDEX "InboxConversation_awaitingReply_lastMessageAt_idx"
    ON "InboxConversation"("awaitingReply", "lastMessageAt");

-- ── Tin nhắn ────────────────────────────────────────────────────────────────
-- UNIQUE ("channel", "channelMessageId") là chốt chống trùng THẬT của webhook:
-- nhà cung cấp retry gửi lại đúng id đó. NULL hợp lệ và KHÔNG bị chặn (nhiều dòng
-- OUT vừa giành chỗ đều mang NULL) — đúng ý, vì chiều OUT chống trùng bằng
-- "outboundKey".
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channel" "InboxChannel" NOT NULL,
    "direction" "InboxDirection" NOT NULL,
    "channelMessageId" TEXT,
    "body" TEXT,
    "attachments" JSONB,
    "sentByUserId" TEXT,
    "sentOutsideSystem" BOOLEAN NOT NULL DEFAULT false,
    "deliveryStatus" "InboxDeliveryStatus",
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "outboundKey" TEXT,
    "sentAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" TEXT,
    "deletedReason" TEXT,
    "orgUnitId" TEXT,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxMessage_channel_channelMessageId_key"
    ON "InboxMessage"("channel", "channelMessageId");
CREATE UNIQUE INDEX "InboxMessage_conversationId_outboundKey_key"
    ON "InboxMessage"("conversationId", "outboundKey");
CREATE INDEX "InboxMessage_conversationId_sentAt_idx"
    ON "InboxMessage"("conversationId", "sentAt");
CREATE INDEX "InboxMessage_deliveryStatus_createdAt_idx"
    ON "InboxMessage"("deliveryStatus", "createdAt");
CREATE INDEX "InboxMessage_orgUnitId_idx" ON "InboxMessage"("orgUnitId");

-- ── Khoá ngoại NỘI BỘ họ bảng ───────────────────────────────────────────────
-- Chỉ trỏ trong nội bộ 3 bảng này. Cố ý KHÔNG có FK ra "Lead"/"User"/"OrgUnit":
-- hộp thư là dữ liệu ĐẾN TỪ NGOÀI, nó không được quyền chặn thao tác dọn dẹp của
-- các bảng lõi. Tính toàn vẹn của `leadId`/`assigneeId`/`orgUnitId` do tầng ứng
-- dụng giữ (`lib/inbox/`), và tra ngược lỏng là chấp nhận được ở đây.
ALTER TABLE "InboxConversation" ADD CONSTRAINT "InboxConversation_identityId_fkey"
    FOREIGN KEY ("identityId") REFERENCES "InboxIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "InboxConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE "InboxIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboxConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboxMessage" ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════════
-- CHẠY THẾ NÀO (người vận hành, KHÔNG phải agent)
--
--   1. DB dev/test (dùng chung):  npx prisma migrate deploy
--   2. PROD: đi qua `deploy.yml` khi merge `test` → `main` (nó chạy
--      `prisma migrate deploy`), hoặc chạy tay với DIRECT_URL của prod.
--
-- SAU MIGRATION còn MỘT việc bắt buộc nữa, không liên quan bảng: quyền mới
-- `inbox:view` / `inbox:reply` / `inbox:assign` chỉ có hiệu lực trên PROD sau khi
-- chạy workflow `seed-prod-roles.yml` (RBAC v2 đọc quyền từ DỮ LIỆU). Không chạy
-- thì người mở `/sale/hop-thu` trên prod bị đá ra, KHÔNG kèm lỗi, và không tái
-- hiện được ở local vì local chạy RBAC v1 tĩnh.
-- Trên dev/test: `pnpm db:seed:roles`.
-- ════════════════════════════════════════════════════════════════════════════
