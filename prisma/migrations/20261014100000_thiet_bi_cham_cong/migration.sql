-- P2.3 — THIẾT BỊ CHẤM CÔNG (11/10/2026). Additive: 1 enum + 1 bảng mới, không đụng bảng cũ.
--
-- Định danh thiết bị = khoá ngẫu nhiên MÁY CHỦ cấp trong cookie httpOnly, lưu BĂM (SHA-256) ở `keyHash`
-- — không dùng fingerprint trình duyệt. Một trình duyệt dùng chung bởi hai người là HAI dòng (khoá kép
-- userId × keyHash). Bảng không mang dữ liệu theo cơ sở (thiết bị thuộc NGƯỜI) ⇒ không centerId/orgUnitId.
-- Chạy lại được (luật [MIG-01]).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffDeviceStatus') THEN
    CREATE TYPE "StaffDeviceStatus" AS ENUM ('PENDING', 'TRUSTED', 'REVOKED', 'LOST');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "StaffDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "platform" TEXT,
    "userAgent" TEXT,
    "status" "StaffDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6),
    "trustedAt" TIMESTAMPTZ(6),
    "trustedById" TEXT,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StaffDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffDevice_userId_keyHash_key" ON "StaffDevice"("userId", "keyHash");
CREATE INDEX IF NOT EXISTS "StaffDevice_userId_status_idx" ON "StaffDevice"("userId", "status");

ALTER TABLE "StaffDevice" ENABLE ROW LEVEL SECURITY;
