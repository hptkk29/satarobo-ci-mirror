// lib/marketing/attribution.ts — thu & giữ nguồn khách (affiliate `?ref=` + UTM +
// click-id) qua nhiều lần chuyển trang, để form đăng ký gửi kèm khi submit.
//
// Vì sao cần: khách vào `satarobo.vn/?ref=ANNGUYEN` rồi bấm qua `/khoa-hoc/...` mới
// điền form — lúc submit URL đã sạch tham số. Trước đây KHÔNG có chỗ nào giữ lại,
// nên `Lead.affiliateId` chưa bao giờ được gắn dù toàn bộ hệ affiliate (bảng, màn
// quản lý, link ?ref=) đã dựng từ 31/07; các cột UTM của Lead cũng luôn rỗng với
// lead đến từ form web (API nhận sẵn, chỉ là không ai gửi).
//
// Cookie first-party, KHÔNG phải cookie theo dõi bên thứ ba: chỉ lưu tham số chính
// khách mang tới, dùng đúng cho việc quy nguồn của chính họ.
//
// ── Quy tắc gộp (đảo 09/10/2026 — nguồn lead động, docs/source-commission/03 §2.13) ──────────────────
//   · `ref` (mã người giới thiệu) là FIRST-TOUCH trong cửa sổ 90 ngày: khách bấm link giới thiệu của
//     người A rồi (trong 90 ngày) link của người B thì VẪN tính cho A. Trước đây là last-touch ("tính
//     cho B") — đảo vì người giới thiệu là NGUỒN GỐC của khách, không phải đường vào chuyển đổi.
//     Cửa sổ tính từ lần claim ĐẦU (`refAt`) và KHÔNG được gia hạn bởi lần ghé lại hay bởi lần ghi lại
//     cookie: `max-age` của cookie bị làm mới mỗi lần ghi nên một mình nó không thể là hạn của `ref`.
//     Hết 90 ngày thì ref mới được nhận; ref hết hạn mà không có ref mới thì BỊ BỎ.
//   · utm_* / fbclid / gclid giữ LAST-TOUCH (mới ghi đè, vắng thì giữ): chúng là "đường vào chuyển
//     đổi" mà quảng cáo cần đo, đảo chúng là làm sai báo cáo ads.
//   · Server vẫn là nơi quyết định THẮNG giữa các lead (first-claim theo `LeadAttribution.attributedAt`);
//     cookie chỉ giải quyết "trong MỘT trình duyệt".
//
// ⚠️ Cái đo KHÔNG được ở đây: cookie ghi bằng JS có thể bị trình duyệt (Safari ITP) rút xuống ~7 ngày.
// Cửa sổ 90 ngày là cửa sổ TỐI ĐA của mã, không phải bảo đảm — cần đo trên thiết bị thật nếu sau này
// muốn biết tỉ lệ lead mất `ref`.

export const ATTRIBUTION_COOKIE = "sr_attr";
/** Cửa sổ quy nguồn 90 ngày — bằng cửa sổ hưởng hoa hồng ở server (`nguon.cuaSoGhiCongNgay`, mặc định 90). */
export const ATTRIBUTION_MAX_AGE_DAYS = 90;
const NGAY_MS = 24 * 60 * 60 * 1000;
const CUA_SO_REF_MS = ATTRIBUTION_MAX_AGE_DAYS * NGAY_MS;

export type Attribution = {
  ref?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  fbclid?: string;
  gclid?: string;
};

/**
 * Bản ĐANG LƯU trong cookie: `Attribution` + mốc claim `ref` (ms epoch, đồng hồ khách). `refAt` CHỈ sống trong cookie — `readAttribution()` bỏ nó
 * trước khi trả, vì kết quả đó được trải thẳng vào payload gửi `/api/leads` (và validator lead không có chỗ cho khoá lạ).
 */
export type AttributionDaLuu = Attribution & { refAt?: number };

/** URL param → khoá trong Attribution. */
const PARAM_MAP: ReadonlyArray<readonly [string, keyof Attribution]> = [
  ["ref", "ref"],
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["utm_term", "utmTerm"],
  ["utm_content", "utmContent"],
  ["fbclid", "fbclid"],
  ["gclid", "gclid"],
];

/** Trần độ dài khớp validator lead (`ref` 32, utm 100) — cắt tại nguồn cho gọn. */
const MAX_LEN: Partial<Record<keyof Attribution, number>> = { ref: 32 };
const DEFAULT_MAX_LEN = 100;

function clean(value: string | null, key: keyof Attribution): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return v.slice(0, MAX_LEN[key] ?? DEFAULT_MAX_LEN);
}

/** Đọc tham số quy nguồn từ query string. THUẦN — test được, không chạm window. */
export function parseAttributionFromSearch(search: string): Attribution {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: Attribution = {};
  for (const [param, key] of PARAM_MAP) {
    const v = clean(params.get(param), key);
    if (v) out[key] = v;
  }
  return out;
}

/**
 * `ref` đang lưu có CÒN HẠN không. THUẦN.
 *  · không có `refAt` (cookie đời 30 ngày, hoặc `refAt` hỏng đã bị bỏ lúc đọc) ⇒ CÒN HẠN — cookie cũ sống tối đa 30 ngày nên chắc chắn dưới 90;
 *    người gọi đóng dấu `refAt = now` để từ đây tính hạn;
 *  · `refAt` hữu hạn: còn hạn khi 0 ≤ now − refAt < 90 ngày. Tương lai (đồng hồ khách chỉnh) ⇒ HẾT HẠN, kẻo một mốc tương lai khoá `ref` mãi.
 */
function refConHan(stored: AttributionDaLuu, nowMs: number): boolean {
  if (stored.ref === undefined) return false;
  if (stored.refAt === undefined) return true;
  if (!Number.isFinite(stored.refAt)) return false;
  const tuoi = nowMs - stored.refAt;
  return tuoi >= 0 && tuoi < CUA_SO_REF_MS;
}

/**
 * Gộp bản đang lưu với bản vừa đọc từ URL. THUẦN — `nowMs` BẮT BUỘC (hàm không đọc đồng hồ; luật 19).
 *  · `ref`: FIRST-TOUCH. Còn hạn ⇒ giữ ref đang lưu (kể cả khi URL mang ref khác hoặc cùng ref — mốc claim KHÔNG đổi). Hết hạn/chưa có ⇒
 *    nhận ref của URL (mốc = bây giờ); không có ref nào ⇒ bỏ ref + refAt.
 *  · mọi khoá khác: last-touch (mới ghi đè, vắng thì giữ).
 */
export function mergeAttribution(stored: AttributionDaLuu, incoming: Attribution, nowMs: number): AttributionDaLuu {
  const { ref: refCu, refAt: refAtCu, ...khacCu } = stored;
  const { ref: refMoi, ...khacMoi } = incoming;
  const out: AttributionDaLuu = { ...khacCu, ...khacMoi };
  if (refCu !== undefined && refConHan(stored, nowMs)) {
    out.ref = refCu;
    out.refAt = refAtCu !== undefined && Number.isFinite(refAtCu) ? refAtCu : nowMs;
  } else if (refMoi !== undefined) {
    out.ref = refMoi;
    out.refAt = nowMs;
  }
  return out;
}

/** Serialize/parse qua cookie — JSON gọn, luôn fail-safe về {} khi hỏng. THUẦN. */
export function serializeAttribution(a: AttributionDaLuu): string {
  return encodeURIComponent(JSON.stringify(a));
}

/** Bản ĐANG LƯU (có `refAt`). Khoá lạ / giá trị không đúng kiểu bị bỏ; `refAt` không phải số hữu hạn dương ⇒ bỏ (coi như cookie cũ). */
export function deserializeAttributionDaLuu(raw: string | null | undefined): AttributionDaLuu {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== "object") return {};
    const src = parsed as Record<string, unknown>;
    const out: AttributionDaLuu = {};
    for (const [, key] of PARAM_MAP) {
      const v = src[key];
      if (typeof v === "string") {
        const c = clean(v, key);
        if (c) out[key] = c;
      }
    }
    if (out.ref !== undefined && typeof src.refAt === "number" && Number.isFinite(src.refAt) && src.refAt > 0) out.refAt = src.refAt;
    return out;
  } catch {
    return {};
  }
}

/** Bản CÔNG KHAI (không `refAt`) — hình dạng được phép trải vào payload gửi server. */
export function deserializeAttribution(raw: string | null | undefined): Attribution {
  const { refAt: _refAt, ...cong } = deserializeAttributionDaLuu(raw);
  return cong;
}

/** Dấu vân tay NỘI DUNG của bản lưu — không phụ thuộc thứ tự khoá (so JSON thô sẽ ghi lại cookie mỗi lần đổi trang chỉ vì khác thứ tự). */
function dauVanTay(a: AttributionDaLuu): string {
  return [...PARAM_MAP.map(([, k]) => a[k] ?? ""), a.refAt ?? ""].join("");
}

/** Bản công khai TẠI `nowMs`: bỏ `ref` đã quá 90 ngày và bỏ `refAt`. THUẦN. */
export function lamHieuLucAttribution(stored: AttributionDaLuu, nowMs: number): Attribution {
  const { ref, refAt: _refAt, ...khac } = stored;
  return ref !== undefined && refConHan(stored, nowMs) ? { ...khac, ref } : khac;
}

/** Đọc 1 cookie theo tên từ chuỗi document.cookie. THUẦN. */
export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

// ─── Phần chạm trình duyệt (chỉ gọi từ client component) ────────────────────

/** Nguồn đang lưu (đã lọc ref quá hạn, không `refAt`); SSR/không có cookie → {}. */
export function readAttribution(): Attribution {
  if (typeof document === "undefined") return {};
  return lamHieuLucAttribution(deserializeAttributionDaLuu(readCookie(document.cookie, ATTRIBUTION_COOKIE)), Date.now());
}

/**
 * Đọc tham số trên URL hiện tại, gộp với bản đang lưu rồi ghi lại cookie.
 * Không có tham số mới VÀ chưa từng lưu gì → không ghi cookie (không tạo cookie rác).
 */
export function captureAttribution(search?: string): Attribution {
  if (typeof document === "undefined") return {};
  const nowMs = Date.now();
  const incoming = parseAttributionFromSearch(search ?? window.location.search);
  const raw = readCookie(document.cookie, ATTRIBUTION_COOKIE);
  const stored = deserializeAttributionDaLuu(raw);
  const merged = mergeAttribution(stored, incoming, nowMs);
  if (Object.keys(merged).length > 0) {
    // Chỉ ghi lại khi thực sự có thay đổi (đỡ set cookie mỗi lần đổi trang): có tham số mới, chưa có cookie, hoặc phép gộp tự đổi bản lưu
    // (đóng dấu `refAt` cho cookie đời 30 ngày / bỏ ref quá hạn).
    const doiBanLuu = dauVanTay(merged) !== dauVanTay(stored);
    if (Object.keys(incoming).length > 0 || raw === null || doiBanLuu) {
      const maxAge = ATTRIBUTION_MAX_AGE_DAYS * 24 * 60 * 60;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${ATTRIBUTION_COOKIE}=${serializeAttribution(merged)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
    }
  } else if (raw !== null) {
    // Cookie có mà không đọc được / chỉ còn ref hết hạn đã bị bỏ ⇒ gộp ra rỗng: dọn để không giữ rác.
    document.cookie = `${ATTRIBUTION_COOKIE}=; path=/; max-age=0`;
  }
  return lamHieuLucAttribution(merged, nowMs);
}
