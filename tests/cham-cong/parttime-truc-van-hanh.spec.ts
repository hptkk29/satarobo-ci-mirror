// [P5-ODB-*] — trực vận hành tường minh (P5b) trên Postgres THẬT. Thuần: lib/parttime/truc-van-hanh.test.ts.
// Chạy: TEST_DATABASE_URL=postgresql://…/satarobo_test… pnpm test:cham-cong-db
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-truc-van-hanh] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ dem: 0 }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
// Cổng RBAC v2 của Parttime giả BẬT (prod/test chạy v2); `checkPermission` vẫn chạy theo cờ thật của môi trường test.
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
          ctl.dem++;
          return query(args);
        },
      },
    },
  });
  return { ...goc, db: dem };
});

const TAG = "p5ops";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[P5-ODB] trực vận hành tường minh — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let cs1 = "";
  let gv = "";
  let gv2 = "";
  let ql = "";
  let khoa = "";
  let mau = "";
  const actor = { id: null as string | null, name: "QLCS p5b" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({
      where: { code: "LEGACY" },
      update: {},
      create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ (trước SR.QD.238)", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } },
    });
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const dutyIds = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    const wus = await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...dutyIds, ...wus.map((w) => w.id)] } } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER "WorkConfirmation_bat_bien"`,
      db.workConfirmation.deleteMany({ where: { assignmentId: { in: [...pcIds, ...dutyIds] } } }),
      db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER "WorkConfirmation_bat_bien"`,
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" DISABLE TRIGGER "OperationsDutyAcceptance_bat_bien"`,
      db.operationsDutyAcceptance.deleteMany({ where: { dutyId: { in: dutyIds } } }),
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" ENABLE TRIGGER "OperationsDutyAcceptance_bat_bien"`,
    ]);
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    svc = await import("../../lib/parttime/phan-cong-db");
    wu = await import("../../lib/parttime/workunit-db");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    cs1 = (await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS p5b", address: "x", code: `${TAG}-cs1` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs1`, name: "ĐV p5b", path: `/${TAG}-cs1/`, depth: 0, centerId: cs1 } });
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV p5b")).id;
    gv2 = (await mk("gv2", "GV2 p5b")).id;
    ql = (await mk("ql", "QL p5b")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 p5b", slug: `${TAG}-k` }, select: { id: true } })).id;
    mau = (
      await db.shiftTemplate.upsert({
        where: { code_effectiveFrom: { code: `${TAG}-T`, effectiveFrom: new Date("2000-01-01T00:00:00Z") } },
        update: {},
        create: { code: `${TAG}-T`, name: "Ca tối p5b", segments: [{ start: "17:15", end: "21:00", kind: "WORK" }] },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.shiftTemplate.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  const NGUOI = () => ({ id: ql, name: "QL p5b" });
  /** Một tiết lớp 90' đã chạy, đã nhận, đã chốt (thực dạy = gv) và QLCS ĐÃ XÁC NHẬN thực hiện (đơn vị dạy hiệu lực). */
  const tietDaXacNhan = async (userId: string, ymd: string, gio: string, ket: string, p: { quyet?: "XAC_NHAN" | "TU_CHOI" | "CHUA"; vai?: "MAIN" | "TA" } = {}) => {
    soLop++;
    const laTa = p.vai === "TA";
    const lop = await db.class.create({
      data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: cs1, teacherId: laTa ? gv2 : userId, assistantId: laTa ? userId : null, startTime: gio, endTime: ket },
      select: { id: true },
    });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: vn(ymd, gio) }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id, status: "WAITING_ACCEPTANCE" } })) {
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      if (!r.ok) throw new Error(r.loi);
    }
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: laTa ? gv2 : userId } });
    const q = p.quyet ?? "XAC_NHAN";
    if (q !== "CHUA") {
      const ds = await wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now: vn(ymd, "23:30") });
      const r = ds.dong.find((x) => x.bc.sourceId === s.id && x.bc.userId === userId)!;
      const kq = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: q === "XAC_NHAN" ? "CONFIRMED" : "REJECTED", lyDo: q === "TU_CHOI" ? "QLCS từ chối (test)" : null, hangLoat: false, actor: NGUOI(), now: vn(ymd, "23:30") });
      if (!kq.ok) throw new Error(kq.loi);
    }
    return s.id;
  };
  const quet = (userId: string, ymd: string, direction: "CHECK_IN" | "CHECK_OUT", hhmm: string) =>
    db.staffTimeLog.create({ data: { userId, centerId: cs1, direction, loggedAt: vn(ymd, hhmm), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED", reviewStatus: "PENDING" } });
  const giao = async (userId: string, ymd: string, shiftCode = "T", nhan = true) => {
    const r = await db.$transaction((tx) => truc.giaoTruc(tx, { userId, centerId: cs1, ngay: ymd, shiftCode, note: null, actor: NGUOI() }));
    if (!r.ok) throw new Error(r.loi);
    if (nhan) {
      const n = await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: r.id, nguoiBam: { id: userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ymd, "07:00") }));
      if (!n.ok) throw new Error(n.loi);
    }
    return r.id;
  };
  const doc = (ymd: string) => truc.docTrucCoSo({ centerId: cs1, tu: ymd, den: ymd, now: vn(ymd, "23:30") });
  const xacNhan = async (dutyId: string, ymd: string, p: { nguoi?: string; quyetDinh?: "CONFIRMED" | "REJECTED"; lyDo?: string | null } = {}) => {
    const r = (await doc(ymd)).find((x) => x.dutyId === dutyId)!;
    return truc.xacNhanTruc({ dutyId, phienBanDaXem: r.phienBan, dauVanDaXem: r.dauVan, quyetDinh: p.quyetDinh ?? "CONFIRMED", lyDo: p.lyDo ?? null, hangLoat: false, actor: { id: p.nguoi ?? ql, name: "QL" }, now: vn(ymd, "23:45") });
  };
  const opsCua = (userId: string) => db.workUnit.findMany({ where: { userId, workUnitType: "OPERATIONS_DUTY", status: { not: "VOIDED" } } });

  it("[P5-ODB-01][P5-ODB-08] DẠY MỘT TIẾT, KHÔNG TRỰC (D-N1): ô ca T + có mặt 17:15–21:00 ⇒ 1 tiết dạy, 0 trực — không dòng trực, không đơn vị trực", async () => {
    const ngay = "2026-11-02";
    await db.shiftAssignment.create({ data: { userId: gv, centerId: cs1, workDate: new Date(`${ngay}T00:00:00Z`), templateId: mau, templateCode: `${TAG}-T`, segments: [{ start: "17:15", end: "21:00", kind: "WORK" }] } });
    await quet(gv, ngay, "CHECK_IN", "17:10");
    await quet(gv, ngay, "CHECK_OUT", "21:05");
    await tietDaXacNhan(gv, ngay, "18:00", "19:30");
    expect(await doc(ngay)).toEqual([]);
    expect(await db.workUnit.count({ where: { userId: gv, workDate: new Date(`${ngay}T00:00:00Z`), status: "CONFIRMED" } })).toBe(1);
    expect(await opsCua(gv)).toEqual([]);
  });

  it("[P5-ODB-02] trực + 0 tiết ⇒ 1,0 ca · đơn vị OPERATIONS_DUTY quantity 1 · 90.000đ", async () => {
    const ngay = "2026-11-03";
    const id = await giao(gv, ngay);
    await quet(gv, ngay, "CHECK_IN", "17:10");
    await quet(gv, ngay, "CHECK_OUT", "21:05");
    expect((await doc(ngay))[0].danhGia).toMatchObject({ lop: "TU_DONG", donViTra: "1", phutCoMatTrongCa: 225 });
    expect(await xacNhan(id, ngay)).toMatchObject({ ok: true });
    const [w] = await opsCua(gv);
    expect([w.quantity.toString(), w.rateSnapshot, w.role, w.standardMinutes, w.assignmentId]).toEqual(["1", 90000, "OPERATIONS_SUPPORT", 0, id]);
  });

  it("[P5-ODB-03][P5-ODB-04] trực + 1 tiết (MAIN / TA) đã xác nhận ⇒ 0,5 ca", async () => {
    const ngay = "2026-11-04";
    const id = await giao(gv, ngay);
    await quet(gv, ngay, "CHECK_IN", "17:10");
    await quet(gv, ngay, "CHECK_OUT", "21:05");
    await tietDaXacNhan(gv, ngay, "18:00", "19:30");
    expect((await doc(ngay))[0].danhGia).toMatchObject({ donViTra: "0.5", soTietTrongCa: 1 });
    expect(await xacNhan(id, ngay)).toMatchObject({ ok: true });
    expect((await db.workUnit.findMany({ where: { assignmentId: id } })).map((w) => w.quantity.toString())).toEqual(["0.5"]);
    const ngayTa = "2026-11-05";
    const idTa = await giao(gv, ngayTa);
    await quet(gv, ngayTa, "CHECK_IN", "17:10");
    await quet(gv, ngayTa, "CHECK_OUT", "21:05");
    await tietDaXacNhan(gv, ngayTa, "18:00", "19:30", { vai: "TA" });
    expect((await doc(ngayTa))[0].danhGia).toMatchObject({ donViTra: "0.5", soTietTrongCa: 1 });
    expect(idTa).toBeTruthy();
  });

  it("[P5-ODB-05][P5-ODB-06] trực + 2 tiết (MAIN+MAIN, MAIN+TA) ⇒ 0 — ghi quyết định, KHÔNG sinh đơn vị trực", async () => {
    const ngay = "2026-11-06";
    const id = await giao(gv, ngay);
    await quet(gv, ngay, "CHECK_IN", "17:00"); // tiết 17:15 phải có mặt từ 17:05
    await quet(gv, ngay, "CHECK_OUT", "21:05");
    await tietDaXacNhan(gv, ngay, "17:15", "18:45");
    await tietDaXacNhan(gv, ngay, "19:00", "20:30", { vai: "TA" });
    expect((await doc(ngay))[0].danhGia).toMatchObject({ lop: "TU_DONG", donViTra: "0", soTietTrongCa: 2 });
    expect(await xacNhan(id, ngay)).toMatchObject({ ok: true, workUnitId: null });
    expect(await db.workUnit.count({ where: { assignmentId: id } })).toBe(0);
    expect(await db.workConfirmation.count({ where: { assignmentId: id, decision: "CONFIRMED" } })).toBe(1);
    // Bấm lại: không ghi thêm quyết định.
    expect(await xacNhan(id, ngay)).toMatchObject({ ok: true, daCo: true });
    expect(await db.workConfirmation.count({ where: { assignmentId: id } })).toBe(1);
  });

  it("[P5-ODB-07] có mặt ở cơ sở mà KHÔNG được giao trực ⇒ 0; được giao mà CHƯA NHẬN ⇒ không xác nhận được", async () => {
    const ngay = "2026-11-07";
    await quet(gv2, ngay, "CHECK_IN", "17:10");
    await quet(gv2, ngay, "CHECK_OUT", "21:05");
    expect((await doc(ngay)).filter((x) => x.userId === gv2)).toEqual([]);
    const id = await giao(gv2, ngay, "T", false);
    const r = (await doc(ngay)).find((x) => x.dutyId === id)!;
    expect(r.danhGia).toMatchObject({ lop: "CHAN", lyDo: ["CHUA_NHAN"] });
    expect(await xacNhan(id, ngay)).toMatchObject({ ok: false });
    expect(await opsCua(gv2)).toEqual([]);
  });

  it("[P5-ODB-09] tiết VƯỢT ranh ca (09:45–11:45, ca S hết 11:30) ⇒ Q2 cần xem lại; đơn vị dạy VẪN sinh, đơn vị trực KHÔNG", async () => {
    const ngay = "2026-11-09";
    const id = await giao(gv, ngay, "S");
    await quet(gv, ngay, "CHECK_IN", "07:40");
    await quet(gv, ngay, "CHECK_OUT", "12:00");
    // Lớp 120' không chuẩn ⇒ Q1 cũng chặn đơn vị dạy; dùng tiết 90' 10:05–11:35 để chỉ Q2 lên tiếng.
    await tietDaXacNhan(gv, ngay, "10:05", "11:35");
    const r = (await doc(ngay)).find((x) => x.dutyId === id)!;
    expect(r.danhGia).toMatchObject({ lop: "CHAN", lyDo: ["Q2_VUOT_CA"], donViTra: null });
    expect(await xacNhan(id, ngay, { lyDo: "QLCS quyết thay Q2" })).toMatchObject({ ok: false });
    expect(await db.workUnit.count({ where: { userId: gv, workDate: new Date(`${ngay}T00:00:00Z`), workUnitType: "MAIN_TEACHING", status: "CONFIRMED" } })).toBe(1);
    expect(await db.workUnit.count({ where: { assignmentId: id } })).toBe(0);
  });

  it("[P5-ODB-10] tiết chưa được QLCS quyết ⇒ CHỜ; quyết xong ⇒ tính được. Tiết bị TỪ CHỐI ⇒ đếm 0 (1,0 ca)", async () => {
    const ngay = "2026-11-10";
    const id = await giao(gv2, ngay);
    await quet(gv2, ngay, "CHECK_IN", "17:10");
    await quet(gv2, ngay, "CHECK_OUT", "21:05");
    await tietDaXacNhan(gv2, ngay, "18:00", "19:30", { quyet: "CHUA" });
    expect((await doc(ngay)).find((x) => x.dutyId === id)!.danhGia).toMatchObject({ lop: "CHO", lyDo: ["TIET_CHUA_QUYET"] });
    expect(await xacNhan(id, ngay)).toMatchObject({ ok: false });
    const ngay2 = "2026-11-11";
    const id2 = await giao(gv2, ngay2);
    await quet(gv2, ngay2, "CHECK_IN", "17:10");
    await quet(gv2, ngay2, "CHECK_OUT", "21:05");
    await tietDaXacNhan(gv2, ngay2, "18:00", "19:30", { quyet: "TU_CHOI" });
    expect((await doc(ngay2)).find((x) => x.dutyId === id2)!.danhGia).toMatchObject({ lop: "TU_DONG", donViTra: "1", soTietTrongCa: 0 });
  });

  it("[P5-ODB-14] buổi 60' trong ca trực: QLCS TỪ CHỐI buổi đó vẫn KHÔNG gỡ được ca trực (Q1 còn mở)", async () => {
    const ngay = "2026-11-18";
    const id = await giao(gv2, ngay);
    await quet(gv2, ngay, "CHECK_IN", "17:10");
    await quet(gv2, ngay, "CHECK_OUT", "21:05");
    await tietDaXacNhan(gv2, ngay, "18:00", "19:00", { quyet: "TU_CHOI" });
    const r = (await doc(ngay)).find((x) => x.dutyId === id)!;
    expect(r.danhGia).toMatchObject({ lop: "CHAN", lyDo: ["Q1_THOI_LUONG"], donViTra: null });
    expect(await xacNhan(id, ngay, { lyDo: "gỡ cho xong" })).toMatchObject({ ok: false });
  });

  it("[P5-ODB-15] 'Công việc của tôi' chỉ thấy ca trực CHỜ của CHÍNH mình, chưa kết thúc; nhận rồi / hết ca / của người khác thì không", async () => {
    const ngay = "2026-11-20";
    const cho = await giao(gv2, ngay, "C", false);
    await giao(gv2, ngay, "T", true);
    await giao(gv, ngay, "S", false);
    const luc = (h: string) => truc.docTrucChoNhan({ userId: gv2, now: vn(ngay, h) });
    expect((await luc("09:00")).map((x) => [x.dutyId, x.shiftCode, x.tu, x.den])).toEqual([[cho, "C", "13:45", "17:30"]]);
    expect(await luc("17:31")).toEqual([]);
  });

  it("[P5-ODB-11] đơn vị trực CŨ khi tiết trong ca đổi quyết định sau khi xác nhận (1,0 ⇒ phải xem lại)", async () => {
    const ngay = "2026-11-12";
    const id = await giao(gv2, ngay);
    await quet(gv2, ngay, "CHECK_IN", "17:10");
    await quet(gv2, ngay, "CHECK_OUT", "21:05");
    const s = await tietDaXacNhan(gv2, ngay, "18:00", "19:30", { quyet: "TU_CHOI" });
    expect(await xacNhan(id, ngay)).toMatchObject({ ok: true });
    expect((await doc(ngay)).find((x) => x.dutyId === id)!.donVi).toMatchObject({ quantity: "1", hieuLuc: "CONFIRMED" });
    // QLCS đổi ý: tiết đó thực ra đã dạy ⇒ xác nhận tiết ⇒ ca trực phải còn 0,5, đơn vị 1,0 cũ thành CŨ.
    const ds = await wu.docDoiSoatThucHien({ centerId: cs1, tu: ngay, den: ngay, now: vn(ngay, "23:30") });
    const r = ds.dong.find((x) => x.bc.sourceId === s && x.bc.userId === gv2)!;
    expect(await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor: NGUOI(), now: vn(ngay, "23:50") })).toMatchObject({ ok: true });
    const sau = (await doc(ngay)).find((x) => x.dutyId === id)!;
    expect(sau.donVi).toMatchObject({ quantity: "1", hieuLuc: "STALE" });
    expect(sau.danhGia.donViTra).toBe("0.5");
  });

  it("[P5-ODB-12] giao trực: trùng ca ⇒ từ chối; mã ca lạ ⇒ từ chối; ngày LEGACY ⇒ từ chối; người khác KHÔNG nhận thay được; tự xác nhận trực của mình ⇒ từ chối", async () => {
    const ngay = "2026-11-13";
    const id = await giao(gv, ngay, "T", false);
    expect(await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs1, ngay, shiftCode: "T", note: null, actor: NGUOI() }))).toMatchObject({ ok: false });
    expect(await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs1, ngay, shiftCode: "Z", note: null, actor: NGUOI() }))).toMatchObject({ ok: false });
    expect(await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs1, ngay: "2026-10-13", shiftCode: "T", note: null, actor: NGUOI() }))).toMatchObject({ ok: false });
    expect(await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: id, nguoiBam: { id: ql, name: "QL" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ngay, "07:00") }))).toMatchObject({ ok: false });
    expect(await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: id, nguoiBam: { id: gv, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ngay, "21:00") }))).toMatchObject({ ok: false });
    expect(await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: id, nguoiBam: { id: gv, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ngay, "07:00") }))).toMatchObject({ ok: true });
    await expect(db.operationsDutyAcceptance.updateMany({ where: { dutyId: id }, data: { decisionNote: "sửa" } })).rejects.toThrow(/ODA_IMMUTABLE/);
    await quet(gv, ngay, "CHECK_IN", "17:10");
    await quet(gv, ngay, "CHECK_OUT", "21:05");
    expect(await xacNhan(id, ngay, { nguoi: gv })).toMatchObject({ ok: false });
  });

  it("[P5-ODB-13] số câu tra của danh sách trực KHÔNG đổi khi số dòng trực tăng (2 vs 8 người)", async () => {
    const it2 = "2026-11-16";
    const nhieu = "2026-11-17";
    const tao = async (n: number, ngay: string) => {
      for (let i = 0; i < n; i++) {
        const u = (await db.user.create({ data: { email: `x${ngay}${i}@${TAG}.test`, name: `X${i}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } })).id;
        await giao(u, ngay);
        await quet(u, ngay, "CHECK_IN", "17:10");
        await quet(u, ngay, "CHECK_OUT", "21:05");
        await tietDaXacNhan(u, ngay, "18:00", "19:30");
      }
    };
    await tao(2, it2);
    await tao(8, nhieu);
    const dem = async (ngay: string) => {
      ctl.dem = 0;
      const r = await doc(ngay);
      return { so: r.length, cau: ctl.dem };
    };
    const a = await dem(it2);
    const b = await dem(nhieu);
    expect([a.so, b.so]).toEqual([2, 8]);
    expect(b.cau).toBe(a.cau);
  });
});
