// V9.4 P0 — Đăng xuất / đổi tài khoản KHÔNG bền vì yêu cầu NỀN làm mới cookie phiên.
//
// Đo được (tests/e2e/elearning/xuyen-phien.spec.ts, bằng chứng E:/tmp/xuyen-phien/*.json, xem docs V9.4):
//   · Auth.js (`@auth/core/lib/actions/session.js`) với phiên JWT LUÔN mã hoá lại token và đẩy `Set-Cookie` phiên trên MỌI yêu cầu
//     đi qua `proxy.ts` — kể cả prefetch RSC, `/api/chat/*`, `/api/notifications/summary`. ≈26% phản hồi của một trang quản trị mang Set-Cookie phiên.
//   · Mỗi Set-Cookie ấy mang phiên của NGƯỜI GỬI yêu cầu (máy chủ không bao giờ đặt phiên của người khác — 0 vi phạm / hàng trăm phản hồi).
//   · Nhưng phản hồi nền của trang CŨ về SAU `signOut` (hoặc sau khi tab khác đăng nhập người khác) thì GHI ĐÈ cookie mới bằng phiên cũ:
//     đăng xuất tự nhiên bị huỷ 2/15 lần; hai tab: người cũ "bật lại" giữa phiên người mới.
//
// Cách chữa: chỉ cho phép LÀM MỚI cookie phiên trên yêu cầu ĐIỀU HƯỚNG cấp cao (trang tải mới). Yêu cầu nền (fetch/RSC/prefetch/SSE) không được
// phép đặt lại cookie phiên. Phiên vẫn trượt hạn mỗi lần người dùng mở/tải một trang.
//
// ⚠️ Đây là THAY ĐỔI CHÍNH SÁCH XÁC THỰC ⇒ nằm sau cờ `SESSION_COOKIE_REFRESH_NAV_ONLY` (mặc định TẮT, xem lib/flags.ts) cho tới khi Owner duyệt.
// Phần quyết định là HÀM THUẦN ở đây để có test; `proxy.ts` chỉ nối dây.

/** Tên cookie phiên: `authjs.session-token`, `__Secure-authjs.session-token`, `__Secure-sr-<env>.session-token`, và mảnh `.0`, `.1`… */
const TEN_COOKIE_PHIEN = /session-token(\.\d+)?$/;

export type DauYeuCau = {
  method: string;
  pathname: string;
  /** Giá trị tiêu đề `Sec-Fetch-Mode` (trình duyệt hiện đại luôn gửi; client không phải trình duyệt thì không) */
  secFetchMode: string | null;
};

/**
 * Có được phép làm mới cookie phiên trên phản hồi của yêu cầu này không?
 *
 *  · Điều hướng cấp cao (`Sec-Fetch-Mode: navigate`) ⇒ CÓ.
 *  · Không có tiêu đề `Sec-Fetch-Mode` (curl, test Node, trình duyệt rất cũ) ⇒ CÓ — giữ nguyên hành vi hiện tại, không đoán.
 *  · Các route xác thực `/api/auth/*` ⇒ CÓ, TRỪ `GET /api/auth/session` (client `useSession` gọi nền để đọc phiên): đăng nhập/đăng xuất/csrf/callback
 *    là chính những lần ĐẶT/XOÁ cookie, chặn chúng là hỏng đăng nhập.
 *  · Còn lại (fetch, RSC, prefetch, SSE, iframe…) ⇒ KHÔNG.
 */
export function choPhepLamMoiCookiePhien(h: DauYeuCau): boolean {
  if (!h.secFetchMode || h.secFetchMode === "navigate") return true;
  if (h.pathname === "/api/auth/session" && h.method.toUpperCase() === "GET") return false;
  if (h.pathname.startsWith("/api/auth/")) return true;
  return false;
}

/** Một dòng `Set-Cookie`: có phải đang ĐẶT một phiên (giá trị khác rỗng, không phải lệnh xoá) không? */
export function laDatCookiePhien(dong: string): boolean {
  const [cap] = dong.split(";");
  const i = cap.indexOf("=");
  if (i < 0) return false;
  const ten = cap.slice(0, i).trim();
  const giaTri = cap.slice(i + 1).trim();
  if (!TEN_COOKIE_PHIEN.test(ten)) return false;
  if (giaTri === "") return false; // lệnh xoá — luôn giữ
  if (/;\s*max-age=0\b/i.test(dong) || /;\s*expires=thu, 01 jan 1970/i.test(dong)) return false; // lệnh xoá — luôn giữ
  return true;
}

/** Bỏ các dòng ĐẶT cookie phiên khỏi danh sách `Set-Cookie`; giữ nguyên mọi dòng khác (kể cả lệnh xoá cookie phiên). */
export function boDatCookiePhien(dongSetCookie: readonly string[]): string[] {
  return dongSetCookie.filter((d) => !laDatCookiePhien(d));
}
