// tests/cham-cong/lam-tu-xa-cong-tac.spec.ts — đợt 5 (làm từ xa) + đợt 6 (đi công tác) trên DB thật:
// nộp → duyệt → được chấm ngoài văn phòng đúng khung → tính lại công. Mỗi ca ngày riêng (luật 18).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/lam-tu-xa-cong-tac] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-lx56";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const lucVN = (ngay: Date, gio: string) => {
  const [h, mi] = gio.split(":").map(Number);
  return new Date(Date.UTC(ngay.getUTCFullYear(), ngay.getUTCMonth(), ngay.getUTCDate(), h! - 7, mi!));
};
const NOW_TEST = new Date("2026-09-09T03:00:00Z");
const SAU = new Date("2026-12-31T03:00:00Z");

d("[LX/CT-DB] làm từ xa + công tác", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let requests: typeof import("../../lib/cham-cong/requests");
  let recompute: typeof import("../../lib/cham-cong/recompute");
  let chamNgoai: typeof import("../../lib/cham-cong/cham-ngoai-db");
  let timelog: typeof import("../../lib/cham-cong/timelog");
  let cs = "";
  let nv = "";
  let tplHC = "";
  const actor = { id: "", name: "QL lx" };
  const HC_SEG = [
    { start: "08:00", end: "11:30", kind: "WORK", orgUnitIds: [] },
    { start: "13:30", end: "17:30", kind: "WORK", orgUnitIds: [] },
  ];
  const base = {
    hours: null, className: null, classId: null, targetUserId: null, requesterNewTemplateId: null, targetNewTemplateId: null,
    leaveTypeId: null, requestedInAt: null, requestedOutAt: null, requestedIn2At: null, requestedOut2At: null,
    chosenCenterId: null, leaveDurationType: null, detail: null, reason: "test", startTime: null, endTime: null,
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
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    recompute = await import("../../lib/cham-cong/recompute");
    chamNgoai = await import("../../lib/cham-cong/cham-ngoai-db");
    timelog = await import("../../lib/cham-cong/timelog");
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS lx", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } });
    nv = (await mk("nv", "NV lx")).id;
    actor.id = (await mk("ql", "QL lx")).id;
    tplHC = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "HC", centerId: null }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  const xepHC = (ngay: Date) =>
    db.shiftAssignment.create({ data: { userId: nv, centerId: cs, workDate: ngay, templateId: tplHC, templateCode: "HC", segments: HC_SEG, source: "IMPORT" } });
  const nop = async (kind: "REMOTE" | "BUSINESS_TRIP", tu: Date, den: Date, gio: { startTime: string; endTime: string } | null = null) => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, ...(gio ?? {}), requesterId: nv, kind, fromDate: tu, toDate: den });
    if (!s.ok) throw new Error(s.error);
    return s.id;
  };
  const duyet = (id: string) =>
    requests.decideRequest({ now: NOW_TEST, requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
  const dong = async (ngay: Date) => {
    await recompute.recomputeAttendanceDay(nv, ngay, { now: SAU });
    return db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId: nv, workDate: ngay } } });
  };

  it("[LX-DB-01] làm từ xa 14:00–16:00: CHỜ duyệt ⇒ chưa được chấm ngoài; ĐÃ duyệt ⇒ được trong khung, ngoài khung thì không", async () => {
    const ngay = utc(2026, 10, 14);
    await xepHC(ngay);
    const id = await nop("REMOTE", ngay, ngay, { startTime: "14:00", endTime: "16:00" });
    expect(await chamNgoai.quyenChamNgoaiLucNay(nv, lucVN(ngay, "15:00"))).toBeNull();

    expect((await duyet(id)).ok).toBe(true);
    expect(await chamNgoai.quyenChamNgoaiLucNay(nv, lucVN(ngay, "15:00"))).toMatchObject({ lyDo: "LAM_TU_XA" });
    expect(await chamNgoai.quyenChamNgoaiLucNay(nv, lucVN(ngay, "10:00"))).toBeNull();
    expect(await chamNgoai.quyenChamNgoaiLucNay(nv, lucVN(ngay, "18:00"))).toBeNull();

    // Lượt ghi ngoài điểm chấm trong khung mang cờ thông tin; ca KHÔNG đổi.
    const r = await timelog.recordTimeLog({ userId: nv, workLocationId: null, direction: "CHECK_IN", source: "CONG_TAC", now: lucVN(ngay, "14:02") });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.flags).toContain("LAM_TU_XA");
    expect(await db.shiftAssignment.count({ where: { userId: nv, workDate: ngay, status: "ACTIVE", templateCode: "HC" } })).toBe(1);
    const day = await dong(ngay);
    expect(day.flags).toContain("LAM_TU_XA_DUYET");
  });

  it("[CT-DB-01] công tác 3 ngày: MỌI ngày trong khoảng có lịch công tác (không thao tác tay thứ hai), đủ công không cần quét", async () => {
    const ngay = [utc(2026, 10, 19), utc(2026, 10, 20), utc(2026, 10, 21)];
    for (const n of ngay) await xepHC(n);
    const caTruoc = await db.shiftAssignment.count({ where: { userId: nv } });
    const id = await nop("BUSINESS_TRIP", ngay[0]!, ngay[2]!);
    expect((await duyet(id)).ok).toBe(true);
    // Duyệt KHÔNG tạo ca / bản ghi lịch mới — đơn đã duyệt chính là lịch công tác.
    expect(await db.shiftAssignment.count({ where: { userId: nv } })).toBe(caTruoc);

    for (const n of ngay) {
      expect(await chamNgoai.quyenChamNgoaiLucNay(nv, lucVN(n, "09:00"))).toMatchObject({ lyDo: "CONG_TAC" });
      const r = await dong(n);
      expect(r.flags).toEqual(expect.arrayContaining(["CONG_TAC_DUYET", "CONG_TAC_DU_CONG"]));
      expect(r.flags).not.toContain("KHONG_CO_LUOT");
      expect(r.dayCreditEarned).toBe(r.dayCreditExpected);
    }
    // Ngày ngoài khoảng: không có gì.
    expect(await chamNgoai.quyenChamNgoaiLucNay(nv, lucVN(utc(2026, 10, 22), "09:00"))).toBeNull();
  });

  it("[CT-DB-02] idempotent: tính lại nhiều lần ra cùng một dòng; duyệt lại đơn đã duyệt bị chặn, không đẻ thêm gì", async () => {
    const n = utc(2026, 10, 26);
    await xepHC(n);
    const id = await nop("BUSINESS_TRIP", n, n);
    expect((await duyet(id)).ok).toBe(true);
    const a = await dong(n);
    const b = await dong(n);
    expect(b.id).toBe(a.id);
    expect(b.flags).toEqual(a.flags);
    const lai = await duyet(id);
    expect(lai).toEqual({ ok: false, error: "Đơn đã được duyệt" });
    expect(await db.auditLog.count({ where: { entityId: id, action: "APPROVE_REQUEST" } })).toBe(1);
  });
});
