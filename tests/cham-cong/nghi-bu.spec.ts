// tests/cham-cong/nghi-bu.spec.ts — đợt 7–8 đơn từ: nghỉ nửa buổi / theo giờ + quỹ nghỉ bù.
// Đi trọn đường thật: nộp → duyệt → tính lại → đọc StaffAttendanceDay / CompTimeLedger. Mỗi ca dùng
// NGÀY riêng (luật 18); mọi ca nghỉ bù dùng NGƯỜI riêng để số dư quỹ không mượn nhau.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/nghi-bu] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-nb8";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const NOW_TEST = new Date("2026-09-09T03:00:00Z");
const SAU = new Date("2026-11-30T03:00:00Z");

d("[NB-DB] nghỉ một phần ca + quỹ nghỉ bù", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let requests: typeof import("../../lib/cham-cong/requests");
  let recompute: typeof import("../../lib/cham-cong/recompute");
  let quy: typeof import("../../lib/cham-cong/nghi-bu-db");
  let cs = "";
  let tplHC = "";
  let ltCoLuong = "";
  const actor = { id: "", name: "QL nb8" };
  const HC_SEG = [
    { start: "08:00", end: "11:30", kind: "WORK", orgUnitIds: [] },
    { start: "13:30", end: "17:30", kind: "WORK", orgUnitIds: [] },
  ];
  const base = {
    hours: null, className: null, classId: null, targetUserId: null, requesterNewTemplateId: null, targetNewTemplateId: null,
    leaveTypeId: null, requestedInAt: null, requestedOutAt: null, requestedIn2At: null, requestedOut2At: null,
    chosenCenterId: null, detail: null, reason: "test", startTime: null, endTime: null, toDate: null,
  };

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const reqs = await db.workRequest.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: [...reqs.map((r) => r.id), ...ids] } } });
    await db.compTimeLedger.deleteMany({ where: { userId: { in: ids } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  let soNguoi = 0;
  const nguoiMoi = async () =>
    (
      await db.user.create({
        data: { email: `nv${++soNguoi}@${TAG}.test`, name: `NV nb8 ${soNguoi}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    recompute = await import("../../lib/cham-cong/recompute");
    quy = await import("../../lib/cham-cong/nghi-bu-db");
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS nb8", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await cleanup();
    actor.id = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL nb8", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
    tplHC = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "HC", centerId: null }, select: { id: true } })).id;
    ltCoLuong = (
      await db.leaveType.upsert({
        where: { code: `${TAG}-NP` },
        update: { paidRatio: 1, isActive: true },
        create: { code: `${TAG}-NP`, name: "Nghỉ phép nb8", paidRatio: 1, countsAsWorked: false, isActive: true, displayOrder: 999 },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.leaveType.deleteMany({ where: { code: `${TAG}-NP` } });
    await db.$disconnect();
  });

  // Ca hành chính HAI cụm quét (soCapQuetKyVong 2) — nửa buổi chỉ có nghĩa với ca hai cụm.
  const xepHC = (nv: string, ngay: Date) =>
    db.shiftAssignment.create({
      data: { userId: nv, centerId: cs, workDate: ngay, templateId: tplHC, templateCode: "HC", segments: HC_SEG, source: "IMPORT", soCapQuetKyVong: 2 },
    });
  const quet = (nv: string, ngay: Date, gio: string, direction: "CHECK_IN" | "CHECK_OUT") => {
    const [h, mi] = gio.split(":").map(Number);
    return db.staffTimeLog.create({
      data: { userId: nv, centerId: cs, direction, workDate: ngay, source: "TICKET", result: "ACCEPTED", loggedAt: new Date(Date.UTC(ngay.getUTCFullYear(), ngay.getUTCMonth(), ngay.getUTCDate(), h! - 7, mi!)) },
    });
  };
  const nop = async (input: Record<string, unknown>) => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, ...input } as Parameters<typeof requests.submitAttendanceRequest>[0]);
    if (!s.ok) throw new Error(s.error);
    return s.id;
  };
  const duyet = (id: string) =>
    requests.decideRequest({ now: NOW_TEST, requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
  const dong = async (nv: string, ngay: Date) => {
    await recompute.recomputeAttendanceDay(nv, ngay, { now: SAU });
    return db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId: nv, workDate: ngay } } });
  };
  const soDu = async (nv: string) => (await quy.soDuQuyCuaNguoi([nv])).get(nv)!.soDu;

  it("[NB-DB-01] nghỉ nửa SÁNG có lương, chiều đi làm đủ ⇒ không thiếu buổi, công 0,5 + nghỉ 0,5; ô ca GIỮ NGUYÊN", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 12);
    await xepHC(nv, ngay);
    await quet(nv, ngay, "13:25", "CHECK_IN");
    await quet(nv, ngay, "17:35", "CHECK_OUT");
    const truoc = await dong(nv, ngay);
    expect(truoc.flags).toContain("THIEU_BUOI_SANG"); // đối chứng dương: chưa duyệt thì vẫn bị đòi buổi sáng

    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: ngay, leaveTypeId: ltCoLuong, leaveDurationType: "HALF_DAY_AM" });
    const r = await duyet(id);
    expect(r.ok).toBe(true);
    const ca = await db.shiftAssignment.findMany({ where: { userId: nv, workDate: ngay } });
    expect(ca.map((c) => [c.templateCode, c.status])).toEqual([["HC", "ACTIVE"]]);

    const sau = await dong(nv, ngay);
    expect(sau.flags).not.toContain("THIEU_BUOI_SANG");
    expect(sau.flags).toContain("NGHI_MOT_PHAN_DUYET");
    expect(sau.dayCreditEarned).toBe(0.5);
    expect(sau.leaveUnits).toBe(0.5);
  });

  it("[NB-DB-02] nghỉ theo giờ 08:00–09:30 rồi tới 09:35 ⇒ không đi muộn", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 13);
    await xepHC(nv, ngay);
    await quet(nv, ngay, "09:35", "CHECK_IN");
    await quet(nv, ngay, "11:31", "CHECK_OUT");
    await quet(nv, ngay, "13:25", "CHECK_IN");
    await quet(nv, ngay, "17:35", "CHECK_OUT");
    expect((await dong(nv, ngay)).flags).toContain("DI_MUON");
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: ngay, leaveTypeId: ltCoLuong, leaveDurationType: "HOURLY", startTime: "08:00", endTime: "09:30" });
    expect((await duyet(id)).ok).toBe(true);
    expect((await dong(nv, ngay)).flags).not.toContain("DI_MUON");
  });

  it("[NB-DB-03] quỹ = 0 ⇒ không nộp được đơn nghỉ bù", async () => {
    const nv = await nguoiMoi();
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: nv, kind: "COMP_LEAVE", fromDate: utc(2026, 10, 14), leaveDurationType: "FULL_DAY" });
    expect(s.ok).toBe(false);
  });

  it("[NB-DB-04] quỹ 60′, xin nghỉ bù 2h ⇒ duyệt bị chặn, đơn giữ PENDING, quỹ KHÔNG đổi (không bao giờ âm)", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 15);
    await xepHC(nv, ngay);
    expect((await quy.dieuChinhQuy({ userId: nv, centerId: cs, phut: 60, lyDo: "cộng thử nghiệm", actor })).ok).toBe(true);
    const id = await nop({ requesterId: nv, kind: "COMP_LEAVE", fromDate: ngay, leaveDurationType: "HOURLY", startTime: "08:00", endTime: "10:00" });
    const r = await duyet(id);
    expect(r.ok).toBe(false);
    expect((await db.workRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    expect(await soDu(nv)).toBe(60);
  });

  it("[NB-DB-05] quỹ 4h, nghỉ bù 08:00–10:00 ⇒ trừ đúng 120′ một lần; giờ nghỉ không bị đòi quét", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 16);
    await xepHC(nv, ngay);
    await quet(nv, ngay, "09:58", "CHECK_IN");
    await quet(nv, ngay, "11:31", "CHECK_OUT");
    await quet(nv, ngay, "13:25", "CHECK_IN");
    await quet(nv, ngay, "17:35", "CHECK_OUT");
    expect((await quy.dieuChinhQuy({ userId: nv, centerId: cs, phut: 240, lyDo: "cộng thử nghiệm", actor })).ok).toBe(true);
    const id = await nop({ requesterId: nv, kind: "COMP_LEAVE", fromDate: ngay, leaveDurationType: "HOURLY", startTime: "08:00", endTime: "10:00" });
    expect((await duyet(id)).ok).toBe(true);
    expect(await soDu(nv)).toBe(120);
    // Duyệt lại cùng đơn ⇒ đơn không còn chờ, không trừ lần hai.
    expect((await duyet(id)).ok).toBe(false);
    expect(await soDu(nv)).toBe(120);
    const ngayCong = await dong(nv, ngay);
    expect(ngayCong.flags).toContain("NGHI_BU_DUYET");
    expect(ngayCong.flags).not.toContain("DI_MUON");
  });

  it("[NB-DB-06] điều chỉnh tay TRỪ quá số dư ⇒ từ chối, quỹ giữ nguyên; lý do bắt buộc", async () => {
    const nv = await nguoiMoi();
    expect((await quy.dieuChinhQuy({ userId: nv, centerId: cs, phut: 30, lyDo: "cộng thử nghiệm", actor })).ok).toBe(true);
    expect((await quy.dieuChinhQuy({ userId: nv, centerId: cs, phut: -31, lyDo: "trừ thử nghiệm", actor })).ok).toBe(false);
    expect((await quy.dieuChinhQuy({ userId: nv, centerId: cs, phut: 10, lyDo: "", actor })).ok).toBe(false);
    expect(await soDu(nv)).toBe(30);
    const audit = await db.auditLog.findMany({ where: { entityType: "CompTimeLedger", entityId: nv } });
    expect(audit.map((a) => a.action)).toEqual(["ADJUST_COMP_TIME"]);
  });

  it("[NB-DB-07] OT duyệt khi TRẢ TIỀN ⇒ đổi chính sách sang NGHỈ BÙ về sau KHÔNG cộng quỹ hồi tố; OT duyệt khi NGHỈ BÙ ⇒ cộng ĐÚNG MỘT LẦN", async () => {
    const nv = await nguoiMoi();
    const lamThem = async (ngay: Date) => {
      await xepHC(nv, ngay);
      await quet(nv, ngay, "07:55", "CHECK_IN");
      await quet(nv, ngay, "11:31", "CHECK_OUT");
      await quet(nv, ngay, "13:25", "CHECK_IN");
      await quet(nv, ngay, "20:30", "CHECK_OUT");
      const id = await nop({ requesterId: nv, kind: "OT", fromDate: ngay, startTime: "18:00", endTime: "21:00" });
      expect((await duyet(id)).ok).toBe(true);
    };
    const ngayTien = utc(2026, 10, 19);
    await lamThem(ngayTien); // duyệt khi mặc định TRA_TIEN
    expect((await dong(nv, ngayTien)).otPayableMinutes).toBe(150);
    expect(await soDu(nv)).toBe(0);

    const cu = await db.systemSetting.findUnique({ where: { key: "shift.otQuyDoi" } });
    await db.systemSetting.upsert({ where: { key: "shift.otQuyDoi" }, create: { key: "shift.otQuyDoi", valueJson: "NGHI_BU" }, update: { valueJson: "NGHI_BU" } });
    try {
      // Hồi tố: tính lại ngày OT đã duyệt-để-trả-tiền dưới chính sách mới ⇒ quỹ vẫn 0.
      await dong(nv, ngayTien);
      await dong(nv, ngayTien);
      expect(await soDu(nv)).toBe(0);

      const ngayBu = utc(2026, 10, 20);
      await lamThem(ngayBu); // duyệt khi NGHI_BU ⇒ ảnh chụp trên đơn
      await dong(nv, ngayBu);
      await dong(nv, ngayBu);
      expect(await soDu(nv)).toBe(150);
      expect(await db.compTimeLedger.count({ where: { userId: nv } })).toBe(1);
    } finally {
      if (cu) await db.systemSetting.update({ where: { key: cu.key }, data: { valueJson: cu.valueJson ?? undefined } });
      else await db.systemSetting.delete({ where: { key: "shift.otQuyDoi" } });
    }
  });

  it("[NB-DB-08] tính lại công rút giờ OT mà phần quỹ đã được NGHỈ BÙ ⇒ KHÔNG trừ âm, KHÔNG kẹp 0: cờ rà soát + audit MỘT lần; quỹ đủ thì tự trừ nốt", async () => {
    const nv = await nguoiMoi();
    const ngayOt = utc(2026, 10, 21);
    const ngayBu = utc(2026, 10, 22);
    await xepHC(nv, ngayOt);
    await xepHC(nv, ngayBu);
    await quet(nv, ngayOt, "07:55", "CHECK_IN");
    await quet(nv, ngayOt, "11:31", "CHECK_OUT");
    await quet(nv, ngayOt, "13:25", "CHECK_IN");
    const ra = await quet(nv, ngayOt, "20:30", "CHECK_OUT");
    const cu = await db.systemSetting.findUnique({ where: { key: "shift.otQuyDoi" } });
    await db.systemSetting.upsert({ where: { key: "shift.otQuyDoi" }, create: { key: "shift.otQuyDoi", valueJson: "NGHI_BU" }, update: { valueJson: "NGHI_BU" } });
    try {
      const idOt = await nop({ requesterId: nv, kind: "OT", fromDate: ngayOt, startTime: "18:00", endTime: "21:00" });
      expect((await duyet(idOt)).ok).toBe(true);
    } finally {
      if (cu) await db.systemSetting.update({ where: { key: cu.key }, data: { valueJson: cu.valueJson ?? undefined } });
      else await db.systemSetting.delete({ where: { key: "shift.otQuyDoi" } });
    }
    await dong(nv, ngayOt);
    expect(await soDu(nv)).toBe(150);
    const idBu = await nop({ requesterId: nv, kind: "COMP_LEAVE", fromDate: ngayBu, leaveDurationType: "HOURLY", startTime: "08:00", endTime: "10:00" });
    expect((await duyet(idBu)).ok).toBe(true);
    expect(await soDu(nv)).toBe(30);

    // Chỉnh lượt ra thành 18:30 ⇒ OT thật chỉ còn 30′ ⇒ muốn trừ lại 120′, quỹ chỉ còn 30′.
    await db.staffTimeLog.update({ where: { id: ra.id }, data: { loggedAt: new Date(Date.UTC(2026, 9, 21, 11, 30)) } });
    const ngay1 = await dong(nv, ngayOt);
    await dong(nv, ngayOt); // tính lại lần nữa: không audit trùng
    expect(await soDu(nv)).toBe(30); // không âm, không trừ một phần
    expect(ngay1.flags).toContain("QUY_NGHI_BU_CAN_RA_SOAT");
    expect(ngay1.ruleSnapshot).toMatchObject({ quyNghiBuTreo: [{ nguon: "APPROVED_OT", phut: 120 }] });
    expect(await db.auditLog.count({ where: { entityId: ngay1.id, action: "COMP_TIME_RECONCILE_BLOCKED" } })).toBe(1);
    const raSoat = await quy.ngayCanRaSoat([nv]);
    expect(raSoat.map((r) => r.treo)).toEqual([[{ nguon: "APPROVED_OT", phut: 120, soDu: 30 }]]);

    // Quỹ đủ trở lại (điều chỉnh tay) ⇒ lần tính lại sau trừ nốt đúng 120′, gỡ cờ.
    expect((await quy.dieuChinhQuy({ userId: nv, centerId: cs, phut: 200, lyDo: "bù theo quyết định", actor })).ok).toBe(true);
    const ngay2 = await dong(nv, ngayOt);
    expect(await soDu(nv)).toBe(110);
    expect(ngay2.flags).not.toContain("QUY_NGHI_BU_CAN_RA_SOAT");
  });
});
