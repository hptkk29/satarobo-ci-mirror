// lib/nguon-hoa-hong/url.ts — dựng query của khung module. THUẦN (không next/*, không DB).
//
// Bộ lọc quan trọng nằm TRÊN URL (06 §3 phản mục tiêu "lọc ở client cho bảng dày"): đổi bộ lọc là đổi địa
// chỉ, tải lại / chia sẻ link / nút Back đều đúng. Mỗi chỗ tự ghép chuỗi là một chỗ rơi tham số khi đổi tab,
// nên ghép ở MỘT hàm: bỏ giá trị rỗng, và `trang=1` không bao giờ lên URL (mặc định).

export type TruyVan = Record<string, string | number | null | undefined>;

/** Thứ tự cố định ⇒ cùng một trạng thái luôn ra cùng một chuỗi (test so được, cache không nhân đôi). */
const THU_TU = ["coSo", "xem", "van-de", "trangthai", "trang"] as const;

export function hrefVoi(base: string, q: TruyVan = {}): string {
  const biet = THU_TU as readonly string[];
  const khoa = [...biet.filter((k) => k in q), ...Object.keys(q).filter((k) => !biet.includes(k))];
  const phan: string[] = [];
  for (const k of khoa) {
    const v = q[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (k === "trang" && s === "1") continue; // trang 1 là mặc định — không lên URL
    phan.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  }
  return phan.length ? `${base}?${phan.join("&")}` : base;
}

/** `?trang=` → số nguyên ≥ 1; rác/âm/0/NaN ⇒ 1 (không ném, không đoán). */
export function docTrang(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(s ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Giá trị query đầu tiên dạng chuỗi, hoặc null (Next trả `string | string[] | undefined`). */
export function motGiaTri(raw: string | string[] | undefined): string | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return s && s.trim() !== "" ? s.trim() : null;
}

/**
 * `?trang=` đã đọc → trang HỢP LỆ theo tổng hiện có. Hàng chờ co lại khi người ta xử lý nó, nên F5 hay bookmark ở
 * trang cuối rất hay rơi quá biên; không kẹp thì bảng rỗng kèm câu "Hiển thị 2.451–30 / 30" (tu > den) mà nhánh
 * "rỗng" không chạy vì `tong > 0`. Tổng 0 ⇒ trang 1. Số trang là `ceil` (26 lead / 25 = 2 trang).
 */
export function kepTrang(trang: number, tong: number, kichThuoc: number): number {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  return Math.min(Math.max(1, Math.trunc(trang) || 1), soTrang);
}

/**
 * Mã trên đường dẫn (`/nguon/<ma>`) → chuỗi giải mã, hoặc `null` khi %-escape sai. `decodeURIComponent` trần ném
 * `URIError` với `%` đơn lẻ — người gõ URL sai sẽ nhận trang lỗi 500 (và Sentry nhận một lỗi không phải của hệ thống).
 */
export function giaiMaTrenUrl(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
