// R6-D2 — DataTable generic query builder.
import { describe, it, expect } from "vitest";
import {
  parseTableParams,
  buildPagination,
  buildOrderBy,
  buildWhere,
  buildTableQuery,
  MAX_PAGE_SIZE,
} from "./query";

describe("[R6-D2] DataTable query", () => {
  it("[R6-D2-T1-01] sort chỉ field allowlist; ngoài allowlist → fallback", () => {
    expect(buildOrderBy("name", "asc", ["name", "createdAt"])).toEqual({ name: "asc" });
    expect(buildOrderBy("password", "asc", ["name"])).toEqual({ createdAt: "desc" }); // chặn cột lạ
  });

  it("[R6-D2-T1-02] filter contains chỉ field allowlist", () => {
    const where = buildWhere({ name: "an", secret: "x" }, ["name"]);
    expect(where).toEqual({ name: { contains: "an", mode: "insensitive" } });
    expect(where.secret).toBeUndefined();
  });

  it("[R6-D2-T11-01] pagination LUÔN có take ≤ MAX (không kéo toàn bảng)", () => {
    expect(buildPagination({ page: 1, pageSize: 20 })).toEqual({ skip: 0, take: 20 });
    expect(buildPagination({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
    // pageSize quá lớn → clamp về MAX.
    expect(buildPagination({ page: 1, pageSize: 99999 }).take).toBe(MAX_PAGE_SIZE);
    // pageSize 0/âm → tối thiểu 1.
    expect(buildPagination({ page: 1, pageSize: 0 }).take).toBeGreaterThanOrEqual(1);
  });

  it("[R6-D2-T11-02] parseTableParams clamp page/pageSize", () => {
    const p = parseTableParams({ page: "-5", pageSize: "500", sortBy: "name", sortDir: "asc" });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(MAX_PAGE_SIZE);
    expect(p.sortDir).toBe("asc");
  });

  it("[R6-D2-T1-03] buildTableQuery gộp base where + filter", () => {
    const q = buildTableQuery(
      { page: 2, pageSize: 10, sortBy: "name", sortDir: "asc", filters: { name: "an" } },
      { allowedSort: ["name"], allowedFilter: ["name"], baseWhere: { deletedAt: null } },
    );
    expect(q.skip).toBe(10);
    expect(q.take).toBe(10);
    expect(q.orderBy).toEqual({ name: "asc" });
    expect(q.where).toEqual({ deletedAt: null, name: { contains: "an", mode: "insensitive" } });
  });
});
