-- === CHAT REALTIME (Đợt 2) — US-14: sổ gửi ZNS "có tin nhắn mới" ===
-- Additive thuần: 1 enum + 1 bảng, không đụng bảng cũ.
-- Bảng là CHỐT CHỐNG TRÙNG cho cron `chat-zns-notify` (mỗi tin 400đ, ZNS không thu
-- hồi được): UNIQUE (conversationId, userId, messageId) khiến hai lượt cron chồng
-- nhau va nhau ở DB chứ không gửi đôi. Apply qua `prisma migrate deploy`.
--
-- ⚠️ ENABLE ROW LEVEL SECURITY là BẮT BUỘC với mọi bảng mới trong schema public:
-- migration 20260617000000 chỉ bật RLS cho bảng TỒN TẠI LÚC ĐÓ, bảng sinh sau ra đời
-- với RLS TẮT trong khi Supabase đã cấp sẵn anon/authenticated đủ DML — đúng lỗ đã
-- phải vá ở 20260809130000 / 20260809140000. Chỉ ENABLE (không FORCE): Prisma là
-- owner nên bypass, app không đổi hành vi. KHÔNG tạo policy = deny-all cho anon.

-- CreateEnum
CREATE TYPE "ChatZnsStatus" AS ENUM ('PENDING', 'SENT', 'SIMULATED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "ChatZnsNotification" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "messageKind" "MessageKind" NOT NULL,
    "status" "ChatZnsStatus" NOT NULL DEFAULT 'PENDING',
    "znsLogId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ChatZnsNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatZnsNotification_conversationId_userId_messageId_key"
    ON "ChatZnsNotification"("conversationId", "userId", "messageId");

-- CreateIndex
CREATE INDEX "ChatZnsNotification_conversationId_userId_createdAt_idx"
    ON "ChatZnsNotification"("conversationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatZnsNotification_status_createdAt_idx"
    ON "ChatZnsNotification"("status", "createdAt");

-- RLS (luật E-bis #3)
ALTER TABLE "ChatZnsNotification" ENABLE ROW LEVEL SECURITY;
