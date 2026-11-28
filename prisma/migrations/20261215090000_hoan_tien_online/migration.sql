-- V8.40 — HOÀN TIỀN ONLINE (PAY-06). CHỈ THÊM cột trên `RefundRequest` (mặc định giữ nguyên hành vi Offline) + 1 CHECK + 1 chỉ mục từng phần. Không đổi/xoá cột, không backfill (mọi dòng cũ = 'OFFLINE').
-- CHẠY LẠI ĐƯỢC (luật [MIG-01]). Không phụ thuộc migration V8.29 (20261211). ADD COLUMN có DEFAULT hằng số ⇒ không ghi lại bảng.

ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "kenh" TEXT NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "kenhYeuCau" TEXT;
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "lyDoTuChoi" TEXT;
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "maGiaoDichHoan" TEXT;
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "quyenDaThuHoiLuc" TIMESTAMPTZ(6);
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "canXuLyQuyen" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_kenh_check" CHECK ("kenh" IN ('OFFLINE', 'ONLINE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_kenhYeuCau_check" CHECK ("kenhYeuCau" IS NULL OR "kenhYeuCau" IN ('PARENT', 'STAFF'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ONLINE bắt buộc gắn dòng đơn (tiền Online nằm ở mức đơn; không có ghi danh).
DO $$ BEGIN
  ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_online_co_dong_check" CHECK ("kenh" <> 'ONLINE' OR "orderItemId" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Chỉ mục TỪNG PHẦN (Prisma không biểu diễn được WHERE): mỗi dòng đơn ONLINE tối đa MỘT yêu cầu đang mở.
CREATE UNIQUE INDEX IF NOT EXISTS "RefundRequest_online_open_key" ON "RefundRequest"("orderItemId") WHERE "kenh" = 'ONLINE' AND "status" IN ('PENDING', 'APPROVED');
