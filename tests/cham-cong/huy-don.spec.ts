// tests/cham-cong/huy-don.spec.ts — đợt 11–12 đơn từ: HUỶ ĐƠN ĐÃ DUYỆT (hoàn tác theo loại) + bộ kiểm
// XUNG ĐỘT lúc nộp / lúc duyệt. Đi trọn đường thật: nộp → duyệt → xin huỷ → duyệt / từ chối huỷ → đọc
// lưới ca, lượt quét, sổ quỹ, audit. Mỗi ca dùng NGƯỜI riêng (luật 18).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/huy-don] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-huy11";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const NOW_TEST = new Date("2026-09-09T03:00:00Z");
const SAU = new Date("2026-11-30T03:00:00Z");

d("[HUY-DB] huỷ đơn đã duyệt + xung đột", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let requests: typeof import("../../lib/cham-cong/requests");
  let recompute: typeof import("../../lib/cham-cong/recompute");
  let quy: typeof import("../../lib/cham-cong/nghi-bu-db");
  let huy: typeof import("../../lib/cham-cong/huy-don");
  let cs = "";
  let tplHC = "";
  let ltCoLuong = "";
  const actor = { id: "", name: "QL huy11" };
  const HC_SEG = [
    { start: "08:00", end: "11:30", kind: "WORK", orgUnitIds: [] },
    { start: "13:30", end: "17:30", kind: "WORK", orgUnitIds: [] },
  ];
  const base = {
    hours: null, className: null, classId: null, targetUserId: null, requesterNewTemplateId: null, targetNewTemplateId: null,
    leaveTypeId: null, requestedInAt: null, requestedOutAt: null, requestedIn2At: null, requestedOut2At: null,
    chosenCenterId: null, detail: null, reason: "test", startTime: null, endTime: null, toDate: null, leaveDurationType: null,
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
    if (cs) await db.attendancePeriod.deleteMany({ where: { centerId: cs } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  let soNguoi = 0;
  const nguoiMoi = async () =>
    (
      await db.user.create({
        data: { email: `nv${++soNguoi}@${TAG}.test`, name: `NV huy11 ${soNguoi}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    recompute = await import("../../lib/cham-cong/recompute");
    quy = await import("../../lib/cham-cong/nghi-bu-db");
    huy = await import("../../lib/cham-cong/huy-don");
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS huy11", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await cleanup();
    actor.id = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL huy11", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
    tplHC = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "HC", centerId: null }, select: { id: true } })).id;
    ltCoLuong = (
      await db.leaveType.upsert({
        where: { code: `${TAG}-NP` },
        update: { paidRatio: 1, isActive: true, noticeDays: null },
        create: { code: `${TAG}-NP`, name: "Nghỉ phép huy11", paidRatio: 1, countsAsWorked: false, isActive: true, displayOrder: 999 },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.leaveType.deleteMany({ where: { code: `${TAG}-NP` } });
    await db.$disconnect();
  });

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
  const xinHuy = (nv: string, id: string, lyDo = "đổi kế hoạch cá nhân") =>
    huy.yeuCauHuyDon({ requestId: id, requesterId: nv, requesterName: "NV", lyDo, now: NOW_TEST });
  const duyetHuy = (id: string, decision: "APPROVED" | "REJECTED" = "APPROVED", note: string | null = null) =>
    huy.quyetDinhHuy({ requestId: id, decision, note, actor, canWriteCenter: () => true, now: NOW_TEST });
  const trangThai = async (id: string) => (await db.workRequest.findUniqueOrThrow({ where: { id } })).status;
  const auditCua = async (id: string) =>
    (await db.auditLog.findMany({ where: { entityType: "WorkRequest", entityId: id }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((a) => a.action);
  const caDangDung = (nv: string, ngay: Date) => db.shiftAssignment.findFirst({ where: { userId: nv, workDate: ngay, status: "ACTIVE" } });

  it("[HUY-DB-01] nghỉ CẢ NGÀY: xin huỷ ⇒ vẫn hiệu lực; duyệt huỷ ⇒ ô ca CŨ (đúng id) sống lại, ô P huỷ; audit đủ 4 bước", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 12);
    const goc = await xepHC(nv, ngay);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: ngay, toDate: ngay, leaveTypeId: ltCoLuong, leaveDurationType: "FULL_DAY" });
    expect((await duyet(id)).ok).toBe(true);
    expect((await caDangDung(nv, ngay))?.templateCode).toBe("P");

    expect(await xinHuy(nv, id)).toMatchObject({ ok: true });
    expect(await trangThai(id)).toBe("CANCEL_REQUESTED");
    expect((await caDangDung(nv, ngay))?.templateCode).toBe("P"); // xin huỷ chưa phải đã huỷ

    expect((await duyetHuy(id)).ok).toBe(true);
    expect(await trangThai(id)).toBe("CANCELLED");
    const sau = await caDangDung(nv, ngay);
    expect(sau?.id).toBe(goc.id);
    expect(sau?.templateCode).toBe("HC");
    expect(await db.shiftAssignment.count({ where: { userId: nv, workDate: ngay, templateCode: "P", status: "CANCELLED" } })).toBe(1);
    expect(await auditCua(id)).toEqual(["SUBMIT_REQUEST", "APPROVE_REQUEST", "REQUEST_CANCELLATION", "APPROVE_CANCELLATION"]);
    // Duyệt huỷ lần hai ⇒ đã xử lý, không hoàn tác hai lần.
    expect((await duyetHuy(id)).ok).toBe(false);
  });

  it("[HUY-DB-02] lưới ca bị sửa SAU khi duyệt ⇒ duyệt huỷ bị TỪ CHỐI, giữ nguyên mọi thứ; từ chối huỷ ⇒ về ĐÃ DUYỆT", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 13);
    await xepHC(nv, ngay);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: ngay, toDate: ngay, leaveTypeId: ltCoLuong, leaveDurationType: "FULL_DAY" });
    expect((await duyet(id)).ok).toBe(true);
    // Quản lý xếp lại tay ngày đó.
    const p = await caDangDung(nv, ngay);
    await db.shiftAssignment.update({ where: { id: p!.id }, data: { status: "CANCELLED" } });
    const tay = await xepHC(nv, ngay);
    expect(await xinHuy(nv, id)).toMatchObject({ ok: true });
    const r = await duyetHuy(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/đã được sửa sau khi duyệt/);
    expect(await trangThai(id)).toBe("CANCEL_REQUESTED");
    expect((await caDangDung(nv, ngay))?.id).toBe(tay.id);

    expect((await duyetHuy(id, "REJECTED", "giữ đơn")).ok).toBe(true);
    expect(await trangThai(id)).toBe("APPROVED");
    expect((await auditCua(id)).slice(-1)).toEqual(["REJECT_CANCELLATION"]);
  });

  it("[HUY-DB-03] nghỉ bù: duyệt huỷ ⇒ hoàn ĐÚNG số phút đã trừ, một lần", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 14);
    await xepHC(nv, ngay);
    expect((await quy.dieuChinhQuy({ userId: nv, centerId: cs, phut: 240, lyDo: "cộng thử nghiệm", actor })).ok).toBe(true);
    const id = await nop({ requesterId: nv, kind: "COMP_LEAVE", fromDate: ngay, leaveDurationType: "HOURLY", startTime: "08:00", endTime: "10:00" });
    expect((await duyet(id)).ok).toBe(true);
    expect(await soDu(nv)).toBe(120);
    expect(await xinHuy(nv, id)).toMatchObject({ ok: true });
    expect((await duyetHuy(id)).ok).toBe(true);
    expect(await soDu(nv)).toBe(240);
    expect(await db.compTimeLedger.count({ where: { userId: nv, sourceType: "COMP_LEAVE_REFUND" } })).toBe(1);
  });

  it("[HUY-DB-04] OT đã cộng quỹ mà quỹ đã DÙNG ⇒ huỷ OT bị chặn; huỷ nghỉ bù trước thì huỷ OT được, quỹ về 0", async () => {
    const nv = await nguoiMoi();
    const ngayOt = utc(2026, 10, 15);
    const ngayBu = utc(2026, 10, 16);
    await xepHC(nv, ngayOt);
    await xepHC(nv, ngayBu);
    await quet(nv, ngayOt, "07:55", "CHECK_IN");
    await quet(nv, ngayOt, "11:31", "CHECK_OUT");
    await quet(nv, ngayOt, "13:25", "CHECK_IN");
    await quet(nv, ngayOt, "20:30", "CHECK_OUT");
    const cu = await db.systemSetting.findUnique({ where: { key: "shift.otQuyDoi" } });
    await db.systemSetting.upsert({ where: { key: "shift.otQuyDoi" }, create: { key: "shift.otQuyDoi", valueJson: "NGHI_BU" }, update: { valueJson: "NGHI_BU" } });
    let idOt: string;
    try {
      idOt = await nop({ requesterId: nv, kind: "OT", fromDate: ngayOt, startTime: "18:00", endTime: "21:00" });
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

    expect(await xinHuy(nv, idOt)).toMatchObject({ ok: true });
    const chan = await duyetHuy(idOt);
    expect(chan.ok).toBe(false);
    if (!chan.ok) expect(chan.error).toMatch(/quỹ âm/);
    expect(await trangThai(idOt)).toBe("CANCEL_REQUESTED");

    expect(await xinHuy(nv, idBu)).toMatchObject({ ok: true });
    expect((await duyetHuy(idBu)).ok).toBe(true);
    expect(await soDu(nv)).toBe(150);
    expect((await duyetHuy(idOt)).ok).toBe(true);
    const r = await dong(nv, ngayOt);
    expect(r.otPayableMinutes).toBe(0);
    expect(await soDu(nv)).toBe(0);
  });

  it("[HUY-DB-05] chỉnh công GHI ĐÈ: duyệt huỷ ⇒ mốc tay thôi tính (không xoá), lượt quét cũ về ĐÚNG trạng thái cũ", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 19);
    await xepHC(nv, ngay);
    for (const [g, h] of [["07:55", "CHECK_IN"], ["11:31", "CHECK_OUT"], ["13:25", "CHECK_IN"], ["17:35", "CHECK_OUT"]] as const) await quet(nv, ngay, g, h);
    const goc = await db.staffTimeLog.findMany({ where: { userId: nv, workDate: ngay }, select: { id: true, reviewStatus: true, reviewNote: true } });
    const id = await nop({ requesterId: nv, kind: "TIMESHEET_FIX", fromDate: ngay, requestedInAt: "08:00", requestedOutAt: "11:30", requestedIn2At: "13:30", requestedOut2At: "17:30" });
    expect((await duyet(id)).ok).toBe(true);
    expect(await db.staffTimeLog.count({ where: { id: { in: goc.map((g) => g.id) }, reviewStatus: "DISMISSED" } })).toBe(4);

    expect(await xinHuy(nv, id)).toMatchObject({ ok: true });
    expect((await duyetHuy(id)).ok).toBe(true);
    const sau = await db.staffTimeLog.findMany({ where: { id: { in: goc.map((g) => g.id) } }, select: { id: true, reviewStatus: true, reviewNote: true } });
    const theoId = <T extends { id: string }>(x: T[]) => [...x].sort((a, b) => a.id.localeCompare(b.id));
    expect(theoId(sau)).toEqual(theoId(goc));
    const tay = await db.staffTimeLog.findMany({ where: { adjustRequestId: id } });
    expect(tay).toHaveLength(4); // không xoá cứng
    expect(tay.every((l) => l.reviewStatus === "DISMISSED")).toBe(true);
  });

  it("[HUY-DB-06] từ chối xin huỷ: đơn còn chờ ⇒ Thu hồi; đơn của người khác; lý do ngắn; đơn duyệt theo luật CŨ", async () => {
    const nv = await nguoiMoi();
    const khac = await nguoiMoi();
    const ngay = utc(2026, 10, 20);
    const idCho = await nop({ requesterId: nv, kind: "REMOTE", fromDate: ngay, toDate: ngay });
    expect(await xinHuy(nv, idCho)).toEqual({ ok: false, error: "Đơn còn chờ duyệt — dùng nút Thu hồi" });
    expect((await duyet(idCho)).ok).toBe(true);
    expect(await xinHuy(khac, idCho)).toEqual({ ok: false, error: "Không tìm thấy đơn" });
    expect((await xinHuy(nv, idCho, "ngắn")).ok).toBe(false);
    // Đơn duyệt TRƯỚC khi có dấu effectVersion: không có ảnh chụp ⇒ không nhận yêu cầu huỷ.
    const ngay2 = utc(2026, 10, 21);
    const idCu = await nop({ requesterId: nv, kind: "REMOTE", fromDate: ngay2, toDate: ngay2 });
    await db.workRequest.update({ where: { id: idCu }, data: { status: "APPROVED", reviewedAt: NOW_TEST } });
    const r = await xinHuy(nv, idCu);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/trước khi có chức năng huỷ/);
    expect(await trangThai(idCu)).toBe("APPROVED");
  });

  it("[HUY-DB-07] kỳ đã CHỐT ⇒ không nhận yêu cầu huỷ (cùng cổng với duyệt đơn)", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 11, 3);
    const id = await nop({ requesterId: nv, kind: "REMOTE", fromDate: ngay, toDate: ngay });
    expect((await duyet(id)).ok).toBe(true);
    await db.attendancePeriod.create({ data: { centerId: cs, periodKey: "2026-11", status: "LOCKED" } });
    try {
      const r = await xinHuy(nv, id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/2026-11/);
    } finally {
      await db.attendancePeriod.deleteMany({ where: { centerId: cs, periodKey: "2026-11" } });
    }
  });

  it("[XD-DB-01] nộp: trùng đơn ĐÃ DUYỆT bị chặn kèm lý do; ĐỐI CHỨNG làm từ xa + tăng ca vẫn nộp được", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 22);
    await xepHC(nv, ngay);
    const idNghi = await nop({ requesterId: nv, kind: "LEAVE", fromDate: ngay, toDate: ngay, leaveTypeId: ltCoLuong, leaveDurationType: "FULL_DAY" });
    expect((await duyet(idNghi)).ok).toBe(true);
    const ot = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: nv, kind: "OT", fromDate: ngay, startTime: "18:00", endTime: "20:00" });
    expect(ot.ok).toBe(false);
    if (!ot.ok) expect(ot.error).toMatch(/^Trùng với đơn Nghỉ phép .*nghỉ cả ngày/);

    const nv2 = await nguoiMoi();
    const ngay2 = utc(2026, 10, 23);
    await nop({ requesterId: nv2, kind: "REMOTE", fromDate: ngay2, toDate: ngay2 });
    await nop({ requesterId: nv2, kind: "OT", fromDate: ngay2, startTime: "18:00", endTime: "20:00" });
  });

  it("[XD-DB-02] duyệt: đơn cũ đang chờ trùng với đơn VỪA duyệt ⇒ duyệt bị chặn, đơn giữ chờ", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 26);
    await xepHC(nv, ngay);
    const id1 = await nop({ requesterId: nv, kind: "OT", fromDate: ngay, startTime: "18:00", endTime: "20:00" });
    // Đơn thứ hai trùng khung — giả lập dữ liệu nộp TRƯỚC khi có bộ kiểm xung đột (ghi thẳng DB).
    const don2 = await db.workRequest.create({
      data: { requesterId: nv, centerId: cs, kind: "OT", fromDate: ngay, toDate: ngay, startTime: "19:00", endTime: "21:00", reason: "cũ" },
    });
    expect((await duyet(id1)).ok).toBe(true);
    const r = await duyet(don2.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Trùng với đơn Tăng ca/);
    expect(await trangThai(don2.id)).toBe("PENDING");
  });

  it("[XD-DB-03] hai quản lý duyệt CÙNG LÚC hai đơn trùng của cùng một người ⇒ tối đa MỘT đơn thành ĐÃ DUYỆT", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 27);
    await xepHC(nv, ngay);
    // Hai đơn nghỉ cả ngày cùng ngày — ghi thẳng DB (giả lập hai đơn lọt cổng nộp, vd nộp từ hai tab).
    const mk = () =>
      db.workRequest.create({
        data: { requesterId: nv, centerId: cs, kind: "REMOTE", fromDate: ngay, toDate: ngay, reason: "đua" },
        select: { id: true },
      });
    const [a, b] = await Promise.all([mk(), mk()]);
    const kq = await Promise.all([duyet(a.id), duyet(b.id)]);
    expect(kq.filter((r) => r.ok)).toHaveLength(1);
    const st = await db.workRequest.findMany({ where: { id: { in: [a.id, b.id] } }, select: { status: true } });
    expect(st.map((s) => s.status).sort()).toEqual(["APPROVED", "PENDING"]);
  });

  it("[XD-DB-03b] lượt duyệt XẾP HÀNG sau khoá theo người nộp (tất định — ca đua ở trên có thể tình cờ chạy nối tiếp)", async () => {
    const nv = await nguoiMoi();
    const ngay = utc(2026, 10, 28);
    await xepHC(nv, ngay);
    const don = await db.workRequest.create({
      data: { requesterId: nv, centerId: cs, kind: "REMOTE", fromDate: ngay, toDate: ngay, reason: "khoá" },
      select: { id: true },
    });
    // Một kết nối khác giữ ĐÚNG khoá mà lượt duyệt phải lấy — mô phỏng lượt duyệt đơn trùng đang chạy dở.
    let tha!: () => void;
    const giu = new Promise<void>((r) => (tha = r));
    let daGiu!: () => void;
    const giuXong = new Promise<void>((r) => (daGiu = r));
    const ngoai = db.$transaction(
      async (t) => {
        await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`don-tu:${nv}`}))`;
        daGiu();
        await giu;
      },
      { timeout: 20_000 },
    );
    await giuXong;
    const luot = duyet(don.id);
    await new Promise((r) => setTimeout(r, 800));
    expect(await trangThai(don.id)).toBe("PENDING"); // còn đứng chờ khoá — chưa commit được
    tha();
    await ngoai;
    expect((await luot).ok).toBe(true);
    expect(await trangThai(don.id)).toBe("APPROVED");
  });
});
