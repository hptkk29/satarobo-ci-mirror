/**
 * Danh sách đường dẫn RIÊNG TƯ duy nhất cho phân tích bên thứ ba (GA4, Meta Pixel).
 * Trên các đường này KHÔNG gửi page_view / PageView và không gửi URL (kể cả query như `?t=token`)
 * cho Google/Meta. Landing `/disc` (marketing) trên host công khai KHÔNG nằm trong danh sách — vẫn được theo dõi.
 * Thêm đường riêng tư mới: chỉ sửa các MẢNG này.
 */
export const DUONG_DAN_RIENG_TU: readonly string[] = [
  "/disc/bat-dau",
  "/disc/xac-minh-email",
  "/kich-hoat",
  // Trang kết quả của phụ huynh (URL mang submissionId, thân trang mang tên + điểm của trẻ).
  "/portal/disc",
];

/**
 * Host portal (khớp `PORTAL_HOST` ở proxy.ts). Ở host này proxy REWRITE đường sạch `/disc/<id>` → `/portal/disc/<id>`
 * nhưng thanh địa chỉ (và `usePathname`) vẫn là `/disc/<id>`. Còn `/disc` trên host CÔNG KHAI là landing marketing,
 * nên tiền tố `/disc` chỉ riêng tư khi đúng host này. Lưới `[RT-12]` ghim hằng này bằng `proxy.ts`.
 */
export const HOST_PORTAL = "hocvien.satarobo.vn";
export const DUONG_DAN_RIENG_TU_TREN_HOST_PORTAL: readonly string[] = ["/disc"];

/**
 * Biểu thức JS (chuỗi) chạy TRONG trình duyệt cho script khởi tạo nội tuyến — dựng từ CHÍNH các mảng trên
 * nên không có bản sao thứ hai của danh sách. Trả `true` khi `location.pathname` (+ `location.hostname`) là đường riêng tư.
 */
export const BIEU_THUC_JS_LA_RIENG_TU = `(function(){var P=${JSON.stringify(DUONG_DAN_RIENG_TU)};var Q=${JSON.stringify(DUONG_DAN_RIENG_TU_TREN_HOST_PORTAL)};var h=(location.hostname||'').toLowerCase();var p=(location.pathname||'').toLowerCase().replace(/\\/+$/,'')||'/';var L=h===${JSON.stringify(HOST_PORTAL)}?P.concat(Q):P;return L.some(function(d){return p===d||p.indexOf(d+'/')===0})})()`;

/**
 * Khớp tiền tố theo ranh giới đoạn: `/kich-hoat` và `/kich-hoat/x` khớp, `/kich-hoat-abc` thì không.
 * `hostname` BỎ TRỐNG (SSR / không biết) ⇒ chỉ áp danh sách chung; truyền `window.location.hostname` ở trình duyệt.
 */
export function laDuongRiengTu(pathname: string | null | undefined, hostname?: string | null): boolean {
  if (!pathname) return false;
  const p = pathname.split(/[?#]/)[0].toLowerCase().replace(/\/+$/, "") || "/";
  const tren = (hostname ?? "").toLowerCase() === HOST_PORTAL ? [...DUONG_DAN_RIENG_TU, ...DUONG_DAN_RIENG_TU_TREN_HOST_PORTAL] : DUONG_DAN_RIENG_TU;
  return tren.some((d) => p === d || p.startsWith(`${d}/`));
}
