-- 20/10/2026 — HỌC BÙ: CASE DO SALE TẠO Ở TRẠNG THÁI "CHỜ DUYỆT", QUẢN LÝ CƠ SỞ DUYỆT THÌ MỚI THÀNH LỊCH THẬT. CHỈ THÊM.
--
-- Chủ dự án chốt 20/10/2026: "màn tổng quan các case bù được sale tạo ở trạng thái chờ duyệt, qlcs duyệt thì mới thành lịch thật,
-- giáo viên mới thấy".
--
-- ── ĐÂY LÀ CÁI GÌ, VÀ KHÔNG PHẢI CÁI GÌ ─────────────────────────────────────────────────────────────
--   1. giá trị `PENDING_APPROVAL` cho enum `MakeupCaseStatus`. File này KHÔNG dùng giá trị mới (`ALTER TYPE … ADD VALUE` không dùng được trong
--      cùng transaction): không DEFAULT, không CHECK, không INSERT. Cột `status` vẫn mặc định `SCHEDULED`.
--   2. ba cột NULLABLE trên "MakeupCase": `approvedById` + `approvedAt` (ai duyệt, lúc nào) và `rejectReason` (lý do từ chối / rút lại).
--      Không backfill, không UPDATE/DELETE dòng nào: mọi case đang có giữ nguyên trạng thái và cột mới là NULL.
-- Chạy lại được (IF NOT EXISTS). Chạy tay trên prod theo luật Nền #4 — KHÔNG trong task này.

ALTER TYPE "MakeupCaseStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';

ALTER TABLE "MakeupCase" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "MakeupCase" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMPTZ(6);
ALTER TABLE "MakeupCase" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;
