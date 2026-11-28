-- V8.31 (A) — DISC: phiên MỞ KHOÁ ở máy chủ (PIN thật sự bảo vệ dữ liệu). CỘNG THÊM, forward-only, RIÊNG (KHÔNG gộp với `20261211090000_domain_event_thue_xu_ly`).
--   · DiscGiaDinh: +3 cột (pinPhienBan mặc định 0, matKhauSai mặc định 0, matKhauKhoaDen NULL) — hàng cũ nhận mặc định, không backfill.
--   · Bảng mới DiscUnlockSession (+ RLS bật, không policy — như mọi bảng mới của repo). Không lưu PIN/mật khẩu; tokenHash là sha256 của token web.
-- THỨ TỰ: migration TRƯỚC, mã SAU (client Prisma mới trên schema cũ làm hỏng các truy vấn DiscGiaDinh). Cờ DISC_PIN_ENFORCE_ENABLED mặc định TẮT ⇒ mã mới không chạm bảng mới khi tắt.
-- HOÀN TÁC (chỉ khi chắc chắn; mã cũ chạy tốt khi cột/bảng còn nguyên): DROP TABLE "DiscUnlockSession"; ALTER TABLE "DiscGiaDinh" DROP COLUMN "matKhauKhoaDen", DROP COLUMN "matKhauSai", DROP COLUMN "pinPhienBan";
ALTER TABLE "DiscGiaDinh" ADD COLUMN IF NOT EXISTS "pinPhienBan" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "matKhauSai" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "matKhauKhoaDen" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "DiscUnlockSession" (
    "id" TEXT NOT NULL,
    "giaDinhId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kenh" TEXT NOT NULL,
    "phienDangNhapId" TEXT,
    "tokenHash" TEXT,
    "scopes" TEXT[],
    "thanhVienGioiHan" TEXT,
    "phienBanPin" INTEGER NOT NULL,
    "tokenVersionLucMo" INTEGER NOT NULL,
    "xacMinhBang" TEXT NOT NULL,
    "taoLuc" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "xacMinhLuc" TIMESTAMPTZ(6) NOT NULL,
    "hoatDongLuc" TIMESTAMPTZ(6) NOT NULL,
    "hetHanTuyetDoi" TIMESTAMPTZ(6) NOT NULL,
    "thuHoiLuc" TIMESTAMPTZ(6),
    "lyDoThuHoi" TEXT,

    CONSTRAINT "DiscUnlockSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiscUnlockSession_tokenHash_key" ON "DiscUnlockSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "DiscUnlockSession_giaDinhId_thuHoiLuc_idx" ON "DiscUnlockSession"("giaDinhId", "thuHoiLuc");
CREATE INDEX IF NOT EXISTS "DiscUnlockSession_userId_idx" ON "DiscUnlockSession"("userId");
CREATE INDEX IF NOT EXISTS "DiscUnlockSession_phienDangNhapId_idx" ON "DiscUnlockSession"("phienDangNhapId");

DO $$ BEGIN
  ALTER TABLE "DiscUnlockSession" ADD CONSTRAINT "DiscUnlockSession_giaDinhId_fkey" FOREIGN KEY ("giaDinhId") REFERENCES "DiscGiaDinh"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "DiscUnlockSession" ENABLE ROW LEVEL SECURITY;
