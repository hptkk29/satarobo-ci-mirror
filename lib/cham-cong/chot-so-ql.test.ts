import { describe, expect, it } from "vitest";
import { apDungChotSoQl, chotSoQlSchema, type DongChot } from "./chot-so-ql";
import type { PeriodPersonRow, PeriodSummary } from "./period";

function dong(userId: string, units: number, lateMinutes = 0): PeriodPersonRow {
  return {
    userId, name: `Người ${userId}`, employeeCode: userId, jobTitle: null,
    units, expectedUnits: units, leaveUnits: 0, holidayPaidUnits: 0, hourCredit: 0, workedMinutes: 0, expectedMinutes: 0,
    lateCount: lateMinutes ? 1 : 0, lateMinutes, earlyLeaveCount: 0, earlyLeaveMinutes: 0, otMinutes: 0, holidayWorkMinutes: 0,
    restDayWorkMinutes: 0, workedDays: 0, scheduledDays: 0, missingTapDays: 0, overrideDays: 0, flaggedDays: 0, teachingSessions: 2,
    noiQuy: { caQuyDinh: 0, caThucTe: 0, soLanTre: 0, ngayKhongPhep: 0, ngayChoKetLuan: 0, phanTramTru: 0 },
    grid: { "2026-10-01": "HC" }, unitsByDay: { "2026-10-01": 1 },
  };
}
const summary = (rows: PeriodPersonRow[]): PeriodSummary => ({
  centerId: "cs2", periodKey: "2026-10", standardUnits: 27, builtAt: "x", days: [], rows,
  totals: { people: rows.length, units: rows.reduce((s, r) => s + r.units, 0), teachingSessions: 4, flaggedDays: 0 },
});
const chot = (userId: string, units: number, extra: Partial<DongChot> = {}): DongChot => ({
  userId, units, leaveUnits: 0, lateCount: 0, lateMinutes: 0, earlyLeaveCount: 0, earlyLeaveMinutes: 0, ...extra,
});
const META = { boi: "QTTC", luc: "2026-11-04T15:00:00.000Z", lyDo: "Bảng chốt T10" };

describe("[CSQ] chốt kỳ theo số QL", () => {
  it("[CSQ-01] thay số của từng người, giữ số máy trong chotQl, tính lại tổng", () => {
    const r = apDungChotSoQl(summary([dong("a", 25, 116), dong("b", 27)]), [chot("a", 26, { lateCount: 6, lateMinutes: 58, earlyLeaveCount: 2, earlyLeaveMinutes: 73, ghiChu: "QLCS" }), chot("b", 27, { leaveUnits: 1 })], new Map(), META);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.summary.rows.find((x) => x.userId === "a")!;
    expect([a.units, a.lateCount, a.lateMinutes, a.earlyLeaveCount, a.earlyLeaveMinutes]).toEqual([26, 6, 58, 2, 73]);
    expect(a.chotQl?.soMay).toMatchObject({ units: 25, lateMinutes: 116 });
    expect(a.chotQl?.ghiChu).toBe("QLCS");
    expect(a.teachingSessions).toBe(2);
    expect(r.summary.rows.find((x) => x.userId === "b")!.leaveUnits).toBe(1);
    expect(r.summary.totals).toMatchObject({ people: 2, units: 53, teachingSessions: 4 });
    expect(r.summary.chotTay).toEqual(META);
  });

  it("[CSQ-02] thiếu người đang có trong bảng công ⇒ từ chối (không âm thầm giữ số máy)", () => {
    const r = apDungChotSoQl(summary([dong("a", 25), dong("b", 27)]), [chot("a", 26)], new Map(), META);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi.join()).toContain("Thiếu số chốt cho b");
  });

  it("[CSQ-03] trùng người ⇒ từ chối", () => {
    const r = apDungChotSoQl(summary([dong("a", 25)]), [chot("a", 26), chot("a", 1)], new Map(), META);
    expect(r.ok).toBe(false);
  });

  it("[CSQ-04] người chưa có trong bảng công: có hồ sơ ⇒ thêm dòng; không hồ sơ ⇒ từ chối", () => {
    const ok = apDungChotSoQl(summary([dong("a", 1)]), [chot("a", 1), chot("n", 0.5)], new Map([["n", { name: "Mới", employeeCode: "SR.NV.099", jobTitle: null }]]), META);
    expect(ok.ok && ok.summary.rows.find((x) => x.userId === "n")?.units).toBe(0.5);
    const ko = apDungChotSoQl(summary([dong("a", 1)]), [chot("a", 1), chot("x", 1)], new Map(), META);
    expect(ko.ok).toBe(false);
  });

  it("[CSQ-05] schema: số âm, phút lẻ, lý do ngắn đều bị chặn", () => {
    const base = { centerId: "cs2", ky: "2026-10", lyDo: "Bảng chốt T10 đã duyệt", rows: [chot("a", 1)] };
    expect(chotSoQlSchema.safeParse(base).success).toBe(true);
    expect(chotSoQlSchema.safeParse({ ...base, rows: [chot("a", -1)] }).success).toBe(false);
    expect(chotSoQlSchema.safeParse({ ...base, rows: [chot("a", 1, { lateMinutes: 1.5 })] }).success).toBe(false);
    expect(chotSoQlSchema.safeParse({ ...base, lyDo: "ngắn" }).success).toBe(false);
  });
});
