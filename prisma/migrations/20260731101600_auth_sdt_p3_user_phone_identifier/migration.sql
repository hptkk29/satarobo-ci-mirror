-- AUTH-SĐT P3 — User.phone làm khoá đăng nhập (canonical 84XXXXXXXXX) + email
-- nới nullable (giữ unique). ADDITIVE THUẦN, KHÔNG backfill: unique index trên
-- cột toàn NULL không thể fail trên prod; rollback = revert code, dữ liệu email
-- còn nguyên, mọi tài khoản cũ đăng nhập như cũ.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMPTZ(6);

-- @unique → *_key (unique index) · @@index → *_idx (theo naming Prisma).
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE INDEX "User_phone_idx" ON "User"("phone");
