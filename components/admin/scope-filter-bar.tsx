import Link from "next/link";
import type { ScopeFilters } from "@/lib/reports/scope-filters";
import type { QlcsTabId } from "@/lib/dashboard/qlcs-tabs";

/**
 * A-02 — thanh lọc phạm vi dùng chung của dashboard QLCS 4 tab.
 *
 * ĐẶT CẠNH `report-filter-bar.tsx`, KHÔNG thay nó: bản cũ đơn trị (`?center=<id>`) đang
 * phục vụ 8 trang `/bao-cao/*` và MỘT đường ghi (form mục tiêu doanh thu). Ràng buộc 6
 * của PRD §6.2 chốt "để nguyên cái cũ" — nên đây là component MỚI.
 *
 * ┌─ Vì sao là `<details>` + checkbox thường, không phải Popover ─────────────────────┐
 * │ Chốt kỹ thuật 24/08 (OQ-3) đề xuất "Popover + Checkbox của shadcn". Đo lại repo:  │
 * │ `components/ui/` KHÔNG có `popover.tsx` lẫn `checkbox.tsx` (đề xuất viết trước    │
 * │ khi rà), và quan trọng hơn — Popover render nội dung qua PORTAL, tức các ô        │
 * │ checkbox nằm NGOÀI cây DOM của `<form>`. Form GET chỉ serialize input BÊN TRONG   │
 * │ nó ⇒ bấm "Lọc" là mất sạch cơ sở vừa chọn, im lặng. `<details>` giữ input trong   │
 * │ form, chạy không cần JS, và không thêm thư viện nào (luật nhà #7).                │
 * └──────────────────────────────────────────────────────────────────────────────────┘
 *
 * Toàn bộ quyết định (giao phạm vi, kẹp ngày, ép tắt "tách" khi < 2 cơ sở) đã nằm ở
 * `buildScopeFilters` phía server. Component này CHỈ vẽ lại thứ server đã chốt — không
 * tự suy luận gì, để thanh lọc không thể nói khác số liệu.
 */
export function ScopeFilterBar({
  basePath,
  tab,
  visibleCenters,
  filters,
  dateFromStr,
  dateToStr,
  canSplit,
  droppedCenterCount,
}: {
  basePath: string;
  /** Giữ tab đang xem khi bấm "Lọc" — nếu không, lọc xong là văng về tab đầu. */
  tab: QlcsTabId;
  visibleCenters: { id: string; name: string }[];
  filters: ScopeFilters;
  dateFromStr: string;
  dateToStr: string;
  canSplit: boolean;
  droppedCenterCount: number;
}) {
  const selected = new Set(filters.centerIds);
  const multiCenter = visibleCenters.length > 1;
  const centerLabel = filters.isAllCenters
    ? `Tất cả cơ sở (${visibleCenters.length})`
    : visibleCenters
        .filter((c) => selected.has(c.id))
        .map((c) => c.name)
        .join(", ") || "Chưa chọn";

  // "Xoá lọc" = về mặc định của A-02 (tất cả cơ sở, ngày 01 → hôm nay), GIỮ tab.
  const resetHref = `${basePath}?tab=${tab}`;

  return (
    <div className="space-y-2">
      <form
        method="GET"
        action={basePath}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted p-3"
      >
        <input type="hidden" name="tab" value={tab} />

        <div className="min-w-[14rem]">
          <span className="mb-1 block text-xs text-muted-foreground">Cơ sở</span>
          {multiCenter ? (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
                {centerLabel}
              </summary>
              <div className="absolute left-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg">
                {/* Giá trị "ALL" được `resolveScopeCenters` hiểu là toàn bộ phạm vi —
                    tick nó thì mọi lựa chọn bên dưới bị bỏ qua ở server. */}
                <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    name="center"
                    value="ALL"
                    defaultChecked={filters.isAllCenters}
                    className="size-4"
                  />
                  <span className="font-medium">Tất cả cơ sở</span>
                </label>
                <div className="my-1 h-px bg-border" />
                {visibleCenters.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      name="center"
                      value={c.id}
                      defaultChecked={!filters.isAllCenters && selected.has(c.id)}
                      className="size-4"
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
                <p className="mt-1 px-1.5 text-[11px] leading-snug text-muted-foreground">
                  Không tick gì = tất cả cơ sở trong phạm vi của bạn.
                </p>
              </div>
            </details>
          ) : (
            // Đúng một cơ sở trong phạm vi: không dựng dropdown một dòng — và cũng
            // không phát `center`, để URL không vỡ khi người này được gán thêm cơ sở.
            <p className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
              {visibleCenters[0]?.name ?? "Không có cơ sở nào trong phạm vi"}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="scope-date-from">
            Từ ngày
          </label>
          <input
            id="scope-date-from"
            type="date"
            name="dateFrom"
            defaultValue={dateFromStr}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="scope-date-to">
            Đến ngày
          </label>
          <input
            id="scope-date-to"
            type="date"
            name="dateTo"
            defaultValue={dateToStr}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm"
          />
        </div>

        {/* OQ-4 — công tắc CHỈ hiện khi đang chọn ≥ 2 cơ sở: một cơ sở thì tách và gộp
            cho ra cùng con số, nên nút đó chỉ tổ làm người dùng tưởng mình bỏ sót gì. */}
        {canSplit ? (
          <label className="flex items-center gap-2 rounded border border-border bg-card px-2 py-2 text-sm">
            <input
              type="checkbox"
              name="split"
              value="1"
              defaultChecked={filters.groupByCenter}
              className="size-4"
            />
            <span>Tách theo cơ sở</span>
          </label>
        ) : null}

        <button
          type="submit"
          className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white"
        >
          Lọc
        </button>
        <Link
          href={resetHref}
          className="rounded border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          Xoá lọc
        </Link>
      </form>

      {droppedCenterCount > 0 ? (
        // Cố ý KHÔNG nêu tên/id cơ sở bị loại — nói ra là biến thanh lọc thành công cụ
        // dò tên cơ sở ngoài phạm vi (xem `resolveScopeCenters`).
        <p className="text-xs text-primary">
          Một số cơ sở trong đường dẫn không thuộc phạm vi của bạn nên đã được bỏ qua
          ({droppedCenterCount}).
        </p>
      ) : null}
    </div>
  );
}

/**
 * Chuỗi mô tả phạm vi đang áp dụng — dùng ở đầu trang để người xem đọc được số này
 * "của ai, trong khoảng nào" mà không phải giải mã thanh lọc.
 */
export function scopeSummaryText(
  filters: ScopeFilters,
  visibleCenters: { id: string; name: string }[],
  dateFromStr: string,
  dateToStr: string,
): string {
  const selected = new Set(filters.centerIds);
  const centers = filters.isAllCenters
    ? `tất cả cơ sở trong phạm vi (${filters.centerIds.length})`
    : visibleCenters
        .filter((c) => selected.has(c.id))
        .map((c) => c.name)
        .join(" + ");
  const mode = filters.groupByCenter ? "tách theo cơ sở" : "gộp";
  return `${centers} · ${dateFromStr} → ${dateToStr} · ${mode}`;
}
