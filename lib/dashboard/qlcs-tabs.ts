// A-02-UI — 4 tab của dashboard QLCS (Tài chính · Kinh doanh · Chi phí Marketing ·
// Tương tác KH) và cách dựng link chuyển tab.
//
// Phần THUẦN: không `server-only`, không Prisma — Vitest chạy được không cần DB, cùng
// khuôn `lib/reports/scope-filters.ts`.
//
// ┌─ Vì sao tab là `?tab=` chứ không phải 4 route con ────────────────────────────────┐
// │ AC A-02-3 đòi 4 tab đọc CÙNG `searchParams` và đổi tab KHÔNG mất bộ lọc. Thanh lọc │
// │ phải nằm trên tất cả các tab; mà `layout.tsx` của Next App Router KHÔNG nhận       │
// │ `searchParams` — đặt thanh lọc ở layout thì nó không đọc nổi giá trị đang áp dụng. │
// │ ⇒ MỘT trang đọc `?tab=`, thân tab là 4 nhánh. Đây cũng là hình dạng PRD §6.2 mô tả │
// │ ("page.tsx đọc searchParams → render ScopeFilterBar + tab đang chọn").             │
// └───────────────────────────────────────────────────────────────────────────────────┘

export const QLCS_TAB_IDS = [
  "tai-chinh",
  "kinh-doanh",
  "chi-phi-marketing",
  "tuong-tac-kh",
] as const;

export type QlcsTabId = (typeof QLCS_TAB_IDS)[number];

/** Tab mở ra đầu tiên khi `?tab=` vắng mặt hoặc là giá trị lạ. */
export const DEFAULT_QLCS_TAB: QlcsTabId = "tai-chinh";

/** Nhãn tiếng Việt hiển thị trên thanh tab — thứ tự ở đây LÀ thứ tự trên màn hình. */
export const QLCS_TABS: readonly { id: QlcsTabId; label: string }[] = [
  { id: "tai-chinh", label: "Tài chính" },
  { id: "kinh-doanh", label: "Kinh doanh" },
  { id: "chi-phi-marketing", label: "Chi phí Marketing" },
  { id: "tuong-tac-kh", label: "Tương tác KH" },
];

const TAB_SET = new Set<string>(QLCS_TAB_IDS);

/**
 * `?tab=` → tab hợp lệ. Giá trị lạ **lùi về mặc định**, không 404 và không trang trắng:
 * đường dẫn lưu sẵn từ bản trước (hoặc gõ nhầm) vẫn phải mở ra được một cái gì đó.
 * Tham số lặp → lấy giá trị ĐẦU, khớp `URLSearchParams.get()`.
 */
export function resolveQlcsTab(raw: string | string[] | undefined): QlcsTabId {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first && TAB_SET.has(first) ? (first as QlcsTabId) : DEFAULT_QLCS_TAB;
}

/**
 * Bộ lọc ĐÃ GIẢI, ở dạng đủ để dựng lại URL.
 *
 * Cố ý nhận **giá trị đã chuẩn hoá** (`ScopeFilterCore.dateFromStr`/`dateToStr`,
 * `filters.centerIds`) chứ KHÔNG nhận `searchParams` thô: chuyền tiếp chuỗi thô thì
 * ngày tương lai bị kẹp / cơ sở ngoài phạm vi bị loại sẽ **sống lại** ở tab kế tiếp, và
 * thanh lọc lại hiện một đằng, số liệu một nẻo.
 */
export type QlcsFilterQuery = {
  centerIds: string[];
  isAllCenters: boolean;
  /** `YYYY-MM-DD` đã chuẩn hoá. */
  dateFrom: string;
  dateTo: string;
  /** `groupByCenter` — đã bị ép tắt khi chỉ có 1 cơ sở. */
  split: boolean;
};

/**
 * Tham số URL của bộ lọc (KHÔNG gồm `tab`) — dùng chung cho link tab và cho nút
 * "Xoá lọc" của thanh lọc.
 *
 * Hai chỗ cố ý PHÁT THIẾU để URL mặc định sạch và khớp đúng nghĩa của resolver:
 *  • `isAllCenters` ⇒ bỏ hẳn `center` (vắng mặt = toàn bộ phạm vi actor —
 *    `resolveScopeCenters`). Liệt kê tay đủ cả phạm vi cũng cho cùng kết quả, nhưng
 *    URL sẽ vỡ ngay khi người này được gán thêm cơ sở thứ N+1.
 *  • `split === false` ⇒ bỏ hẳn `split` (mặc định là GỘP — OQ-4).
 */
export function qlcsFilterParams(q: QlcsFilterQuery): URLSearchParams {
  const qs = new URLSearchParams();
  if (!q.isAllCenters) for (const id of q.centerIds) qs.append("center", id);
  qs.set("dateFrom", q.dateFrom);
  qs.set("dateTo", q.dateTo);
  if (q.split) qs.set("split", "1");
  return qs;
}

/** Link sang một tab khác, mang theo NGUYÊN bộ lọc đang áp dụng. */
export function buildQlcsTabHref(
  basePath: string,
  q: QlcsFilterQuery,
  tab: QlcsTabId,
): string {
  const qs = new URLSearchParams();
  qs.set("tab", tab);
  for (const [k, v] of qlcsFilterParams(q)) qs.append(k, v);
  return `${basePath}?${qs.toString()}`;
}
