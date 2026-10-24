// [P5-RDB-*] — báo cáo tháng (P5d) trên Postgres THẬT. Thuần: lib/parttime/bao-cao-thang.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-bao-cao-thang] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ dem: 0 }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return { ...goc, getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => (/^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts))) as typeof goc.getSetting };
});
// Cổng RBAC v2 của Parttime giả BẬT (prod/test chạy v2); `checkPermission` vẫn chạy theo cờ thật của môi trường test.
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: { $allModels: { async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) { ctl.dem++; return query(args); } } },
  });
  return { ...goc, db: dem };
});

const TAG = "p5rep";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[P5-RDB] báo cáo tháng — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let dc: typeof import("../../lib/parttime/dieu-chinh-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let bc: typeof import("../../lib/parttime/bao-cao-thang-db");
  let cs1 = "";
  let gv = "";
  let gv2 = "";
  let ta = "";
  let ql = "";
  let khoa = "";
  let bai = "";
  let hv = "";
  const actor = { id: null as string | null, name: "QLCS p5d" };
  const QL = () => ({ id: ql, name: "QL p5d" });

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const dutyIds = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    const wus = (await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((w) => w.id);
    const adj = (await db.compensationAdjustment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((a) => a.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...dutyIds, ...wus, ...adj] } } });
    await db.compensationAdjustment.deleteMany({ where: { userId: { in: ids } } });
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
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const ses = (await db.classSession.findMany({ where: { classId: { in: cls.map((c) => c.id) } }, select: { id: true } })).map((s) => s.id);
    await db.studentSessionFeedback.deleteMany({ where: { classSessionId: { in: ses } } });
    await db.attendance.deleteMany({ where: { sessionId: { in: ses } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.classSession.deleteMany({ where: { id: { in: ses } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.student.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    wu = await import("../../lib/parttime/workunit-db");
    dc = await import("../../lib/parttime/dieu-chinh-db");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    bc = await import("../../lib/parttime/bao-cao-thang-db");
    cs1 = (await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS p5d", address: "x", code: `${TAG}-cs1` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs1`, name: "ĐV p5d", path: `/${TAG}-cs1/`, depth: 0, centerId: cs1 } });
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "A GV p5d")).id;
    gv2 = (await mk("gv2", "B GV2 p5d")).id;
    ta = (await mk("ta", "C TA p5d")).id;
    ql = (await mk("ql", "QL p5d")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 p5d", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT p5d" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    hv = (await db.student.create({ data: { name: `${TAG} hv`, centerId: cs1 }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  const quet = async (u: string, ymd: string, vao: string, ra: string) => {
    await db.staffTimeLog.create({ data: { userId: u, centerId: cs1, direction: "CHECK_IN", loggedAt: vn(ymd, vao), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED" } });
    await db.staffTimeLog.create({ data: { userId: u, centerId: cs1, direction: "CHECK_OUT", loggedAt: vn(ymd, ra), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED" } });
  };
  /** Buổi lớp 18:00–19:30 đã chạy, 1 HV có mặt (+ nhận xét đúng hạn trừ khi `thieuNX`). */
  const buoi = async (ymd: string, p: { teacherId?: string; taId?: string; thay?: string; thieuNX?: boolean } = {}) => {
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `${TAG.toUpperCase()}-L${soLop}`, courseId: khoa, centerId: cs1, teacherId: p.teacherId ?? gv, assistantId: p.taId ?? null, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: vn(ymd, "18:00"), substituteTeacherId: p.thay ?? null }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: p.thay ?? p.teacherId ?? gv } });
    await db.attendance.create({ data: { sessionId: s.id, studentId: hv, status: "PRESENT" } });
    if (!p.thieuNX) await db.studentSessionFeedback.create({ data: { classSessionId: s.id, studentId: hv, createdById: p.thay ?? p.teacherId ?? gv, comment: "Tốt", createdAt: vn(ymd, "19:45") } });
    return s.id;
  };
  const xacNhanHet = async (ymd: string) => {
    const ds = await wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now: vn(ymd, "23:00") });
    for (const r of ds.dong) {
      if (r.ungVien.lop !== "TU_DONG" && r.ungVien.lop !== "XEM_TAY") continue;
      const k = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: "QLCS đã kiểm (test)", hangLoat: false, actor: QL(), now: vn(ymd, "23:00") });
      if (!k.ok) throw new Error(k.loi);
    }
  };
  const NOW = vn("2026-11-30", "23:00");

  let duLieu = false;
  /** Tháng 11/2026: thường · dạy thay · học bù · trợ giảng · muộn + thiếu nhận xét · trực có 1 tiết (0,5). */
  const dungThang = async () => {
    if (duLieu) return;
    duLieu = true;
    await buoi("2026-11-02");
    await quet(gv, "2026-11-02", "17:45", "19:35");
    await buoi("2026-11-03", { teacherId: gv2, thay: gv });
    await quet(gv, "2026-11-03", "17:45", "19:35");
    const c = await db.makeupCase.create({ data: { centerId: cs1, courseId: khoa, lessonId: bai, date: new Date("2026-11-04T00:00:00Z"), startTime: "18:00", endTime: "19:30", teacherId: gv, status: "SCHEDULED", createdById: gv }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "TAO_BUOI", actor);
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    await quet(gv, "2026-11-04", "17:45", "19:35");
    await buoi("2026-11-05", { taId: ta });
    await quet(gv, "2026-11-05", "17:45", "19:35");
    await quet(ta, "2026-11-05", "17:45", "19:35");
    await buoi("2026-11-06", { thieuNX: true });
    await quet(gv, "2026-11-06", "17:58", "19:35");
    const duty = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs1, ngay: "2026-11-09", shiftCode: "T", note: null, actor: QL() }));
    if (!duty.ok) throw new Error(duty.loi);
    await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: duty.id, nguoiBam: { id: gv, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn("2026-11-09", "07:00") }));
    await buoi("2026-11-09");
    await quet(gv, "2026-11-09", "17:10", "21:05");
    for (const n of ["02", "03", "04", "05", "06", "09"]) await xacNhanHet(`2026-11-${n}`);
    const dt = (await truc.docTrucCoSo({ centerId: cs1, tu: "2026-11-09", den: "2026-11-09", now: vn("2026-11-09", "23:30") }))[0];
    const k = await truc.xacNhanTruc({ dutyId: dt.dutyId, phienBanDaXem: dt.phienBan, dauVanDaXem: dt.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor: QL(), now: vn("2026-11-09", "23:30") });
    if (!k.ok) throw new Error(k.loi);
    await dc.dongBoDeXuat({ centerId: cs1, tu: "2026-11-01", den: "2026-11-30", now: NOW, actor: QL() });
  };

  it("[P5-RDB-01] số tháng của GV: thường 4 · dạy thay 1 · học bù 1 · trực 0,5 · 6 tiết = 600' · đề xuất −40.000đ; trợ giảng 1 tiết", async () => {
    await dungThang();
    const r = await bc.docBaoCaoThang({ centerId: cs1, thang: "2026-11", now: NOW });
    const a = r.tongHop.find((x) => x.userId === gv)!;
    const n = (k: keyof typeof a.ds) => a.ds[k].length;
    expect([n("mainThuong"), n("mainDayThay"), n("mainHocBu"), n("mainHocVuot"), n("troGiang")]).toEqual([4, 1, 1, 0, 0]);
    expect([a.soTiet, a.phutChuanDay]).toEqual([6, 600]);
    expect([n("trucDu"), n("trucNua"), a.donViTruc]).toEqual([0, 1, 0.5]);
    expect([n("diMuon"), n("thieuNhanXet"), a.tienDeXuat, a.tienDaXacNhan]).toEqual([1, 1, -40000, 0]);
    const t = r.tongHop.find((x) => x.userId === ta)!;
    expect([t.ds.troGiang.length, t.soTiet, t.tienDeXuat]).toEqual([1, 1, 0]);
    expect(r.tongHop.find((x) => x.userId === gv2)).toBeUndefined(); // GV gốc của buổi dạy thay: không có công
  });

  it("[P5-RDB-02] TỔNG = CHI TIẾT trên dữ liệu thật: mọi khoá của mọi chỉ số trỏ đúng một dòng có thật; tổng tiết = tổng quantity các dòng", async () => {
    await dungThang();
    const r = await bc.docBaoCaoThang({ centerId: cs1, thang: "2026-11", now: NOW });
    const dayTheoPc = new Map(r.day.map((x) => [x.dong.bc.assignmentId, x]));
    const trucTheoId = new Map(r.truc.map((t) => [t.dutyId, t]));
    const khoan = new Map(r.day.flatMap((x) => x.dieuChinh.map((a) => [a.id, a] as const)));
    for (const row of r.tongHop) {
      for (const [k, ds] of Object.entries(row.ds)) for (const id of ds) expect(dayTheoPc.has(id) || trucTheoId.has(id) || khoan.has(id), `${k}:${id}`).toBe(true);
      const tiet = (["mainThuong", "mainDayThay", "mainHocBu", "mainHocVuot", "mainKhac", "troGiang"] as const).flatMap((k) => row.ds[k]).map((id) => Number(dayTheoPc.get(id)!.dong.donVi!.quantity));
      expect(tiet.reduce((s, x) => s + x, 0)).toBe(row.soTiet);
      expect(row.ds.deXuat.map((id) => khoan.get(id)!.amount).reduce((s, x) => s + x, 0)).toBe(row.tienDeXuat);
      expect([...row.ds.trucDu, ...row.ds.trucNua].map((id) => Number(trucTheoId.get(id)!.donVi!.quantity)).reduce((s, x) => s + x, 0)).toBe(row.donViTruc);
    }
    // Nhãn chi tiết có thật: buổi lớp mang mã lớp, học bù mang tên khoá.
    expect(Object.values(r.nhanBuoi)).toEqual(expect.arrayContaining([expect.stringMatching(/^P5REP-L\d+$/), "Học bù — Sata 4 p5d"]));
  });

  it("[P5-RDB-03] giáo viên thấy ĐÚNG dòng QLCS thấy (luật 12b) và KHÔNG thấy dữ liệu người khác", async () => {
    await dungThang();
    const ql = await bc.docBaoCaoThang({ centerId: cs1, thang: "2026-11", now: NOW });
    const toi = await bc.docBaoCaoCuaToi({ userId: gv, thang: "2026-11", now: NOW });
    expect(toi.tongHop).toEqual([ql.tongHop.find((x) => x.userId === gv)]);
    expect(new Set([...toi.day.map((x) => x.dong.bc.userId), ...toi.truc.map((t) => t.userId)])).toEqual(new Set([gv]));
    // Không khoản trừ nào bị giấu: mọi khoản của gv trong DB đều có mặt trong màn của gv.
    const trongDb = await db.compensationAdjustment.findMany({ where: { userId: gv }, select: { id: true } });
    expect(toi.day.flatMap((x) => x.dieuChinh.map((a) => a.id)).sort()).toEqual(trongDb.map((a) => a.id).sort());
  });

  it("[P5-RDB-04] số câu tra của báo cáo tháng KHÔNG đổi theo số buổi (1 vs 4)", async () => {
    const it1 = "2026-12-01";
    await buoi(it1);
    await quet(gv, it1, "17:45", "19:35");
    await xacNhanHet(it1);
    for (const ngay of ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07"]) {
      await buoi(ngay);
      await quet(gv, ngay, "17:45", "19:35");
      await xacNhanHet(ngay);
    }
    const dem = async (thang: string) => {
      ctl.dem = 0;
      const r = await bc.docBaoCaoThang({ centerId: cs1, thang, now: vn("2027-02-01", "08:00") });
      return { tiet: r.tongHop.reduce((s, x) => s + x.soTiet, 0), cau: ctl.dem };
    };
    const a = await dem("2026-12");
    const b = await dem("2027-01");
    expect([a.tiet, b.tiet]).toEqual([1, 4]);
    expect(b.cau).toBe(a.cau);
  });

  /** Xác nhận lại một phân công (dòng có ngoại lệ ⇒ kèm lý do). */
  const xacNhanLai = async (ymd: string, sourceId: string, userId: string, now: Date) => {
    const ds = await wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now });
    const r = ds.dong.find((x) => x.bc.sourceId === sourceId && x.bc.userId === userId)!;
    const k = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: "QLCS xác nhận lại (test)", hangLoat: false, actor: QL(), now });
    if (!k.ok) throw new Error(k.loi);
    return r.bc.assignmentId;
  };
  /** Mọi đơn vị chưa VOID + mọi khoản trừ sống của cơ sở trong tháng phải nằm ở ĐÚNG MỘT ô báo cáo. */
  const kiemDuCo = async (thang: string, now: Date) => {
    const r = await bc.docBaoCaoThang({ centerId: cs1, thang, now });
    const [y, m] = thang.split("-").map(Number);
    const ngay = { gte: new Date(`${thang}-01T00:00:00Z`), lte: new Date(Date.UTC(y, m, 0)) };
    const donVi = await db.workUnit.findMany({ where: { centerId: cs1, workDate: ngay, status: { not: "VOIDED" } }, select: { assignmentId: true, workUnitType: true } });
    const khoan = await db.compensationAdjustment.findMany({ where: { centerId: cs1, workDate: ngay, status: { in: ["PROPOSED", "CONFIRMED"] } }, select: { id: true } });
    const oDonVi = ["mainThuong", "mainDayThay", "mainHocBu", "mainHocVuot", "mainKhac", "troGiang", "trucDu", "trucNua", "donViCu"] as const;
    const oKhoan = ["deXuat", "daXacNhanTru"] as const;
    for (const w of donVi) {
      const ve = r.tongHop.flatMap((x) => oDonVi.flatMap((k) => x.ds[k].filter((id) => id === w.assignmentId).map(() => k)));
      expect(ve, `đơn vị ${w.workUnitType} ${w.assignmentId}`).toHaveLength(1);
    }
    for (const a of khoan) {
      const ve = r.tongHop.flatMap((x) => oKhoan.flatMap((k) => x.ds[k].filter((id) => id === a.id).map(() => k)));
      expect(ve, `khoản ${a.id}`).toHaveLength(1);
    }
    return { r, donVi, khoan };
  };

  it("[P5-RDB-05] ĐỦ CÓ: mọi đơn vị chưa VOID + mọi khoản trừ sống nằm ở ĐÚNG MỘT ô — kể cả buổi bị huỷ sau xác nhận, phân công bị thay, và đơn vị TRỰC", async () => {
    const now = vn("2027-03-31", "23:00");
    // (1) buổi thường
    await buoi("2027-03-01");
    await quet(gv, "2027-03-01", "17:45", "19:35");
    await xacNhanHet("2027-03-01");
    // (2) xác nhận rồi buổi bị HUỶ ⇒ đơn vị phải hiện ở "Cũ", không biến mất
    const huy = await buoi("2027-03-02");
    await quet(gv, "2027-03-02", "17:45", "19:35");
    await xacNhanHet("2027-03-02");
    await db.classSession.update({ where: { id: huy }, data: { status: "CANCELLED" } });
    // (3) xác nhận rồi phân công bị THAY (có người dạy thay) ⇒ đơn vị mồ côi phải hiện ở "Cũ"
    const thay = await buoi("2027-03-03");
    await quet(gv, "2027-03-03", "17:45", "19:35");
    await xacNhanHet("2027-03-03");
    await db.classSession.update({ where: { id: thay }, data: { status: "SCHEDULED", substituteTeacherId: gv2 } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: thay }], "TAO_BUOI", actor);
    // (4) ca trực 0 tiết đã xác nhận ⇒ đơn vị TRỰC (không được coi là mồ côi của phân công dạy)
    const d = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs1, ngay: "2027-03-04", shiftCode: "T", note: null, actor: QL() }));
    if (!d.ok) throw new Error(d.loi);
    await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: d.id, nguoiBam: { id: gv, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn("2027-03-04", "07:00") }));
    await quet(gv, "2027-03-04", "17:10", "21:05");
    const dt = (await truc.docTrucCoSo({ centerId: cs1, tu: "2027-03-04", den: "2027-03-04", now }))[0];
    const k = await truc.xacNhanTruc({ dutyId: dt.dutyId, phienBanDaXem: dt.phienBan, dauVanDaXem: dt.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor: QL(), now });
    if (!k.ok) throw new Error(k.loi);
    const { r, donVi } = await kiemDuCo("2027-03", now);
    expect(donVi.length).toBe(4);
    const a = r.tongHop.find((x) => x.userId === gv)!;
    expect([a.ds.mainThuong.length, a.ds.donViCu.length, a.ds.trucDu.length]).toEqual([1, 2, 1]);
    // Đánh dấu cũ KHÔNG được đụng đơn vị trực (nó không thuộc đối soát dạy).
    await wu.danhDauDonViCu({ centerId: cs1, tu: "2027-03-01", den: "2027-03-31", now, actor: QL() });
    expect((await db.workUnit.findFirstOrThrow({ where: { assignmentId: d.id } })).status).toBe("CONFIRMED");
    expect(await db.workUnit.count({ where: { centerId: cs1, workDate: { gte: new Date("2027-03-01T00:00:00Z"), lte: new Date("2027-03-31T00:00:00Z") }, status: "STALE" } })).toBe(2);
  });

  it("[P5-RDB-06] KHÔNG TRỪ HAI LẦN, KHÔNG GIẤU: khoản đã xác nhận, đơn vị thành cũ rồi được xác nhận lại ⇒ đúng MỘT khoản sống, vẫn hiện ở màn GV", async () => {
    const ngay = "2027-04-01";
    const now = vn("2027-04-03", "08:00");
    const s = await buoi(ngay);
    const vao = await db.staffTimeLog.create({ data: { userId: gv, centerId: cs1, direction: "CHECK_IN", loggedAt: vn(ngay, "17:58"), workDate: new Date(`${ngay}T00:00:00Z`), result: "ACCEPTED" } });
    await db.staffTimeLog.create({ data: { userId: gv, centerId: cs1, direction: "CHECK_OUT", loggedAt: vn(ngay, "19:35"), workDate: new Date(`${ngay}T00:00:00Z`), result: "ACCEPTED" } });
    const pc = await xacNhanLai(ngay, s, gv, now);
    await dc.dongBoDeXuat({ centerId: cs1, tu: ngay, den: ngay, now, actor: QL() });
    const [a] = await db.compensationAdjustment.findMany({ where: { assignmentId: pc } });
    expect(await dc.quyetDieuChinh({ id: a.id, quyet: "CONFIRMED", lyDo: null, actor: QL(), now })).toEqual({ ok: true });
    // Bằng chứng đổi (sửa giờ vào: vẫn muộn) ⇒ đơn vị cũ ⇒ QLCS xác nhận lại ⇒ đơn vị mới.
    await db.staffTimeLog.update({ where: { id: vao.id }, data: { loggedAt: vn(ngay, "17:59") } });
    await xacNhanLai(ngay, s, gv, vn("2027-04-03", "09:00"));
    await dc.dongBoDeXuat({ centerId: cs1, tu: ngay, den: ngay, now: vn("2027-04-03", "10:00"), actor: QL() });
    const song = await db.compensationAdjustment.findMany({ where: { assignmentId: pc, type: "LATE_ARRIVAL", status: { in: ["PROPOSED", "CONFIRMED"] } } });
    expect(song.map((x) => [x.status, x.amount])).toEqual([["CONFIRMED", -10000]]);
    const toi = await bc.docBaoCaoCuaToi({ userId: gv, thang: "2027-04", now: vn("2027-04-03", "10:00") });
    expect([toi.tongHop[0].ds.daXacNhanTru, toi.tongHop[0].tienDaXacNhan]).toEqual([[a.id], -10000]);
    await kiemDuCo("2027-04", vn("2027-04-03", "10:00"));
  });
});
