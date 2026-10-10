// lib/cham-cong/scope-href.ts — giữ NGỮ CẢNH (kỳ · khối · ngày) khi đi giữa 13 màn chấm công.
//
// Vì sao file này tồn tại: mỗi màn tự ghép query bằng tay nên chuyển tab là rơi tham số —
// `date-nav-input.tsx` push `/cham-cong?date=` và làm rơi `coSo` là bug có thật. Ở đây một
// chỗ quyết định tab nào giữ tham số nào, và một hàm ghép chuỗi bỏ giá trị rỗng.
//
// THUẦN — không `@/lib/db`, không `next/*`. Cố ý KHÔNG import `currentPeriodKey`/
// `parsePeriodKey` từ `./period`: file đó kéo theo `@/lib/db` (PrismaClient) và cả cây
// ScopeBar/ModuleNav/ConfigTabs nhập file này. Hai công thức dưới đây suy thẳng từ
// `lib/time/vn` nên KHÔNG lệch được với period.ts: kỳ = 7 ký tự đầu của ngày theo giờ VN.
import { vnYmd } from "@/lib/time/vn";

export type ScopeQuery = Record<string, string | number | null | undefined>;

/** Thứ tự cố định để href của cùng một trạng thái luôn ra một chuỗi (dễ so trong test,
 *  không đẻ hai bản cache khác nhau cho cùng một trang). */
const PARAM_ORDER = ["ky", "coSo", "date"] as const;

/** Ghép query, BỎ mọi giá trị rỗng/null/undefined. Không tham số nào ⇒ trả `base` trần. */
export function hrefWith(base: string, q: ScopeQuery = {}): string {
  const known = PARAM_ORDER as readonly string[];
  const keys = [...known.filter((k) => k in q), ...Object.keys(q).filter((k) => !known.includes(k))];
  const parts: string[] = [];
  for (const k of keys) {
    const v = q[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  }
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

export type ScopeCtx = {
  ky?: string | null;
  coSo?: string | null;
  date?: string | null;
  /** Tiêm được để test không phụ thuộc đồng hồ máy chạy. */
  now?: Date;
};

/** Tab đích giữ tham số nào. Khớp đúng ĐƯỜNG DẪN (không phải tiền tố) vì `/don-tu/cua-toi`
 *  và `/don-tu` giữ khác nhau. Không khai ⇒ "none" (vd `/holidays`, `/cham-cong/checkin`). */
type ScopeMode = "date+coSo" | "ky+coSo" | "coSo" | "none";

const TAB_MODE: Record<string, ScopeMode> = {
  "/cham-cong": "date+coSo",
  "/cham-cong/phan-ca": "ky+coSo",
  "/cham-cong/phan-ca/import": "ky+coSo",
  "/cham-cong/ky-cong": "ky+coSo",
  "/cham-cong/thong-ke": "ky+coSo",
  "/cham-cong/cong-day": "ky+coSo",
  "/cham-cong/doi-soat": "ky+coSo",
  "/cham-cong/danh-muc-ca": "ky+coSo",
  "/cham-cong/loai-nghi": "ky+coSo",
  "/cham-cong/diem-cham": "ky+coSo",
  "/cham-cong/khung-ca": "ky+coSo",
  "/cham-cong/ghi-chu": "ky+coSo",
  "/don-tu": "coSo",
  // Cụm "Của tôi" + kiosk KHÔNG nhận ngữ cảnh khối: lich-ca đọc dữ liệu của chính người
  // đăng nhập (`?month=`), checkin đi bằng `?w=&t=` của mã QR, man-hinh dùng `?centerId=`.
  "/cham-cong/lich-ca": "none",
  "/cham-cong/checkin": "none",
  "/cham-cong/man-hinh": "none",
  "/don-tu/cua-toi": "none",
};

/** Kỳ "YYYY-MM" hợp lệ? (tháng 01–12) */
function validKy(ky: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(ky);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

/** Kỳ của "hôm nay" theo giờ VN. Bằng đúng `currentPeriodKey()` của period.ts. */
function kyNow(now: Date): string {
  return vnYmd(now).slice(0, 7);
}

function ctxKy(ctx: ScopeCtx): string | null {
  const ky = ctx.ky?.trim();
  if (ky && validKy(ky)) return ky;
  const d = ctx.date?.trim();
  if (d && validKy(d.slice(0, 7))) return d.slice(0, 7);
  return null;
}

/**
 * Href của một tab, mang theo ngữ cảnh đang xem.
 *
 * `canCoSo` = khối đang chọn CÒN hợp lệ ở tab đích (page tính bằng `scope.has(action, coSo)`).
 * Sai thì đừng đẩy `?coSo=` sang — màn đích sẽ tự rơi về khối đầu tiên có quyền, còn đẩy
 * sang một khối cấm là in ra bảng rỗng mà không nói vì sao.
 */
export function scopeHref(tabHref: string, ctx: ScopeCtx, canCoSo = true): string {
  const base = tabHref.split("?")[0];
  const mode = TAB_MODE[base] ?? "none";
  if (mode === "none") return base;

  const now = ctx.now ?? new Date();
  const ky = ctxKy(ctx);
  const coSo = canCoSo ? ctx.coSo?.trim() || null : null;

  if (mode === "coSo") return hrefWith(base, { coSo });
  if (mode === "date+coSo") {
    // Không có `date` thì suy từ kỳ: kỳ hiện tại ⇒ HÔM NAY (mở ra là thấy việc của mình),
    // kỳ khác ⇒ mùng 1 (không nhảy sang tháng khác vì hôm nay là ngày 31).
    const date = ctx.date?.trim() || (ky ? (ky === kyNow(now) ? vnYmd(now) : `${ky}-01`) : null);
    return hrefWith(base, { coSo, date });
  }
  return hrefWith(base, { ky, coSo });
}

/** Kỳ dịch `delta` tháng. Kỳ sai định dạng ⇒ trả nguyên (không đoán hộ). */
export function shiftKy(ky: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ky.trim());
  if (!m) return ky;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return ky;
  const total = y * 12 + (mo - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/**
 * Nút ‹ › tháng ở màn Bảng công ngày: đổi `?date=` sang tháng liền kề.
 *
 * Trả HÔM NAY nếu nhảy vào tháng hiện tại, không thì MÙNG 1. Cố ý không giữ ngày trong
 * tháng: từ 31/01 bấm › mà giữ ngày là ra 31/02 — một ngày không tồn tại; mùng 1 luôn có
 * thật ở mọi tháng nên không cần kẹp 30/28.
 */
export function monthStepDate(date: string, delta: number, now = new Date()): string {
  const head = date.trim().slice(0, 7);
  const base = validKy(head) ? head : kyNow(now);
  const ky = shiftKy(base, delta);
  return ky === kyNow(now) ? vnYmd(now) : `${ky}-01`;
}
