// app/(public)/thong-tin-hoa-don/[ma]/_hang-so.ts — hằng số của trang công khai "thông tin người mua hoá đơn" (Invoice Hub đợt 2, S11). Tách khỏi `_actions.ts` vì tệp `'use server'`
// chỉ được export hàm async.

/**
 * Phiên bản văn bản đồng ý mà trang đang hiển thị — ghi vào `HoaDonYeuCauNguoiMua.donY` mỗi lần phụ huynh gửi.
 *
 * [02/11/2026] Câu chữ ĐÃ ĐỔI: trước đó nói «không thu thập số căn cước hay giấy tờ tuỳ thân», nay form thu CCCD (chủ dự án yêu cầu) nên câu cũ sẽ NÓI DỐI — đã bỏ và đổi hằng này sang `-nhap-cccd`.
 *
 * ⚠️ NỘI DUNG ĐIỀU KHOẢN CHƯA ĐƯỢC PHÁP CHẾ DUYỆT (OD-11). Giá trị này mang hậu tố `-nhap` (bản nháp) CÓ CHỦ ĐÍCH: nó cho biết bản ghi đồng ý nào đã dùng câu chữ nháp.
 * Trang chỉ chạy được khi cờ `hoaDon.hubNguoiMua` BẬT cho cơ sở thí điểm (mặc định TẮT) — KHÔNG bật ở cơ sở thật trước khi pháp chế duyệt câu chữ dưới đây và đổi giá trị này
 * sang phiên bản chính thức. Đổi câu chữ ở `NOI_DUNG_QUYEN_RIENG_TU` / `NHAN_DONG_Y` mà không đổi hằng này là ghi đồng ý cho một văn bản khác với văn bản người ta đã thấy.
 */
export const PHIEN_BAN_DIEU_KHOAN = "2026-11-02-nhap-cccd";

/** Câu thông báo quyền riêng tư NGẮN, đặt ngay trên nút gửi. Không hứa thời hạn lưu (OD-11 còn mở). */
export const NOI_DUNG_QUYEN_RIENG_TU =
  "Sata Robo chỉ dùng thông tin này, kể cả số căn cước công dân, để xuất hoá đơn cho giao dịch của bạn.";

export const NHAN_DONG_Y = "Tôi đồng ý để Sata Robo dùng thông tin trên để xuất hoá đơn.";
