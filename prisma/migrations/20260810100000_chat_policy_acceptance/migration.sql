-- === CHAT REALTIME (Đợt 2) — US-16: mốc đồng ý chính sách sử dụng chat ===
-- Additive thuần: 1 bảng, không đụng bảng cũ, không đụng enum cũ.
-- Bảng này là CỔNG CHẶN Ở SERVER cho `/portal/tin-nhan/**`: không có dòng nào ở
-- version đang phát hành ⇒ server không trả nội dung hội thoại (lib/chat/policy.ts).
-- UNIQUE (userId, version) vừa chống ghi đôi (bấm 2 lần / 2 tab) vừa là chỉ mục tra
-- "người này đã đồng ý bản hiện hành chưa" — đường đọc nóng nhất của module.
--
-- ⚠️ ENABLE ROW LEVEL SECURITY là BẮT BUỘC với mọi bảng mới trong schema public:
-- migration 20260617000000 chỉ bật RLS cho bảng TỒN TẠI LÚC ĐÓ; bảng sinh sau ra đời
-- với RLS TẮT trong khi Supabase đã cấp sẵn anon/authenticated đủ DML (lỗ đã phải vá ở
-- 20260809130000 / 20260809140000). Chỉ ENABLE (không FORCE): Prisma là owner nên
-- bypass, app không đổi hành vi; không tạo policy = deny-all cho anon/authenticated.

-- CreateTable
CREATE TABLE "ChatPolicyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatPolicyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatPolicyAcceptance_userId_version_key"
    ON "ChatPolicyAcceptance"("userId", "version");

-- CreateIndex
CREATE INDEX "ChatPolicyAcceptance_version_acceptedAt_idx"
    ON "ChatPolicyAcceptance"("version", "acceptedAt");

-- RLS (luật E-bis #3)
ALTER TABLE "ChatPolicyAcceptance" ENABLE ROW LEVEL SECURITY;
