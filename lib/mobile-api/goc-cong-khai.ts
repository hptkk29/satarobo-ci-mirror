import { LoiApiMobile } from "./xac-thuc/dich-vu";

/**
 * SEC-10 (V8.45) — GỐC URL CÔNG KHAI khi máy chủ phải dựng một URL tuyệt đối trả cho app (liên kết tải phiếu thu / hoá đơn…).
 *
 * Lỗ cũ: `MOBILE_API_PUBLIC_BASE → NEXT_PUBLIC_APP_URL → new URL(req.url).origin`. Thiếu cả hai biến ⇒ gốc suy từ header `Host` của yêu cầu (proxy lỏng / `Host` giả ⇒ URL ký có token
 * 300 giây trỏ sang tên miền kẻ tấn công). Tác động chỉ lên yêu cầu của chính người gọi nên mức thấp, nhưng URL ký là THỨ NHẠY CẢM — không dựng từ đầu vào của client.
 *
 * Luật: biến cấu hình (hợp lệ, `http(s)://`) LUÔN thắng; KHÔNG có ⇒ ở production TỪ CHỐI (503, người vận hành phải đặt biến); chỉ ngoài production (dev/test cục bộ không có biến) mới rơi về gốc của yêu cầu.
 * Gọi BÊN TRONG handler (sau cổng xác thực), không ở đầu route: người chưa đăng nhập luôn nhận 401 chứ không phải 503 cấu hình.
 */
const hopLe = (v: string | undefined): string | null => {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
};

export function gocCongKhai(req: Request, env: Record<string, string | undefined> = process.env): string {
  const cauHinh = hopLe(env.MOBILE_API_PUBLIC_BASE) ?? hopLe(env.NEXT_PUBLIC_APP_URL);
  if (cauHinh) return cauHinh;
  if (env.NODE_ENV === "production") throw new LoiApiMobile("SERVER", 503, "Hệ thống chưa cấu hình địa chỉ công khai — báo quản trị viên.", 60);
  return new URL(req.url).origin;
}
