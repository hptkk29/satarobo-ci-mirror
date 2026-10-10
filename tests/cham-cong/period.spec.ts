// tests/cham-cong/period.spec.ts — L5: kỳ công (công chuẩn K-04, tổng hợp, chốt trong tx, mở lại,
// ghi đè công ngày, workbook xuất). Phần thuần chạy mọi nơi; phần DB cần Postgres LOCAL.
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL) /* từ chối cả tunnel VPS (CONG_TUNNEL_VPS) */;
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/period] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-period";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));

describe("period — thuần", () => {
  it("countStandardUnits: tháng 9/2026 nghỉ Thứ Hai (4 ngày) + lễ 02/09 (Thứ Tư) = 30 − 4 − 1 = 25", async () => {
    const { countStandardUnits } = await import("../../lib/cham-cong/period");
    expect(countStandardUnits({ key: "2026-09", weeklyOff: [1], holidayDates: new Set(["2026-09-02"]) })).toBe(25);
    // Lễ rơi đúng ngày nghỉ tuần thì không trừ hai lần: 07/09/2026 là Thứ Hai.
    expect(countStandardUnits({ key: "2026-09", weeklyOff: [1], holidayDates: new Set(["2026-09-07"]) })).toBe(26);
    expect(countStandardUnits({ key: "2026-02", weeklyOff: [], holidayDates: new Set() })).toBe(28);
  });
  it("periodRange / parsePeriodKey / currentPeriodKey theo giờ VN", async () => {
    const { periodRange, parsePeriodKey, currentPeriodKey } = await import("../../lib/cham-cong/period");
    expect(periodRange("2026-02").days).toBe(28);
    expect(parsePeriodKey("2026-13")).toBeNull();
    // 30/09 23:30 VN = 30/09 16:30Z → vẫn tháng 9; 30/09 17:30Z = 01/10 00:30 VN → tháng 10.
    expect(currentPeriodKey(new Date("2026-09-30T16:30:00Z"))).toBe("2026-09");
    expect(currentPeriodKey(new Date("2026-09-30T17:30:00Z"))).toBe("2026-10");
  });
  it("buildPeriodWorkbook: 3 sheet, mã NV ép chuỗi, lưới có đủ cột ngày", async () => {
    const { buildPeriodWorkbook } = await import("../../lib/cham-cong/export-xlsx");
    const wb = buildPeriodWorkbook({
      locked: true,
      centerLabel: "CS1",
      watermark: "wm",
      summary: {
        centerId: "c", periodKey: "2026-09", standardUnits: 25, builtAt: "x", days: ["2026-09-01", "2026-09-02"],
        rows: [{ userId: "u", name: "A", employeeCode: "0012", jobTitle: "GV", units: 1.5, expectedUnits: 2, leaveUnits: 0, holidayPaidUnits: 0, hourCredit: 0, workedMinutes: 300, expectedMinutes: 450, lateCount: 1, lateMinutes: 12, earlyLeaveCount: 0, earlyLeaveMinutes: 0, otMinutes: 145, holidayWorkMinutes: 30, restDayWorkMinutes: 15, workedDays: 1, scheduledDays: 2, missingTapDays: 0, overrideDays: 1, flaggedDays: 1, teachingSessions: 3, noiQuy: { caQuyDinh: 2, caThucTe: 1, soLanTre: 1, ngayKhongPhep: 0, ngayChoKetLuan: 0, phanTramTru: 0.5 }, grid: { "2026-09-01": "S", "2026-09-02": "P" }, unitsByDay: { "2026-09-01": 1, "2026-09-02": 0.5 } }],
        totals: { people: 1, units: 1.5, teachingSessions: 3, flaggedDays: 1 },
      },
    });
    expect(wb.SheetNames).toEqual(["Tong hop", "Luoi", "_watermark"]);
    const ws = wb.Sheets["Tong hop"];
    expect(ws["A4"]).toMatchObject({ v: "0012", t: "s", z: "@" });
    // Đợt 4: cột OT được trả; đợt 9: hai cột làm ngày lễ / ngày nghỉ ngay sau, là cột cuối.
    const tong = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 });
    expect(tong[2]!.slice(-3)).toEqual(["OT được trả (phút)", "Làm ngày lễ (phút)", "Làm ngày nghỉ (phút)"]);
    expect(tong[3]!.slice(-3)).toEqual([145, 30, 15]);
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Luoi"], { header: 1 });
    expect(grid[0]).toEqual(["Họ tên", "01", "02", "Σ công"]);
    expect(grid[1]).toEqual(["A", "S", "P", 1.5]);
  });
});

d("period — DB thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let centerId = "";
  let userId = "";
  let actorId = "";
  let period: typeof import("../../lib/cham-cong/period");
  // 🔴 ĐỒNG HỒ ĐÓNG BĂNG — luật 19. `lockPeriod` CÓ điều kiện thời gian thật
  // (`to > now ⇒ "Kỳ chưa kết thúc"`), không chỉ dùng `now` cho dấu thời gian audit.
  //
  // Hôm nay bộ này xanh vì fixture cố ý chọn kỳ ĐÃ QUA (`2026-06`) và kỳ CÒN XA (`2099-01`)
  // — hai mốc mà đồng hồ thật còn lâu mới chạm. Nhưng đó là lý do CHƯA nổ, không phải lý do
  // KHÔNG nổ: ai thêm một điều kiện đọc `now` vào `lockPeriod`/`reopenPeriod`/`setDayOverride`
  // là nó nổ, và người đó sẽ đi soi sai chỗ y như ca `LEAVE` hôm 13/09 (#244).
  //
  // 01/07/2026 10:00 VN — sau ngày cuối `KEY` (chốt được), và trước `2099-01` rất xa
  // (kỳ tương lai vẫn phải bị từ chối).
  const NOW = new Date("2026-07-01T03:00:00Z");
  const KEY = "2026-06"; // kỳ đã qua ⇒ chốt được
  const d1 = utc(2026, 6, 2); // Thứ Ba
  const d2 = utc(2026, 6, 3);

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    if (centerId) await db.attendancePeriod.deleteMany({ where: { centerId } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    period = await import("../../lib/cham-cong/period");
    await seedShiftTemplates(db);
    centerId = (await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS1 period", address: "x", code: `${TAG}-CS1` }, select: { id: true } })).id;
    await cleanup();
    userId = (await db.user.create({ data: { email: `nv@${TAG}.test`, name: "NV period", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId }, select: { id: true } })).id;
    actorId = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL period", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId }, select: { id: true } })).id;
    const tplS = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } })).id;
    const seg = [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }];
    await db.shiftAssignment.createMany({ data: [d1, d2].map((workDate) => ({ userId, centerId, workDate, templateId: tplS, templateCode: "S", segments: seg, source: "IMPORT" })) });
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("getOrCreatePeriod sinh công chuẩn tự động; buildPeriodSummary trước khi tính = lưới có mã nhưng 0 công", async () => {
    const p = await period.getOrCreatePeriod(centerId, KEY);
    expect(p.status).toBe("OPEN");
    expect(p.standardUnits).toBeGreaterThan(20);
    const s = await period.buildPeriodSummary(centerId, KEY);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].grid["2026-06-02"]).toBe("S");
    expect(s.days).toHaveLength(30);
  });

  it("lockPeriod: tính lại rồi khoá — ngày công LOCKED + periodId, summaryJson có 2 công; khoá lần hai bị từ chối; engine bỏ qua ngày LOCKED", async () => {
    const r = await period.lockPeriod({ now: NOW, centerId, periodKey: KEY, actorId, reason: "test" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.rows[0].units).toBe(2);
    // Engine ghi MỘT dòng cho MỖI ngày trong kỳ (kể cả ngày không ca — dayType UNSCHEDULED/nghỉ tuần)
    // để lưới tháng đủ ô; chỉ 2 ngày có ca S.
    const rows = await db.staffAttendanceDay.findMany({ where: { userId } });
    expect(rows).toHaveLength(30);
    expect(rows.filter((x) => x.templateCode === "S")).toHaveLength(2);
    expect(rows.every((x) => x.status === "LOCKED" && x.periodId)).toBe(true);
    const p = await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId, periodKey: KEY } } });
    expect(p.status).toBe("LOCKED");
    expect((p.summaryJson as { totals: { units: number } }).totals.units).toBe(2);
    expect((await period.lockPeriod({ now: NOW, centerId, periodKey: KEY, actorId, reason: null })).ok).toBe(false);
    const { recomputeAttendanceDay } = await import("../../lib/cham-cong/recompute");
    expect((await recomputeAttendanceDay(userId, d1)).skipped).toBe("LOCKED");
    // Ghi đè trên ngày đã khoá bị chặn.
    expect((await period.setDayOverride({ now: NOW, userId, workDate: d1, units: 0.5, note: "x", actorId })).ok).toBe(false);
  });

  it("kỳ chưa kết thúc không chốt được; reopen mở băng; setDayOverride sau đó ghi ADJUSTED và summary đọc số ghi đè", async () => {
    const future = "2099-01";
    expect((await period.lockPeriod({ now: NOW, centerId, periodKey: future, actorId, reason: null })).ok).toBe(false);
    const ro = await period.reopenPeriod({ now: NOW, centerId, periodKey: KEY, actorId, reason: "sửa công" });
    expect(ro.ok).toBe(true);
    expect((await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId, periodKey: KEY } } })).status).toBe("REOPENED");
    expect((await db.staffAttendanceDay.findMany({ where: { userId } })).every((x) => x.status === "COMPUTED")).toBe(true);
    const ov = await period.setDayOverride({ now: NOW, userId, workDate: d1, units: 0.5, note: "về sớm có phép", actorId });
    expect(ov.ok).toBe(true);
    const row = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId, workDate: d1 } } });
    expect(row).toMatchObject({ overrideUnits: 0.5, status: "ADJUSTED", overrideById: actorId });
    const s = await period.buildPeriodSummary(centerId, KEY);
    expect(s.rows[0].units).toBe(1.5);
    expect(s.rows[0].overrideDays).toBe(1);
    // Không lý do ⇒ chặn; bỏ ghi đè ⇒ về COMPUTED.
    expect((await period.setDayOverride({ now: NOW, userId, workDate: d2, units: 0, note: "", actorId })).ok).toBe(false);
    expect((await period.setDayOverride({ now: NOW, userId, workDate: d1, units: null, note: null, actorId })).ok).toBe(true);
    expect((await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId, workDate: d1 } } })).status).toBe("COMPUTED");
  });
});
