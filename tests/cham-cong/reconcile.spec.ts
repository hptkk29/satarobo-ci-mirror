// tests/cham-cong/reconcile.spec.ts — L6: lõi đối soát thuần (không DB).
import { describe, expect, it } from "vitest";
import { mergeSheetRows, reconcileMonth, sheetUnitsOf, type ReconcilePerson } from "../../lib/cham-cong/reconcile";
import type { MonthGrid, MonthGridRow } from "../../lib/cham-cong/sheet-parse";

const LEAVE = new Set(["X", "P"]);
const grid: MonthGrid = { sheetName: "LỊCH T09-2026", periodKey: "2026-09", year: 2026, month: 9, daysInMonth: 30, rows: [], unknownUnitRows: [] };
const person = (over: Partial<ReconcilePerson>): ReconcilePerson => ({ sheetName: "A", userId: "u1", exempt: false, sheetCells: {}, sheetTotal: null, sysCells: {}, sysUnits: {}, ...over });

describe("reconcile — thuần", () => {
  it("sheetUnitsOf: ô làm = 1, X/P/trống = 0 (K-01)", () => {
    expect(sheetUnitsOf("S", LEAVE)).toBe(1);
    expect(sheetUnitsOf("D1", LEAVE)).toBe(1);
    expect(sheetUnitsOf("X", LEAVE)).toBe(0);
    expect(sheetUnitsOf(null, LEAVE)).toBe(0);
  });

  it("khớp hoàn toàn ⇒ clean, chuỗi sạch = số ngày so", () => {
    const p = person({ sheetCells: { 1: "S", 2: "X", 3: "CG" }, sysCells: { 1: "S", 2: "X", 3: "CG" }, sysUnits: { 1: 1, 2: 0, 3: 1 } });
    const r = reconcileMonth({ grid, people: [p], upToDay: 3, leaveCodes: LEAVE });
    expect(r.clean).toBe(true);
    expect(r.cleanStreak).toBe(3);
    expect(r.people).toBe(1);
  });

  it("4 loại lệch được gọi đúng tên; chuỗi sạch đếm từ cuối; người chưa ánh xạ / miễn công tách riêng", () => {
    const p = person({
      sheetCells: { 1: "S", 2: null, 3: "S", 4: "S", 5: "S" },
      sysCells: { 1: null, 2: "S", 3: "CG", 4: "S", 5: "S" },
      sysUnits: { 3: 1, 4: 0.5, 5: 1 },
    });
    const r = reconcileMonth({ grid, people: [p, person({ sheetName: "B", userId: null }), person({ sheetName: "C", userId: "u3", exempt: true, sheetCells: { 1: "S" } })], upToDay: 5, leaveCodes: LEAVE });
    expect(r.cellDiffs.map((d) => [d.day, d.kind])).toEqual([[1, "MISSING_SYS"], [2, "MISSING_SHEET"], [3, "CODE"], [4, "UNITS"]]);
    expect(r.cleanStreak).toBe(1);
    expect(r.unmapped).toEqual(["B"]);
    expect(r.exempt).toEqual(["C"]);
    expect(r.people).toBe(1);
    expect(r.clean).toBe(false);
  });

  it("hệ thống ghi P (nghỉ duyệt) mà Sheet trống ⇒ KHÔNG coi là lệch; công chưa tính ⇒ không so số", () => {
    const p = person({ sheetCells: { 1: null, 2: "S" }, sysCells: { 1: "P", 2: "S" }, sysUnits: {} });
    const r = reconcileMonth({ grid, people: [p], upToDay: 2, leaveCodes: LEAVE });
    expect(r.cellDiffs).toEqual([]);
  });

  it("tổng tháng chỉ so khi đã hết tháng; mergeSheetRows gộp ô con trỏ D1 vào ô khối kia", () => {
    const rows: MonthGridRow[] = [
      { stt: 1, name: "A", unit: "CS1", unitRaw: "Cơ sở 1", role: "GV", cells: { 1: "D2", 2: "S" }, totalOnSheet: 20, offOnSheet: null },
      { stt: 2, name: "A", unit: "CS2", unitRaw: "Cơ sở 2", role: "GV", cells: { 1: "S", 2: null }, totalOnSheet: null, offOnSheet: null },
    ];
    const merged = mergeSheetRows(rows, 2);
    expect(merged[1]).toBe("S");
    expect(merged[2]).toBe("S");
    const p = person({ sheetCells: merged, sheetTotal: 20, sysCells: { 1: "S", 2: "S" }, sysUnits: { 1: 1, 2: 1 } });
    expect(reconcileMonth({ grid, people: [p], upToDay: 2, leaveCodes: LEAVE }).totalDiffs).toEqual([]);
    const full = reconcileMonth({ grid: { ...grid, daysInMonth: 2 }, people: [p], upToDay: 2, leaveCodes: LEAVE });
    expect(full.totalDiffs).toEqual([{ sheetName: "A", sheetTotal: 20, sysTotal: 2 }]);
  });
});
