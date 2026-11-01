-- WEB PUSH ĐỢT 1 — TẦNG DỮ LIỆU. Thông báo đẩy vào điện thoại NHÂN VIÊN.
--
-- HOÀN TOÀN ADDITIVE: hai bảng MỚI, hai enum MỚI. Không đụng bảng đang có dữ liệu,
-- không ALTER, không backfill, không đổi kiểu, không bỏ cột nào.
-- Rollback = ngừng ghi; hai bảng nằm im, không bảng nào khác trỏ tới chúng.
--
-- PHẠM VI ĐÃ CHỐT (chủ dự án 08/09/2026): chỉ nhân viên nội bộ. Phụ huynh KHÔNG nhận
-- Web Push — họ đi ZNS theo chốt 09/08/2026 (lib/chat/zns-notify.ts:20). Vì thế sổ gửi
-- chỉ cần biết đọc StaffNotification; không có cột `source`, không phục vụ trục phụ huynh.
--
-- VÌ SAO HAI BẢNG NÀY KHÔNG CÓ CỘT ĐƠN VỊ (centerId/orgUnitId) — luật Nền Hệ thống #3:
-- dữ liệu THEO NGƯỜI, không theo đơn vị. Một cái điện thoại thuộc về một nhân viên, không
-- thuộc về cơ sở nào; cơ sở suy từ User tại thời điểm gửi. Cùng tiền lệ StaffNotification,
-- ChatZnsNotification, AttendanceTicket, và cùng lý do đã ghi thành văn tại
-- docs/notification/00-ke-hoach-notification.md:48. Thêm cột đơn vị vào đây là nhận nghĩa
-- vụ mà không có cơ chế nào ghi nó: scopedDb chỉ chèn theo centerId, và lib/org/dual-write.ts
-- chỉ kích hoạt khi khối data CÓ centerId.
--
-- VÌ SAO KHÔNG DÙNG DomainEvent LÀM HÀNG ĐỢI GỬI: nó không có mốc lùi lịch (dispatcher quét
-- PENDING theo createdAt, không điều kiện thời gian; cron mỗi phút; maxAttempts 5 ⇒ nhịp cố
-- định 60s, chết sau ~5 phút, không ghi được Retry-After của 429), và nó chỉ có MỘT cặp
-- status/attempts cho cả sự kiện nên không biểu diễn được ca "3 máy, 1 nhận / 1 Gone / 1 bị
-- bóp" — retry sẽ bắn lại vào máy đã nhận. DomainEvent vẫn là bus sự kiện miền duy nhất;
-- bảng dưới đây là SỔ GỬI của một kênh, cùng vai EmailQueue và ChatZnsNotification.

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WebPushSubscriptionStatus') THEN
    CREATE TYPE "WebPushSubscriptionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WebPushOutboxStatus') THEN
    CREATE TYPE "WebPushOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD', 'SKIPPED');
  END IF;
END $$;

-- ─── Thiết bị đã bật thông báo ───────────────────────────────────────────────
--
-- `endpoint` UNIQUE là khoá tự nhiên: trình duyệt cấp lại ĐÚNG chuỗi cũ khi cùng máy +
-- cùng khoá VAPID, nên đường ghi là UPSERT theo cột này. Vì thế bảng CỐ Ý không có
-- `deletedAt`: soft-delete cộng unique toàn cục là mâu thuẫn không vá được ở tầng code —
-- người dùng bật lại thông báo trên đúng máy cũ sẽ vỡ P2002 và không có cách tự khỏi.
-- Trạng thái tường minh (status + revokedAt) thay cho soft-delete, đúng nếp MediaAsset.PURGED.
--
-- Cố ý KHÔNG có FK tới User: 10/10 model mới nhất của repo dùng userId phẳng + index, và
-- khai relation buộc phải sửa model User (ngoài phạm vi đợt này).
CREATE TABLE IF NOT EXISTS "WebPushSubscription" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "endpoint"      TEXT NOT NULL,
  "p256dh"        TEXT NOT NULL,
  "auth"          TEXT NOT NULL,
  "origin"        TEXT NOT NULL,
  "vapidKeyId"    TEXT NOT NULL DEFAULT 'v1',
  "userAgent"     TEXT,
  "deviceLabel"   TEXT,
  -- Chế độ hiển thị lúc đăng ký (standalone / browser). Cột ĐO ĐƯỢC điều kiện mà toàn bộ lý lẽ
  -- phạm vi đứng lên: iOS Safari chỉ giao push khi trang đã "Thêm vào màn hình chính". Thiếu nó
  -- thì ca "nhân viên iPhone không nhận gì" không phân biệt được với "push service bóp".
  "displayMode"   TEXT,
  "status"        "WebPushSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt"     TIMESTAMPTZ(6),
  "revokedReason" TEXT,
  "failureCount"  INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" INTEGER,
  "lastSuccessAt" TIMESTAMPTZ(6),
  "lastFailureAt" TIMESTAMPTZ(6),
  "lastSeenAt"    TIMESTAMPTZ(6),
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebPushSubscription_endpoint_key"
  ON "WebPushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "WebPushSubscription_userId_status_idx"
  ON "WebPushSubscription"("userId", "status");
CREATE INDEX IF NOT EXISTS "WebPushSubscription_status_lastFailureAt_idx"
  ON "WebPushSubscription"("status", "lastFailureAt");

-- ─── Sổ gửi ──────────────────────────────────────────────────────────────────
--
-- Một dòng = một thông báo cần đẩy tới một NGƯỜI. Nội dung KHÔNG nằm ở đây: lúc gửi mới
-- đọc StaffNotification theo (userId, dedupeKey) — cặp cột này khớp đúng khoá
-- StaffNotification_userId_dedupeKey_key. Nhờ vậy lib/notifications/notify.ts giữ nguyên
-- vai "đường ghi DUY NHẤT", số điện thoại đã bị cheSdt() che không bị chép sang bảng thứ
-- hai, và thông báo đã thu hồi thì tự động không còn gì để gửi.
--
-- `resultJson` giữ kết quả theo TỪNG endpoint để lượt thử lại chỉ gửi cho máy chưa nhận —
-- đây là thứ DomainEvent không biểu diễn được. `claimedAt` để reaper đo theo mốc GIÀNH CHỖ
-- chứ không theo createdAt (lib/events/dispatcher.ts đang đo nhầm đúng chỗ đó; kế thừa lỗi
-- ấy vào push nghĩa là gửi trùng mỗi khi hàng đợi tồn đọng).
CREATE TABLE IF NOT EXISTS "WebPushOutbox" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "dedupeKey"     TEXT NOT NULL,
  "status"        "WebPushOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "maxAttempts"   INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt"     TIMESTAMPTZ(6),
  "expiresAt"     TIMESTAMPTZ(6),
  "resultJson"    JSONB,
  "lastError"     TEXT,
  "lastErrorCode" INTEGER,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(6) NOT NULL,
  "sentAt"        TIMESTAMPTZ(6),
  CONSTRAINT "WebPushOutbox_pkey" PRIMARY KEY ("id")
);

-- Chống trùng ở tầng DB: hai lượt cron chồng nhau va nhau ở đây chứ không gửi đôi. Cái giá
-- của gửi đôi không phải tiền — là người dùng tắt quyền thông báo ở cấp trình duyệt, mất
-- kênh vĩnh viễn, code không lấy lại được.
CREATE UNIQUE INDEX IF NOT EXISTS "WebPushOutbox_userId_dedupeKey_key"
  ON "WebPushOutbox"("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "WebPushOutbox_status_nextAttemptAt_idx"
  ON "WebPushOutbox"("status", "nextAttemptAt");
-- Vòng DỌN. Cố ý theo "createdAt" chứ KHÔNG theo "sentAt": mọi thông báo ngoài allowlist ghi một
-- dòng SKIPPED, mà SKIPPED/DEAD luôn có "sentAt" NULL — với allowlist đợt đầu đúng một tiền tố,
-- gần như cả bảng sẽ là SKIPPED, và câu dọn tự nhiên sẽ không có index nào dẫn.
CREATE INDEX IF NOT EXISTS "WebPushOutbox_status_createdAt_idx"
  ON "WebPushOutbox"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WebPushOutbox_userId_createdAt_idx"
  ON "WebPushOutbox"("userId", "createdAt" DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- BẮT BUỘC, và đây là bảng nguy hiểm nhất trong số các bảng gần đây lỡ quên dòng này.
-- Migration 20260617 bật RLS hàng loạt chỉ chạy MỘT LẦN; mọi bảng sinh sau nó ra đời với
-- RLS TẮT, mà vai anon/authenticated của Supabase có sẵn đủ DML (sự cố 09/08/2026). Riêng
-- WebPushSubscription lưu endpoint + p256dh + auth — tức đủ nguyên liệu để bất kỳ ai đọc
-- được bảng qua PostgREST tự gửi push GIẢ MẠO vào điện thoại nhân viên, hoặc xoá sạch đăng
-- ký để giết kênh.
--
-- Chỉ ENABLE, KHÔNG FORCE, KHÔNG tạo policy: Prisma kết nối bằng chủ bảng nên bypass RLS,
-- app không đổi hành vi; không policy = deny-all cho anon/authenticated, đúng thứ cần.
ALTER TABLE "WebPushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebPushOutbox" ENABLE ROW LEVEL SECURITY;
