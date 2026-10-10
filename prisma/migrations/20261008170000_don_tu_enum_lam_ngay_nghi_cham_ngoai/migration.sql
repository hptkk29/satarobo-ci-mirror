-- ĐƠN TỪ · ĐỢT 9–10 — loại đơn LÀM NGÀY NGHỈ / LỄ và CHẤM CÔNG NGOÀI ĐỊA ĐIỂM (08/10/2026). CHỈ giá trị
-- enum, KHÔNG gì khác: giá trị vừa ADD VALUE chưa dùng được trong cùng giao dịch
-- (khuôn 20260930100000_hoa_don_misa_trang_thai). ADDITIVE, chạy lại được.
ALTER TYPE "WorkRequestKind" ADD VALUE IF NOT EXISTS 'HOLIDAY_WORK';
ALTER TYPE "WorkRequestKind" ADD VALUE IF NOT EXISTS 'OUTSIDE_ATTENDANCE';
