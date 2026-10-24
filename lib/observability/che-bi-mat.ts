// =============================================================================
// CHE BÍ MẬT trước khi dữ liệu rời tiến trình (Sentry: lỗi, giao dịch, span,
// breadcrumb). Hàm THUẦN, không import gì ngoài ngôn ngữ ⇒ dùng được ở cả ba
// runtime: Node (`sentry.server.config.ts`), Edge (`sentry.edge.config.ts`) và
// trình duyệt (`instrumentation-client.ts`).
//
// Vì sao cần (sinh ra ở tích hợp OmiCall 29/09/2026; trục đó ĐÃ GỠ 06/10/2026 — phần riêng
// của nó đã cắt, phần còn lại là thứ các webhook CÒN SỐNG cần):
//  · Webhook nhận bí mật qua header `x-webhook-secret` (facebook · quatang · zalo ·
//    `lib/lead/webhook.ts`) hoặc `?secret=` (google-form) ⇒ lỗi trong route webhook mang
//    theo `request.url`, `request.query_string` và `request.headers` chứa bí mật.
//  · SePay nhận khoá qua `x-api-key` / `apikey` (`lib/payments/sepay.ts`).
//  · Sentry tự vết mọi lời `fetch` ra ngoài (httpIntegration) nên URL mang `?apiKey=` /
//    `token=` đi thẳng vào span (`url.full`, `http.url`, description) và breadcrumb (`data.url`).
//  · Bộ che chung `lib/security/che-bi-mat.ts` KHÔNG thay được bộ này: nó không có tên
//    `x-webhook-secret`, `x-api-key`/`apikey` và không che `?secret=`.
//
// Cách che: đi SÂU mọi object thường/mảng (có giới hạn độ sâu + chống vòng lặp):
//  · khoá (tên header, tên tham số, tên trường) thuộc danh sách nhạy cảm ⇒ "[REDACTED]";
//  · mảng cặp `[tên, giá trị]` (dạng `query_string` của Sentry) ⇒ che vế giá trị;
//  · MỌI chuỗi ⇒ che `?apiKey=…`/`&secret=…`/`token=…` và `Bearer …`, cộng các giá
//    trị bí mật cụ thể nơi gọi truyền vào.
// =============================================================================

export const DA_CHE = "[REDACTED]";

/** Tên header / tham số / trường mà GIÁ TRỊ luôn bị che. So không phân biệt hoa thường. */
const TEN_NHAY_CAM: ReadonlySet<string> = new Set([
  // header
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-webhook-secret",
  "x-api-key",
  // tham số query / trường thân
  "secret",
  "apikey",
  "api_key",
  "token",
  "access_token",
  "password",
]);

export function laTenNhayCam(ten: string): boolean {
  return TEN_NHAY_CAM.has(ten.trim().toLowerCase());
}

// Tham số query nhạy cảm, đứng sau đầu chuỗi / `?` / `&` / `;` / khoảng trắng.
// Giá trị kéo tới ký tự phân cách kế tiếp (không nuốt `&` của tham số sau).
const RE_THAM_SO = /(^|[?&;\s])(secret|apikey|api_key|token|access_token)=([^&#\s"'<>]*)/gi;
const RE_BEARER = /\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi;

/** Độ dài tối thiểu để một giá trị bí mật cụ thể được thay theo văn bản (tránh thay nhầm chuỗi ngắn). */
const DO_DAI_BI_MAT_TOI_THIEU = 8;

function locGiaTriBiMat(giaTri?: readonly (string | undefined | null)[]): string[] {
  if (!giaTri) return [];
  return giaTri.filter(
    (g): g is string => typeof g === "string" && g.length >= DO_DAI_BI_MAT_TOI_THIEU,
  );
}

/**
 * Che bí mật trong MỘT chuỗi (URL, thông điệp lỗi, description của span...).
 * `giaTriBiMat` — các giá trị cụ thể phải biến mất dù xuất hiện ở đâu.
 */
export function cheChuoi(s: string, giaTriBiMat?: readonly (string | undefined | null)[]): string {
  let kq = s.replace(RE_THAM_SO, (_m, dau: string, ten: string) => `${dau}${ten}=${DA_CHE}`);
  kq = kq.replace(RE_BEARER, (_m, bearer: string) => `${bearer} ${DA_CHE}`);
  for (const g of locGiaTriBiMat(giaTriBiMat)) {
    if (kq.includes(g)) kq = kq.split(g).join(DA_CHE);
    const daMaHoa = encodeURIComponent(g);
    if (daMaHoa !== g && kq.includes(daMaHoa)) kq = kq.split(daMaHoa).join(DA_CHE);
  }
  return kq;
}

const DO_SAU_TOI_DA = 12;

function laObjectThuong(x: object): x is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function ganAnToan(dich: Record<string, unknown> | unknown[], khoa: string | number, giaTri: unknown) {
  try {
    (dich as Record<string | number, unknown>)[khoa] = giaTri;
  } catch {
    // Object bị đóng băng — bỏ qua, không để bộ che làm rơi cả sự kiện.
  }
}

function di(x: unknown, biMat: readonly string[], doSau: number, daQua: WeakSet<object>): unknown {
  if (typeof x === "string") return cheChuoi(x, biMat);
  if (x === null || typeof x !== "object" || doSau > DO_SAU_TOI_DA) return x;
  if (daQua.has(x)) return x;
  daQua.add(x);

  if (Array.isArray(x)) {
    // Dạng cặp [tên, giá trị] — `query_string` của Sentry có thể là mảng các cặp.
    if (x.length === 2 && typeof x[0] === "string" && laTenNhayCam(x[0])) {
      ganAnToan(x, 1, DA_CHE);
      return x;
    }
    for (let i = 0; i < x.length; i++) ganAnToan(x, i, di(x[i], biMat, doSau + 1, daQua));
    return x;
  }

  if (!laObjectThuong(x)) return x;
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (laTenNhayCam(k)) {
      if (v !== undefined && v !== null && v !== "") ganAnToan(x, k, DA_CHE);
      continue;
    }
    ganAnToan(x, k, di(v, biMat, doSau + 1, daQua));
  }
  return x;
}

/**
 * Che bí mật trong một sự kiện Sentry (ErrorEvent / TransactionEvent / SpanJSON /
 * Breadcrumb) hoặc bất kỳ cấu trúc JSON nào. SỬA TẠI CHỖ và trả lại đúng tham chiếu
 * (Sentry chấp nhận sự kiện đã sửa), nên chữ ký giữ nguyên kiểu đầu vào.
 */
export function cheSauBiMat<T>(x: T, giaTriBiMat?: readonly (string | undefined | null)[]): T {
  const biMat = locGiaTriBiMat(giaTriBiMat);
  if (typeof x === "string") return cheChuoi(x, biMat) as T;
  di(x, biMat, 0, new WeakSet());
  return x;
}
