-- Chính sách hoá đơn (Invoice Hub S7) — BỎ luật «người duyệt phải khác người soạn» ở tầng DB.
--
-- Chủ dự án chốt 02/11/2026 (trong chat): «bỏ phần duyệt bằng người khác giúp tôi, không cần phải phiền phức như vậy».
-- Một kế toán Hội sở có quyền duyệt nay tự duyệt được bản chính sách mình soạn. Phần ứng dụng (`kiemChuyen`, nút Duyệt) bỏ cổng
-- cùng lúc; CHECK cũ `HoaDonChinhSach_maker_checker_check` (migration 20261120090000) sẽ từ chối UPDATE ngay cả khi app đã bỏ cổng,
-- nên phải thả ở đây.
--
-- GIỮ phần còn lại của ý định cũ: một phiên bản đã HIEU_LUC luôn phải ghi NGƯỜI DUYỆT (truy vết «ai áp dụng bản này»). Chỉ bỏ vế
-- «khác người tạo». Không đổi/xoá dữ liệu nào: mọi dòng HIEU_LUC hiện có đã có `nguoiDuyetId` nên CHECK mới thoả sẵn.
-- Idempotent (IF EXISTS) để chạy lại không lỗi. Bảng chưa có ở PROD (Hub chưa lên main) — khi lên main migration này đi cùng đợt.

ALTER TABLE "HoaDonChinhSach" DROP CONSTRAINT IF EXISTS "HoaDonChinhSach_maker_checker_check";
ALTER TABLE "HoaDonChinhSach" DROP CONSTRAINT IF EXISTS "HoaDonChinhSach_nguoi_duyet_check";
ALTER TABLE "HoaDonChinhSach"
    ADD CONSTRAINT "HoaDonChinhSach_nguoi_duyet_check" CHECK ("trangThai" <> 'HIEU_LUC' OR "nguoiDuyetId" IS NOT NULL);
