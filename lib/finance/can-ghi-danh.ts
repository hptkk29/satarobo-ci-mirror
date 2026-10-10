// lib/finance/can-ghi-danh.ts — khoản của LOẠI ĐƠN nào phải có ghi danh mới xác nhận được. THUẦN.
//
// Chủ dự án chốt 29/09/2026: đơn KIT (`PRODUCT`) và đơn THI (`EXAM`) không có ghi danh nào — bán bộ kit
// / thu lệ phí thi không xếp bé vào lớp. Trước bản này `confirmPayment` + bước chốt hoá đơn từ chối mọi
// khoản thiếu `enrollmentId` ⇒ tiền kit/thi đã về mà khoản CHỜ MÃI, và hàng chờ hoá đơn còn mời "gắn
// ghi danh" cho một đơn không có gì để gắn.
//
// MỘT chỗ quyết, mọi nơi gọi: lõi xác nhận (`xacNhanKhoanTrongTx`), cổng sớm của `confirmPayment`, bước
// chốt hoá đơn, dòng hàng chờ hoá đơn, và nút ✓ ở màn Thanh toán. Rải điều kiện `type === "PRODUCT"` ra
// từng chỗ là để một chỗ quên loại đơn thứ ba ⇒ màn hứa xác nhận được mà lõi từ chối (luật 12).
//
// FAIL-CLOSED: loại đơn LẠ / trống (khoản không có đơn, `PACKAGE`, `COMBO`) VẪN phải có ghi danh — y
// hệt hành vi trước bản này. Chỉ đúng hai loại đã chốt được miễn; thêm loại thứ ba là một quyết định
// nghiệp vụ, không phải sửa cho tiện.

/** Loại đơn KHÔNG có ghi danh — khoản xác nhận được, phiếu thu mang `enrollmentId = null`. */
export const LOAI_DON_KHONG_GHI_DANH: readonly string[] = ["PRODUCT", "EXAM"];

/**
 * Khoản của đơn loại này có BẮT BUỘC gắn ghi danh mới xác nhận được không.
 * `null` = khoản không có đơn / không đọc được loại đơn ⇒ BẮT BUỘC (fail-closed).
 */
export function donCanGhiDanh(loaiDon: string | null): boolean {
  return loaiDon == null || !LOAI_DON_KHONG_GHI_DANH.includes(loaiDon);
}

/**
 * Khoản này bị chặn xác nhận vì THIẾU ghi danh (đơn cần ghi danh mà khoản chưa gắn).
 * `loaiDon` bắt buộc truyền (luật 7 — `tsc` liệt kê chỗ gọi); không có đơn thì truyền `null`.
 */
export function thieuGhiDanh(khoan: { enrollmentId: string | null }, loaiDon: string | null): boolean {
  return !khoan.enrollmentId && donCanGhiDanh(loaiDon);
}
