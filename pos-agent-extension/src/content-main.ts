/*
 * SataRobo POS Agent — content script chạy trong WORLD MAIN của merchant portal Techcombank.
 *
 * Vì sao ở world MAIN (D10): lệnh gọi API portal phải chạy TRONG TRANG để token/cookie phiên không
 * bao giờ rời bộ nhớ trang. Header app gắn (`X-API-Auth`, `x-api-payment`, `X-Device-ID`) CHƯA
 * ĐO được cách dựng ⇒ phương án dự phòng roadmap cho phép: bọc `window.fetch` (+ XHR) để NHỚ
 * header app vừa dùng cho đúng endpoint search, rồi dùng lại. Header/token CHỈ sống trong closure
 * này — không bao giờ qua postMessage, storage hay mạng satarobo.
 *
 * ALLOWLIST CHẶN CỨNG — chỉ hai yêu cầu, so KHỚP NGUYÊN VĂN cả chuỗi URL:
 *   GET  https://merchant.techcombank.com/api/auth/session
 *   POST https://merchant.techcombank.com/api/partners/merchant-portal/{merchantCode}/v2/transactions/search
 * Mọi URL khác (hoàn trả, nhân viên, đổi mật khẩu, đăng xuất, merchant khác, biến thể path /
 * query / encode) ⇒ URL_BLOCKED, KHÔNG gọi mạng. Không đi theo chuyển hướng (redirect: manual).
 *
 * Tệp này là SCRIPT CỔ ĐIỂN (Chrome không nạp content script dạng module): không import, không
 * export, không biến toàn cục — mọi thứ nằm trong một hàm tự gọi.
 */
(() => {
  "use strict";

  const KENH = "satarobo-pos-agent";
  const PORTAL_ORIGIN = "https://merchant.techcombank.com";
  const DUONG_PHIEN = "/api/auth/session";
  const MERCHANT_RE = /^[A-Z0-9]{4,32}$/;
  const TIM_KIEM_RE = /^\/api\/partners\/merchant-portal\/([A-Z0-9]{4,32})\/v2\/transactions\/search$/;
  const GIO_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const ID_RE = /^[0-9a-f]{32}$/;
  /** Whitelist hợp đồng §6.1 — chỉ các khoá này được ĐƯA RA KHỎI TRANG (không tên chủ thẻ, không device_id). */
  const KHOA_GIAO_DICH: readonly string[] = [
    "transaction_id",
    "transaction_type",
    "transaction_detail_status",
    "transaction_master_status",
    "order_description",
    "authorization_id",
    "card_transaction_id",
    "tcb_transaction_id",
    "order_amount",
    "transaction_master_amount",
    "transaction_detail_amount",
    "fee",
    "tax",
    "currency",
    "transaction_time",
    "merchant_code",
    "store_code",
    "terminal_code",
    "payment_method",
    "service_type",
    "sender_card_number",
    "sender_card_type",
    "accounting_reference_id",
    "settlement_id",
    "merchant_order_id",
    "transaction_operation_msg",
  ];

  type CapHeader = [string, string];
  interface PhanHoiTrang {
    type: string;
    status: number;
    ok: boolean;
    text(): Promise<string>;
  }
  type HamFetch = (this: unknown, input: unknown, init?: unknown) => Promise<PhanHoiTrang>;
  interface XhrInst {
    status: number;
    addEventListener(t: string, fn: () => void): void;
  }
  interface XhrProto {
    open(this: XhrInst, ...a: unknown[]): unknown;
    setRequestHeader(this: XhrInst, k: string, v: string): unknown;
    send(this: XhrInst, b?: unknown): unknown;
  }
  interface TinCuaSo {
    data: unknown;
    origin: string;
    source: unknown;
  }
  interface CuaSoMain {
    location: { origin: string; href: string };
    fetch: HamFetch;
    XMLHttpRequest?: { prototype: XhrProto };
    Headers: new () => { set(k: string, v: string): void; has(k: string): boolean };
    addEventListener(t: "message", fn: (ev: TinCuaSo) => void): void;
    postMessage(data: unknown, targetOrigin: string): void;
    crypto: { getRandomValues(a: Uint8Array): Uint8Array };
    atob(s: string): string;
  }
  interface DauHeader {
    maTrang: string;
    soBat: number;
    coHeader: boolean;
    thanMaHoa: boolean;
  }
  interface BanBat {
    headers: CapHeader[];
    thanMaHoa: boolean;
  }
  interface ThanTimKiem {
    page_index: number;
    page_size: number;
    transaction_time_from: string;
    transaction_time_to: string;
  }
  type KetQua = Record<string, unknown>;

  const W = globalThis as unknown as CuaSoMain;
  if (!W.location || W.location.origin !== PORTAL_ORIGIN || typeof W.fetch !== "function") return;

  const gocFetch: HamFetch = W.fetch;
  /** Header app đã dùng THÀNH CÔNG cho search của từng merchant — chỉ trong closure này. */
  const daBat = new Map<string, BanBat>();
  const soBat = new Map<string, number>();
  const maTrang = (() => {
    const b = W.crypto.getRandomValues(new Uint8Array(8));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  })();

  const laObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

  function dau(merchant: string): DauHeader | null {
    if (!MERCHANT_RE.test(merchant)) return null;
    return {
      maTrang,
      soBat: soBat.get(merchant) ?? 0,
      coHeader: daBat.has(merchant),
      thanMaHoa: daBat.get(merchant)?.thanMaHoa ?? false,
    };
  }

  function loi(ma: string, merchant = "", httpStatus: number | null = null): KetQua {
    return { loai: "LOI", ma, httpStatus, dauHeader: dau(merchant) };
  }

  /** Allowlist: KHỚP NGUYÊN VĂN. Trả loại yêu cầu hoặc null (bị chặn). */
  function urlChoPhep(phuongThuc: unknown, url: unknown, merchantCode: unknown): "PHIEN" | "TIM_KIEM" | null {
    if (typeof phuongThuc !== "string" || typeof url !== "string") return null;
    if (phuongThuc === "GET" && url === PORTAL_ORIGIN + DUONG_PHIEN) return "PHIEN";
    if (
      phuongThuc === "POST" &&
      typeof merchantCode === "string" &&
      MERCHANT_RE.test(merchantCode) &&
      url === `${PORTAL_ORIGIN}/api/partners/merchant-portal/${merchantCode}/v2/transactions/search`
    ) {
      return "TIM_KIEM";
    }
    return null;
  }

  // ---------------- bắt header từ lời gọi CỦA APP ----------------

  function docHeaders(h: unknown): CapHeader[] {
    const ra: CapHeader[] = [];
    if (!h) return ra;
    if (typeof (h as { forEach?: unknown }).forEach === "function" && !Array.isArray(h)) {
      (h as { forEach(fn: (v: string, k: string) => void): void }).forEach((v, k) => ra.push([String(k), String(v)]));
      return ra;
    }
    if (Array.isArray(h)) {
      for (const cap of h) if (Array.isArray(cap) && cap.length === 2) ra.push([String(cap[0]), String(cap[1])]);
      return ra;
    }
    if (laObject(h)) for (const [k, v] of Object.entries(h)) ra.push([k, String(v)]);
    return ra;
  }

  /** Merchant của lời gọi search của app; không phải search ⇒ null. */
  function merchantCuaTimKiem(method: unknown, url: unknown): string | null {
    if (typeof url !== "string" || String(method ?? "GET").toUpperCase() !== "POST") return null;
    let u: URL;
    try {
      u = new URL(url, W.location.href);
    } catch {
      return null;
    }
    if (u.origin !== PORTAL_ORIGIN) return null;
    const m = TIM_KIEM_RE.exec(u.pathname);
    return m ? m[1] : null;
  }

  /** Thân search của app có đúng là JSON thuần như đã đo (roadmap §2.3)? Không ⇒ coi là mã hoá. */
  function laThanTimKiemThuan(b: unknown): boolean {
    if (typeof b !== "string") return false;
    try {
      const j: unknown = JSON.parse(b);
      return (
        laObject(j) &&
        typeof j.page_index === "number" &&
        typeof j.page_size === "number" &&
        typeof j.transaction_time_from === "string" &&
        typeof j.transaction_time_to === "string"
      );
    } catch {
      return false;
    }
  }

  function ghiNhanBat(merchant: string, headers: CapHeader[], thanMaHoa: boolean): void {
    daBat.set(merchant, { headers, thanMaHoa });
    soBat.set(merchant, (soBat.get(merchant) ?? 0) + 1);
  }

  function quanSatFetch(input: unknown, init: unknown): { merchant: string; headers: CapHeader[]; thanThuan: Promise<boolean> } | null {
    const i = laObject(init) ? init : {};
    const laRequest = laObject(input) && typeof input.url === "string" && typeof input.clone === "function";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : laRequest ? String(input.url) : null;
    const method = i.method ?? (laRequest ? (input as { method?: unknown }).method : "GET");
    const merchant = merchantCuaTimKiem(method, url);
    if (!merchant) return null;
    const headers = [...(laRequest ? docHeaders((input as { headers?: unknown }).headers) : []), ...docHeaders(i.headers)];
    let thanThuan: Promise<boolean>;
    if (i.body !== undefined) thanThuan = Promise.resolve(laThanTimKiemThuan(i.body));
    else if (laRequest) {
      thanThuan = (input as { clone(): { text(): Promise<string> } })
        .clone()
        .text()
        .then(laThanTimKiemThuan, () => false);
    } else thanThuan = Promise.resolve(false);
    return { merchant, headers, thanThuan };
  }

  W.fetch = function (this: unknown, ...args: [unknown, unknown?]): Promise<PhanHoiTrang> {
    let qs: ReturnType<typeof quanSatFetch> = null;
    try {
      qs = quanSatFetch(args[0], args[1]);
    } catch {
      // quan sát hỏng KHÔNG được làm hỏng lời gọi của app — bỏ qua lượt bắt này
    }
    const p = gocFetch.apply(this, args);
    if (qs) {
      const q = qs;
      p.then(
        async (res) => {
          if (res && res.status >= 200 && res.status < 300) ghiNhanBat(q.merchant, q.headers, !(await q.thanThuan));
        },
        () => undefined,
      );
    }
    return p;
  };

  const xhrProto = W.XMLHttpRequest?.prototype;
  if (xhrProto) {
    const gocOpen = xhrProto.open;
    const gocSet = xhrProto.setRequestHeader;
    const gocSend = xhrProto.send;
    const theoDoi = new WeakMap<object, { method: unknown; url: unknown; headers: CapHeader[] }>();
    xhrProto.open = function (this: XhrInst, ...a: unknown[]) {
      try {
        theoDoi.set(this, { method: a[0], url: a[1] instanceof URL ? a[1].href : a[1], headers: [] });
      } catch {
        // bỏ qua — không làm hỏng app
      }
      return gocOpen.apply(this, a);
    };
    xhrProto.setRequestHeader = function (this: XhrInst, k: string, v: string) {
      try {
        theoDoi.get(this)?.headers.push([String(k), String(v)]);
      } catch {
        // bỏ qua
      }
      return gocSet.call(this, k, v);
    };
    xhrProto.send = function (this: XhrInst, b?: unknown) {
      try {
        const t = theoDoi.get(this);
        const merchant = t ? merchantCuaTimKiem(t.method, t.url) : null;
        if (t && merchant) {
          const headers = t.headers.slice();
          const thanMaHoa = !laThanTimKiemThuan(b);
          this.addEventListener("loadend", () => {
            if (this.status >= 200 && this.status < 300) ghiNhanBat(merchant, headers, thanMaHoa);
          });
        }
      } catch {
        // bỏ qua
      }
      return gocSend.call(this, b);
    };
  }

  // ---------------- thực thi lệnh của extension ----------------

  function laChuyenHuong(res: PhanHoiTrang): boolean {
    return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
  }

  function chonTruong(r: unknown): Record<string, unknown> | null {
    if (!laObject(r)) return null;
    const o: Record<string, unknown> = {};
    for (const k of KHOA_GIAO_DICH) {
      if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
      const v = r[k];
      o[k] = v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;
    }
    return o;
  }

  function hai(n: number): string {
    return String(n).padStart(2, "0");
  }

  function isoVN(ms: number): string {
    const d = new Date(Math.floor(ms / 1000) * 1000 + 7 * 3600_000);
    return `${d.getUTCFullYear()}-${hai(d.getUTCMonth() + 1)}-${hai(d.getUTCDate())}T${hai(d.getUTCHours())}:${hai(d.getUTCMinutes())}:${hai(d.getUTCSeconds())}+07:00`;
  }

  /**
   * MỐC `exp` của access token (chỉ thời điểm — D10). Không giải được ⇒ KHÔNG biết hạn (null).
   * RV5: KHÔNG lùi về `expires` của session — với NextAuth JWT nó TRƯỢT (= lúc gọi + maxAge) ở mỗi lần gọi
   * /api/auth/session: vừa phá chống nháy (mốc "đổi" ở mỗi keepalive), vừa báo máy chủ hạn +30 ngày.
   */
  function tachHetHan(user: Record<string, unknown>): { hetHanLuc: string | null; nguon: string | null } {
    const at = user.accessToken;
    if (typeof at === "string") {
      const phan = at.split(".");
      if (phan.length === 3) {
        try {
          const b64 = phan[1].replace(/-/g, "+").replace(/_/g, "/");
          const payload: unknown = JSON.parse(W.atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
          const exp = laObject(payload) ? payload.exp : null;
          if (typeof exp === "number" && Number.isFinite(exp) && exp > 1e9 && exp < 1e11) {
            return { hetHanLuc: isoVN(exp * 1000), nguon: "ACCESS_TOKEN" };
          }
        } catch {
          // không phải JWT đọc được ⇒ không biết hạn
        }
      }
    }
    return { hetHanLuc: null, nguon: null };
  }

  async function goi(url: string, init: Record<string, unknown>): Promise<PhanHoiTrang | null> {
    try {
      return await gocFetch.call(W, url, {
        ...init,
        credentials: "same-origin",
        redirect: "manual",
        cache: "no-store",
        mode: "same-origin",
      });
    } catch {
      return null;
    }
  }

  async function goiPhien(url: string, merchant: string): Promise<KetQua> {
    const res = await goi(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!res) return loi("NETWORK", merchant);
    if (laChuyenHuong(res)) return { loai: "CHUYEN_HUONG", dauHeader: dau(merchant) };
    if (res.status === 401 || res.status === 403) return { loai: "HET_PHIEN", httpStatus: res.status, dauHeader: dau(merchant) };
    if (!res.ok) return loi("PORTAL_HTTP_ERROR", merchant, res.status);
    let j: unknown;
    try {
      j = JSON.parse(await res.text());
    } catch {
      return loi("PORTAL_BAD_SHAPE", merchant);
    }
    const user = laObject(j) && laObject(j.user) ? j.user : null;
    const het = user ? tachHetHan(user) : { hetHanLuc: null, nguon: null };
    return {
      loai: "PHIEN",
      httpStatus: res.status,
      coUser: user !== null,
      hetHanLuc: het.hetHanLuc,
      nguonHetHan: het.nguon,
      dauHeader: dau(merchant),
    };
  }

  function docThanLenh(t: unknown): ThanTimKiem | null {
    if (!laObject(t)) return null;
    const khoa = Object.keys(t).sort().join(",");
    if (khoa !== "page_index,page_size,transaction_time_from,transaction_time_to") return null;
    const { page_index, page_size, transaction_time_from, transaction_time_to } = t;
    if (typeof page_index !== "number" || !Number.isInteger(page_index) || page_index < 0 || page_index > 100_000) return null;
    if (typeof page_size !== "number" || !Number.isInteger(page_size) || page_size < 1 || page_size > 200) return null;
    if (typeof transaction_time_from !== "string" || !GIO_RE.test(transaction_time_from)) return null;
    if (typeof transaction_time_to !== "string" || !GIO_RE.test(transaction_time_to)) return null;
    return { page_index, page_size, transaction_time_from, transaction_time_to };
  }

  async function goiTimKiem(url: string, merchant: string, than: ThanTimKiem): Promise<KetQua> {
    const bat = daBat.get(merchant);
    if (!bat) return loi("HEADER_NOT_CAPTURED", merchant);
    if (bat.thanMaHoa) return loi("BODY_ENCRYPTED", merchant);
    const headers = new W.Headers();
    for (const [k, v] of bat.headers) {
      try {
        headers.set(k, v);
      } catch {
        // header trình duyệt cấm đặt (vd content-length) — bỏ
      }
    }
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    const res = await goi(url, { method: "POST", headers, body: JSON.stringify(than) });
    if (!res) return loi("NETWORK", merchant);
    if (laChuyenHuong(res)) {
      // RV5: như 401 — header đã bị đá, đừng dùng lại (chờ app gọi lại = bằng chứng phiên mới).
      daBat.delete(merchant);
      return { loai: "CHUYEN_HUONG", dauHeader: dau(merchant) };
    }
    if (res.status === 401 || res.status === 403) {
      daBat.delete(merchant); // header cũ không còn dùng được — chờ app gọi lại
      return { loai: "HET_PHIEN", httpStatus: res.status, dauHeader: dau(merchant) };
    }
    if (!res.ok) return loi("PORTAL_HTTP_ERROR", merchant, res.status);
    let j: unknown;
    try {
      j = JSON.parse(await res.text());
    } catch {
      return loi("PORTAL_BAD_SHAPE", merchant);
    }
    if (!laObject(j) || !Array.isArray(j.data) || !laObject(j.meta)) return loi("PORTAL_BAD_SHAPE", merchant);
    const rows: Record<string, unknown>[] = [];
    for (const r of j.data) {
      const o = chonTruong(r);
      if (o) rows.push(o);
    }
    const pi = j.meta.page_index;
    return {
      loai: "TRANG",
      httpStatus: res.status,
      rows,
      totalItems: j.meta.total_items,
      pageIndex: typeof pi === "number" && Number.isInteger(pi) ? pi : null,
      dauHeader: dau(merchant),
    };
  }

  async function xuLyLenh(l: unknown): Promise<KetQua> {
    if (!laObject(l) || l.loai !== "GOI") return loi("BAD_COMMAND");
    const merchant = typeof l.merchantCode === "string" ? l.merchantCode : "";
    const loai = urlChoPhep(l.phuongThuc, l.url, merchant);
    if (!loai) return loi("URL_BLOCKED", merchant);
    const url = l.url as string;
    if (loai === "PHIEN") {
      if (l.than !== undefined) return loi("BAD_COMMAND", merchant);
      return goiPhien(url, merchant);
    }
    const than = docThanLenh(l.than);
    if (!than) return loi("BAD_COMMAND", merchant);
    return goiTimKiem(url, merchant, than);
  }

  W.addEventListener("message", (ev: TinCuaSo) => {
    // Chỉ tin từ CHÍNH cửa sổ này, đúng origin portal, đúng kênh, đúng chiều, nonce đúng dạng.
    if (ev.source !== W || ev.origin !== PORTAL_ORIGIN) return;
    const d = ev.data;
    if (!laObject(d) || d.kenh !== KENH || d.huong !== "lenh" || typeof d.id !== "string" || !ID_RE.test(d.id)) return;
    const id = d.id;
    void xuLyLenh(d.lenh)
      .catch(() => loi("BAD_COMMAND"))
      .then((ketQua) => {
        W.postMessage({ kenh: KENH, huong: "ket-qua", id, ketQua }, PORTAL_ORIGIN);
      });
  });
})();
