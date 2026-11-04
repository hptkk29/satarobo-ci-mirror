// tests/cham-cong/recompute.spec.ts — L2 cổng ra: engine ghi được StaffAttendanceDay từ DB thật.
// Postgres LOCAL (satarobo_test); tự SKIP nếu không có.
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";
import { HO_CENTER_ID } from "../../lib/cham-cong/home-center";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL) /* từ chối cả tunnel VPS (CONG_TUNNEL_VPS) */;
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/recompute] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-recompute";
// Giờ VN: 07:43 = 00:43Z
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("recomputeAttendanceDay — DB thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let userId = "";
  let centerId = "";
  let tplS = "";
  const day = new Date(Date.UTC(2026, 8, 8)); // 08/09/2026 (Thứ Ba)
  // Import động sau khi env sẵn sàng (lib/db đọc DATABASE_URL lúc import).
  let recompute: typeof import("../../lib/cham-cong/recompute");

  beforeAll(async () => {
    recompute = await import("../../lib/cham-cong/recompute");
    await seedShiftTemplates(db);
    const old = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = old.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const c = await db.center.upsert({
      where: { slug: `${TAG}-cs1` },
      update: {},
      create: { slug: `${TAG}-cs1`, name: "CS1 recompute", address: "x", code: `${TAG}-CS1` },
      select: { id: true },
    });
    centerId = c.id;
    const u = await db.user.create({
      data: { email: `gv@${TAG}.test`, name: "GV recompute", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId },
      select: { id: true },
    });
    userId = u.id;
    tplS = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } })).id;
    await db.shiftAssignment.create({
      data: {
        userId,
        centerId,
        workDate: day,
        templateId: tplS,
        templateCode: "S",
        segments: [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }],
        placeMode: "AT_UNITS",
        attendanceMode: "REQUIRED",
        dayCredit: 1,
        source: "IMPORT",
      },
    });
  });

  afterAll(async () => {
    await db.staffAttendanceDay.deleteMany({ where: { userId } });
    await db.staffTimeLog.deleteMany({ where: { userId } });
    await db.shiftAssignment.deleteMany({ where: { userId } });
    await db.attendancePeriod.deleteMany({ where: { centerId, periodKey: "2026-09" } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("không lượt → dòng WORK, KHONG_CO_LUOT, 1 công theo kế hoạch", async () => {
    const r = await recompute.recomputeAttendanceDay(userId, day);
    expect(r.skipped).toBeUndefined();
    const row = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId, workDate: day } } });
    expect(row).toMatchObject({ dayType: "WORK", templateCode: "S", centerId, expectedMinutes: 225, workedMinutes: 0, dayCreditEarned: 1, status: "COMPUTED" });
    expect(row.flags).toEqual(["KHONG_CO_LUOT"]);
  });

  it("2 lượt ACCEPTED (07:43 vào, 11:32 ra) + 1 lượt REJECTED bị bỏ → 225′, không cờ; giờ tính theo VN", async () => {
    await db.staffTimeLog.createMany({
      data: [
        { userId, centerId, direction: "CHECK_IN", loggedAt: vn("2026-09-08", "07:43"), workDate: day, source: "TICKET", result: "ACCEPTED" },
        { userId, centerId, direction: "CHECK_OUT", loggedAt: vn("2026-09-08", "11:32"), workDate: day, source: "TICKET", result: "ACCEPTED" },
        { userId, centerId, direction: "CHECK_IN", loggedAt: vn("2026-09-08", "06:00"), workDate: day, source: "TICKET", result: "REJECTED", rejectReason: "TICKET_INVALID" },
      ],
    });
    const logs = await recompute.acceptedLogsOfDay(db, userId, day);
    expect(logs).toHaveLength(2);
    await recompute.recomputeAttendanceDay(userId, day);
    const row = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId, workDate: day } } });
    expect(row.workedMinutes).toBe(225);
    expect(row.flags).toEqual([]);
    expect(row.hourCredit).toBe(3.75);
  });

  it("overrideUnits của QLCS được giữ qua lần tính lại, status ADJUSTED", async () => {
    await db.staffAttendanceDay.update({ where: { userId_workDate: { userId, workDate: day } }, data: { overrideUnits: 0.5, overrideNote: "về sớm", status: "ADJUSTED" } });
    await recompute.recomputeAttendanceDay(userId, day);
    const row = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId, workDate: day } } });
    expect(row.overrideUnits).toBe(0.5);
    expect(row.status).toBe("ADJUSTED");
  });

  it("kỳ LOCKED → bỏ qua, không đè", async () => {
    await db.attendancePeriod.create({ data: { centerId, periodKey: "2026-09", status: "LOCKED" } });
    await db.staffTimeLog.create({ data: { userId, centerId, direction: "CHECK_OUT", loggedAt: vn("2026-09-08", "12:00"), workDate: day, source: "TICKET", result: "ACCEPTED" } });
    const r = await recompute.recomputeAttendanceDay(userId, day);
    expect(r.skipped).toBe("LOCKED");
    const row = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId, workDate: day } } });
    expect(row.workedMinutes).toBe(225);
    await db.attendancePeriod.deleteMany({ where: { centerId, periodKey: "2026-09" } });
  });

  it("miễn tính công → xoá dòng, skipped EXEMPT", async () => {
    const emp = await db.employee.create({
      data: { employeeCode: `${TAG}-E1`, fullName: "GV recompute", jobTitle: "GV", department: "DAO_TAO", timesheetExempt: true, centerId },
      select: { id: true },
    });
    await db.user.update({ where: { id: userId }, data: { employeeId: emp.id } });
    const r = await recompute.recomputeAttendanceDay(userId, day);
    expect(r.skipped).toBe("EXEMPT");
    expect(await db.staffAttendanceDay.findUnique({ where: { userId_workDate: { userId, workDate: day } } })).toBeNull();
    await db.user.update({ where: { id: userId }, data: { employeeId: null } });
    await db.employee.delete({ where: { id: emp.id } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug prod 13/09/2026 — công của người Hội sở nhảy vào cơ sở họ vừa quét.
//
// ⚠️ `describe` RIÊNG, người RIÊNG, ngày RIÊNG (luật 18): khối trên chain trạng thái giữa các
// ca, khối này KHÔNG được mượn gì của nó và cũng không để lại gì cho nó.
// ─────────────────────────────────────────────────────────────────────────────
const TAG_HO = "cc-noi-chiu-cong";

d("recomputeAttendanceDay — NƠI CHỊU CÔNG là nơi trực thuộc, không phải nơi quét", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let recompute: typeof import("../../lib/cham-cong/recompute");
  let cs1 = "";
  const ngay = new Date(Date.UTC(2026, 8, 12)); // 12/09/2026 — KHÔNG đụng ngày của khối trên

  const donDep = async () => {
    const u = await db.user.findMany({ where: { email: { endsWith: `@${TAG_HO}.test` } }, select: { id: true } });
    const ids = u.map((x) => x.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  };

  beforeAll(async () => {
    recompute = await import("../../lib/cham-cong/recompute");
    await seedShiftTemplates(db);
    await donDep();
    cs1 = (
      await db.center.upsert({
        where: { slug: `${TAG_HO}-cs1` },
        update: {},
        create: { slug: `${TAG_HO}-cs1`, name: "CS1 nơi quét", address: "x", code: `${TAG_HO}-CS1` },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await donDep();
    await db.$disconnect();
  });

  /** Người KHÔNG có ca xếp ngày đó, chỉ có lượt quét ở `centerIdQuet`. */
  async function nguoiQuetONoiKhac(email: string, centerIdNha: string | null, centerIdQuet: string) {
    const u = await db.user.create({
      data: { email, name: email, role: "HR", roles: ["HR"], password: "x", centerId: centerIdNha },
      select: { id: true },
    });
    await db.staffTimeLog.createMany({
      data: [
        { userId: u.id, centerId: centerIdQuet, direction: "CHECK_IN", loggedAt: vn("2026-09-12", "08:05"), workDate: ngay, source: "TICKET", result: "ACCEPTED" },
        { userId: u.id, centerId: centerIdQuet, direction: "CHECK_OUT", loggedAt: vn("2026-09-12", "17:20"), workDate: ngay, source: "TICKET", result: "ACCEPTED" },
      ],
    });
    await recompute.recomputeAttendanceDay(u.id, ngay);
    return u.id;
  }

  // ── vế CHẶN: đúng bug được báo ─────────────────────────────────────────────
  it("người HỘI SỞ không có ca, quét ở CS1 ⇒ ngày công thuộc HO, 0 dòng ở CS1", async () => {
    // `centerId: null` trên User ⇒ `resolveHomeCenter` trả HO (`home-center.ts`).
    const userId = await nguoiQuetONoiKhac(`ho@${TAG_HO}.test`, null, cs1);

    const row = await db.staffAttendanceDay.findUniqueOrThrow({
      where: { userId_workDate: { userId, workDate: ngay } },
    });
    expect(row.centerId, "ngày công phải thuộc Hội sở").toBe(HO_CENTER_ID);
    expect(row.centerId).not.toBe(cs1);

    // Sổ công của CS1 lọc theo `StaffAttendanceDay.centerId` ⇒ 0 dòng.
    const oCS1 = await db.staffAttendanceDay.count({ where: { workDate: ngay, centerId: cs1, userId } });
    expect(oCS1, "0 dòng công ở CS1").toBe(0);

    // …nhưng LƯỢT QUÉT vẫn mang CS1 — nơi quét không bị xoá đi đâu cả.
    const luot = await db.staffTimeLog.findMany({ where: { userId, workDate: ngay }, select: { centerId: true } });
    expect(luot.map((l) => l.centerId)).toEqual([cs1, cs1]);
  });

  // ── vế CHO QUA (luật 16) ───────────────────────────────────────────────────
  it("người CS1 quét ở CS1 ⇒ VẪN thuộc CS1", async () => {
    const userId = await nguoiQuetONoiKhac(`cs1@${TAG_HO}.test`, cs1, cs1);
    const row = await db.staffAttendanceDay.findUniqueOrThrow({
      where: { userId_workDate: { userId, workDate: ngay } },
    });
    expect(row.centerId).toBe(cs1);
  });

  it("ca ĐƯỢC XẾP vẫn thắng nơi trực thuộc — người Hội sở được xếp ca ở CS1 thì công thuộc CS1", async () => {
    // Cố ý: `ShiftAssignment.centerId` là "cơ sở LÀM / chịu công hôm đó". Bản vá KHÔNG được
    // biến mọi thứ thành "luôn theo nhà" — đó là vá quá tay.
    const u = await db.user.create({
      data: { email: `ho-co-ca@${TAG_HO}.test`, name: "HO có ca", role: "HR", roles: ["HR"], password: "x", centerId: null },
      select: { id: true },
    });
    const tpl = await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } });
    await db.shiftAssignment.create({
      data: {
        userId: u.id, centerId: cs1, workDate: ngay, templateId: tpl.id, templateCode: "S",
        segments: [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }],
        placeMode: "AT_UNITS", attendanceMode: "REQUIRED", dayCredit: 1, source: "MANUAL",
      },
    });
    await recompute.recomputeAttendanceDay(u.id, ngay);
    const row = await db.staffAttendanceDay.findUniqueOrThrow({
      where: { userId_workDate: { userId: u.id, workDate: ngay } },
    });
    expect(row.centerId).toBe(cs1);
  });
});
