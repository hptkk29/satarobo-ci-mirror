-- C-06 — đánh dấu RỚT: trạng thái theo TỪNG CON, lý do ở cấp PHỤ HUYNH.
--
-- Migration ADD-ONLY (luật cứng #4): một enum MỚI + ba cột NULLABLE mới. Không đổi
-- kiểu, không bỏ, không đặt NOT NULL trên bảng đang có dữ liệu prod.
--
-- Vì sao "LeadChild"."status" KHÔNG có DEFAULT 'NEW': đặt default là ghi đè một khẳng
-- định lên toàn bộ dòng cũ ("mọi đứa trẻ đang có đều ở bước Mới"), trong khi phần lớn
-- chúng đã ghi danh hoặc đã nghỉ từ lâu. NULL = "chưa ai phân loại" — đọc ra là biết
-- mình không biết, thay vì đọc ra một con số sai mà không ai ngờ.
--
-- Tầng của lý do rớt là quyết định B5 (24/08/2026): TRẠNG THÁI rớt theo từng con,
-- LÝ DO rớt (ô ghi chú tự do — quyết định 12(b), không danh mục) ở cấp phụ huynh.

-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ SỬA 21/09/2026 — LÀM TỆP NÀY IDEMPOTENT. ĐỌC TRƯỚC KHI ĐỔI LẠI.
--
-- Tệp này ĐÃ apply trên `test`/`dev` (25/08) nhưng CHƯA apply trên PROD, và khi lượt
-- gộp `test` → `main` chạy thì nó sẽ nổ:
--
--     Error P3018 · 42701
--     column "lostNote" of relation "Lead" already exists
--
-- VÌ SAO: `Lead.lostNote` và `Lead.lostAt` được thêm bởi HAI migration —
--   · tệp này                          (25/08, CHỈ có trên `test`)
--   · `20260827080000_lead_lost_note`  (27/08, có trên CẢ HAI nhánh)
--
-- Trên `test` tệp này chạy TRƯỚC, nên cái 27/08 (vốn đã dùng `IF NOT EXISTS`) no-op.
-- Trên PROD cái 27/08 đã chạy từ lâu, nên tệp này — dấu thời gian SỚM HƠN nên vẫn
-- nằm trong hàng chờ — đâm vào một cột đã tồn tại.
--
-- Đây KHÔNG phải ca riêng lẻ: 18/19 migration của lượt gộp này mang dấu thời gian
-- sớm hơn migration cuối của `main`, tức thứ tự áp dụng trên prod KHÁC trên test.
-- Đã quét cả 19 (tĩnh + chạy lại trên DB mô phỏng prod): chỉ HAI câu lệnh này va chạm.
--
-- ⚠️ Sửa một migration ĐÃ apply là ngoại lệ của luật `.claude/rules/prisma-db.md`, và
-- nó được chấp nhận vì ĐO ĐƯỢC hai điều:
--   1. `migrate deploy` KHÔNG kiểm checksum của migration đã apply — dựng DB có tệp
--      bản cũ rồi sửa tệp, chạy lại: "No pending migrations to apply", không lỗi;
--   2. cách còn lại (`migrate resolve --applied` trên prod + một migration bù cho
--      enum và cột) có nhiều mảnh hơn, và mỗi mảnh là một chỗ sai được.
--
-- CHỈ hai thay đổi: `ADD COLUMN` → `IF NOT EXISTS`, `CREATE TYPE` → bọc `DO$$`.
-- Không đụng gì khác trong tệp.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
-- `CREATE TYPE` KHÔNG có `IF NOT EXISTS` trong Postgres, nên guard duy nhất là bắt
-- `duplicate_object`. (Trên prod enum này CHƯA có — quét đã xác nhận — nhưng để trần
-- thì lần chạy lại nào cũng là một lần nổ tiềm tàng.)
DO $$
BEGIN
  CREATE TYPE "LeadChildStatus" AS ENUM ('NEW', 'CONSULTING', 'TRIAL_SCHEDULED', 'TRIAL_ATTENDED', 'ENROLLED', 'LOST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "LeadChild" ADD COLUMN IF NOT EXISTS "status" "LeadChildStatus";

-- AlterTable
-- HAI CỘT NÀY LÀ CHỖ NỔ. `IF NOT EXISTS` cho cả hai — cùng khuôn mà
-- `20260827080000_lead_lost_note` đã dùng.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lostNote" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lostAt" TIMESTAMPTZ(6);
