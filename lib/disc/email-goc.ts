/**
 * Gốc URL tuyệt đối để dựng liên kết trong thư DISC (xác minh email, báo cáo). THUẦN: nhận `env` làm tham số.
 *
 * Dùng đúng bộ biến "URL ứng dụng" mà phần email còn lại của repo đã dùng (`NEXTAUTH_URL` · `AUTH_URL` · `NEXT_PUBLIC_APP_URL`,
 * xem `lib/email/chan-gui-hoa-don.ts`). KHÔNG dùng `AFFILIATE_PUBLIC_ORIGIN` — biến đó chỉ dành cho link ngắn `/r/<token>`, và KHÔNG bao
 * giờ lấy từ Host/Origin của request (chống open-redirect: liên kết trong thư do máy chủ dựng, không do người gọi quyết).
 *
 * Chỉ nhận `https://<host>` (hoặc `http://localhost[:cổng]` cho máy dev); mọi giá trị khác bị BỎ QUA, không sửa ngầm.
 * Không biến nào hợp lệ ⇒ `null`: nơi gọi PHẢI dừng, không tự bịa một tên miền.
 */
const BIEN_URL_UNG_DUNG = ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const;

export type EnvGocEmail = Readonly<Record<string, string | undefined>>;

function chuanHoa(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const laLocal = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (u.protocol !== "https:" && !laLocal) return null;
  if (u.username || u.password) return null;
  return `${u.protocol}//${u.host}`;
}

export function gocUngDungEmail(env: EnvGocEmail = process.env): string | null {
  for (const k of BIEN_URL_UNG_DUNG) {
    const g = chuanHoa(env[k]);
    if (g) return g;
  }
  return null;
}
