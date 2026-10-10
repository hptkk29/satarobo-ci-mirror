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
// Quy tắc gộp: tham số có mặt trên URL hiện tại GHI ĐÈ giá trị cũ (last-touch —
// khách bấm link giới thiệu của người B sau người A thì tính cho B); tham số không
// xuất hiện thì GIỮ giá trị đang lưu (đi sâu vào site không làm mất nguồn).

export const ATTRIBUTION_COOKIE = "sr_attr";
/** Cửa sổ quy nguồn 30 ngày — đủ dài cho chu kỳ tư vấn, không lưu vô hạn. */
export const ATTRIBUTION_MAX_AGE_DAYS = 30;

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

/** Gộp bản đang lưu với bản vừa đọc từ URL (mới ghi đè, thiếu thì giữ). THUẦN. */
export function mergeAttribution(stored: Attribution, incoming: Attribution): Attribution {
  return { ...stored, ...incoming };
}

/** Serialize/parse qua cookie — JSON gọn, luôn fail-safe về {} khi hỏng. THUẦN. */
export function serializeAttribution(a: Attribution): string {
  return encodeURIComponent(JSON.stringify(a));
}

export function deserializeAttribution(raw: string | null | undefined): Attribution {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== "object") return {};
    const src = parsed as Record<string, unknown>;
    const out: Attribution = {};
    for (const [, key] of PARAM_MAP) {
      const v = src[key];
      if (typeof v === "string") {
        const c = clean(v, key);
        if (c) out[key] = c;
      }
    }
    return out;
  } catch {
    return {};
  }
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

/** Nguồn đang lưu; SSR/không có cookie → {}. */
export function readAttribution(): Attribution {
  if (typeof document === "undefined") return {};
  return deserializeAttribution(readCookie(document.cookie, ATTRIBUTION_COOKIE));
}

/**
 * Đọc tham số trên URL hiện tại, gộp với bản đang lưu rồi ghi lại cookie.
 * Không có tham số mới VÀ chưa từng lưu gì → không ghi cookie (không tạo cookie rác).
 */
export function captureAttribution(search?: string): Attribution {
  if (typeof document === "undefined") return {};
  const incoming = parseAttributionFromSearch(search ?? window.location.search);
  const stored = readAttribution();
  const merged = mergeAttribution(stored, incoming);
  if (Object.keys(merged).length === 0) return merged;
  // Chỉ ghi lại khi thực sự có thay đổi (đỡ set cookie mỗi lần đổi trang).
  if (Object.keys(incoming).length > 0 || !readCookie(document.cookie, ATTRIBUTION_COOKIE)) {
    const maxAge = ATTRIBUTION_MAX_AGE_DAYS * 24 * 60 * 60;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${ATTRIBUTION_COOKIE}=${serializeAttribution(merged)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
  }
  return merged;
}
