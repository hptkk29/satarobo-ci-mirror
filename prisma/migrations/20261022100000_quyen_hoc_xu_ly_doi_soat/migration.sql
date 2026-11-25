-- "Thu học phí theo phạm vi học" — PR hàng đợi quyền học + cron đối soát `quyen-hoc-doi-soat`. CHỈ THÊM HAI GIÁ TRỊ ENUM.
--
--   THIEU_QUYEN_HOC — tiền xác nhận đã ĐỦ cho dòng đơn SCOPE, đã biết học viên, mà dòng CHƯA có quyền học và không có dòng chờ nào:
--                     lượt cấp quyền khi tiền về đã bị lỡ (hích lỗi / sự kiện mất). Ghi bởi `cap-tu-don.ts` ở chế độ CHI_GHI_NHAN (cron).
--   LECH_DU_LIEU    — dữ liệu payment / đơn / quyền học / ghi danh lệch nhau (ghi danh có dấu SCOPE mà không có quyền học; quyền học lệch dòng đơn,
--                     ghi danh, học viên, số tiền; tiền không gắn được dòng). Ghi bởi cron; chi tiết nằm ở `payload.chiTiet`.
--
-- Vì sao GIÁ TRỊ MỚI thay vì dùng lại loại cũ: khoá duy nhất là (orderItemId, loai) và `cap-tu-don.ts` / `xep-lop-tu-don.ts` đóng CHO_CHUYEN_DOI,
-- CHO_XEP_LOP, CAN_THU_HOI, TREO_DUYET_TAY mỗi lượt chạy khi điều kiện của chúng hết — một dòng cảnh báo của cron mượn loại cũ sẽ bị chính đường
-- cấp quyền đóng ngay lượt hích kế tiếp.
--
-- ADDITIVE, chạy lại được (IF NOT EXISTS). Giá trị enum mới chưa dùng được trong cùng giao dịch — migration này KHÔNG dùng chúng, không backfill,
-- không UPDATE/DELETE dòng nào, không bảng/cột/chỉ mục mới. Bảng `StudyEntitlementXuLy` không đổi hình dạng.
ALTER TYPE "EntitlementXuLyLoai" ADD VALUE IF NOT EXISTS 'THIEU_QUYEN_HOC';
ALTER TYPE "EntitlementXuLyLoai" ADD VALUE IF NOT EXISTS 'LECH_DU_LIEU';
