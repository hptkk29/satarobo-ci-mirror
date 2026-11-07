// A-02 — Bộ lọc phạm vi dùng chung cho dashboard QLCS 4 tab (Tài chính / Kinh doanh /
// Chi phí Marketing / Tương tác KH). Phần THUẦN: không `server-only`, không Prisma, để
// Vitest chạy được không cần DB (cùng khuôn `lib/students/birthday-dates.ts`).
// Đường DB-backed `resolveScopeFilters(actor, sp)` nằm ở `lib/reports/filters.ts`.
//
// ┌─ Vì sao là hàm/kiểu MỚI chứ không sửa `ReportFilters` ────────────────────────────┐
// │ `ReportFilters.centerId` đơn trị đang được 8 trang /bao-cao/* đọc ở 11 chỗ, cộng   │
// │ 8 chỗ `selection={fc.selection}` và MỘT đường GHI (form mục tiêu doanh thu:        │
// │ bao-cao/doanh-thu/page.tsx → _actions.ts đọc formData "centerId"). Đổi nó sang     │
// │ mảng là vỡ cả đường đọc lẫn đường ghi ⇒ A-02 chỉ THÊM, không đụng cái cũ.          │
// └───────────────────────────────────────────────────────────────────────────────────┘
import { shiftDayKey, vnDayKey, vnDayStartUtc } from "@/lib/students/birthday-dates";

/**
 * Bộ lọc đã giải xong — thứ mọi hàm số liệu của B/C/D/E nhận vào.
 *
 * ⚠️ `centerIds` LUÔN tường minh, KHÔNG BAO GIỜ `null`. Đây là kết luận của vòng
 * red-team (RT-2): giả định "để null thì `scopedDb` vẫn chặn" đã bị BÁC BỎ —
 * `AdsInsightDaily` và `MarketingCostPeriod` KHÔNG có cột `centerId`, còn
 * `Conversation` + `RevenueTarget` nằm trong `SCOPE_EXEMPT` (`lib/db-scope.ts`) nên
 * `scopedDb` là pass-through. Phát ra danh sách tường minh thì chỗ gọi không có cách
 * nào "quên" lọc; dùng `scopeCenterWhere()` để dựng mệnh đề.
 */
export type ScopeFilters = {
  /** Cơ sở ĐÃ kiểm quyền = giao của (cơ sở actor được xem) × (cơ sở actor chọn). */
  centerIds: string[];
  /**
   * true = người xem KHÔNG thu hẹp (chọn "Tất cả cơ sở" trong phạm vi của mình).
   * Cần tách khỏi `centerIds` vì vài bảng dùng `centerId = NULL` với nghĩa "toàn hệ
   * thống" (`RevenueTarget`) hoặc "chưa gán cơ sở" (lead mới về): `{ in: [...] }` sẽ
   * LOẠI những dòng đó, nên chỉ khi cờ này bật thì tab mới được phép gộp chúng vào.
   */
  isAllCenters: boolean;
  /** 00:00 giờ VN của ngày bắt đầu (mốc UTC). Mặc định: ngày 01 tháng hiện tại. */
  dateFrom: Date;
  /** 23:59:59.999 giờ VN của ngày kết thúc (mốc UTC). Mặc định: hôm nay. */
  dateTo: Date;
  /** OQ-4 (24/08): false = gộp (mặc định) · true = tách từng cơ sở kèm dòng Tổng. */
  groupByCenter: boolean;
};

/** Phần giải được mà KHÔNG cần DB (tên cơ sở phải đọc DB nên nằm ở tầng trên). */
export type ScopeFilterCore = {
  filters: ScopeFilters;
  /**
   * OQ-4: công tắc "Tách theo cơ sở" CHỈ được render khi đang chọn ≥ 2 cơ sở — một cơ
   * sở thì tách và gộp cho ra cùng con số.
   */
  canSplit: boolean;
  /** Giá trị cho `<input type="date">` — LÀ giá trị đã chuẩn hoá/kẹp, không phải chuỗi thô. */
  dateFromStr: string;
  dateToStr: string;
  /**
   * Số cơ sở trong URL bị loại vì ngoài phạm vi actor. Dùng để hiện lời nhắc chung
   * ("một số cơ sở đã bị bỏ qua"). ⚠️ KHÔNG BAO GIỜ trả id/tên cơ sở ngoài phạm vi ra
   * ngoài — đó chính là cách một bộ lọc biến thành công cụ dò tên cơ sở.
   */
  droppedCenterCount: number;
};

/** searchParams dùng chung của 4 tab. Next trả `string | string[]` khi tham số lặp. */
export type ScopeFilterSearchParams = {
  /** `?center=cs1&center=cs2`, hoặc `ALL`/vắng mặt = toàn bộ phạm vi. */
  center?: string | string[];
  /** `YYYY-MM-DD`. */
  dateFrom?: string | string[];
  dateTo?: string | string[];
  /** `?split=1` = tách theo cơ sở (dùng chung cho cả 4 tab để đổi tab không mất trạng thái). */
  split?: string | string[];
};

/**
 * `URLSearchParams` → `ScopeFilterSearchParams`, cho các route (không phải page) muốn
 * giải LẠI đúng bộ lọc mà màn hình đang áp dụng — ví dụ đường xuất Excel C-04.
 *
 * ⚠️ `center` PHẢI đi qua `getAll`. Trang nhận `searchParams` từ Next nên `?center=a&
 * center=b` tới tay nó sẵn dạng mảng; còn route cầm `URLSearchParams`, ở đó `get()` chỉ
 * trả giá trị ĐẦU. Dùng `get()` ở đây là im lặng bỏ mọi cơ sở từ thứ hai trở đi: tệp
 * xuất ra hẹp hơn bảng trên màn, không có lỗi nào, và người dùng chỉ phát hiện khi đối
 * chiếu tay.
 */
export function parseScopeFilterSearchParams(
  qs: URLSearchParams,
): ScopeFilterSearchParams {
  return {
    center: qs.getAll("center"),
    dateFrom: qs.get("dateFrom") ?? undefined,
    dateTo: qs.get("dateTo") ?? undefined,
    split: qs.get("split") ?? undefined,
  };
}

/** Phần Actor mà bộ lọc cần — khai theo cấu trúc để module này không phải kéo `lib/db` vào. */
export type ScopeActor = {
  isSuperAdmin: boolean;
  isHoLevel: boolean;
  visibleCenterIds: string[];
};

const ALL = "ALL";
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tham số lặp → lấy giá trị ĐẦU, khớp hành vi `URLSearchParams.get()`. */
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function toList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * `YYYY-MM-DD` hợp lệ THẬT → chính nó; ngược lại `null`.
 *
 * Phải kiểm tra khứ hồi chứ không chỉ regex: `Date.UTC(2026, 12, 45)` tự TRÀN sang
 * 2027-02-14 mà không báo gì, tức "2026-13-45" sẽ lọt thành một ngày có thật.
 */
function parseDayKey(s: string | undefined): string | null {
  if (!s || !DAY_KEY_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m! - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return s;
}

/** 23:59:59.999 giờ VN của `dayKey`, trả mốc UTC (cận `lte` cho Prisma). */
function vnDayEndUtc(dayKey: string): Date {
  return new Date(vnDayStartUtc(shiftDayKey(dayKey, 1)).getTime() - 1);
}

/**
 * Khoảng ngày đã chuẩn hoá, tính theo NGÀY LỊCH giờ VN.
 *
 * Ba ca lệch được xử lý dứt điểm ở đây thay vì để mỗi tab tự đoán:
 *  • **thiếu** → mặc định "ngày 01 tháng hiện tại → hôm nay" (OQ-B9 chốt 24/08, không
 *    có ngoại lệ cho tab B).
 *  • **đảo ngược** (từ > đến) → HOÁN ĐỔI. Trả khoảng rỗng thì 4 tab đồng loạt hiện 0 mà
 *    không ai hiểu vì sao — đúng loại hỏng câm.
 *  • **vượt tương lai** → KẸP về hôm nay. Bốn tab đều là báo cáo nhìn lại; để nguyên thì
 *    một đường dẫn lưu sẵn `dateTo=2099-12-31` sẽ đóng băng "hôm nay" vĩnh viễn. Kẹp
 *    xong trả lại `dateFromStr`/`dateToStr` ĐÃ kẹp nên ô ngày trên thanh lọc hiện đúng
 *    thứ vừa áp dụng — người dùng THẤY, không phải đoán.
 */
export function resolveScopeDayRange(
  sp: Pick<ScopeFilterSearchParams, "dateFrom" | "dateTo">,
  now: Date,
): { fromKey: string; toKey: string } {
  const todayKey = vnDayKey(now);
  let fromKey = parseDayKey(first(sp.dateFrom));
  let toKey = parseDayKey(first(sp.dateTo));

  // So sánh chuỗi là đủ và đúng với dạng YYYY-MM-DD (thứ tự từ điển = thứ tự thời gian).
  if (fromKey && toKey && fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];

  if (!toKey || toKey > todayKey) toKey = todayKey;
  if (!fromKey) fromKey = `${todayKey.slice(0, 8)}01`;
  if (fromKey > toKey) fromKey = toKey;

  return { fromKey, toKey };
}

/**
 * Giao "cơ sở được xem" × "cơ sở chọn trong URL" — chống IDOR qua đường dẫn.
 *
 * Cơ sở ngoài phạm vi bị loại **im lặng**, không ném lỗi: một thông báo dạng "cơ sở X
 * không thuộc phạm vi của bạn" là kênh dò tên cơ sở miễn phí. Chỉ đếm số lượng.
 *
 * Nếu loại xong KHÔNG còn cơ sở nào hợp lệ ⇒ lùi về mặc định (toàn bộ phạm vi của
 * actor) thay vì tập rỗng, cùng cách `resolveReportFilters` xử lý center rác. Người
 * dùng vẫn chỉ thấy dữ liệu của chính mình, còn `droppedCenterCount > 0` là tín hiệu
 * để thanh lọc nói "một số cơ sở đã bị bỏ qua".
 */
export function resolveScopeCenters(
  visibleCenterIds: string[],
  requested: string | string[] | undefined,
): Pick<ScopeFilters, "centerIds" | "isAllCenters"> & { droppedCenterCount: number } {
  const visible = [...new Set(visibleCenterIds)];
  const raw = toList(requested);
  const wantsAll = raw.length === 0 || raw.includes(ALL);
  if (wantsAll) {
    return { centerIds: visible, isAllCenters: true, droppedCenterCount: 0 };
  }

  const visibleSet = new Set(visible);
  const requestedSet = new Set(raw);
  // Lọc theo `visible` (không theo URL) ⇒ khử trùng + thứ tự ổn định, nên khoá cache và
  // thứ tự cột khi tách theo cơ sở không đổi theo cách người dùng bấm.
  const kept = visible.filter((id) => requestedSet.has(id));
  const droppedCenterCount = [...requestedSet].filter((id) => !visibleSet.has(id)).length;

  if (kept.length === 0) {
    return { centerIds: visible, isAllCenters: true, droppedCenterCount };
  }
  return {
    centerIds: kept,
    // Chọn tay đủ cả phạm vi ≡ chọn "tất cả": không thì cùng một tập cơ sở lại sinh hai
    // entry cache và hai cách đối xử với dòng `centerId = NULL`.
    isAllCenters: kept.length === visible.length,
    droppedCenterCount,
  };
}

/** THUẦN — toàn bộ quyết định của A-02, tách khỏi DB để test không cần Postgres. */
export function buildScopeFilters(args: {
  visibleCenterIds: string[];
  sp: ScopeFilterSearchParams;
  now: Date;
}): ScopeFilterCore {
  const { centerIds, isAllCenters, droppedCenterCount } = resolveScopeCenters(
    args.visibleCenterIds,
    args.sp.center,
  );
  const { fromKey, toKey } = resolveScopeDayRange(args.sp, args.now);

  // OQ-4: công tắc chỉ sống khi ≥ 2 cơ sở. ÉP ở SERVER chứ không chỉ ẩn nút — nếu không,
  // `?split=1` gõ tay với 1 cơ sở sẽ bắt 4 tab trả hình dạng "tách" cho đúng một dòng.
  const canSplit = centerIds.length >= 2;
  const groupByCenter = canSplit && first(args.sp.split) === "1";

  return {
    filters: {
      centerIds,
      isAllCenters,
      dateFrom: vnDayStartUtc(fromKey),
      dateTo: vnDayEndUtc(toKey),
      groupByCenter,
    },
    canSplit,
    dateFromStr: fromKey,
    dateToStr: toKey,
    droppedCenterCount,
  };
}

/**
 * Cơ sở actor được phép CHỌN. Cấp Hội sở / SUPER_ADMIN thấy tất cả; còn lại giao với
 * `visibleCenterIds`. Cùng luật với `resolveReportFilters` để hai bộ lọc không lệch nhau.
 *
 * ⚠️ Đừng thay bằng `scopedDb(actor).center.findMany()`: `Center` nằm trong
 * `SCOPE_EXEMPT` (`lib/db-scope.ts`) nên lời gọi đó là pass-through, trả MỌI cơ sở.
 */
export function visibleCentersForActor<T extends { id: string }>(
  actor: ScopeActor,
  allCenters: T[],
): T[] {
  if (actor.isSuperAdmin || actor.isHoLevel) return allCenters;
  const allowed = new Set(actor.visibleCenterIds);
  return allCenters.filter((c) => allowed.has(c.id));
}

/**
 * Khoá cache theo bộ lọc (ghép sau `actorScopeKey`).
 *
 * ⚠️ PHẢI chứa ĐỦ mọi trường của `ScopeFilters`. Các trang báo cáo gọi
 * `safeCache(() => compute(actor, fc.filters), [...])` với closure 0 tham số ⇒ khoá này
 * là thứ DUY NHẤT phân biệt hai lần gọi. Thêm trường vào bộ lọc mà quên sửa đây =
 * hai bộ lọc khác nhau dùng chung một entry, sai số liệu im lặng suốt TTL.
 * `groupByCenter` nằm trong khoá vì nó đổi HÌNH DẠNG kết quả, không chỉ con số.
 */
export function scopeFilterCacheKey(f: ScopeFilters): string {
  const ids = [...f.centerIds].sort().join(",");
  return [
    f.isAllCenters ? `ALL(${ids})` : ids,
    f.dateFrom.toISOString(),
    f.dateTo.toISOString(),
    f.groupByCenter ? "split" : "gop",
  ].join("|");
}

/**
 * Mệnh đề cơ sở cho Prisma — LUÔN tường minh (RT-2). Dùng cho cả model `scopedDb`
 * không đụng tới được: `AdsInsightDaily`, `MarketingCostPeriod`, `Conversation`,
 * `RevenueTarget`.
 */
export function scopeCenterWhere(f: ScopeFilters): { in: string[] } {
  return { in: f.centerIds };
}

/** Mệnh đề DateTime cho Prisma — luôn đủ hai cận vì khoảng ngày không bao giờ rỗng. */
export function scopeDateWhere(f: ScopeFilters): { gte: Date; lte: Date } {
  return { gte: f.dateFrom, lte: f.dateTo };
}
