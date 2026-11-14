// Chữ báo lỗi của form đăng nhập — MỘT chỗ, thuần.
//
// Trước đây mọi `result.error` đều thành "mật khẩu không đúng", nên các lỗi KHÔNG phải
// sai mật khẩu (mất cookie CSRF trong trình duyệt nhúng của Zalo/Facebook, mất mạng, trình
// duyệt chặn cookie) cũng hiện đúng câu đó — người dùng đổi mật khẩu vô ích.

export const LOI_SAI_THONG_TIN = "Thông tin đăng nhập hoặc mật khẩu không đúng.";
export const LOI_PHIEN =
  "Không tạo được phiên đăng nhập. Kiểm tra NGÀY GIỜ của điện thoại có đúng không (đặt lệch ngày làm cookie hết hạn ngay), rồi tải lại trang, hoặc mở bằng Chrome/Safari (không mở trong Zalo/Facebook) và thử lại.";
export const LOI_MANG = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

/** Kết quả `signIn(..., { redirect: false })` đã rút gọn phần ta đọc. */
export type KetQuaSignIn = { error?: string | null; code?: string | null } | undefined | null;

/**
 * `null` = đăng nhập chưa lỗi. `CredentialsSignin` là mã Auth.js trả khi `authorize` trả null
 * (sai thông tin, bị rate-limit, tài khoản khoá) — giữ nguyên câu cũ cho riêng mã này.
 */
export function loiTuKetQuaSignIn(r: KetQuaSignIn): string | null {
  if (!r) return LOI_PHIEN; // signIn trả undefined (không lấy được providers) = không có phiên
  if (!r.error) return null;
  return r.error === "CredentialsSignin" || r.code === "credentials" ? LOI_SAI_THONG_TIN : LOI_PHIEN;
}
