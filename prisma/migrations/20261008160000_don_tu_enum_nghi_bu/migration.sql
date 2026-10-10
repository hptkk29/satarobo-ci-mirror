-- ĐƠN TỪ · ĐỢT 8 — loại đơn NGHỈ BÙ (08/10/2026). CHỈ giá trị enum, KHÔNG gì khác: giá trị vừa
-- ADD VALUE chưa dùng được trong cùng giao dịch (khuôn 20260930100000_hoa_don_misa_trang_thai).
-- ADDITIVE, không đảo ngược được (Postgres không có DROP VALUE). Chạy lại được.
ALTER TYPE "WorkRequestKind" ADD VALUE IF NOT EXISTS 'COMP_LEAVE';
