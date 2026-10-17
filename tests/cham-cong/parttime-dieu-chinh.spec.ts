// [P5-ADB-*] — hạn nhận xét + điều chỉnh tiền (P5c) trên Postgres THẬT. Thuần: lib/parttime/dieu-chinh.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-dieu-chinh] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ dem: 0 }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      key === "shift.phanCongNhanLopBat" ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: { $allModels: { async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) { ctl.dem++; return query(args); } } },
  });
  return { ...goc, db: dem };
});

const TAG = "p5adj";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[P5-ADB] hạn nhận xét + điều chỉnh tiền — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let dc: typeof import("../../lib/parttime/dieu-chinh-db");
  let cs1 = "";
  let gv = "";
  let gv2 = "";
  let ta = "";
  let ql = "";
  let khoa = "";
  let bai = "";
  const hv: string[] = [];
  const actor = { id: null as string | null, name: "QLCS p5c" };
  const QL = () => ({ id: ql, name: "QL p5c" });

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
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const wus = (await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((w) => w.id);
    const adj = (await db.compensationAdjustment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((a) => a.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...wus, ...adj] } } });
    await db.compensationAdjustment.deleteMany({ where: { userId: { in: ids } } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER "WorkConfirmation_bat_bien"`,
      db.workConfirmation.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER "WorkConfirmation_bat_bien"`,
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
    ]);
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const ses = (await db.classSession.findMany({ where: { classId: { in: cls.map((c) => c.id) } }, select: { id: true } })).map((s) => s.id);
    await db.studentSessionFeedback.deleteMany({ where: { classSessionId: { in: ses } } });
    await db.attendance.deleteMany({ where: { sessionId: { in: ses } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.makeupNeed.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.classSession.deleteMany({ where: { id: { in: ses } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.student.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    if (cs1) await db.attendancePeriod.deleteMany({ where: { centerId: cs1 } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    svc = await import("../../lib/parttime/phan-cong-db");
    wu = await import("../../lib/parttime/workunit-db");
    dc = await import("../../lib/parttime/dieu-chinh-db");
    cs1 = (await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS p5c", address: "x", code: `${TAG}-cs1` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs1`, name: "ĐV p5c", path: `/${TAG}-cs1/`, depth: 0, centerId: cs1 } });
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV p5c")).id;
    gv2 = (await mk("gv2", "GV2 p5c")).id;
    ta = (await mk("ta", "TA p5c")).id;
    ql = (await mk("ql", "QL p5c")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 p5c", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT p5c" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    for (const i of [1, 2]) hv.push((await db.student.create({ data: { name: `${TAG} hv${i}`, centerId: cs1 }, select: { id: true } })).id);
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  /** Buổi 18:00–19:30 đã chạy (MAIN = gv, TA tuỳ chọn), 2 HV có mặt, chấm công theo `vao`. Trả id buổi + lớp. */
  const buoi = async (ymd: string, p: { vao?: string; ra?: string; taId?: string } = {}) => {
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: cs1, teacherId: gv, assistantId: p.taId ?? null, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: vn(ymd, "18:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id, status: "WAITING_ACCEPTANCE" } })) {
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      if (!r.ok) throw new Error(r.loi);
    }
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: gv } });
    for (const u of [gv, ...(p.taId ? [p.taId] : [])]) {
      await db.staffTimeLog.create({ data: { userId: u, centerId: cs1, direction: "CHECK_IN", loggedAt: vn(ymd, p.vao ?? "17:45"), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED" } });
      await db.staffTimeLog.create({ data: { userId: u, centerId: cs1, direction: "CHECK_OUT", loggedAt: vn(ymd, p.ra ?? "19:35"), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED" } });
    }
    for (const h of hv) await db.attendance.create({ data: { sessionId: s.id, studentId: h, status: "PRESENT" } });
    return { sessionId: s.id, classId: lop.id };
  };
  const nhanXet = (sessionId: string, studentId: string, luc: Date) => db.studentSessionFeedback.create({ data: { classSessionId: sessionId, studentId, createdById: gv, comment: "Tốt", createdAt: luc } });
  /** QLCS xác nhận thực hiện (lý do kèm theo khi dòng có ngoại lệ). */
  const xacNhanDay = async (ymd: string, sourceId: string, userId = gv) => {
    const ds = await wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now: vn(ymd, "22:00") });
    const r = ds.dong.find((x) => x.bc.sourceId === sourceId && x.bc.userId === userId)!;
    const kq = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: "QLCS đã kiểm tra (test)", hangLoat: false, actor: QL(), now: vn(ymd, "22:00") });
    if (!kq.ok) throw new Error(kq.loi);
    return kq.workUnitId!;
  };
  const sau = (ymd: string, ngay: number, h: string) => {
    const [y, m, dd] = ymd.split("-").map(Number);
    return vn(new Date(Date.UTC(y, m - 1, dd + ngay)).toISOString().slice(0, 10), h);
  };
  const dongBoLuc = (ymd: string, now: Date) => dc.dongBoDeXuat({ centerId: cs1, tu: ymd, den: ymd, now, actor: QL() });
  const docLuc = (ymd: string, now: Date) => dc.docDieuChinh({ centerId: cs1, tu: ymd, den: ymd, now });
  const cuaDonVi = (workUnitId: string) => db.compensationAdjustment.findMany({ where: { workUnitId }, orderBy: { createdAt: "asc" } });

  it("[P5-ADB-01][P5-A06][P5-A07] muộn 8' (đứng chính) ⇒ MỘT đề xuất -10.000đ có nguồn + ảnh chụp + audit; chạy lại không nhân đôi; WorkUnit KHÔNG đổi", async () => {
    const ngay = "2026-11-02";
    const { sessionId } = await buoi(ngay, { vao: "17:58" });
    for (const h of hv) await nhanXet(sessionId, h, vn(ngay, "19:40"));
    const w = await xacNhanDay(ngay, sessionId);
    const truoc = await db.workUnit.findUniqueOrThrow({ where: { id: w } });
    expect(await dongBoLuc(ngay, sau(ngay, 2, "08:00"))).toEqual({ tao: 1, rut: 0 });
    expect(await dongBoLuc(ngay, sau(ngay, 2, "09:00"))).toEqual({ tao: 0, rut: 0 });
    const [a] = await cuaDonVi(w);
    expect(a).toMatchObject({ type: "LATE_ARRIVAL", amount: -10000, ruleCode: "LATE_0_15", status: "PROPOSED", sourceType: "P4_EVIDENCE", sourceId: sessionId, policyVersionId: "cpv_sr_qd_238", userId: gv });
    expect(a.evidenceSnapshot).toMatchObject({ treVaoPhut: 8 });
    expect((await db.auditLog.findMany({ where: { entityId: a.id } })).map((x) => x.action)).toEqual(["PT_ADJUSTMENT_PROPOSED"]);
    const sauDC = await db.workUnit.findUniqueOrThrow({ where: { id: w } });
    expect([sauDC.quantity.toString(), sauDC.status, sauDC.rateSnapshot, sauDC.updatedAt.getTime()]).toEqual([truoc.quantity.toString(), "CONFIRMED", truoc.rateSnapshot, truoc.updatedAt.getTime()]);
  });

  it("[P5-ADB-02][P5-ADB-03] muộn 20' ⇒ KHÔNG dòng nào, chặn chốt kỳ Q10; muộn 35' ⇒ ngoại lệ 'bỏ ca' Q11, không -200.000đ", async () => {
    const ngay = "2026-11-03";
    const a = await buoi(ngay, { vao: "18:10" });
    for (const h of hv) await nhanXet(a.sessionId, h, vn(ngay, "19:40"));
    const wa = await xacNhanDay(ngay, a.sessionId);
    const ngay2 = "2026-11-04";
    const b = await buoi(ngay2, { vao: "18:25" });
    for (const h of hv) await nhanXet(b.sessionId, h, vn(ngay2, "19:40"));
    const wb = await xacNhanDay(ngay2, b.sessionId);
    await dongBoLuc(ngay, sau(ngay, 2, "08:00"));
    await dongBoLuc(ngay2, sau(ngay2, 2, "08:00"));
    expect([...(await cuaDonVi(wa)), ...(await cuaDonVi(wb))]).toEqual([]);
    expect((await docLuc(ngay, sau(ngay, 2, "08:00"))).chuaGiaiQuyet.map((m) => [m.maLuat, m.cauHoi, m.soTien])).toEqual([["LATE_MIDDLE_UNRESOLVED", "Q10", null]]);
    expect((await docLuc(ngay2, sau(ngay2, 2, "08:00"))).chuaGiaiQuyet.map((m) => [m.loai, m.cauHoi, m.soTien])).toEqual([["ABANDONED_WORK", "Q11", null]]);
  });

  it("[P5-ADB-04][P5-C05] nhận xét thiếu quá 10:00 hôm sau ⇒ đề xuất -30.000đ; GV nộp nốt (trễ) ⇒ đề xuất bị RÚT, chờ Q15", async () => {
    const ngay = "2026-11-05";
    const { sessionId } = await buoi(ngay);
    await nhanXet(sessionId, hv[0], vn(ngay, "19:40"));
    const w = await xacNhanDay(ngay, sessionId);
    expect((await docLuc(ngay, sau(ngay, 1, "09:59"))).dong[0].nhanXet?.trangThai).toBe("PENDING");
    expect(await dongBoLuc(ngay, sau(ngay, 1, "09:59"))).toEqual({ tao: 0, rut: 0 });
    expect(await dongBoLuc(ngay, sau(ngay, 1, "10:01"))).toEqual({ tao: 1, rut: 0 });
    expect(await cuaDonVi(w)).toMatchObject([{ type: "MISSING_SESSION_COMMENT", amount: -30000, status: "PROPOSED", sourceType: "CLASS_SESSION:COMMENT" }]);
    // Thiếu nhận xét là ĐIỀU CHỈNH, không phải "không dạy": đơn vị vẫn nguyên 1 tiết.
    expect(await db.workUnit.findUniqueOrThrow({ where: { id: w }, select: { status: true, quantity: true } })).toMatchObject({ status: "CONFIRMED" });
    expect((await db.workUnit.findUniqueOrThrow({ where: { id: w } })).quantity.toString()).toBe("1");
    await nhanXet(sessionId, hv[1], sau(ngay, 1, "14:00"));
    expect(await dongBoLuc(ngay, sau(ngay, 1, "15:00"))).toEqual({ tao: 0, rut: 1 });
    expect((await cuaDonVi(w)).map((x) => x.status)).toEqual(["CANCELLED"]);
    const doc = await docLuc(ngay, sau(ngay, 1, "15:00"));
    expect(doc.dong[0].nhanXet).toMatchObject({ trangThai: "LATE", hoanTatLuc: sau(ngay, 1, "14:00") });
    expect(doc.chuaGiaiQuyet.map((m) => m.cauHoi)).toEqual(["Q15"]);
  });

  it("[P5-ADB-05][P5-C01] nhận xét đủ trước hạn ⇒ ON_TIME, không khoản nào", async () => {
    const ngay = "2026-11-06";
    const { sessionId } = await buoi(ngay);
    for (const h of hv) await nhanXet(sessionId, h, sau(ngay, 1, "09:59"));
    const w = await xacNhanDay(ngay, sessionId);
    await dongBoLuc(ngay, sau(ngay, 3, "08:00"));
    expect((await docLuc(ngay, sau(ngay, 3, "08:00"))).dong[0].nhanXet?.trangThai).toBe("ON_TIME");
    expect(await cuaDonVi(w)).toEqual([]);
  });

  it("[P5-ADB-06][P5-C06] trợ giảng: buổi thiếu nhận xét ⇒ khoản thuộc ĐỨNG CHÍNH, trợ giảng không có khoản nhận xét", async () => {
    const ngay = "2026-11-07";
    const { sessionId } = await buoi(ngay, { taId: ta });
    const wMain = await xacNhanDay(ngay, sessionId, gv);
    const wTa = await xacNhanDay(ngay, sessionId, ta);
    await dongBoLuc(ngay, sau(ngay, 2, "08:00"));
    expect((await cuaDonVi(wMain)).map((x) => x.type)).toEqual(["MISSING_SESSION_COMMENT"]);
    expect(await cuaDonVi(wTa)).toEqual([]);
  });

  it("[P5-ADB-07][P5-C07] HỌC BÙ đứng chính: nhận xét ở BUỔI GỐC của bé có mặt — thiếu quá hạn ⇒ đề xuất; có ⇒ không", async () => {
    const ngay = "2026-11-09";
    const goc = await buoi("2026-11-02");
    const need = await db.makeupNeed.create({ data: { studentId: hv[0], classId: goc.classId, centerId: cs1, courseId: khoa, sourceType: "MANUAL", missedSessionId: goc.sessionId, status: "PENDING" }, select: { id: true } });
    const c = await db.makeupCase.create({ data: { centerId: cs1, courseId: khoa, lessonId: bai, date: new Date(`${ngay}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv, status: "SCHEDULED", createdById: gv }, select: { id: true } });
    await db.makeupCaseStudent.create({ data: { caseId: c.id, makeupNeedId: need.id, centerId: cs1, status: "PRESENT", addedById: gv, originalSessionId: goc.sessionId } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "TAO_BUOI", actor);
    for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId: c.id, status: "WAITING_ACCEPTANCE" } })) {
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      if (!r.ok) throw new Error(r.loi);
    }
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    await db.staffTimeLog.create({ data: { userId: gv, centerId: cs1, direction: "CHECK_IN", loggedAt: vn(ngay, "17:45"), workDate: new Date(`${ngay}T00:00:00Z`), result: "ACCEPTED" } });
    await db.staffTimeLog.create({ data: { userId: gv, centerId: cs1, direction: "CHECK_OUT", loggedAt: vn(ngay, "19:35"), workDate: new Date(`${ngay}T00:00:00Z`), result: "ACCEPTED" } });
    const w = await xacNhanDay(ngay, c.id);
    const truocHan = await docLuc(ngay, sau(ngay, 1, "09:00"));
    expect(truocHan.dong.find((x) => x.dong.bc.sourceId === c.id)!.nhanXet).toMatchObject({ trangThai: "PENDING", canCo: 1, daCo: 0 });
    await dongBoLuc(ngay, sau(ngay, 1, "10:30"));
    expect(await cuaDonVi(w)).toMatchObject([{ type: "MISSING_SESSION_COMMENT", sourceType: "MAKEUP_CASE:COMMENT", sourceId: c.id, status: "PROPOSED" }]);
    // Nhận xét cho bé ở BUỔI GỐC (đúng đường saveSessionEvalChoHocBu) trước hạn ⇒ ON_TIME, đề xuất bị rút.
    await nhanXet(goc.sessionId, hv[0], vn(ngay, "19:50"));
    expect(await dongBoLuc(ngay, sau(ngay, 1, "11:00"))).toEqual({ tao: 0, rut: 1 });
    expect((await docLuc(ngay, sau(ngay, 1, "11:00"))).dong.find((x) => x.dong.bc.sourceId === c.id)!.nhanXet?.trangThai).toBe("ON_TIME");
  });

  it("[P5-ADB-08] QLCS quyết: xác nhận ⇒ CONFIRMED + audit; tự quyết khoản của mình ⇒ từ chối; đồng bộ sau đó KHÔNG đụng khoản đã xác nhận", async () => {
    const ngay = "2026-11-10";
    const { sessionId } = await buoi(ngay, { vao: "17:58" });
    for (const h of hv) await nhanXet(sessionId, h, vn(ngay, "19:40"));
    const w = await xacNhanDay(ngay, sessionId);
    await dongBoLuc(ngay, sau(ngay, 2, "08:00"));
    const [a] = await cuaDonVi(w);
    expect(await dc.quyetDieuChinh({ id: a.id, quyet: "CONFIRMED", lyDo: null, actor: { id: gv, name: "tự quyết" }, now: sau(ngay, 2, "09:00") })).toMatchObject({ ok: false });
    expect(await dc.quyetDieuChinh({ id: a.id, quyet: "CONFIRMED", lyDo: null, actor: QL(), now: sau(ngay, 2, "09:00") })).toEqual({ ok: true });
    expect(await dc.quyetDieuChinh({ id: a.id, quyet: "REJECTED", lyDo: "đổi ý sau khi xác nhận", actor: QL(), now: sau(ngay, 2, "09:10") })).toMatchObject({ ok: false });
    // Bằng chứng đổi (lượt vào bị gỡ) ⇒ đơn vị CŨ ⇒ đồng bộ không rút khoản ĐÃ XÁC NHẬN (quyết định của QLCS).
    await db.staffTimeLog.updateMany({ where: { userId: gv, loggedAt: vn(ngay, "17:58") }, data: { reviewStatus: "DISMISSED" } });
    expect(await dongBoLuc(ngay, sau(ngay, 2, "10:00"))).toEqual({ tao: 0, rut: 0 });
    expect((await cuaDonVi(w)).map((x) => [x.status, x.decidedById])).toEqual([["CONFIRMED", ql]]);
    expect((await db.auditLog.findMany({ where: { entityId: a.id }, orderBy: { createdAt: "asc" } })).map((x) => x.action)).toEqual(["PT_ADJUSTMENT_PROPOSED", "PT_ADJUSTMENT_CONFIRMED"]);
  });

  it("[P5-ADB-09] đơn vị dạy thành CŨ ⇒ đề xuất đang chờ bị RÚT (không treo trên sự thật đã đổi)", async () => {
    const ngay = "2026-11-11";
    const { sessionId } = await buoi(ngay, { vao: "17:58" });
    for (const h of hv) await nhanXet(sessionId, h, vn(ngay, "19:40"));
    const w = await xacNhanDay(ngay, sessionId);
    await dongBoLuc(ngay, sau(ngay, 2, "08:00"));
    await db.staffTimeLog.updateMany({ where: { userId: gv, loggedAt: vn(ngay, "17:58") }, data: { reviewStatus: "DISMISSED" } });
    expect(await dongBoLuc(ngay, sau(ngay, 2, "09:00"))).toEqual({ tao: 0, rut: 1 });
    expect((await cuaDonVi(w)).map((x) => x.status)).toEqual(["CANCELLED"]);
  });

  it("[P5-ADB-10][P5-A07] ràng buộc DB: khoản DƯƠNG / thiếu mã luật / thiếu nguồn ⇒ từ chối; hai khoản sống cùng loại cho một đơn vị ⇒ từ chối", async () => {
    const ngay = "2026-11-12";
    const { sessionId } = await buoi(ngay);
    const w = await xacNhanDay(ngay, sessionId);
    const goc = { userId: gv, centerId: cs1, workDate: new Date(`${ngay}T00:00:00Z`), workUnitId: w, type: "LATE_ARRIVAL" as const, policyVersionId: "cpv_sr_qd_238", evidenceSnapshot: {}, sourceType: "P4_EVIDENCE" };
    await expect(db.compensationAdjustment.create({ data: { ...goc, amount: 10000, ruleCode: "X", sourceId: sessionId } })).rejects.toThrow(/amount_check/);
    await expect(db.compensationAdjustment.create({ data: { ...goc, amount: -1, ruleCode: "", sourceId: sessionId } })).rejects.toThrow(/rule_check/);
    await expect(db.compensationAdjustment.create({ data: { ...goc, amount: -1, ruleCode: "X", sourceId: "" } })).rejects.toThrow(/rule_check/);
    await db.compensationAdjustment.create({ data: { ...goc, amount: -1, ruleCode: "X", sourceId: sessionId } });
    await expect(db.compensationAdjustment.create({ data: { ...goc, amount: -2, ruleCode: "Y", sourceId: sessionId } })).rejects.toThrow(/Unique constraint/);
  });

  it("[P5-ADB-11] kỳ công KHOÁ ⇒ không quyết được khoản trong kỳ", async () => {
    const ngay = "2026-12-01";
    const { sessionId } = await buoi(ngay, { vao: "17:58" });
    for (const h of hv) await nhanXet(sessionId, h, vn(ngay, "19:40"));
    const w = await xacNhanDay(ngay, sessionId);
    await dongBoLuc(ngay, sau(ngay, 2, "08:00"));
    await db.attendancePeriod.create({ data: { centerId: cs1, periodKey: "2026-12", status: "LOCKED" } });
    const [a] = await cuaDonVi(w);
    expect(await dc.quyetDieuChinh({ id: a.id, quyet: "CONFIRMED", lyDo: null, actor: QL(), now: sau(ngay, 2, "09:00") })).toMatchObject({ ok: false });
  });

  it("[P5-ADB-13] đơn vị bị THAY (xác nhận lại) ⇒ đề xuất của nó bị RÚT NGAY trong giao dịch; đánh dấu CŨ cũng rút; đồng bộ dựng lại ĐÚNG MỘT khoản trên đơn vị mới", async () => {
    const ngay = "2026-11-19";
    const { sessionId } = await buoi(ngay, { vao: "17:58" });
    for (const h of hv) await nhanXet(sessionId, h, vn(ngay, "19:40"));
    const w1 = await xacNhanDay(ngay, sessionId);
    await dongBoLuc(ngay, sau(ngay, 2, "08:00"));
    const [a1] = await cuaDonVi(w1);
    expect(a1.status).toBe("PROPOSED");
    // Sửa giờ vào (vẫn muộn) ⇒ đơn vị cũ ⇒ QLCS xác nhận lại ⇒ đơn vị mới; KHÔNG chạy đồng bộ.
    await db.staffTimeLog.updateMany({ where: { userId: gv, loggedAt: vn(ngay, "17:58") }, data: { loggedAt: vn(ngay, "17:59") } });
    const w2 = await xacNhanDay(ngay, sessionId);
    expect(w2).not.toBe(w1);
    expect((await db.compensationAdjustment.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe("CANCELLED");
    expect((await db.auditLog.findMany({ where: { entityId: a1.id }, orderBy: { createdAt: "asc" } })).map((x) => x.action)).toEqual(["PT_ADJUSTMENT_PROPOSED", "PT_ADJUSTMENT_WITHDRAWN"]);
    await dongBoLuc(ngay, sau(ngay, 2, "09:00"));
    const song = await db.compensationAdjustment.findMany({ where: { assignmentId: a1.assignmentId, status: { in: ["PROPOSED", "CONFIRMED"] } } });
    expect(song.map((x) => [x.workUnitId, x.amount])).toEqual([[w2, -10000]]);
    expect(song[0].evidenceSnapshot).toMatchObject({ nguonLuat: expect.stringMatching(/nháp/) });
    // Đánh dấu CŨ (bằng chứng đổi lần nữa) ⇒ khoản đề xuất của đơn vị đó bị rút cùng giao dịch.
    await db.staffTimeLog.updateMany({ where: { userId: gv, loggedAt: vn(ngay, "17:59") }, data: { loggedAt: vn(ngay, "17:57") } });
    expect(await wu.danhDauDonViCu({ centerId: cs1, tu: ngay, den: ngay, now: sau(ngay, 2, "10:00"), actor: QL() })).toBe(1);
    expect((await db.compensationAdjustment.findUniqueOrThrow({ where: { id: song[0].id } })).status).toBe("CANCELLED");
  });

  it("[P5-ADB-12] số câu tra của docDieuChinh KHÔNG đổi theo số buổi (2 vs 6)", async () => {
    const it1 = "2026-11-16";
    const it2 = "2026-11-17";
    const tao = async (ngay: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const { sessionId } = await buoi(ngay);
        await nhanXet(sessionId, hv[0], vn(ngay, "19:40"));
        await xacNhanDay(ngay, sessionId);
      }
    };
    await tao(it1, 1);
    await tao(it2, 3);
    const dem = async (ngay: string) => {
      ctl.dem = 0;
      const r = await docLuc(ngay, sau(ngay, 2, "08:00"));
      return { so: r.dong.length, cau: ctl.dem };
    };
    const a = await dem(it1);
    const b = await dem(it2);
    expect([a.so, b.so]).toEqual([1, 3]);
    expect(b.cau).toBe(a.cau);
  });
});
