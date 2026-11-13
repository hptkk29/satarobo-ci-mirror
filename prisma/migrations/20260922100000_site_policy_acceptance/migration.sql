-- === HỒ SƠ BỘ CÔNG THƯƠNG (mục 4) — SỔ ĐỒNG Ý CHÍNH SÁCH WEBSITE của phụ huynh ===
--
-- Additive thuần (luật cứng #4): MỘT bảng mới, không đụng bảng nào đang có dữ liệu PROD,
-- không đụng enum nào. Rollback = ngừng ghi + xoá layout cổng; bảng nằm im.
--
-- Đây là SỔ BẰNG CHỨNG, không phải cờ trạng thái: append-only, không UPDATE, không DELETE.
-- Mỗi dòng trả lời "người này, lúc nào, đồng ý với BẢN NÀO".
--
-- Vì sao BẢNG RIÊNG chứ không thêm cột vào "User": một dòng/người thì nâng version là GHI
-- ĐÈ mốc đồng ý bản cũ — xoá đúng thứ hồ sơ cần.
-- Vì sao KHÔNG tái dùng "StudentConsent": bảng đó khoá theo studentId (sai chủ thể — một
-- phụ huynh nhiều con sẽ phải tích nhiều lần), enum ConsentType chỉ có CLASS_MEDIA, và
-- không có cột version.
-- Vì sao KHÔNG khoá ngoại tới "User": FK kèm ON DELETE CASCADE (kiểu UserPermissionGrant)
-- sẽ XOÁ BẰNG CHỨNG khi xoá tài khoản. userId luôn đến từ auth() nên không cần DB validate.
--
-- Đây là bản sao CÓ CHỦ ĐÍCH của "ChatPolicyAcceptance" (20260810100000) — cùng bài toán,
-- cùng hình dạng, cùng kiểu cột. Giữ TIMESTAMP(3) đúng như bảng đó để khớp `schema.prisma`
-- và không góp thêm vào lượng drift đang khoá `prisma migrate dev`.
--
-- UNIQUE (userId, policyKey, version) làm HAI việc: chống ghi đôi khi bấm 2 lần / 2 tab,
-- và là chỉ mục cho câu đọc nóng nhất ("người này đã đồng ý bản hiện hành chưa").
--
-- ⚠️ ENABLE ROW LEVEL SECURITY là BẮT BUỘC với mọi bảng mới trong schema public:
-- migration 20260617000000 chỉ bật RLS cho bảng TỒN TẠI LÚC ĐÓ; bảng sinh sau ra đời với
-- RLS TẮT trong khi Supabase đã cấp sẵn anon/authenticated đủ DML. Chỉ ENABLE (không
-- FORCE): Prisma là owner nên bypass, app không đổi hành vi; không tạo policy = deny-all.

-- CreateTable
CREATE TABLE "SitePolicyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "SitePolicyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SitePolicyAcceptance_userId_policyKey_version_key"
    ON "SitePolicyAcceptance"("userId", "policyKey", "version");

-- CreateIndex — báo cáo "bao nhiêu phụ huynh đã đồng ý bản đang phát hành".
CREATE INDEX "SitePolicyAcceptance_policyKey_version_acceptedAt_idx"
    ON "SitePolicyAcceptance"("policyKey", "version", "acceptedAt");

-- RLS (luật E-bis #3)
ALTER TABLE "SitePolicyAcceptance" ENABLE ROW LEVEL SECURITY;
