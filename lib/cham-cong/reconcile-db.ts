// lib/cham-cong/reconcile-db.ts — L6: vỏ DB cho lõi đối soát (`reconcile.ts`). Một hiện thực,
// hai vỏ: màn /cham-cong/doi-soat và script `scripts/cham-cong-doi-soat.ts`.
import type { PrismaClient } from "@prisma/client";
import type { MonthGrid } from "./sheet-parse";
import { groupRowsByName } from "./import-core";
import { mergeSheetRows, reconcileMonth, type ReconcilePerson, type ReconcileReport } from "./reconcile";
import { vnDateOnly } from "@/lib/time/vn";

export type ReconcileDb = Pick<PrismaClient, "shiftWeeklyPattern" | "shiftAssignment" | "staffAttendanceDay" | "shiftTemplate" | "user">;

/**
 * Ánh xạ tên Sheet → user theo bộ nhớ import (ShiftWeeklyPattern.sheetName) + `extraMapping`
 * (người dùng chọn tay ở màn). Người chưa ánh xạ được báo, không đoán.
 */
export async function reconcileGridWithDb(opts: {
  db: ReconcileDb;
  grid: MonthGrid;
  extraMapping?: Record<string, string>;
  now?: Date;
}): Promise<ReconcileReport> {
  const { db, grid } = opts;
  const now = opts.now ?? new Date();
  const remembered = await db.shiftWeeklyPattern.findMany({ where: { sheetName: { not: null } }, select: { sheetName: true, userId: true }, distinct: ["sheetName"] });
  const mapping: Record<string, string> = { ...Object.fromEntries(remembered.map((r) => [r.sheetName as string, r.userId])), ...(opts.extraMapping ?? {}) };
  const leaveCodes = new Set((await db.shiftTemplate.findMany({ where: { OR: [{ isLeave: true }, { kind: "OFF" }] }, select: { code: true } })).map((t) => t.code));

  const perPerson = groupRowsByName(grid);
  const userIds = [...new Set([...perPerson.keys()].map((n) => mapping[n]).filter((x): x is string => !!x))];
  const from = new Date(Date.UTC(grid.year, grid.month - 1, 1));
  const to = new Date(Date.UTC(grid.year, grid.month, 0));
  const [assignments, days, users] = await Promise.all([
    userIds.length ? db.shiftAssignment.findMany({ where: { userId: { in: userIds }, workDate: { gte: from, lte: to }, status: "ACTIVE" }, select: { userId: true, workDate: true, templateCode: true } }) : [],
    userIds.length ? db.staffAttendanceDay.findMany({ where: { userId: { in: userIds }, workDate: { gte: from, lte: to } }, select: { userId: true, workDate: true, overrideUnits: true, dayCreditEarned: true } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, employee: { select: { timesheetExempt: true } } } }) : [],
  ]);
  const exemptOf = new Map(users.map((u) => [u.id, u.employee?.timesheetExempt ?? false]));

  const people: ReconcilePerson[] = [...perPerson.entries()].map(([sheetName, rows]) => {
    const userId = mapping[sheetName] ?? null;
    const sysCells: Record<number, string | null> = {};
    const sysUnits: Record<number, number | null> = {};
    if (userId) {
      for (const a of assignments.filter((x) => x.userId === userId)) sysCells[a.workDate.getUTCDate()] = a.templateCode;
      for (const d of days.filter((x) => x.userId === userId)) sysUnits[d.workDate.getUTCDate()] = d.overrideUnits ?? d.dayCreditEarned;
    }
    const totals = rows.map((r) => r.totalOnSheet).filter((x): x is number => x != null);
    return {
      sheetName,
      userId,
      exempt: userId ? (exemptOf.get(userId) ?? false) : false,
      sheetCells: mergeSheetRows(rows, grid.daysInMonth),
      sheetTotal: totals.length ? totals.reduce((s, x) => s + x, 0) : null,
      sysCells,
      sysUnits,
    };
  });

  // Chỉ so tới HÔM QUA (giờ VN): hôm nay chưa hết ca, ngày mai chưa có công.
  const today = vnDateOnly(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const upToDay = yesterday.getUTCFullYear() === grid.year && yesterday.getUTCMonth() + 1 === grid.month ? yesterday.getUTCDate() : yesterday > to ? grid.daysInMonth : 0;

  return reconcileMonth({ grid, people, upToDay, leaveCodes });
}
