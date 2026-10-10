/**
 * Merchant portal Techcombank GIẢ ở tầng HTTP — thứ mà `window.fetch` của trang nói chuyện.
 *
 * Mô phỏng đúng các dữ kiện đã đo (roadmap §2.2–2.3): `GET /api/auth/session` trả `{ user, expires }`
 * (không đăng nhập ⇒ `{}`); `POST …/v2/transactions/search` đòi header app tự gắn và trả
 * `{ data, meta: { total_items, page_index, page_size, … } }`. Ghi lại MỌI lời gọi để test đếm
 * xem extension có gọi URL nào ngoài allowlist không.
 */
import { MERCHANT, PORTAL, TOKEN_GIA } from "./du-lieu";

export interface GoiPortal {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface RequestInitGia {
  method?: string;
  headers?: unknown;
  body?: unknown;
  redirect?: string;
  credentials?: string;
  mode?: string;
  cache?: string;
}

export interface PhanHoiGia {
  type: string;
  status: number;
  ok: boolean;
  redirected: boolean;
  url: string;
  headers: Headers;
  text(): Promise<string>;
}

const TIM_KIEM_RE = /^\/api\/partners\/merchant-portal\/([A-Z0-9]+)\/v2\/transactions\/search$/;

function phanHoi(status: number, body: unknown): PhanHoiGia {
  const chu = typeof body === "string" ? body : JSON.stringify(body);
  return {
    type: "basic",
    status,
    ok: status >= 200 && status < 300,
    redirected: false,
    url: "",
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => chu,
  };
}

function docHeader(h: unknown): Record<string, string> {
  const ra: Record<string, string> = {};
  if (!h) return ra;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      ra[k.toLowerCase()] = v;
    });
    return ra;
  }
  if (Array.isArray(h)) {
    for (const cap of h) if (Array.isArray(cap) && cap.length === 2) ra[String(cap[0]).toLowerCase()] = String(cap[1]);
    return ra;
  }
  if (typeof h === "object") {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) ra[k.toLowerCase()] = String(v);
  }
  return ra;
}

export class PortalHttpGia {
  readonly goi: GoiPortal[] = [];
  /** Người (admin) đang đăng nhập trên portal — hết phiên thì `false`. */
  dangNhap = true;
  /** `exp` (giây) của access token đang phát — đăng nhập lại ⇒ token mới, mốc mới. */
  accessToken: string = TOKEN_GIA.accessToken;
  /** Header app tự gắn khi gọi search; portal từ chối (401) nếu thiếu/sai. */
  readonly header: Record<string, string> = {
    "x-api-auth": TOKEN_GIA.xApiAuth,
    "x-api-payment": TOKEN_GIA.xApiPayment,
    "x-device-id": TOKEN_GIA.deviceId,
  };
  giaoDich: Record<string, unknown>[] = [];
  /** Ép lỗi cho lời gọi search: "401" | "403" | "500" | "CHUYEN_HUONG" | "SAI_HINH" | null. */
  epTimKiem: "401" | "403" | "500" | "CHUYEN_HUONG" | "SAI_HINH" | null = null;
  /** Portal bỏ qua `page_size` yêu cầu và dùng cỡ trang riêng (null = tôn trọng). */
  coTrangRieng: number | null = null;
  /** Search có `page_index` ≥ số này ⇒ 500 (mô phỏng hỏng GIỮA lượt đồng bộ). */
  loi500TuTrang: number | null = null;
  /** Portal BỎ QUA `page_index` yêu cầu — trang nào cũng trả trang đầu (RV5 — trang lặp). */
  boQuaPageIndex = false;
  /** `expires` của session do hàm này dựng (NextAuth JWT: TRƯỢT theo mỗi lần gọi). null = mốc cố định. */
  expiresTruot: (() => string) | null = null;

  fetch = async (input: unknown, init?: RequestInitGia): Promise<PhanHoiGia> => {
    let url: string;
    let method = (init?.method ?? "GET").toUpperCase();
    let headers = docHeader(init?.headers);
    let body: string | null = typeof init?.body === "string" ? init.body : null;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else if (input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string") {
      const r = input as Request;
      url = r.url;
      if (!init?.method) method = r.method.toUpperCase();
      headers = { ...docHeader(r.headers), ...headers };
      if (body === null && init?.body === undefined) body = await r.clone().text();
    } else throw new TypeError("input lạ");
    const tuyetDoi = new URL(url, PORTAL).href;
    this.goi.push({ url: tuyetDoi, method, headers, body });
    const u = new URL(tuyetDoi);
    if (u.origin !== PORTAL) throw new TypeError("Failed to fetch (khác origin)");

    if (u.pathname === "/api/auth/session" && method === "GET") {
      if (!this.dangNhap) return phanHoi(200, {});
      return phanHoi(200, {
        user: {
          name: "pos.cs1",
          accessToken: this.accessToken,
          refreshToken: TOKEN_GIA.refreshToken,
          deviceId: TOKEN_GIA.deviceId,
          permissions: ["TXN_VIEW"],
        },
        expires: this.expiresTruot ? this.expiresTruot() : "2026-11-06T03:20:00.000Z",
      });
    }

    const m = TIM_KIEM_RE.exec(u.pathname);
    if (m && method === "POST") {
      if (this.epTimKiem === "CHUYEN_HUONG") {
        return { ...phanHoi(0, ""), type: "opaqueredirect", ok: false };
      }
      if (this.epTimKiem === "401" || !this.dangNhap) return phanHoi(401, { message: "Unauthorized" });
      if (this.epTimKiem === "403") return phanHoi(403, { message: "Forbidden" });
      if (this.epTimKiem === "500") return phanHoi(500, { message: "Lỗi" });
      for (const [k, v] of Object.entries(this.header)) {
        if (headers[k] !== v) return phanHoi(401, { message: "header sai" });
      }
      if (m[1] !== MERCHANT) return phanHoi(403, { message: "merchant khác" });
      let b: Record<string, unknown>;
      try {
        b = JSON.parse(body ?? "{}") as Record<string, unknown>;
      } catch {
        // Thân app bị MÃ HOÁ: portal thật tự giải được — trả rỗng hợp lệ cho chính app.
        return phanHoi(200, { data: [], meta: { code: "SUCCESS", page_index: 0, page_size: 10, total_items: 0 } });
      }
      if (this.epTimKiem === "SAI_HINH") return phanHoi(200, { items: [] });
      if (this.loi500TuTrang !== null && Number(b.page_index) >= this.loi500TuTrang) {
        return phanHoi(500, { message: "Lỗi giữa chừng" });
      }
      const tu = String(b.transaction_time_from);
      const den = String(b.transaction_time_to);
      const loc = this.giaoDich.filter((r) => {
        const t = String(r.transaction_time).replace(/\//g, "-");
        return t >= tu && t <= den;
      });
      const co = this.coTrangRieng ?? Number(b.page_size);
      const batDau = this.boQuaPageIndex ? 0 : Number(b.page_index) * co;
      return phanHoi(200, {
        data: loc.slice(batDau, batDau + co),
        meta: {
          code: "SUCCESS",
          cursor: null,
          page_index: this.boQuaPageIndex ? 0 : Number(b.page_index),
          page_size: co,
          total_items: loc.length,
          request_id: "req-gia",
        },
      });
    }
    return phanHoi(404, { message: "không có" });
  };

  /** Các lời gọi KHÔNG phải của app (để đếm lời gọi của extension). */
  goiTimKiem(): GoiPortal[] {
    return this.goi.filter((g) => TIM_KIEM_RE.test(new URL(g.url).pathname));
  }
}

/** `XMLHttpRequest` giả của trang — để kiểm extension bắt header khi app dùng XHR (axios). */
export function taoXhrGia(portal: PortalHttpGia): new () => unknown {
  return class XhrGia {
    status = 0;
    readyState = 0;
    responseText = "";
    private m = "GET";
    private u = "";
    private h: Record<string, string> = {};
    private nghe: Record<string, Array<() => void>> = {};
    open(method: string, url: string): void {
      this.m = method;
      this.u = url;
      this.readyState = 1;
    }
    setRequestHeader(k: string, v: string): void {
      this.h[k.toLowerCase()] = v;
    }
    addEventListener(t: string, fn: () => void): void {
      (this.nghe[t] ??= []).push(fn);
    }
    send(body?: string): void {
      void portal
        .fetch(new URL(this.u, PORTAL).href, { method: this.m, headers: this.h, body })
        .then(async (res) => {
          this.status = res.status;
          this.responseText = await res.text();
          this.readyState = 4;
          for (const fn of this.nghe.load ?? []) fn();
          for (const fn of this.nghe.loadend ?? []) fn();
        });
    }
  };
}
