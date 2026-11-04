// tests/cham-cong/tang-ca.spec.ts — đợt 4 đơn từ: OT vào bảng công (QĐ-2: trả = min(duyệt, thật)).
// Đi trọn đường thật: nộp → duyệt → tính lại → đọc StaffAttendanceDay. Mỗi ca dùng NGÀY riêng (luật 18).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/tang-ca] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-ot4";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const NOW_TEST = new Date("2026-09-09T03:00:00Z");
const SAU = new Date("2026-11-30T03:00:00Z");

d("[OT-DB] tăng ca vào bảng công", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let requests: typeof import("../../lib/cham-cong/requests");
  let recompute: typeof import("../../lib/cham-cong/recompute");
  let cs = "";
  let nv = "";
  let tplHC = "";
  const actor = { id: "", name: "QL ot4" };
  const HC_SEG = [
    { start: "08:00", end: "11:30", kind: "WORK", orgUnitIds: [] },
    { start: "13:30", end: "17:30", kind: "WORK", orgUnitIds: [] },
  ];
  const base = {
    hours: null, className: null, classId: null, targetUserId: null, requesterNewTemplateId: null, targetNewTemplateId: null,
    leaveTypeId: null, requestedInAt: null, requestedOutAt: null, requestedIn2At: null, requestedOut2At: null,
    chosenCenterId: null, leaveDurationType: null, detail: null, reason: "test",
  };

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const reqs = await db.workRequest.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: reqs.map((r) => r.id) } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.holiday.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    recompute = await import("../../lib/cham-cong/recompute");
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS ot4", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } });
    nv = (await mk("nv", "NV ot4")).id;
    actor.id = (await mk("ql", "QL ot4")).id;
    tplHC = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "HC", centerId: null }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  const xepHC = (ngay: Date) =>
    db.shiftAssignment.create({ data: { userId: nv, centerId: cs, workDate: ngay, templateId: tplHC, templateCode: "HC", segments: HC_SEG, source: "IMPORT" } });
  const quet = (ngay: Date, gio: string, direction: "CHECK_IN" | "CHECK_OUT") => {
    const [h, mi] = gio.split(":").map(Number);
    return db.staffTimeLog.create({
      data: { userId: nv, centerId: cs, direction, workDate: ngay, source: "TICKET", result: "ACCEPTED", loggedAt: new Date(Date.UTC(ngay.getUTCFullYear(), ngay.getUTCMonth(), ngay.getUTCDate(), h! - 7, mi!)) },
    });
  };
  const nopOt = async (ngay: Date, tu: string, den: string) => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: nv, kind: "OT", fromDate: ngay, toDate: null, startTime: tu, endTime: den });
    if (!s.ok) throw new Error(s.error);
    return s.id;
  };
  const duyet = (id: string, dieuChinh?: { otTu: string | null; otDen: string | null }) =>
    requests.decideRequest({ now: NOW_TEST, requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true, dieuChinh });
  const dong = async (ngay: Date) => {
    await recompute.recomputeAttendanceDay(nv, ngay, { now: SAU });
    return db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId: nv, workDate: ngay } } });
  };
  const ngayLamDu = async (ngay: Date, raLuc: string) => {
    await xepHC(ngay);
    await quet(ngay, "07:55", "CHECK_IN");
    await quet(ngay, "11:31", "CHECK_OUT");
    await quet(ngay, "13:25", "CHECK_IN");
    await quet(ngay, raLuc, "CHECK_OUT");
  };

  it("[OT-DB-01] chưa duyệt ⇒ 0; duyệt 18:00–21:00 + làm tới 20:30 ⇒ trả 150′; công trong ca không đổi", async () => {
    const ngay = utc(2026, 10, 5);
    await ngayLamDu(ngay, "20:30");
    const id = await nopOt(ngay, "18:00", "21:00");
    const truoc = await dong(ngay);
    expect(truoc.otPayableMinutes).toBe(0); // OT chưa duyệt không ảnh hưởng bảng công

    const r = await duyet(id);
    expect(r.ok).toBe(true);
    const don = await db.workRequest.findUniqueOrThrow({ where: { id } });
    expect(don.effectVersion).toBe(1);
    expect([don.approvedStartTime, don.approvedEndTime]).toEqual(["18:00", "21:00"]);

    const sau = await dong(ngay);
    expect(sau.otApprovedMinutes).toBe(180);
    expect(sau.otActualMinutes).toBe(150);
    expect(sau.otPayableMinutes).toBe(150);
    expect(sau.dayCreditEarned).toBe(truoc.dayCreditEarned);
    expect(sau.workedMinutes).toBe(truoc.workedMinutes);
  });

  it("[OT-DB-02] quản lý THU HẸP khung còn 18:00–19:00 ⇒ trả 60′; nới rộng ⇒ bị chặn, đơn giữ PENDING", async () => {
    const ngay = utc(2026, 10, 6);
    await ngayLamDu(ngay, "20:30");
    const id = await nopOt(ngay, "18:00", "21:00");
    const rong = await duyet(id, { otTu: "17:00", otDen: "21:00" });
    expect(rong.ok).toBe(false);
    expect((await db.workRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");

    expect((await duyet(id, { otTu: "18:00", otDen: "19:00" })).ok).toBe(true);
    expect((await dong(ngay)).otPayableMinutes).toBe(60);
  });

  it("[OT-DB-03] đã duyệt nhưng KHÔNG chấm công trong khung ⇒ 0 (không tự cộng đủ giờ)", async () => {
    const ngay = utc(2026, 10, 7);
    await ngayLamDu(ngay, "17:35");
    const id = await nopOt(ngay, "18:00", "21:00");
    expect((await duyet(id)).ok).toBe(true);
    const r = await dong(ngay);
    expect(r.otApprovedMinutes).toBe(180);
    expect(r.otPayableMinutes).toBe(0);
  });

  it("[OT-DB-04] ngày không có ca / ngày lễ ⇒ không duyệt OT (đó là đơn làm ngày nghỉ / lễ)", async () => {
    const khongCa = utc(2026, 10, 8);
    const id1 = await nopOt(khongCa, "18:00", "20:00");
    const r1 = await duyet(id1);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/không có ca làm việc/);

    const le = utc(2026, 10, 9);
    await xepHC(le);
    await db.holiday.create({ data: { name: `${TAG} lễ`, date: le, type: "HOLIDAY", centerId: cs } });
    const id2 = await nopOt(le, "18:00", "20:00");
    const r2 = await duyet(id2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/ngày lễ/);
  });

  it("[OT-DB-05] đơn OT duyệt THEO LUẬT CŨ (không dấu effectVersion) ⇒ KHÔNG tác động bảng công", async () => {
    const ngay = utc(2026, 10, 12);
    await ngayLamDu(ngay, "20:30");
    const id = await nopOt(ngay, "18:00", "21:00");
    // Giả lập đơn đã duyệt TRƯỚC bản này trên prod: APPROVED mà không có dấu.
    await db.workRequest.update({ where: { id }, data: { status: "APPROVED", reviewedAt: NOW_TEST } });
    expect((await dong(ngay)).otPayableMinutes).toBe(0);
  });
});
