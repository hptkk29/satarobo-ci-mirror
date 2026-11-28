import { describe, it, expect } from "vitest";
import {
  buildClassWhere,
  countActiveFilters,
  matchesFill,
  parseClassListFilters,
  toClassListQuery,
} from "./list-filter";

describe("parseClassListFilters", () => {
  it("[CLF-01] bỏ giá trị lạ thay vì ném — URL cũ vẫn mở được", () => {
    const f = parseClassListFilters({
      status: "ACTIVE,XYZ,ACTIVE",
      thu: "1,9,a,3",
      tu: "2026-13-99x",
      siSo: "gi-do",
      sort: "lung-tung",
    });
    expect(f.statuses).toEqual(["ACTIVE"]);
    expect(f.weekdays).toEqual([1, 3]);
    expect(f.startFrom).toBeUndefined();
    expect(f.fill).toBeUndefined();
    expect(f.sort).toBe("status");
  });

  it("[CLF-02] vòng parse → query → parse giữ nguyên bộ lọc", () => {
    const f = parseClassListFilters({
      q: " Sata 3 ",
      status: "ACTIVE,RECRUITING",
      centerId: "c1",
      courseId: "k1",
      teacherId: "t1",
      thu: "6,0",
      tu: "2026-09-01",
      den: "2026-09-30",
      siSo: "available",
      sort: "name",
    });
    expect(f.q).toBe("Sata 3");
    expect(parseClassListFilters(Object.fromEntries(new URLSearchParams(toClassListQuery(f))))).toEqual(f);
    expect(countActiveFilters(f)).toBe(8);
  });

  it("[CLF-03] bộ lọc rỗng ⇒ query rỗng (không có '?sort=status')", () => {
    expect(toClassListQuery(parseClassListFilters({}))).toBe("");
  });
});

describe("buildClassWhere", () => {
  it("[CLF-04] view-own: ÉP về GV của chính họ, bỏ qua teacherId trên URL", () => {
    const f = parseClassListFilters({ teacherId: "nguoi-khac" });
    const w = JSON.stringify(buildClassWhere(f, { forceTeacherId: "toi" }));
    expect(w).toContain('"teacherId":"toi"');
    expect(w).not.toContain("nguoi-khac");
  });

  it("[CLF-05] khai giảng: ôm trọn ngày cuối theo lịch VN, cả hai quy ước lưu ngày", () => {
    const f = parseClassListFilters({ tu: "2026-09-01", den: "2026-09-30" });
    const and = (buildClassWhere(f, { forceTeacherId: null }).AND ?? []) as Array<{
      startDate?: { gte: Date; lt: Date };
    }>;
    const r = and.find((c) => c.startDate)!.startDate!;
    const inRange = (d: Date) => d >= r.gte && d < r.lt;
    // nửa đêm UTC của ngày VN (form hiện hành)
    expect(inRange(new Date("2026-09-01T00:00:00Z"))).toBe(true);
    expect(inRange(new Date("2026-09-30T00:00:00Z"))).toBe(true);
    expect(inRange(new Date("2026-10-01T00:00:00Z"))).toBe(false);
    // 00:00 giờ VN (dữ liệu cũ)
    expect(inRange(new Date("2026-08-31T17:00:00Z"))).toBe(true);
    expect(inRange(new Date("2026-09-30T17:00:00Z"))).toBe(false);
    expect(inRange(new Date("2026-08-30T17:00:00Z"))).toBe(false);
  });

  it("[CLF-06] luôn loại lớp đã xoá mềm", () => {
    const w = JSON.stringify(buildClassWhere(parseClassListFilters({}), { forceTeacherId: null }));
    expect(w).toContain('"deletedAt":null');
  });
});

describe("matchesFill", () => {
  it("[CLF-07] ba mức sĩ số", () => {
    expect(matchesFill(0, 10, "empty")).toBe(true);
    expect(matchesFill(1, 10, "empty")).toBe(false);
    expect(matchesFill(10, 10, "full")).toBe(true);
    expect(matchesFill(9, 10, "full")).toBe(false);
    expect(matchesFill(9, 10, "available")).toBe(true);
    expect(matchesFill(10, 10, "available")).toBe(false);
    expect(matchesFill(99, 1, undefined)).toBe(true);
  });
});
