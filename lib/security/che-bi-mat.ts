// lib/security/che-bi-mat.ts — che bí mật trước khi một sự kiện rời máy chủ sang Sentry.
//
// "Log ứng dụng và Sentry KHÔNG chứa token, khoá, tham số dạng rõ". Sentry tự gom những thứ mã
// không kiểm soát: header của yêu cầu, thân form, URL điều hướng, đối số `console.*` thành
// breadcrumb, biến cục bộ trong khung stack. Hàm này là lưới cuối.
//
// 02/10/2026 — sinh ra cùng Cổng dữ liệu agent; cổng đã gỡ nhưng bộ lọc GIỮ vì nó che bí mật
// chung của cả app (Bearer/Basic, tham số OAuth, mật khẩu, cookie). Chỉ bỏ lớp tiền tố khoá
// riêng của cổng (`srk_`/`sra_`/`srm_`/`srs_`) — không còn gì sinh ra các khoá đó.
//
// ⚠️ THUẦN, KHÔNG import gì: tệp này chạy ở CẢ ba runtime (node · edge · trình duyệt — xem
// `instrumentation-client.ts`). Không dùng lookbehind trong regex (Safari cũ ném lỗi khi dựng
// regex ⇒ hỏng luôn Sentry.init).
//
// Hai lớp che, áp cho MỌI chuỗi trong sự kiện:
//   1. Giá trị `Authorization: Bearer|Basic …` — kể cả token không tiền tố.
//   2. Tham số OAuth dạng `khoa=giá trị` (URL, thân form) và `"khoa":"giá trị"` (JSON).
// Cộng một lớp theo TÊN KHOÁ của object (header, thân yêu cầu đã parse, extra…).
//
// Không che chuỗi ngẫu nhiên không tiền tố nói chung: bản băm hex 64 ký tự, cuid, mã yêu cầu đều
// trông giống token — che hết là Sentry vô dụng cho việc điều tra.

/** Thứ thay vào chỗ bí mật. Cố ý không mang độ dài hay vài ký tự đầu/cuối. */
export const CHO_CHE = "[DA_CHE]";

/** `Bearer xxx` / `Basic xxx` — giữ tên lược đồ để người điều tra biết đó là loại xác thực nào. */
const MAU_XAC_THUC = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** Tham số bí mật dạng `ten=giá trị` (query, thân form). `state`, `client_id` KHÔNG bí mật — giữ. */
const MAU_THAM_SO =
  /(^|[?&#;\s])(code|code_verifier|refresh_token|access_token|id_token|client_secret|token|password)=([^&#\s"']+)/gi;
/** Cùng tập tên nhưng trong chuỗi JSON: `"code":"…"`. */
const MAU_JSON =
  /"(code|code_verifier|refresh_token|access_token|id_token|client_secret|token|password)"\s*:\s*"(?:[^"\\]|\\.)*"/gi;

/** Tên khoá object (so chữ thường, bỏ `-`/`_`) mà GIÁ TRỊ luôn bị che, bất kể nội dung. */
const KHOA_NHAY_CAM = new Set(
  [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-sr-signature",
    "client_secret",
    "refresh_token",
    "access_token",
    "id_token",
    "code_verifier",
    "password",
    "mat_khau",
    "ma_xac_thuc",
    "bi_mat",
    "secret",
    "token",
  ].map(chuanTenKhoa),
);
/** Chỉ trong thân/query của YÊU CẦU: `code` là mã ủy quyền OAuth. Ở chỗ khác `code` là mã lỗi (P2002…). */
const KHOA_NHAY_CAM_YEU_CAU = new Set([...KHOA_NHAY_CAM, chuanTenKhoa("code")]);

function chuanTenKhoa(k: string): string {
  return k.toLowerCase().replace(/[-_]/g, "");
}

/** Che một chuỗi. Idempotent: che lại chuỗi đã che không đổi gì. */
export function cheBiMat(s: string): string {
  if (!s) return s;
  return s
    .replace(MAU_XAC_THUC, (_m, luocDo: string) => `${luocDo} ${CHO_CHE}`)
    .replace(MAU_THAM_SO, (_m, dau: string, ten: string) => `${dau}${ten}=${CHO_CHE}`)
    .replace(MAU_JSON, (_m, ten: string) => `"${ten}":"${CHO_CHE}"`);
}

/** Trần độ sâu — sâu hơn thì THAY cả nhánh (fail closed), không bỏ qua. */
const DO_SAU_TOI_DA = 24;

function cheSau(x: unknown, khoaNhayCam: ReadonlySet<string>, doSau: number, daQua: WeakSet<object>): unknown {
  if (typeof x === "string") return cheBiMat(x);
  if (x === null || typeof x !== "object") return x;
  if (x instanceof Date) return x;
  if (doSau >= DO_SAU_TOI_DA) return CHO_CHE;
  if (daQua.has(x)) return x;
  daQua.add(x);
  if (Array.isArray(x)) {
    // Cặp `[khoá, giá trị]` (vd `request.query_string` kiểu mảng của SDK): giá trị không có tên
    // khoá riêng để lớp theo-tên bắt, nên soi khoá ở phần tử 0.
    if (x.length === 2 && typeof x[0] === "string" && typeof x[1] === "string" && khoaNhayCam.has(chuanTenKhoa(x[0])) && x[1] !== "") {
      x[1] = CHO_CHE;
      return x;
    }
    for (let i = 0; i < x.length; i++) x[i] = cheSau(x[i], khoaNhayCam, doSau + 1, daQua);
    return x;
  }
  const o = x as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (khoaNhayCam.has(chuanTenKhoa(k)) && v !== null && v !== undefined && v !== "") {
      o[k] = CHO_CHE;
      continue;
    }
    o[k] = cheSau(v, khoaNhayCam, doSau + 1, daQua);
  }
  return o;
}

/** Hình dạng tối thiểu của sự kiện Sentry mà hàm cần biết — nhận mọi kiểu sự kiện của SDK. */
type SuKienCoYeuCau = {
  request?: { cookies?: unknown; headers?: Record<string, string>; data?: unknown; [k: string]: unknown };
  [k: string]: unknown;
};

/**
 * Che bí mật trên TOÀN BỘ sự kiện (sửa tại chỗ + trả lại chính nó — Sentry nhận cả hai cách).
 * `request.cookies` bị bỏ hẳn (cookie phiên không có giá trị điều tra nào).
 */
export function locSuKienSentry<T extends object>(suKien: T): T {
  const e = suKien as unknown as SuKienCoYeuCau;
  const daQua = new WeakSet<object>();
  if (e.request && typeof e.request === "object") {
    delete e.request.cookies;
    for (const k of Object.keys(e.request)) {
      e.request[k] = cheSau(e.request[k], KHOA_NHAY_CAM_YEU_CAU, 1, daQua);
    }
  }
  for (const k of Object.keys(e)) {
    if (k === "request") continue;
    e[k] = cheSau(e[k], KHOA_NHAY_CAM, 0, daQua);
  }
  return suKien;
}

/** Che bí mật trên một breadcrumb (message + data — đối số console, URL điều hướng/fetch). */
export function locBreadcrumbSentry<T extends object>(bc: T): T {
  return cheSau(bc, KHOA_NHAY_CAM_YEU_CAU, 0, new WeakSet<object>()) as T;
}
