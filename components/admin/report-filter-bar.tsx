import Link from "next/link";

// Thanh lọc dùng chung cho /bao-cao/* — GET form (server component). Cơ sở + khoảng ngày.
// `basePath` = đường dẫn báo cáo (vd "/bao-cao/lead"). `extra` = hidden field cần giữ.
export function ReportFilterBar({
  basePath,
  centers,
  selection,
  dateFrom,
  dateTo,
  allowAll,
  extra,
}: {
  basePath: string;
  centers: { id: string; name: string }[];
  selection: string;
  dateFrom: string;
  dateTo: string;
  allowAll: boolean;
  extra?: Record<string, string>;
}) {
  return (
    <form
      method="GET"
      action={basePath}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted p-3"
    >
      {extra
        ? Object.entries(extra).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))
        : null}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Cơ sở</label>
        <select
          name="center"
          defaultValue={selection}
          className="rounded border border-border px-2 py-1.5 text-sm"
        >
          {allowAll && <option value="ALL">Tất cả cơ sở</option>}
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Từ ngày</label>
        <input
          type="date"
          name="dateFrom"
          defaultValue={dateFrom}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Đến ngày</label>
        <input
          type="date"
          name="dateTo"
          defaultValue={dateTo}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <button
        type="submit"
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white"
      >
        Lọc
      </button>
      <Link
        href={basePath}
        className="rounded border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
      >
        Xoá lọc
      </Link>
    </form>
  );
}
