-- ĐƠN TỪ · ĐỢT 11 — HUỶ ĐƠN ĐÃ DUYỆT (08/10/2026): hai trạng thái mới. CHỈ giá trị enum (ADD VALUE chưa
-- dùng được trong cùng giao dịch — khuôn 20260930100000_hoa_don_misa_trang_thai). ADDITIVE, chạy lại được.
--   CANCEL_REQUESTED — người nộp xin huỷ đơn ĐÃ DUYỆT; đơn VẪN còn hiệu lực cho tới khi quản lý duyệt huỷ.
--   CANCELLED        — quản lý duyệt huỷ; hệ quả đã hoàn tác trong cùng giao dịch.
ALTER TYPE "WorkRequestStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';
ALTER TYPE "WorkRequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
