// lib/cham-cong/reconcile.ts — L6: ĐỐI SOÁT Sheet ↔ hệ thống (khuôn drift-report: một lõi thuần,
// hai vỏ — màn admin /cham-cong/doi-soat và script chạy tay). Chạy song song 1 kỳ với Sheet 29/08
// (K-02: không có bảng công nào khác để so), cổng ra L6 = 0 lệch 10 ngày làm việc liên tiếp.
//
// So ba thứ, theo TỪNG NGƯỜI × NGÀY:
//   1. Ô lịch: mã trên Sheet (đã gộp ô con trỏ D1/D2 giống import) vs ShiftAssignment ACTIVE.
//   2. Công ngày: Sheet đếm 1 ô = 1 công (K-01) vs StaffAttendanceDay (overrideUnits ?? dayCreditEarned).
//   3. Tổng tháng: cột "Tổng" trên Sheet vs Σ công hệ thống.
// Người miễn chấm công (timesheetExempt) được LOẠI TƯỜNG MINH (kế hoạch §3.2 — Sheet đang đếm anh
// 12/tuần, hệ thống cố ý không đếm) và người chưa ánh xạ được báo riêng, không im lặng.
import type { MonthGrid, MonthGridRow } from "./sheet-parse";
import { mergePointerCells } from "./place";

export type ReconcilePerson = {
  sheetName: string;
  userId: string | null; // null = chưa ánh xạ
  exempt: boolean;
  /** ngày → mã Sheet (sau gộp con trỏ) */
  sheetCells: Record<number, string | null>;
  sheetTotal: number | null;
  /** ngày → mã hệ thống */
  sysCells: Record<number, string | null>;
  /** ngày → công hệ thống (null = chưa tính) */
  sysUnits: Record<number, number | null>;
};

export type CellDiff = { sheetName: string; userId: string | null; day: number; sheetCode: string | null; sysCode: string | null; sheetUnits: number; sysUnits: number | null; kind: "MISSING_SYS" | "MISSING_SHEET" | "CODE" | "UNITS" };

export type ReconcileReport = {
  periodKey: string;
  daysCompared: number;
  people: number;
  unmapped: string[];
  exempt: string[];
  cellDiffs: CellDiff[];
  totalDiffs: { sheetName: string; sheetTotal: number; sysTotal: number }[];
  perDay: { day: number; diffs: number }[];
  /** Số ngày (đến `upToDay`) không có lệch nào — cổng ra "10 ngày liên tiếp". */
  cleanStreak: number;
  clean: boolean;
};

/** Ô làm việc trên Sheet = 1 công; X/P/trống = 0 (K-01). */
export function sheetUnitsOf(code: string | null, leaveCodes: ReadonlySet<string>): number {
  if (!code) return 0;
  return leaveCodes.has(code) ? 0 : 1;
}

export function reconcileMonth(input: {
  grid: MonthGrid;
  people: ReconcilePerson[];
  /** Chỉ so tới ngày này (hôm qua theo giờ VN) — ngày tương lai chưa có công. */
  upToDay: number;
  leaveCodes: ReadonlySet<string>;
}): ReconcileReport {
  const { grid, people, upToDay, leaveCodes } = input;
  const cellDiffs: CellDiff[] = [];
  const totalDiffs: ReconcileReport["totalDiffs"] = [];
  const perDayMap = new Map<number, number>();
  const unmapped: string[] = [];
  const exempt: string[] = [];
  let compared = 0;

  for (const p of people) {
    if (!p.userId) { unmapped.push(p.sheetName); continue; }
    if (p.exempt) { exempt.push(p.sheetName); continue; }
    compared += 1;
    let sysTotal = 0;
    for (let day = 1; day <= Math.min(upToDay, grid.daysInMonth); day++) {
      const sheetCode = p.sheetCells[day] ?? null;
      const sysCode = p.sysCells[day] ?? null;
      const sheetUnits = sheetUnitsOf(sheetCode, leaveCodes);
      const sysUnits = p.sysUnits[day] ?? null;
      sysTotal += sysUnits ?? 0;
      let kind: CellDiff["kind"] | null = null;
      if (sheetCode && !sysCode) kind = "MISSING_SYS";
      else if (!sheetCode && sysCode && !leaveCodes.has(sysCode)) kind = "MISSING_SHEET";
      else if (sheetCode && sysCode && sheetCode !== sysCode) kind = "CODE";
      else if (sysUnits != null && Math.abs(sheetUnits - sysUnits) > 1e-9) kind = "UNITS";
      if (kind) {
        cellDiffs.push({ sheetName: p.sheetName, userId: p.userId, day, sheetCode, sysCode, sheetUnits, sysUnits, kind });
        perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
      }
    }
    if (p.sheetTotal != null && upToDay >= grid.daysInMonth && Math.abs(p.sheetTotal - sysTotal) > 1e-9) {
      totalDiffs.push({ sheetName: p.sheetName, sheetTotal: p.sheetTotal, sysTotal: Math.round(sysTotal * 100) / 100 });
    }
  }

  const perDay = Array.from({ length: Math.min(upToDay, grid.daysInMonth) }, (_, i) => ({ day: i + 1, diffs: perDayMap.get(i + 1) ?? 0 }));
  let cleanStreak = 0;
  for (let i = perDay.length - 1; i >= 0 && perDay[i].diffs === 0; i--) cleanStreak += 1;

  return {
    periodKey: grid.periodKey,
    daysCompared: perDay.length,
    people: compared,
    unmapped,
    exempt,
    cellDiffs,
    totalDiffs,
    perDay,
    cleanStreak,
    clean: cellDiffs.length === 0 && totalDiffs.length === 0 && unmapped.length === 0,
  };
}

/** Gộp các dòng Sheet của cùng một người (khối CS1 + khối CS2 + HO) thành một bộ ô — giống import. */
export function mergeSheetRows(rows: MonthGridRow[], daysInMonth: number): Record<number, string | null> {
  const out: Record<number, string | null> = {};
  for (let day = 1; day <= daysInMonth; day++) {
    const cellsByUnit: Record<string, string | null> = {};
    for (const r of rows) cellsByUnit[r.unit] = r.cells[day] ?? null;
    out[day] = mergePointerCells(cellsByUnit).code;
  }
  return out;
}

export function formatReconcileMarkdown(r: ReconcileReport): string {
  const lines = [
    `## Đối soát Sheet ↔ hệ thống — kỳ ${r.periodKey}`,
    ``,
    `| Chỉ số | Giá trị |`,
    `|---|---|`,
    `| Người so | ${r.people} |`,
    `| Ngày so (1 → ${r.daysCompared}) | ${r.daysCompared} |`,
    `| Ô lệch | ${r.cellDiffs.length} |`,
    `| Lệch tổng tháng | ${r.totalDiffs.length} |`,
    `| Chưa ánh xạ | ${r.unmapped.length}${r.unmapped.length ? ` (${r.unmapped.join(", ")})` : ""} |`,
    `| Miễn chấm công (bỏ qua) | ${r.exempt.length}${r.exempt.length ? ` (${r.exempt.join(", ")})` : ""} |`,
    `| Chuỗi ngày sạch gần nhất | **${r.cleanStreak}** / 10 |`,
    ``,
  ];
  if (r.cellDiffs.length) {
    lines.push(`| Người | Ngày | Sheet | Hệ thống | Công Sheet | Công HT | Loại |`, `|---|---|---|---|---|---|---|`);
    for (const d of r.cellDiffs.slice(0, 200)) lines.push(`| ${d.sheetName} | ${d.day} | ${d.sheetCode ?? "—"} | ${d.sysCode ?? "—"} | ${d.sheetUnits} | ${d.sysUnits ?? "chưa tính"} | ${d.kind} |`);
    if (r.cellDiffs.length > 200) lines.push(`| … | | | | | | còn ${r.cellDiffs.length - 200} |`);
  }
  if (r.totalDiffs.length) {
    lines.push(``, `| Người | Tổng Sheet | Tổng HT |`, `|---|---|---|`);
    for (const t of r.totalDiffs) lines.push(`| ${t.sheetName} | ${t.sheetTotal} | ${t.sysTotal} |`);
  }
  return lines.join("\n");
}
