// SEC-H05 (gộp LIB-09) — 1 nguồn secret ký cho các token tự-ký (QR điểm danh,
// vé SCORM, cookie portal active-site, OTP hash). Trước đây mỗi nơi fallback
// `?? ""` (HMAC key rỗng → forge được) hoặc `?? "otp-dev-secret"` (hằng số công
// khai). Nay THIẾU/YẾU secret = THROW (fail loud) thay vì ký bằng key không an toàn.
//
// Giữ ĐÚNG thứ tự NEXTAUTH_SECRET ?? AUTH_SECRET như code cũ → token/cookie đã ký
// vẫn verify được (không đổi behavior). Gọi lazy (trong hàm ký/verify) nên KHÔNG
// throw lúc build — chỉ throw khi thực sự cần ký mà secret vắng/yếu ở runtime.

/** Secret ký ≥32 ký tự. Throw nếu thiếu/yếu — KHÔNG bao giờ ký bằng key rỗng/hằng số. */
export function getSigningSecret(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "Thiếu/yếu signing secret: đặt NEXTAUTH_SECRET (hoặc AUTH_SECRET) ≥32 ký tự. " +
        "Tạo: `openssl rand -base64 32`.",
    );
  }
  return s;
}
