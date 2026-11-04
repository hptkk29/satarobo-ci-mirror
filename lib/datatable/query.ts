// lib/datatable/query.ts — R6-D2: DataTable generic server-side (sort/filter/pagination).
// THUẦN — biến query params (đã parse) thành mảnh Prisma {skip,take,orderBy,where}.
// An toàn: chỉ field trong allowlist mới được sort/filter (chống injection cột) (T1).
// Pagination LUÔN áp `take` ≤ max (không bao giờ trả toàn bảng) (T11).

export type SortDir = "asc" | "desc";
export type TableParams = {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: SortDir;
  filters?: Record<string, string>;
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Parse params thô (searchParams) → TableParams chuẩn hoá (clamp). */
export function parseTableParams(raw: Record<string, string | undefined>): TableParams {
  const page = Math.max(1, parseInt(raw.page ?? "1", 10) || 1);
  const rawSize = parseInt(raw.pageSize ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  const sortDir: SortDir = raw.sortDir === "asc" ? "asc" : "desc";
  return {
    page,
    pageSize,
    sortBy: raw.sortBy || undefined,
    sortDir,
    filters: undefined,
  };
}

/** skip/take — LUÔN có take (≤ MAX_PAGE_SIZE) để không kéo toàn bảng (T11). */
export function buildPagination(p: Pick<TableParams, "page" | "pageSize">): { skip: number; take: number } {
  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, p.pageSize || DEFAULT_PAGE_SIZE));
  const page = Math.max(1, p.page || 1);
  return { skip: (page - 1) * take, take };
}

/** orderBy — chỉ cho field trong allowlist; ngoài allowlist → fallback. */
export function buildOrderBy(
  sortBy: string | undefined,
  sortDir: SortDir | undefined,
  allowed: readonly string[],
  fallback: Record<string, SortDir> = { createdAt: "desc" },
): Record<string, SortDir> {
  if (sortBy && allowed.includes(sortBy)) {
    return { [sortBy]: sortDir ?? "desc" };
  }
  return fallback;
}

/** where — filter `contains` (string, insensitive) cho field trong allowlist. */
export function buildWhere(
  filters: Record<string, string> | undefined,
  allowed: readonly string[],
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (!filters) return where;
  for (const [k, v] of Object.entries(filters)) {
    if (!allowed.includes(k) || !v) continue;
    where[k] = { contains: v, mode: "insensitive" };
  }
  return where;
}

/** Gom thành 1 query Prisma. allowedSort/allowedFilter whitelist cột. */
export function buildTableQuery(
  params: TableParams,
  opts: { allowedSort: readonly string[]; allowedFilter: readonly string[]; baseWhere?: Record<string, unknown> },
): { skip: number; take: number; orderBy: Record<string, SortDir>; where: Record<string, unknown> } {
  const { skip, take } = buildPagination(params);
  const orderBy = buildOrderBy(params.sortBy, params.sortDir, opts.allowedSort);
  const filterWhere = buildWhere(params.filters, opts.allowedFilter);
  const where = { ...(opts.baseWhere ?? {}), ...filterWhere };
  return { skip, take, orderBy, where };
}

/** Tính tổng số trang từ total + pageSize. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
