-- HOÁ ĐƠN ĐIỆN TỬ · BƯỚC 1 "PHÁT HÀNH QUA MISA" (30/09/2026, docs/ke-toan-hoa-don/PLAN.md mục "Bước 1").
--
-- CHỈ hai giá trị enum. KHÔNG có gì khác trong file này.
--
-- VÌ SAO ĐỨNG RIÊNG MỘT MIGRATION: Postgres (12+) cho `ALTER TYPE ... ADD VALUE` chạy trong transaction,
-- NHƯNG giá trị vừa thêm KHÔNG dùng được cho tới khi transaction đó commit. Prisma chạy mỗi tệp
-- migration trong MỘT transaction ⇒ migration kế (20260930100100) — dựng lại chỉ mục từng phần NHẮC
-- 'DANG_PHAT_HANH' — phải nằm ở tệp riêng, chạy SAU (thứ tự thư mục đã đúng). Khuôn:
-- 20260906090000_zalocrm_enum_kenh_ca_nhan.
--
-- IF NOT EXISTS: chạy lại phải no-op. ADD VALUE là THÊM thuần, không viết lại bảng, KHÔNG đảo ngược
-- được (Postgres không có DROP VALUE).
--
--   DANG_PHAT_HANH — hệ thống đã tạo bản ghi + khoá khoản, đang/đã gửi MISA, chưa hoàn tất
--                    (chưa có số, hoặc có số mà chưa tải đủ tệp). Mọi lỗi KHÔNG CHẮC CHẮN giữ ở đây.
--   LOI_PHAT_HANH  — MISA từ chối CHẮC CHẮN (lỗi dữ liệu) ⇒ chưa có hoá đơn nào; khoản vẫn bị giữ
--                    tới khi kế toán "Phát hành lại" hoặc "Bỏ, làm tay".
ALTER TYPE "HoaDonTrangThai" ADD VALUE IF NOT EXISTS 'DANG_PHAT_HANH';
ALTER TYPE "HoaDonTrangThai" ADD VALUE IF NOT EXISTS 'LOI_PHAT_HANH';
