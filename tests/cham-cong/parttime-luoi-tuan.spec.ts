// [LT-DB-*] — lưới phân công giáo viên trên Postgres THẬT, chạy qua CHÍNH bộ đồng bộ Parttime (`dongBoNgay`): dữ liệu nguồn đổi
// (tạo / dời / huỷ buổi, giao / huỷ trực, đổi GV) ⇒ `docLuoiTuan` ra mã mới — không ai sửa lưới tay. Thuần: lib/parttime/luoi-tuan*.test.ts.
// Chạy: TEST_DATABASE_URL=postgresql://…/satarobo_test… pnpm test:cham-cong-db
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-luoi-tuan] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ dem: 0 }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: { $allModels: { async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) { ctl.dem++; return query(args); } } },
  });
  return { ...goc, db: dem };
});

const TAG = "ptlt";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
// Tuần T2 02/11 → CN 08/11/2026 (SR.QD.238 hiệu lực từ 15/10).
const T2 = "2026-11-02";
const CN = "2026-11-08";
const T7 = "2026-11-07";

d("[LT-DB] lưới phân công GV — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let luoi: typeof import("../../lib/parttime/luoi-tuan-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let doiSoat: typeof import("../../lib/parttime/doi-soat-dong-bo");
  let cs = "";
  let csKhac = "";
  let gv = "";
  let gv2 = "";
  let khoa = "";
  let bai = "";
  const actor = { id: null as string | null, name: "QLCS lt" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({
      where: { code: "LEGACY" },
      update: {},
      create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } },
    });
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "SR.QD.238", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const dutyIds = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityType: { in: ["SessionStaffAssignment", "OperationsDutyAssignment"] }, entityId: { in: [...pcIds, ...dutyIds] } } });
    if (pcIds.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
    }
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.operationsDutyAcceptance.deleteMany({ where: { duty: { userId: { in: ids } } } });
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = (await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.trialClassV2.deleteMany({ where: { code: { startsWith: TAG } } });
    await db.lead.deleteMany({ where: { parentName: { startsWith: TAG } } });
    await db.trialCertificate.deleteMany({ where: { userId: { in: ids } } });
    await db.trialSupportPolicy.deleteMany({ where: { reason: { startsWith: TAG } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftTemplate.deleteMany({ where: { code: `${TAG.toUpperCase()}_NGHI` } });
    await db.classSession.deleteMany({ where: { classId: { in: cls } } });
    await db.class.deleteMany({ where: { id: { in: cls } } });
    await db.teacherRankHistory.deleteMany({ where: { userId: { in: ids } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    luoi = await import("../../lib/parttime/luoi-tuan-db");
    doiSoat = await import("../../lib/parttime/doi-soat-dong-bo");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    const tao = async (code: string) => {
      const c = (await db.center.upsert({ where: { slug: `${TAG}-${code}` }, update: {}, create: { slug: `${TAG}-${code}`, name: `CS ${code}`, address: "x", code: `${TAG}-${code}` }, select: { id: true } })).id;
      await db.orgUnit.upsert({ where: { code: `${TAG}-${code}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${code}`, name: `ĐV ${code}`, path: `/${TAG}-${code}/`, depth: 0, centerId: c } });
      return c;
    };
    cs = await tao("cs2");
    csKhac = await tao("cs1");
    await cleanup();
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "GV A lt", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    gv2 = (await db.user.create({ data: { email: `gv2@${TAG}.test`, name: "GV B lt (CS1)", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: csKhac }, select: { id: true } })).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 lt", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT lt" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  let soLop = 0;
  /** Lớp 18:00–19:30 của `nguoi` ở `centerId`, một buổi ngày `ymd` — phân công dựng bằng CHÍNH bộ đồng bộ. */
  const buoi = async (p: { ymd?: string; nguoi?: string; centerId?: string; gio?: [string, string] } = {}) => {
    const ymd = p.ymd ?? T7;
    const [bat, ket] = p.gio ?? ["18:00", "19:30"];
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: p.centerId ?? cs, teacherId: p.nguoi ?? gv, startTime: bat, endTime: ket }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: p.centerId ?? cs, status: "SCHEDULED", date: vn(ymd, bat), lessonId: bai }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    return { sessionId: s.id, classId: lop.id };
  };
  const giao = async (shiftCode: string, ymd = T7, userId = gv) => {
    const r = await db.$transaction((tx) => truc.giaoTruc(tx, { userId, centerId: cs, ngay: ymd, shiftCode, note: null, nguonGiao: "TAY", actor }));
    if (!r.ok) throw new Error(r.loi);
    return r.id;
  };
  const doc = () => luoi.docLuoiTuan({ centerId: cs, tu: T2, den: CN, now: vn("2026-11-09", "09:00") });
  const o = async (ngay = T7, ca = "T", userId = gv) => (await doc()).dong.find((x) => x.userId === userId)?.o[ngay]?.[ca] ?? null;

  it("[LT-DB-01] EV-01 lớp cố định: tạo buổi ⇒ bộ đồng bộ phân MAIN ⇒ ô T7·T = D, 120.000 (R1 mặc định)", async () => {
    const b = await buoi();
    const x = await o();
    expect(x?.ke).toMatchObject({ ma: "D", tong: 120000 });
    expect(x?.hoatDong[0]).toMatchObject({ sourceId: b.sessionId, loai: "REGULAR", vai: "MAIN" });
    // Đối chứng âm cho LT-DB-04: một buổi, không gì trùng ⇒ KHÔNG được báo trùng giờ / bận nơi khác (bắt lỗi đọc nhầm chính cơ sở này).
    expect(x?.canhBao).not.toContain("TRUNG_GIO");
    expect(x?.canhBao).not.toContain("O_CO_SO_KHAC");
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: b.sessionId }], "HUY_BUOI", actor);
  });

  it("[LT-DB-02] buổi + giao trực cùng ca ⇒ TD 165.000; huỷ buổi ⇒ T (trực GIỮ NGUYÊN); huỷ trực ⇒ ô trống", async () => {
    const b = await buoi();
    const dutyId = await giao("T");
    expect((await o())?.ke).toMatchObject({ ma: "TD", tong: 165000 });
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: b.sessionId }], "HUY_BUOI", actor);
    expect((await o())?.ke).toMatchObject({ ma: "T", tong: 90000 });
    await db.$transaction((tx) => truc.huyTruc(tx, { dutyId, lyDo: "test", actor }));
    expect(await o()).toBeNull(); // không còn việc nào ⇒ GV không còn dòng
  });

  it("[LT-DB-03] EV-11 dời buổi T7 tối → CN sáng: ô cũ trống, ô mới D — bộ đồng bộ sửa tại chỗ, không nhân đôi", async () => {
    const b = await buoi();
    await db.classSession.update({ where: { id: b.sessionId }, data: { date: vn(CN, "09:45") } });
    await db.class.update({ where: { id: b.classId }, data: { startTime: "09:45", endTime: "11:15" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: b.sessionId }], "DOI_LICH_BUOI", actor);
    const l = await doc();
    const dong = l.dong.find((x) => x.userId === gv)!;
    expect(dong.o[T7]!["T"]!.hoatDong.filter((h) => h.sourceId === b.sessionId)).toHaveLength(0);
    expect(dong.o[CN]!["S"]!.hoatDong.filter((h) => h.sourceId === b.sessionId)).toHaveLength(1);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: b.sessionId, status: { notIn: ["CANCELLED", "REPLACED"] } } })).toBe(1);
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: b.sessionId }], "HUY_BUOI", actor);
  });

  it("[LT-DB-04] EV-16 GV cơ sở khác được phân buổi ở cơ sở này ⇒ laMuon, cơ sở gốc không đổi; EV-15 trùng giờ ở CS1 ⇒ cảnh báo", async () => {
    const b = await buoi({ nguoi: gv2 });
    const bKhac = await buoi({ nguoi: gv2, centerId: csKhac, gio: ["19:00", "20:30"] });
    const l = await doc();
    const dong = l.dong.find((x) => x.userId === gv2)!;
    expect(dong).toMatchObject({ laMuon: true });
    expect(dong.o[T7]!["T"]!.canhBao).toEqual(expect.arrayContaining(["TRUNG_GIO", "O_CO_SO_KHAC"]));
    expect((await db.user.findUniqueOrThrow({ where: { id: gv2 }, select: { centerId: true } })).centerId).toBe(csKhac);
    for (const x of [b, bKhac]) {
      await db.classSession.update({ where: { id: x.sessionId }, data: { status: "CANCELLED" } });
      await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: x.sessionId }], "HUY_BUOI", actor);
    }
  });

  it("[LT-DB-05] Rank theo ngày hiệu lực: R3 từ CN ⇒ buổi T7 120.000, buổi CN 160.000", async () => {
    const b1 = await buoi();
    const b2 = await buoi({ ymd: CN });
    await db.teacherRankHistory.create({ data: { userId: gv, rank: 3, effectiveFrom: new Date(`${CN}T00:00:00Z`), reason: "test" } });
    expect((await o())?.ke?.tong).toBe(120000);
    expect((await o(CN))?.ke?.tong).toBe(160000);
    await db.teacherRankHistory.deleteMany({ where: { userId: gv } });
    for (const x of [b1, b2]) {
      await db.classSession.update({ where: { id: x.sessionId }, data: { status: "CANCELLED" } });
      await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: x.sessionId }], "HUY_BUOI", actor);
    }
  });

  // ── G1 · đối soát định kỳ: sự kiện SÓT tự lành; idempotent; không đụng buổi đã qua ────────────────────────────────────────
  const huy = async (sessionId: string) => {
    await db.classSession.update({ where: { id: sessionId }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: sessionId }], "HUY_BUOI", actor);
  };
  const taoBuoiKhongDongBo = async (ymd: string) => {
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: cs, teacherId: gv, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    return (await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(ymd, "18:00"), lessonId: bai }, select: { id: true } })).id;
  };
  const NOW_T2 = vn(T2, "00:30");

  it("[LT-DB-06] G1 buổi tạo mà SÓT sự kiện ⇒ lưới trống; đối soát ⇒ có D; chạy lại ⇒ 0 bước (idempotent); buổi ĐÃ QUA không bị dựng hồi tố", async () => {
    const sTuongLai = await taoBuoiKhongDongBo(T7);
    const sDaQua = await taoBuoiKhongDongBo("2026-11-01"); // trước NOW_T2
    expect((await o())?.hoatDong.some((h) => h.sourceId === sTuongLai) ?? false).toBe(false);
    const k1 = await doiSoat.doiSoatDongBo({ now: NOW_T2, soNgay: 21, actor, centerIds: [cs] });
    expect(k1).toMatchObject({ tu: T2, den: "2026-11-23", loi: [] });
    expect((await o())?.hoatDong.filter((h) => h.sourceId === sTuongLai)).toHaveLength(1);
    const k2 = await doiSoat.doiSoatDongBo({ now: NOW_T2, soNgay: 21, actor, centerIds: [cs] });
    expect(k2.soBuoc).toBe(0);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: sTuongLai } })).toBe(1);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: sDaQua } })).toBe(0);
    await huy(sTuongLai);
    await huy(sDaQua);
  });

  it("[LT-DB-07] G2 case học bù CHỜ DUYỆT ⇒ đối soát KHÔNG sinh MAIN; duyệt (SCHEDULED) ⇒ đối soát sinh MAIN", async () => {
    const c = await db.makeupCase.create({
      data: { centerId: cs, courseId: khoa, lessonId: bai, date: new Date(`${T7}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv, createdById: gv, status: "PENDING_APPROVAL" },
      select: { id: true },
    });
    await doiSoat.doiSoatDongBo({ now: NOW_T2, soNgay: 21, actor, centerIds: [cs] });
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: c.id, status: { notIn: ["CANCELLED", "REPLACED"] } } })).toBe(0);
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "SCHEDULED" } });
    await doiSoat.doiSoatDongBo({ now: NOW_T2, soNgay: 21, actor, centerIds: [cs] });
    expect(await db.sessionStaffAssignment.findMany({ where: { sourceId: c.id, status: { notIn: ["CANCELLED", "REPLACED"] } }, select: { role: true, userId: true } })).toEqual([
      { role: "MAIN_TEACHER", userId: gv },
    ]);
    expect((await o())?.hoatDong.find((h) => h.sourceId === c.id)).toMatchObject({ loai: "MAKEUP" });
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_HUY", actor);
  });

  it("[LT-DB-08] G3 đơn nghỉ đã duyệt (ô ca nguồn LEAVE) mà còn buổi ⇒ cảnh báo NGHI_DA_DUYET; người đứng chính KHÔNG đổi", async () => {
    const b = await buoi();
    const tpl = await db.shiftTemplate.create({ data: { code: `${TAG.toUpperCase()}_NGHI`, name: "Nghỉ phép (test)", segments: [] }, select: { id: true, code: true } });
    await db.shiftAssignment.create({ data: { userId: gv, centerId: cs, workDate: new Date(`${T7}T00:00:00Z`), templateId: tpl.id, templateCode: tpl.code, source: "LEAVE", status: "ACTIVE", segments: [] } });
    const x = await o();
    expect(x?.canhBao).toContain("NGHI_DA_DUYET");
    expect(x?.hoatDong.find((h) => h.sourceId === b.sessionId)).toMatchObject({ vai: "MAIN" });
    await huy(b.sessionId);
  });

  // ── EV-05 / EV-04 / EV-06 đầu-cuối: buổi Trial THẬT trong ca trực → bộ đồng bộ → điểm danh → chứng nhận + chính sách ────────
  it("[LT-DB-09] Trial 20:00 T7 trong ca T có trực, 2 HV có mặt, có chứng nhận + chính sách bật ⇒ T +TR = 150.000; thiếu chứng nhận ⇒ 90.000; 1 vắng ⇒ 120.000", async () => {
    const lop = await db.trialClassV2.create({ data: { code: `${TAG}-tr1`, name: "Trial lt", centerId: cs, sessionCount: 1, teacherId: gv }, select: { id: true } });
    const buoiTr = await db.trialClassSession.create({ data: { trialClassId: lop.id, seq: 1, date: new Date(`${T7}T00:00:00Z`), startTime: "20:00", endTime: "21:00", teacherId: gv }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "TRIAL_SESSION", sourceId: buoiTr.id }], "TRIAL_TAO", actor);
    // Phân công phải tạo TRƯỚC giờ buổi: ghim `createdAt` về mốc tuyệt đối — không dựa vào đồng hồ thật (luật 19: sau 07/11/2026 ca này
    // sẽ tự đỏ nếu để `createdAt = now()`).
    await db.sessionStaffAssignment.updateMany({ where: { sourceId: buoiTr.id }, data: { createdAt: vn("2026-11-01", "09:00") } });
    const lead = await db.lead.create({ data: { parentName: `${TAG} PH`, phone: "0900000001" }, select: { id: true } });
    const be = [];
    for (const ten of ["Bé A", "Bé B"]) {
      const c = await db.leadChild.create({ data: { leadId: lead.id, fullName: ten }, select: { id: true } });
      be.push((await db.trialEnrollment.create({ data: { trialClassId: lop.id, leadChildId: c.id, scheduledSessionId: buoiTr.id }, select: { id: true } })).id);
    }
    for (const e of be) await db.trialAttendance.create({ data: { trialSessionId: buoiTr.id, trialEnrollmentId: e, status: "PRESENT" } });
    const dutyId = await giao("T");
    await db.trialSupportPolicy.create({ data: { centerId: null, enabled: true, amountPerStudent: 30000, effectiveFrom: new Date("2026-10-15T00:00:00Z"), reason: `${TAG} chính sách thử`, approvedById: gv } });

    // Không chứng nhận ⇒ chỉ 90.000 trực, lý do CERTIFICATE_MISSING.
    let x = await o();
    expect(x?.ke).toMatchObject({ ma: "T", coTrial: true, tong: 90000 });
    expect(x?.hoatDong.find((h) => h.loai === "TRIAL")?.trial?.lyDo).toContain("CERTIFICATE_MISSING");

    await db.trialCertificate.create({ data: { userId: gv, effectiveFrom: new Date("2026-10-15T00:00:00Z"), issuedById: gv } });
    x = await o();
    expect(x?.ke).toMatchObject({ ma: "T", coTrial: true, tong: 150000 });
    expect(x?.hoatDong.find((h) => h.loai === "TRIAL")?.trial).toMatchObject({ trangThai: "DU_DIEU_KIEN", soCoMat: 2, soTien: 60000 });

    await db.trialAttendance.updateMany({ where: { trialEnrollmentId: be[1]! }, data: { status: "ABSENT" } });
    expect((await o())?.ke?.tong).toBe(120000);

    // EV-03: huỷ buổi Trial ⇒ trực GIỮ NGUYÊN, hỗ trợ 0.
    await db.trialClassSession.update({ where: { id: buoiTr.id }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "TRIAL_SESSION", sourceId: buoiTr.id }], "TRIAL_HUY", actor);
    expect((await o())?.ke).toMatchObject({ ma: "T", tong: 90000 });
    await db.$transaction((t) => truc.huyTruc(t, { dutyId, lyDo: "test", actor }));
  });

  it("[LT-DB-Q] số câu tra của docLuoiTuan KHÔNG đổi theo số buổi (2 vs 12)", async () => {
    const dem = async () => {
      ctl.dem = 0;
      await doc();
      return ctl.dem;
    };
    const tao = [await buoi(), await buoi({ ymd: CN })];
    const it2 = await dem();
    for (let i = 0; i < 10; i++) tao.push(await buoi({ ymd: "2026-11-0" + (2 + (i % 5)), gio: ["09:45", "11:15"] }));
    expect(await dem()).toBe(it2);
    for (const x of tao) {
      await db.classSession.update({ where: { id: x.sessionId }, data: { status: "CANCELLED" } });
      await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: x.sessionId }], "HUY_BUOI", actor);
    }
  });

  // ─── PR6 · học bù rơi vào ca đang trực (chủ dự án 24/10/2026) ─────────────────────────────────────────────────────────────────
  const NOW_PR6 = vn("2026-11-02", "09:00"); // trước giờ hết ca T ngày T7 (07/11 21:00)
  const caseBu = async (p: { gio?: [string, string]; status?: "SCHEDULED" | "PENDING_APPROVAL" } = {}) => {
    const [bat, ket] = p.gio ?? ["19:15", "20:45"];
    const c = await db.makeupCase.create({
      data: { centerId: cs, courseId: khoa, lessonId: bai, date: new Date(`${T7}T00:00:00Z`), startTime: bat, endTime: ket, teacherId: gv, createdById: gv, status: p.status ?? "SCHEDULED" },
      select: { id: true },
    });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_TAO", actor);
    return c.id;
  };
  const huyBu = async (id: string) => {
    await db.makeupCase.update({ where: { id }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: id }], "HOC_BU_HUY", actor);
  };
  const chot = async (caseId: string, giu: boolean, lyDo: string | null = null, now = NOW_PR6) => {
    const tb = await import("../../lib/parttime/truc-bu");
    return db.$transaction((tx) => tb.chotTrucKhiCoBu(tx, { caseId, giu, lyDo, actor, now }));
  };

  it("[LT-DB-10] PR6 trực T + book học bù CHƯA quyết ⇒ ô D (không suy TD), tiền trực chưa tính, cảnh báo CAN_QUYET_TRUC; GIỮ ⇒ TD 165.000; giữ lần hai idempotent", async () => {
    const dutyId = await giao("T");
    const c = await caseBu();
    let x = await o();
    expect(x?.ke).toMatchObject({ ma: "D", tong: 120000 });
    expect(x?.canhBao).toContain("CAN_QUYET_TRUC");
    expect(x?.ke?.dong.find((d) => d.loai === "TRUC")).toMatchObject({ thanhTien: null });
    expect(await chot(c, true)).toEqual({ ok: true, daDoi: true });
    x = await o();
    expect(x?.ke).toMatchObject({ ma: "TD", tong: 165000 });
    expect(x?.canhBao).not.toContain("CAN_QUYET_TRUC");
    expect(await chot(c, true)).toEqual({ ok: true, daDoi: false });
    expect(await db.auditLog.count({ where: { entityId: dutyId, action: "PT_DUTY_KEPT_WITH_MAKEUP" } })).toBe(1);
    // Huỷ bù ⇒ trực GIỮ NGUYÊN ⇒ ô về T.
    await huyBu(c);
    expect((await o())?.ke).toMatchObject({ ma: "T", tong: 90000 });
    await db.$transaction((tx) => truc.huyTruc(tx, { dutyId, lyDo: "dọn ca test", actor }));
  });

  it("[LT-DB-11] PR6 BỎ trực: thiếu lý do ⇒ từ chối, không đổi gì; có lý do ⇒ dòng trực huỷ (lý do ghi rõ buổi bù) ⇒ ô D 120.000; huỷ bù sau đó KHÔNG khôi phục trực", async () => {
    const dutyId = await giao("T");
    const c = await caseBu();
    expect(await chot(c, false, "x")).toMatchObject({ ok: false });
    expect((await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: dutyId } })).status).not.toBe("CANCELLED");
    expect(await chot(c, false, "GV chỉ dạy bù, người khác trực")).toEqual({ ok: true, daDoi: true });
    expect((await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: dutyId } })).status).toBe("CANCELLED");
    const au = await db.auditLog.findFirst({ where: { entityId: dutyId, action: "PT_DUTY_CANCELLED" }, select: { reason: true } });
    expect(au?.reason).toContain("19:15–20:45");
    const x = await o();
    expect(x?.ke).toMatchObject({ ma: "D", tong: 120000 });
    expect(x?.trucId).toBeNull();
    await huyBu(c);
    expect(await o()).toBeNull();
    expect((await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: dutyId } })).status).toBe("CANCELLED");
  });

  it("[LT-DB-12] PR6 case CHỜ DUYỆT ⇒ không có MAIN trên lưới, quyết trực bị từ chối; ca trực đã kết thúc ⇒ từ chối (đi Sửa buổi đã qua)", async () => {
    const dutyId = await giao("T");
    const cho = await caseBu({ status: "PENDING_APPROVAL" });
    expect(await chot(cho, true)).toMatchObject({ ok: false });
    expect((await o())?.ke).toMatchObject({ ma: "T" });
    await db.makeupCase.update({ where: { id: cho }, data: { status: "SCHEDULED" } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: cho }], "HOC_BU_TAO", actor);
    expect(await chot(cho, true, null, vn(T7, "21:30"))).toMatchObject({ ok: false });
    await huyBu(cho);
    await db.$transaction((tx) => truc.huyTruc(tx, { dutyId, lyDo: "dọn ca test", actor }));
  });

  it("[LT-DB-13] PR6 giữ trực cho case A KHÔNG áp sang case B dời vào cùng ca; không có trực ⇒ quyết trực báo không có gì để quyết", async () => {
    const dutyId = await giao("T");
    const a = await caseBu({ gio: ["17:30", "19:00"] });
    expect(await chot(a, true)).toEqual({ ok: true, daDoi: true });
    await huyBu(a);
    const b = await caseBu({ gio: ["19:15", "20:45"] });
    expect((await o())?.canhBao).toContain("CAN_QUYET_TRUC");
    await huyBu(b);
    await db.$transaction((tx) => truc.huyTruc(tx, { dutyId, lyDo: "dọn ca test", actor }));
    const khong = await caseBu();
    expect(await chot(khong, true)).toMatchObject({ ok: false });
    await huyBu(khong);
  });

  it("[LT-DB-14] PR7 lý do điều chỉnh từ NGUỒN THẬT: trực huỷ khi nhận bù (lý do ghi rõ buổi bù) · đơn dạy thay đã duyệt (người gửi / người duyệt) · phân công nhập chuyển đổi ⇒ 'không có dữ liệu lịch sử'; phân công thường ⇒ không có điều chỉnh", async () => {
    const ld = await import("../../lib/parttime/ly-do-dieu-chinh-db");
    const dutyId = await giao("T");
    const c = await caseBu();
    expect(await chot(c, false, "GV chỉ dạy bù, người khác trực")).toEqual({ ok: true, daDoi: true });
    const lop = await buoi({ ymd: CN, gio: ["09:45", "11:15"] });
    const pcLop = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: lop.sessionId, status: { notIn: ["CANCELLED", "REPLACED"] } }, select: { id: true } });
    const pcBu = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: c, status: { notIn: ["CANCELLED", "REPLACED"] } }, select: { id: true } });
    let r = await ld.docDieuChinh({ centerId: cs, tu: T2, den: CN, assignmentIds: [pcLop.id, pcBu.id], dutyIds: [] });
    expect(r.theoId.get(pcLop.id)).toBeUndefined();
    const huy = r.trucDaHuy.find((t) => t.id === dutyId)!;
    expect(huy).toMatchObject({ userId: gv, ngay: T7, shiftCode: "T", ten: "GV A lt" });
    expect(huy.dieuChinh[0]).toMatchObject({ nguon: "HUY_TRUC" });
    expect(huy.dieuChinh[0]!.lyDo).toContain("GV chỉ dạy bù");

    const don = await db.workRequest.create({
      data: { requesterId: gv2, centerId: cs, kind: "SUB_TEACH", status: "APPROVED", reason: "GV chính ốm", reviewedByName: "QLCS lt", reviewedAt: vn("2026-11-06", "08:00") },
      select: { id: true },
    });
    await db.sessionStaffAssignment.update({ where: { id: pcLop.id }, data: { sourceWorkRequestId: don.id } });
    await db.sessionStaffAssignment.update({ where: { id: pcBu.id }, data: { assignmentType: "CUTOVER" } });
    r = await ld.docDieuChinh({ centerId: cs, tu: T2, den: CN, assignmentIds: [pcLop.id, pcBu.id], dutyIds: [] });
    expect(r.theoId.get(pcLop.id)).toEqual([
      { nguon: "DON_TU", lyDo: "GV chính ốm", nguoiYeuCau: "GV B lt (CS1)", nguoiDuyet: "QLCS lt", luc: vn("2026-11-06", "08:00").toISOString(), truocSau: "Dạy thay", maThamChieu: don.id },
    ]);
    expect(r.theoId.get(pcBu.id)).toEqual([{ nguon: "CHUYEN_DOI", lyDo: null, nguoiYeuCau: null, nguoiDuyet: null, luc: null, truocSau: null, maThamChieu: pcBu.id }]);
    await db.workRequest.delete({ where: { id: don.id } }).catch(() => undefined);
    await huyBu(c);
    await db.classSession.update({ where: { id: lop.sessionId }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: lop.sessionId }], "HUY_BUOI", actor);
  });
});
