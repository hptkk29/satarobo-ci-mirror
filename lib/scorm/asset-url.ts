// lib/scorm/asset-url.ts — URL + cookie của đường phát asset SCORM/PDF (12/10/2026). THUẦN, dùng chung client + server.
//
// Vì sao MÃ GÓI nằm trong URL (`/api/scorm/asset/<packageId>/res/index.html`):
//  · Cả 50 gói thật trên prod đều launch `res/index.html`, nên URL asset con (`res/data/player.js`, `video1.mp4`…) TRÙNG NHAU giữa
//    các gói. Bản cũ không có mã gói trong URL mà cache `private, max-age=3600` ⇒ mở bài A rồi bài B trong một giờ có thể nhận
//    tệp của bài A từ cache trình duyệt (và một cookie vé dùng chung cho mọi gói, mở tab thứ hai là ghi đè tab đầu).
//  · Có mã gói trong URL thì khoá cache theo gói, và cookie vé giới hạn `path` theo gói.
export const SCORM_ASSET_BASE = "/api/scorm/asset";

/** Cookie vé theo gói (mới). Cookie cũ `scorm_at` (path chung) chỉ còn đọc cho vé đang bay lúc triển khai. */
export const SCORM_COOKIE_VE = "scorm_tk";
export const SCORM_COOKIE_VE_CU = "scorm_at";

/** Mã gói là cuid: bắt đầu bằng `c`, chữ thường + số, ≥ 20 ký tự. */
const LA_MA_GOI = /^c[a-z0-9]{20,}$/;
export const laMaGoi = (s: string): boolean => LA_MA_GOI.test(s);

/** Build src asset: mã hoá từng segment, đính mã gói + vé (query `t` chỉ ở hop đầu). */
export function taoUrlAssetScorm(packageId: string, launchUrl: string, ticket: string): string {
  const clean = launchUrl.replace(/\\/g, "/").replace(/^\.?\//, "");
  const encoded = clean.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${SCORM_ASSET_BASE}/${encodeURIComponent(packageId)}/${encoded}?t=${encodeURIComponent(ticket)}`;
}

/** `path` của cookie vé — chỉ phủ đúng thư mục asset của gói đó. */
export function cookiePathChoGoi(packageId: string): string {
  return `${SCORM_ASSET_BASE}/${packageId}`;
}

/**
 * Tách các segment của URL thành (mã gói trong URL?, đường dẫn trong gói).
 * Kiểu MỚI: segment đầu là mã gói. Kiểu CŨ (vé đang bay lúc triển khai): không có mã gói — dùng cả đường dẫn.
 */
export function tachDuongDanAsset(segs: string[]): { maGoiTrongUrl: string | null; rel: string[] } {
  const dau = segs[0];
  if (dau !== undefined && laMaGoi(dau)) return { maGoiTrongUrl: dau, rel: segs.slice(1) };
  return { maGoiTrongUrl: null, rel: segs };
}

/**
 * Header `Range` đơn hợp lệ để CHUYỂN THẲNG cho R2, hoặc null (⇒ trả cả tệp).
 * Chỉ nhận MỘT khoảng `bytes=a-b | a- | -n` — nhiều khoảng đòi multipart/byteranges, không trình phát nào gửi (cùng chốt với
 * `lib/elearning/range.ts`).
 */
export function rangeChuyenTiep(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  if (m[1] === "" && m[2] === "") return null;
  return `bytes=${m[1]}-${m[2]}`;
}
