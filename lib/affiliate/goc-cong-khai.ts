/**
 * lib/affiliate/goc-cong-khai.ts — GỐC CÔNG KHAI của LINK NGẮN `/r/<token>` và QR (AFF-WEB, thay hằng `GOC_LINK_CONG_KHAI` cũ). THUẦN: nhận `env` làm tham số.
 *
 * ── Cái này LÀ gì, và KHÔNG là gì ───────────────────────────────────────────────────────────────────────────────
 *  · LÀ: địa chỉ máy chủ NÀY phục vụ route `/r/:token` (nơi QR in ra và link ngắn trỏ vào). Mỗi môi trường một gốc: prod `satarobo.vn`, test `test.satarobo.vn`.
 *    Cứng một tên miền thì QR phát từ test trỏ về prod — nơi DB khác, token không tồn tại, khách bị đá về trang chủ.
 *  · KHÔNG LÀ: miền của link giới thiệu. Địa chỉ ĐÍCH của một link luôn lấy từ website đã khai (`AffiliateSite.baseUrl` + trang đích) — xem `dung-url-theo-doi.ts`.
 *  · KHÔNG còn quảng bá `<gốc>/?ref=<mã>` như một link: cơ chế `?ref=` cũ vẫn gắn lead trên site công khai, nhưng link giới thiệu nay tạo ở tab Link / QR / Mã.
 *
 * ── Nguồn DUY NHẤT: biến `AFFILIATE_PUBLIC_ORIGIN` (chủ dự án chốt 13/10/2026) ─────────────────────────────────
 * Đọc lúc CHẠY (khoá động `env[tên]` nên Next không nướng vào image). KHÔNG lùi về `NEXT_PUBLIC_APP_URL` (biến đó phục vụ metadata/payOS, mang tên miền theo lúc build — dùng chung là
 * để một biến khác mục đích âm thầm quyết link ngắn), và KHÔNG có mặc định theo `VERCEL_ENV` (một môi trường mang `VERCEL_ENV=production` mà không phải prod sẽ phát QR trỏ về prod).
 * Thiếu hoặc sai ⇒ `null` = «chưa cấu hình»: nơi gọi PHẢI nói thẳng với người dùng (`LY_DO_THIEU_GOC`), không ẩn lặng lẽ, và link trực tiếp vẫn dùng được.
 * Không bao giờ lấy từ Host / Origin của request (chống open-redirect, xem luật 1 ở `theo-doi-cong-khai.ts`).
 *
 * ⚠️ Đặt biến này trên MỌI môi trường dùng link ngắn: prod `https://satarobo.vn`, test `https://test.satarobo.vn` (mẫu ở `deploy/.env.example` và `.env.example`).
 */

export const BIEN_GOC_CONG_KHAI = "AFFILIATE_PUBLIC_ORIGIN";

export const LY_DO_THIEU_GOC = `Chưa cấu hình gốc địa chỉ công khai cho link ngắn (đặt ${BIEN_GOC_CONG_KHAI}=https://<tên-miền> cho môi trường này). Link trực tiếp vẫn dùng được.`;

/** `https://<tên-miền>` — không đường dẫn, query, cổng. Cùng hình dạng mà `dungUrlChuyenHuong` chấp nhận. */
const GOC_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Chuẩn hoá một giá trị cấu hình thành gốc hợp lệ, hoặc null. Chấp nhận dấu `/` cuối và chữ hoa (hạ chữ thường); mọi thứ khác sai ⇒ null (không sửa ngầm). */
export function chuanHoaGoc(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const g = raw.trim().replace(/\/+$/, "").toLowerCase();
  return GOC_RE.test(g) ? g : null;
}

export type EnvGoc = Readonly<Record<string, string | undefined>>;

/** Gốc công khai của môi trường này, hoặc null nếu chưa cấu hình (xem đầu tệp). */
export function gocCongKhai(env: EnvGoc): string | null {
  return chuanHoaGoc(env[BIEN_GOC_CONG_KHAI]);
}
