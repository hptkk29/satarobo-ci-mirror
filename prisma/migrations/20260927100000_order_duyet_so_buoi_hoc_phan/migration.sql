-- 25/09/2026 — DUYỆT SỐ BUỔI (mốc học phần).
--
-- Chủ dự án: *"khi sale tạo đơn, nếu buổi học khác 12 24 36 48 tức 1 học phần, 2 học
-- phần, 3 học phần, 4 học phần thì phải qua quản lý duyệt"*; thu hẹp ngay sau đó: *"ở
-- prod có các khoá sata 3,4,5,6,7 có 48 buổi thì mới áp luật này, còn các khoá khác thì
-- không"*. Luật ở `lib/orders/so-buoi-hoc-phan.ts`.
--
-- CHỈ THÊM CỘT (additive), KHÔNG đụng dữ liệu đang có:
--   · mọi đơn cũ giữ `soBuoiApprovalStatus = NULL` = "không có gì phải duyệt", đúng
--     nghĩa mà hai cột duyệt có sẵn đang dùng cho NULL;
--   · không backfill, không ALTER cột nào — luật cứng #4 (không tự ý sinh migration
--     đổi/bỏ cột trên bảng có dữ liệu PROD).
--
-- Bốn cột phụ đi theo ĐÚNG khuôn của hai nhóm duyệt có sẵn (`discount*`/`installment*`):
-- `*RequestedById` / `*ApprovedById` là TEXT thường, KHÔNG có khoá ngoại — hai nhóm kia
-- cũng vậy, và lệch khuôn ở đây chỉ đẻ ra một ngoại lệ phải nhớ.
--
-- ⚠️ KHÔNG `ENABLE ROW LEVEL SECURITY`: luật ấy dành cho BẢNG MỚI. `Order` đã tồn tại và
-- trạng thái RLS của nó không phải việc của migration này.

-- ⚠️ IDEMPOTENT CÓ CHỦ ĐÍCH — không phải thói quen thừa.
--
-- Migration này PHẢI CHẠY TAY trên prod (luật cứng #4), tức nó chạy dưới tay người, có
-- thể bị ngắt giữa chừng, và có thể bị chạy lại. Một lượt chạy lại mà chết ở dòng đầu để
-- lại `_prisma_migrations` mang dòng FAILED, và từ đó **mọi** `migrate deploy` sau đó bị
-- Prisma chặn bằng `P3009` — kể cả migration chẳng liên quan gì.
--
-- Đã xảy ra thật ngày 28/09/2026 trên `satarobo_test`: thư mục migration được đổi tên
-- (`20260925100000` → `20260927100000`) cho đúng thứ tự so với `origin/test`, nên bản tên
-- MỚI chạy lại trên một DB đã có sẵn enum + 5 cột ⇒ chết ⇒ R7 không khởi động được vì
-- `global-setup` gọi `migrate deploy`. Sự cố ở DB test thì rẻ; đúng kịch bản ấy trên prod
-- thì khoá toàn bộ đường migrate cho tới khi có người vào gỡ tay.
--
-- `CREATE TYPE` KHÔNG có `IF NOT EXISTS` trong Postgres ⇒ phải bọc `DO $$ … $$`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SoBuoiApprovalStatus') THEN
    CREATE TYPE "SoBuoiApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');
  END IF;
END
$$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "soBuoiApprovalStatus" "SoBuoiApprovalStatus",
  ADD COLUMN IF NOT EXISTS "soBuoiRequestedById"  TEXT,
  ADD COLUMN IF NOT EXISTS "soBuoiApprovedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "soBuoiApprovedAt"     TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "soBuoiRejectReason"   TEXT;
