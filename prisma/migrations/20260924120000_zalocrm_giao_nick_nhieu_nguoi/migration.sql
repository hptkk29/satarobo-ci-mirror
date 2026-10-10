-- Giao nick Zalo cho NHIỀU người, mỗi người một mức quyền (chủ dự án chốt 24/09/2026).
--
-- TRƯỚC: `ZaloCrmNick.sataUserId` — MỘT người, không mức quyền, và Sata đẩy sang ZaloCRM
-- với `permission` đóng cứng là 'chat'.
-- NAY: bảng nối (nick × người × mức), khớp đúng mô hình mà ZaloCRM vốn đã có —
-- `zalo_account_access.permission` nhận 'read' (xem tin) / 'chat' (gửi tin) /
-- 'admin' (quản lý nick).
--
-- ⚠️ KHÔNG DROP `ZaloCrmNick.sataUserId` ở đợt này. Luật 2 pha của repo: thêm trước,
-- bỏ sau khi đã chạy ổn — và cột đó vẫn đang được `dongBoNick` GHI (suy chủ nick từ
-- ZaloCRM). Bước lùi của đợt này là thôi đọc bảng mới, không phải khôi phục một cột.
--
-- Mức quyền để là TEXT + CHECK chứ không phải enum Postgres: thêm mức thứ tư sau này
-- chỉ là sửa CHECK, không phải `ALTER TYPE` trên bảng có dữ liệu prod (luật cứng #4).
CREATE TABLE IF NOT EXISTS "ZaloCrmNickGiao" (
  "id"          TEXT NOT NULL,
  "nickId"      TEXT NOT NULL,
  "sataUserId"  TEXT NOT NULL,
  "mucQuyen"    TEXT NOT NULL DEFAULT 'chat',
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ZaloCrmNickGiao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ZaloCrmNickGiao_mucQuyen_check" CHECK ("mucQuyen" IN ('read', 'chat', 'admin'))
);

-- Một người chỉ có MỘT dòng trên một nick. Thiếu khoá này thì hai lượt bấm nhanh sinh
-- hai dòng cùng người khác mức, và lượt đối soát gửi đi mức nào là tuỳ thứ tự trả về.
CREATE UNIQUE INDEX IF NOT EXISTS "ZaloCrmNickGiao_nickId_sataUserId_key"
  ON "ZaloCrmNickGiao"("nickId", "sataUserId");
CREATE INDEX IF NOT EXISTS "ZaloCrmNickGiao_nickId_idx" ON "ZaloCrmNickGiao"("nickId");
CREATE INDEX IF NOT EXISTS "ZaloCrmNickGiao_sataUserId_idx" ON "ZaloCrmNickGiao"("sataUserId");

-- Xoá nick ⇒ xoá dòng giao. KHÔNG dùng RESTRICT: dòng giao là dữ liệu phái sinh, giữ
-- nó lại chỉ chặn việc dọn nick mà chẳng cứu được gì.
ALTER TABLE "ZaloCrmNickGiao"
  ADD CONSTRAINT "ZaloCrmNickGiao_nickId_fkey"
  FOREIGN KEY ("nickId") REFERENCES "ZaloCrmNick"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Xoá người ⇒ xoá dòng giao. Người nghỉ việc thì quyền phải biến mất cùng, không để
-- lại một dòng trỏ vào khoảng không rồi lượt đối soát gửi đi một id không còn ai.
ALTER TABLE "ZaloCrmNickGiao"
  ADD CONSTRAINT "ZaloCrmNickGiao_sataUserId_fkey"
  FOREIGN KEY ("sataUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chuyển dữ liệu đang có: mỗi `sataUserId` cũ thành một dòng giao mức 'chat' — đúng mức
-- mà Sata vẫn đẩy sang ZaloCRM từ trước, nên hành vi KHÔNG đổi ở lượt đối soát kế tiếp.
INSERT INTO "ZaloCrmNickGiao" ("id", "nickId", "sataUserId", "mucQuyen")
SELECT gen_random_uuid()::text, n."id", n."sataUserId", 'chat'
  FROM "ZaloCrmNick" n
 WHERE n."sataUserId" IS NOT NULL
   AND n."deletedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = n."sataUserId")
ON CONFLICT ("nickId", "sataUserId") DO NOTHING;

-- RLS: bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT LẦN,
-- và 31 bảng sinh sau nó đã từng nằm trần cho anon/authenticated — sự cố 09/08).
ALTER TABLE "ZaloCrmNickGiao" ENABLE ROW LEVEL SECURITY;
