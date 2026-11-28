-- V8.1 (20/11/2026) — SỔ TOKEN PUSH của app di động + TUỲ CHỌN thông báo theo danh mục. CỘNG THÊM (2 bảng mới), idempotent, không đụng dữ liệu hiện có.
-- ⚠️ CHỈ là sổ đăng ký: KHÔNG có nhà cung cấp FCM/APNs nào được nối ⇒ không có dòng nào nghĩa là «đã gửi push».
-- Token gắn với PHIÊN (MobileSession): phiên bị thu hồi (đăng xuất · đổi mật khẩu · hết hạn) ⇒ token bị thu hồi cùng (xem `thuHoi` ở lib/mobile-api/xac-thuc/dich-vu.ts).

CREATE TABLE IF NOT EXISTS "MobilePushToken" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "mobileSessionId" TEXT NOT NULL,
  "nenTang"         TEXT NOT NULL,
  "nhaCungCap"      TEXT NOT NULL,
  "token"           TEXT NOT NULL,
  "phienBanApp"     TEXT,
  "lanDangKyCuoi"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "thuHoiLuc"       TIMESTAMPTZ(6),
  "lyDoThuHoi"      TEXT,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MobilePushToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MobilePushToken_token_key" ON "MobilePushToken"("token");
CREATE INDEX IF NOT EXISTS "MobilePushToken_userId_idx" ON "MobilePushToken"("userId");
CREATE INDEX IF NOT EXISTS "MobilePushToken_mobileSessionId_idx" ON "MobilePushToken"("mobileSessionId");
DO $$ BEGIN
  ALTER TABLE "MobilePushToken" ADD CONSTRAINT "MobilePushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MobilePushToken" ADD CONSTRAINT "MobilePushToken_mobileSessionId_fkey" FOREIGN KEY ("mobileSessionId") REFERENCES "MobileSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "MobilePushToken" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "MobileNotificationPref" (
  "userId"    TEXT NOT NULL,
  "danhMuc"   TEXT NOT NULL,
  "bat"       BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MobileNotificationPref_pkey" PRIMARY KEY ("userId", "danhMuc")
);
DO $$ BEGIN
  ALTER TABLE "MobileNotificationPref" ADD CONSTRAINT "MobileNotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "MobileNotificationPref" ENABLE ROW LEVEL SECURITY;
