// tests/cham-cong/lam-ngay-nghi.spec.ts — đợt 9–10 đơn từ: làm ngày nghỉ / lễ + chấm ngoài địa điểm.
// Đi trọn đường thật: nộp → duyệt → tính lại → đọc StaffAttendanceDay / CompTimeLedger. Mỗi ca dùng
// NGƯỜI riêng (luật 18).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/lam-ngay-nghi] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-lnn9";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const NOW_TEST = new Date("2026-09-09T03:00:00Z");
const SAU = new Date("2026-11-30T03:00:00Z");

d("[LNN-DB] làm ngày nghỉ / lễ + chấm ngoài địa điểm", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let requests: typeof import("../../lib/cham-cong/requests");
  let recompute: typeof import("../../lib/cham-cong/recompute");
  let quy: typeof import("../../lib/cham-cong/nghi-bu-db");
  let cs = "";
  let tplHC = "";
  const actor = { id: "", name: "QL lnn9" };
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
    await db.holiday.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  let soNguoi = 0;
  const nguoiMoi = async () =>
    (
      await db.user.create({
        data: { email: `nv${++soNguoi}@${TAG}.test`, name: `NV lnn9 ${soNguoi}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    recompute = await import("../../lib/cham-cong/recompute");
    quy = await import("../../lib/cham-cong/nghi-bu-db");
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS lnn9", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await cleanup();
    actor.id = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL lnn9", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
    tplHC = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "HC", centerId: null }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
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

  const lamDu = async (nv: string, ngay: Date, vao: string, ra: string) => {
    await quet(nv, ngay, vao, "CHECK_IN");
    await quet(nv, ngay, ra, "CHECK_OUT");
  };

  it("[LNN-DB-01] ngày CÓ ca làm bình thường ⇒ không duyệt được (dùng đơn tăng ca), đơn giữ PENDING", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 21);
    await xepHC(nv, ngay);
    const id = await nop({ requesterId: nv, kind: "HOLIDAY_WORK", fromDate: ngay, startTime: "18:00", endTime: "20:00" });
    const r = await duyet(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Tăng ca/);
    expect((await db.workRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
  });

  it("[LNN-DB-02] ngày KHÔNG ca: chưa duyệt ⇒ 0 phút + cờ chấm ngoài lịch; duyệt ⇒ phút làm thật trong khung vào cột NGHỈ, cờ gỡ", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 25);
    await lamDu(nv, ngay, "08:30", "12:40");
    const id = await nop({ requesterId: nv, kind: "HOLIDAY_WORK", fromDate: ngay, startTime: "08:00", endTime: "12:00" });
    const truoc = await dong(nv, ngay);
    expect(truoc.restDayWorkMinutes).toBe(0);
    expect(truoc.flags).toContain("CHAM_NGOAI_LICH");

    expect((await duyet(id)).ok).toBe(true);
    const don = await db.workRequest.findUniqueOrThrow({ where: { id } });
    expect(don.appliedEffect).toMatchObject({ loai: "NGHI", quyDoi: { cheDo: "TRA_TIEN" } });
    const sau = await dong(nv, ngay);
    expect(sau.restDayWorkMinutes).toBe(210);
    expect(sau.holidayWorkMinutes).toBe(0);
    expect(sau.flags).toContain("LAM_NGAY_NGHI_DUYET");
    expect(sau.flags).not.toContain("CHAM_NGOAI_LICH");
    expect(await soDu(nv)).toBe(0); // mặc định trả tiền ⇒ quỹ không đổi
  });

  it("[LNN-DB-03] ngày LỄ có ca ⇒ duyệt được, phút vào cột LỄ", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 26);
    await xepHC(nv, ngay);
    await db.holiday.create({ data: { name: `${TAG} lễ 26`, date: ngay, type: "HOLIDAY", centerId: cs } });
    await lamDu(nv, ngay, "08:00", "11:00");
    const id = await nop({ requesterId: nv, kind: "HOLIDAY_WORK", fromDate: ngay, startTime: "08:00", endTime: "11:00" });
    expect((await duyet(id)).ok).toBe(true);
    const r = await dong(nv, ngay);
    expect(r.holidayWorkMinutes).toBe(180);
    expect(r.restDayWorkMinutes).toBe(0);
  });

  it("[LNN-DB-04] chính sách NGHỈ BÙ lúc duyệt ⇒ cộng quỹ nguồn HOLIDAY_WORK đúng một lần", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 27);
    await lamDu(nv, ngay, "08:00", "10:00");
    const id = await nop({ requesterId: nv, kind: "HOLIDAY_WORK", fromDate: ngay, startTime: "08:00", endTime: "12:00" });
    const cu = await db.systemSetting.findUnique({ where: { key: "shift.lamNgayNghiQuyDoi" } });
    await db.systemSetting.upsert({ where: { key: "shift.lamNgayNghiQuyDoi" }, create: { key: "shift.lamNgayNghiQuyDoi", valueJson: "NGHI_BU" }, update: { valueJson: "NGHI_BU" } });
    try {
      expect((await duyet(id)).ok).toBe(true);
    } finally {
      if (cu) await db.systemSetting.update({ where: { key: cu.key }, data: { valueJson: cu.valueJson ?? undefined } });
      else await db.systemSetting.delete({ where: { key: "shift.lamNgayNghiQuyDoi" } });
    }
    // Chính sách đã trả về mặc định — ảnh chụp trên đơn vẫn quyết.
    await dong(nv, ngay);
    await dong(nv, ngay);
    expect(await soDu(nv)).toBe(120);
    expect(await db.compTimeLedger.findMany({ where: { userId: nv }, select: { sourceType: true, minutes: true } })).toEqual([{ sourceType: "HOLIDAY_WORK", minutes: 120 }]);
  });

  it("[LNN-DB-05] chấm ngoài địa điểm: thiếu địa điểm ⇒ không nộp được; ngày không ca ⇒ không duyệt; có ca ⇒ duyệt + mở cổng đúng khung", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 28);
    const thieu = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: nv, kind: "OUTSIDE_ATTENDANCE", fromDate: ngay, startTime: "14:00", endTime: "16:00", leaveDurationType: null });
    expect(thieu.ok).toBe(false);

    const idKhongCa = await nop({ requesterId: nv, kind: "OUTSIDE_ATTENDANCE", fromDate: ngay, startTime: "14:00", endTime: "16:00", detail: "Địa điểm: Hoà Khánh" });
    expect((await duyet(idKhongCa)).ok).toBe(false);

    const ngay2 = utc(2026, 10, 29);
    await xepHC(nv, ngay2);
    const id = await nop({ requesterId: nv, kind: "OUTSIDE_ATTENDANCE", fromDate: ngay2, startTime: "14:00", endTime: "16:00", detail: "Địa điểm: Hoà Khánh" });
    expect((await duyet(id)).ok).toBe(true);
    const { quyenChamNgoaiLucNay } = await import("../../lib/cham-cong/cham-ngoai-db");
    // 14:10 giờ VN = 07:10Z; 18:00 VN = 11:00Z (ngoài khung + dung sai).
    const trong = await quyenChamNgoaiLucNay(nv, new Date(Date.UTC(2026, 9, 29, 7, 10)));
    const ngoai = await quyenChamNgoaiLucNay(nv, new Date(Date.UTC(2026, 9, 29, 11, 0)));
    expect(trong?.lyDo).toBe("NGOAI_DIA_DIEM");
    expect(ngoai).toBeNull();
  });
});
