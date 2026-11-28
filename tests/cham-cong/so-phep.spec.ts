// tests/cham-cong/so-phep.spec.ts — P2.1A SỔ PHÉP NĂM trên Postgres thật (11/10/2026).
// Đi đường thật: nộp → duyệt (decideRequest) → xin huỷ → duyệt huỷ → đọc LeaveLedger. Mỗi ca một
// NGƯỜI riêng (số dư không mượn nhau) và NGÀY riêng (luật 18). Đồng hồ đóng băng (luật 19).
//
// Công tắc + mã loại được bật TRONG bộ này rồi trả lại nguyên trạng — mã loại là mã RIÊNG của bộ
// test, nên đơn NGHI_PHEP thật của bộ khác không bao giờ bị trừ quỹ dù chạy chung DB.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/so-phep] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-sp21";
const MA = `${TAG}-NP`;
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const NOW_TEST = new Date("2026-09-09T03:00:00Z");
const MOT_NGAY = 480;
const KHOA_CAI = ["shift.soPhepBat", "shift.soPhepMaLoai", "shift.soPhepPhutMotNgay", "shift.soPhepChoAm"] as const;

d("[SP-DB] sổ phép năm — trừ khi duyệt, hoàn khi huỷ, không âm, không trùng", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let requests: typeof import("../../lib/cham-cong/requests");
  let huy: typeof import("../../lib/cham-cong/huy-don");
  let sp: typeof import("../../lib/cham-cong/so-phep");
  let spdb: typeof import("../../lib/cham-cong/so-phep-db");
  let cs = "";
  let tplHC = "";
  let tplX = "";
  let ltPhep = "";
  let ltKhac = "";
  const actor = { id: "", name: "QL sp21" };
  const caiCu = new Map<string, unknown>();
  const HC_SEG = [
    { start: "08:00", end: "11:30", kind: "WORK", orgUnitIds: [] },
    { start: "13:30", end: "17:30", kind: "WORK", orgUnitIds: [] },
  ];
  const base = {
    hours: null, className: null, classId: null, targetUserId: null, requesterNewTemplateId: null, targetNewTemplateId: null,
    leaveTypeId: null, requestedInAt: null, requestedOutAt: null, requestedIn2At: null, requestedOut2At: null,
    chosenCenterId: null, detail: null, reason: "test", startTime: null, endTime: null, toDate: null,
  };

  const datCai = async (key: string, v: unknown) =>
    db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v as never }, update: { valueJson: v as never } });

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const reqs = await db.workRequest.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: [...reqs.map((r) => r.id), ...ids] } } });
    await db.leaveLedger.deleteMany({ where: { userId: { in: ids } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  let soNguoi = 0;
  const nguoiMoi = async () =>
    (
      await db.user.create({
        data: { email: `nv${++soNguoi}@${TAG}.test`, name: `NV sp21 ${soNguoi}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    huy = await import("../../lib/cham-cong/huy-don");
    sp = await import("../../lib/cham-cong/so-phep");
    spdb = await import("../../lib/cham-cong/so-phep-db");
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS sp21", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await cleanup();
    actor.id = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL sp21", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
    tplHC = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "HC", centerId: null }, select: { id: true } })).id;
    tplX = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "X", centerId: null }, select: { id: true } })).id;
    const lt = (code: string, name: string) =>
      db.leaveType.upsert({
        where: { code },
        update: { paidRatio: 1, isActive: true, noticeDays: null },
        create: { code, name, paidRatio: 1, countsAsWorked: false, isActive: true, displayOrder: 999 },
        select: { id: true },
      });
    ltPhep = (await lt(MA, "Phép năm sp21")).id;
    ltKhac = (await lt(`${TAG}-KH`, "Kết hôn sp21")).id;
    for (const k of KHOA_CAI) caiCu.set(k, (await db.systemSetting.findUnique({ where: { key: k } }))?.valueJson);
    await datCai("shift.soPhepBat", true);
    await datCai("shift.soPhepMaLoai", MA);
    await datCai("shift.soPhepPhutMotNgay", MOT_NGAY);
    await datCai("shift.soPhepChoAm", false);
  });

  afterAll(async () => {
    for (const k of KHOA_CAI) {
      const cu = caiCu.get(k);
      if (cu === undefined) await db.systemSetting.deleteMany({ where: { key: k } });
      else await datCai(k, cu);
    }
    await cleanup();
    await db.leaveType.deleteMany({ where: { code: { in: [MA, `${TAG}-KH`] } } });
    await db.$disconnect();
  });

  const xep = (nv: string, ngay: Date, loai: "HC" | "X" = "HC") =>
    db.shiftAssignment.create({
      data:
        loai === "HC"
          ? { userId: nv, centerId: cs, workDate: ngay, templateId: tplHC, templateCode: "HC", segments: HC_SEG, source: "IMPORT", soCapQuetKyVong: 2 }
          : { userId: nv, centerId: cs, workDate: ngay, templateId: tplX, templateCode: "X", segments: [], source: "IMPORT" },
    });
  const nop = async (input: Record<string, unknown>) => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, ...input } as Parameters<typeof requests.submitAttendanceRequest>[0]);
    if (!s.ok) throw new Error(s.error);
    return s.id;
  };
  const duyet = (id: string) =>
    requests.decideRequest({ now: NOW_TEST, requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
  const xinHuy = (nv: string, id: string) => huy.yeuCauHuyDon({ requestId: id, requesterId: nv, requesterName: "NV", lyDo: "đổi kế hoạch cá nhân", now: NOW_TEST });
  const duyetHuy = (id: string) => huy.quyetDinhHuy({ requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true, now: NOW_TEST });
  const soDu = (nv: string, year = 2026, leaveTypeId = ltPhep) => sp.soDuPhep(db, { userId: nv, leaveTypeId, year });
  const capQuy = (nv: string, phut: number, year = 2026) =>
    db.$transaction((tx) =>
      sp.ghiButToanPhep(tx, {
        userId: nv, centerId: cs, orgUnitId: null, leaveTypeId: ltPhep, year, minutes: phut, transactionType: "OPENING",
        sourceType: null, sourceId: null, khoa: `OPENING:${nv}:${year}`, effectiveDate: utc(year, 1, 1), note: "test", createdById: actor.id, choAm: false,
      }),
    );
  const trangThai = async (id: string) => (await db.workRequest.findUniqueOrThrow({ where: { id } })).status;

  it("[SP-01] cấp 8 ngày, nghỉ CẢ NGÀY 2 ngày làm việc ⇒ còn 6; huỷ ⇒ về lại 8; chuỗi số dư liền mạch", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, 8 * MOT_NGAY);
    const [n1, n2] = [utc(2026, 10, 14), utc(2026, 10, 15)];
    await xep(nv, n1);
    await xep(nv, n2);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n1, toDate: n2, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    expect((await duyet(id)).ok).toBe(true);
    expect(await soDu(nv)).toBe(6 * MOT_NGAY);

    expect(await xinHuy(nv, id)).toMatchObject({ ok: true });
    expect((await duyetHuy(id)).ok).toBe(true);
    expect(await trangThai(id)).toBe("CANCELLED");
    expect(await soDu(nv)).toBe(8 * MOT_NGAY);

    const rows = await db.leaveLedger.findMany({ where: { userId: nv }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.transactionType, r.minutes, r.balanceBefore, r.balanceAfter])).toEqual([
      ["OPENING", 3840, 0, 3840],
      ["LEAVE_USED", -960, 3840, 2880],
      ["LEAVE_REFUND", 960, 2880, 3840],
    ]);
  });

  it("[SP-02] thử lại KHÔNG trừ / hoàn hai lần (khoá chống trùng)", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, 3 * MOT_NGAY);
    const n = utc(2026, 10, 16);
    await xep(nv, n);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n, toDate: n, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    expect((await duyet(id)).ok).toBe(true);
    const cauHinh = await sp.docCauHinhSoPhep();
    // Gọi lại đúng bước trừ của lượt duyệt — như một lần thử lại sau lỗi mạng.
    await db.$transaction((tx) =>
      sp.truPhepKhiDuyet(tx, {
        cauHinh, leaveType: { id: ltPhep, code: MA }, don: { id, requesterId: nv, fromDate: n }, centerId: cs, orgUnitId: null,
        actorId: actor.id, phan: { kieu: "CA_NGAY", ngay: [{ ngay: n, laNgayLamViec: true }] }, loiNem: (m) => new Error(m),
      }),
    );
    expect(await soDu(nv)).toBe(2 * MOT_NGAY);
    expect(await xinHuy(nv, id)).toMatchObject({ ok: true });
    expect((await duyetHuy(id)).ok).toBe(true);
    await db.$transaction((tx) => sp.hoanPhepKhiHuy(tx, { donId: id, actorId: actor.id, ngayHuy: NOW_TEST }));
    expect(await soDu(nv)).toBe(3 * MOT_NGAY);
    expect(await db.leaveLedger.count({ where: { sourceId: id } })).toBe(2);
  });

  it("[SP-03] nghỉ 3 ngày lịch có 1 ngày nghỉ tuần (ô X) ⇒ chỉ trừ 2 ngày làm việc", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, 5 * MOT_NGAY);
    const [a, b, c] = [utc(2026, 10, 18), utc(2026, 10, 19), utc(2026, 10, 20)];
    await xep(nv, a);
    await xep(nv, b, "X");
    await xep(nv, c);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: a, toDate: c, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    expect((await duyet(id)).ok).toBe(true);
    expect(await soDu(nv)).toBe(3 * MOT_NGAY);
  });

  it("[SP-04] nghỉ NỬA SÁNG ca hành chính ⇒ trừ đúng 210 phút (08:00–11:30), không phải nửa ngày quy ước", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, MOT_NGAY);
    const n = utc(2026, 10, 21);
    await xep(nv, n);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n, leaveTypeId: ltPhep, leaveDurationType: "HALF_DAY_AM" });
    expect((await duyet(id)).ok).toBe(true);
    expect(await soDu(nv)).toBe(MOT_NGAY - 210);
  });

  it("[SP-05] quỹ KHÔNG đủ và không cho ứng ⇒ không duyệt được: đơn PENDING, ô ca nguyên, sổ không đổi", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, MOT_NGAY);
    const [n1, n2] = [utc(2026, 10, 22), utc(2026, 10, 23)];
    const o1 = await xep(nv, n1);
    await xep(nv, n2);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n1, toDate: n2, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    const r = await duyet(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/không đủ/);
    expect(await trangThai(id)).toBe("PENDING");
    const o = await db.shiftAssignment.findFirst({ where: { userId: nv, workDate: n1, status: "ACTIVE" } });
    expect(o?.id).toBe(o1.id);
    expect(await soDu(nv)).toBe(MOT_NGAY);
  });

  it("[SP-06] HAI đơn duyệt ĐỒNG THỜI, quỹ chỉ đủ một ⇒ đúng một đơn qua, quỹ không âm", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, MOT_NGAY);
    const [n1, n2] = [utc(2026, 10, 26), utc(2026, 10, 27)];
    await xep(nv, n1);
    await xep(nv, n2);
    const id1 = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n1, toDate: n1, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    const id2 = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n2, toDate: n2, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    const kq = await Promise.all([duyet(id1), duyet(id2)]);
    expect(kq.filter((x) => x.ok)).toHaveLength(1);
    expect(await soDu(nv)).toBe(0);
    expect([await trangThai(id1), await trangThai(id2)].sort()).toEqual(["APPROVED", "PENDING"]);
  });

  it("[SP-06b] ghi sổ GIỮ khoá theo người: khi giao dịch khác đang giữ khoá sổ của người đó, bút toán phải CHỜ", async () => {
    // Đường điều chỉnh tay không đi qua decideRequest (khoá `don-tu:`), nên khoá trong `ghiButToanPhep` là
    // lớp chặn duy nhất cho nó. Đua thật giữa hai lượt ghi có khung chỉ vài ms — đo 11/10: bỏ khoá mà
    // hai lượt vẫn tình cờ tuần tự, ca đua "đúng một qua" xanh oan. Nên đo TẤT ĐỊNH: A giữ khoá 400ms,
    // B phải xong SAU lúc A nhả.
    const nv = await nguoiMoi();
    await capQuy(nv, MOT_NGAY);
    let daGiu!: () => void;
    const aDaGiu = new Promise<void>((r) => (daGiu = r));
    let aNhaLuc = 0;
    const giaoDichA = db.$transaction(
      async (tx) => {
        await sp.khoaSoPhep(tx, nv);
        daGiu();
        await new Promise((r) => setTimeout(r, 400));
        aNhaLuc = performance.now();
      },
      { timeout: 20_000 },
    );
    await aDaGiu;
    const giaoDichB = db.$transaction(
      async (tx) => {
        const r = await sp.ghiButToanPhep(tx, {
          userId: nv, centerId: cs, orgUnitId: null, leaveTypeId: ltPhep, year: 2026, minutes: -60, transactionType: "MANUAL_ADJUSTMENT",
          sourceType: null, sourceId: null, khoa: null, effectiveDate: utc(2026, 10, 1), note: "chờ khoá", createdById: actor.id, choAm: false,
        });
        return { r, xongLuc: performance.now() };
      },
      { timeout: 20_000 },
    );
    const [, b] = await Promise.all([giaoDichA, giaoDichB]);
    expect(b.r.ok).toBe(true);
    expect(aNhaLuc).toBeGreaterThan(0);
    expect(b.xongLuc).toBeGreaterThan(aNhaLuc);
  });

  it("[SP-07] loại nghỉ KHÁC mã trừ quỹ ⇒ không đụng sổ (đối chứng dương ở SP-01)", async () => {
    const nv = await nguoiMoi();
    const n = utc(2026, 10, 28);
    await xep(nv, n);
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n, toDate: n, leaveTypeId: ltKhac, leaveDurationType: "FULL_DAY" });
    expect((await duyet(id)).ok).toBe(true);
    expect(await db.leaveLedger.count({ where: { userId: nv } })).toBe(0);
  });

  it("[SP-08] ngày CHƯA xếp ca không bị trừ, và kết quả duyệt nói ra số ngày đó", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, 5 * MOT_NGAY);
    const [a, b] = [utc(2026, 11, 2), utc(2026, 11, 3)];
    await xep(nv, a); // b không xếp ca
    const id = await nop({ requesterId: nv, kind: "LEAVE", fromDate: a, toDate: b, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    const r = await duyet(id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toMatch(/1 ngày chưa xếp ca KHÔNG trừ/);
    expect(await soDu(nv)).toBe(4 * MOT_NGAY);
  });

  it("[SP-09] CÔNG TẮC TẮT ⇒ duyệt như cũ, sổ không đổi; bật lại sau đó thì huỷ vẫn hoàn đúng phần đã trừ", async () => {
    const nv = await nguoiMoi();
    await capQuy(nv, 2 * MOT_NGAY);
    const [n1, n2] = [utc(2026, 11, 4), utc(2026, 11, 5)];
    await xep(nv, n1);
    await xep(nv, n2);
    const idTru = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n1, toDate: n1, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
    expect((await duyet(idTru)).ok).toBe(true); // bật ⇒ trừ 1 ngày
    await datCai("shift.soPhepBat", false);
    try {
      const idKhong = await nop({ requesterId: nv, kind: "LEAVE", fromDate: n2, toDate: n2, leaveTypeId: ltPhep, leaveDurationType: "FULL_DAY" });
      expect((await duyet(idKhong)).ok).toBe(true);
      expect(await soDu(nv)).toBe(MOT_NGAY); // đơn thứ hai KHÔNG trừ
      // Huỷ đơn đã trừ lúc công tắc còn bật — vẫn phải hoàn, kể cả khi công tắc đang tắt.
      expect(await xinHuy(nv, idTru)).toMatchObject({ ok: true });
      expect((await duyetHuy(idTru)).ok).toBe(true);
      expect(await soDu(nv)).toBe(2 * MOT_NGAY);
    } finally {
      await datCai("shift.soPhepBat", true);
    }
  });

  it("[SP-10] bút toán tay: lý do bắt buộc, cấp đầu kỳ không âm, trừ quá quỹ bị chặn KHÔNG ghi gì, hợp lệ ⇒ có audit", async () => {
    const nv = await nguoiMoi();
    const goc = {
      userId: nv, centerId: cs, leaveTypeId: ltPhep, year: 2026, choAm: false, ngayHieuLuc: utc(2026, 1, 1),
      actor: { id: actor.id, name: actor.name },
    };
    expect(await spdb.dieuChinhSoPhep({ ...goc, loai: "OPENING", phut: 960, lyDo: "abc" })).toMatchObject({ ok: false, error: expect.stringMatching(/lý do/) });
    expect(await spdb.dieuChinhSoPhep({ ...goc, loai: "OPENING", phut: -960, lyDo: "cấp quỹ năm 2026" })).toMatchObject({ ok: false });
    expect(await spdb.dieuChinhSoPhep({ ...goc, loai: "OPENING", phut: 960, lyDo: "cấp quỹ năm 2026" })).toEqual({ ok: true, soDuSau: 960 });
    const quaQuy = await spdb.dieuChinhSoPhep({ ...goc, loai: "MANUAL_ADJUSTMENT", phut: -1440, lyDo: "trừ nhầm quá quỹ" });
    expect(quaQuy).toMatchObject({ ok: false, error: expect.stringMatching(/không đủ/) });
    expect(await soDu(nv)).toBe(960);
    expect(await db.leaveLedger.count({ where: { userId: nv } })).toBe(1);
    const audit = await db.auditLog.findMany({ where: { entityType: "LeaveLedger", entityId: nv }, select: { action: true, reason: true } });
    expect(audit).toEqual([{ action: "OPEN_LEAVE_BALANCE", reason: "cấp quỹ năm 2026" }]);
  });
});
