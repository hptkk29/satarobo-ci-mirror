// [P5-DB-*] — WorkUnit + WorkConfirmation trên Postgres THẬT (P5a). Thuần: lib/parttime/workunit.test.ts.
// Chạy: TEST_DATABASE_URL=postgresql://…/satarobo_test… pnpm test:cham-cong-db
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-workunit] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ dem: 0 }));
// ⚠️ GĐ6 (05/11/2026): bộ này ghim LUỒNG XÁC NHẬN TAY của QLCS (luật CŨ) trên ngày tháng 11/2026 ⇒ cờ theo kỳ
// `shift.parttimeLuatCongMoiTuKy` được đặt `2099-01` để các kỳ ở đây đi luật cũ (đường mã y hệt kỳ 10/2026). Hai vế cờ ở cấu hình MẶC
// ĐỊNH (2026-11, KHÔNG mock) canh ở `tests/cham-cong/phan-cong-gop-chot-ky.spec.ts` [CK-DB-*] + `lib/parttime/workunit.test.ts` [P5-GATE-05].
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : key === "shift.parttimeLuatCongMoiTuKy" ? "2099-01" : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
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

const TAG = "p5wu";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[P5-DB] WorkUnit + xác nhận thực hiện — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let cs1 = "";
  let gv = "";
  let gv2 = "";
  let ta = "";
  let ql = "";
  let khoa = "";
  let bai = "";
  const actor = { id: null as string | null, name: "QLCS p5" };

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
    const pcs = await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const pcIds = pcs.map((p) => p.id);
    const wus = await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { OR: [{ entityType: "SessionStaffAssignment", entityId: { in: pcIds } }, { entityType: "WorkUnit", entityId: { in: wus.map((w) => w.id) } }] } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    if (pcIds.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER "WorkConfirmation_bat_bien"`,
        db.workConfirmation.deleteMany({ where: { assignmentId: { in: pcIds } } }),
        db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER "WorkConfirmation_bat_bien"`,
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
    }
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.teacherRankHistory.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    const tcs = await db.trialClassV2.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
    await db.trialClassSession.deleteMany({ where: { trialClassId: { in: tcs.map((t) => t.id) } } });
    await db.trialClassV2.deleteMany({ where: { id: { in: tcs.map((t) => t.id) } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    if (cs1) await db.attendancePeriod.deleteMany({ where: { centerId: cs1 } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    wu = await import("../../lib/parttime/workunit-db");
    cs1 = (await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS p5", address: "x", code: `${TAG}-cs1` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs1`, name: "ĐV p5", path: `/${TAG}-cs1/`, depth: 0, centerId: cs1 } });
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV p5")).id;
    gv2 = (await mk("gv2", "GV2 p5")).id;
    ta = (await mk("ta", "TA p5")).id;
    ql = (await mk("ql", "QL p5")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 p5", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT p5" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  const lopMoi = async (p: { teacherId?: string; assistantId?: string | null; startTime?: string; endTime?: string } = {}) => {
    soLop++;
    return (
      await db.class.create({
        data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: cs1, teacherId: p.teacherId ?? gv, assistantId: p.assistantId ?? null, startTime: p.startTime ?? "18:00", endTime: p.endTime ?? "19:30" },
        select: { id: true },
      })
    ).id;
  };
  const buoiMoi = (classId: string, ymd: string, gio = "18:00", p: { substituteTeacherId?: string | null } = {}) =>
    db.classSession.create({ data: { classId, centerId: cs1, status: "SCHEDULED", date: vn(ymd, gio), substituteTeacherId: p.substituteTeacherId ?? null }, select: { id: true } });
  type Nguon = { sourceType: "CLASS_SESSION" | "MAKEUP_CASE" | "TRIAL_SESSION"; sourceId: string };
  const dong = (ds: Nguon[]) => dongBo.dongBoNgay(ds, "TAO_BUOI", actor);
  const quet = (userId: string, ymd: string, direction: "CHECK_IN" | "CHECK_OUT", hhmm: string) =>
    db.staffTimeLog.create({ data: { userId, centerId: cs1, direction, loggedAt: vn(ymd, hhmm), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED", reviewStatus: "PENDING" }, select: { id: true } });
  const coMatDu = async (userId: string, ymd: string) => {
    await quet(userId, ymd, "CHECK_IN", "17:45");
    return quet(userId, ymd, "CHECK_OUT", "19:35");
  };
  /** Buổi lớp 18:00–19:30 đã chạy: phân + nhận + chốt (thực dạy = GV lớp, hoặc `thucDay`). */
  const buoiDaDay = async (ymd: string, p: { teacherId?: string; assistantId?: string | null; thucDay?: string; substituteTeacherId?: string | null; startTime?: string; endTime?: string } = {}) => {
    const s = await buoiMoi(await lopMoi(p), ymd, p.startTime ?? "18:00", { substituteTeacherId: p.substituteTeacherId });
    await dong([{ sourceType: "CLASS_SESSION", sourceId: s.id }]);
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: p.thucDay ?? p.substituteTeacherId ?? p.teacherId ?? gv } });
    return s.id;
  };
  const doc = (ymd: string, now = vn(ymd, "22:00")) => wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now });
  const dongCua = async (ymd: string, sourceId: string, userId: string, now?: Date) => (await doc(ymd, now)).dong.find((r) => r.bc.sourceId === sourceId && r.bc.userId === userId);
  // Mỗi lượt quyết một mốc RIÊNG, tăng dần: "xác nhận mới nhất" sắp theo decidedAt — mốc trùng là thứ tự may rủi.
  let nhip = 0;
  const xn = (
    r: { bc: { assignmentId: string; assignmentVersion: number; dauVan: string } },
    p: { quyetDinh?: "CONFIRMED" | "REJECTED" | "NEEDS_INFO"; lyDo?: string | null; nguoi?: string; hangLoat?: boolean; now?: Date } = {},
  ) =>
    wu.xacNhanThucHien({
      assignmentId: r.bc.assignmentId,
      phienBanDaXem: r.bc.assignmentVersion,
      dauVanDaXem: r.bc.dauVan,
      quyetDinh: p.quyetDinh ?? "CONFIRMED",
      lyDo: p.lyDo ?? null,
      hangLoat: p.hangLoat ?? false,
      actor: { id: p.nguoi ?? ql, name: "QL p5" },
      now: p.now ?? new Date(Date.UTC(2026, 11, 31) + ++nhip * 1000),
    });
  const donViCua = (assignmentId: string) => db.workUnit.findMany({ where: { assignmentId }, orderBy: { createdAt: "asc" } });

  it("[P5-DB-01] đứng chính thường: xác nhận ⇒ MỘT WorkConfirmation bất biến + MỘT WorkUnit 1 × 100' · Rank 1 mặc định · ảnh chụp chính sách + dấu vân", async () => {
    const ngay = "2026-11-02";
    const s = await buoiDaDay(ngay);
    await coMatDu(gv, ngay);
    const r = (await dongCua(ngay, s, gv))!;
    expect(r.ungVien).toMatchObject({ lop: "TU_DONG", loai: "MAIN_TEACHING" });
    const kq = await xn(r, { hangLoat: true });
    expect(kq).toMatchObject({ ok: true, daCo: false });
    const ds = await donViCua(r.bc.assignmentId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      userId: gv, centerId: cs1, workUnitType: "MAIN_TEACHING", role: "MAIN_TEACHER", activityType: "REGULAR_CLASS", assignmentType: "SYSTEM",
      standardMinutes: 100, rankSnapshot: 1, rateSnapshot: 120000, policyVersionId: "cpv_sr_qd_238", evidenceFingerprint: r.bc.dauVan, evidenceStatus: "DU_BANG_CHUNG", status: "CONFIRMED", confirmedById: ql,
    });
    expect(ds[0].quantity.toString()).toBe("1");
    const xnRows = await db.workConfirmation.findMany({ where: { assignmentId: r.bc.assignmentId } });
    expect(xnRows.map((x) => [x.decision, x.evidenceFingerprint, x.id === ds[0].confirmationId])).toEqual([["CONFIRMED", r.bc.dauVan, true]]);
    // Bất biến ở tầng DB.
    await expect(db.workConfirmation.update({ where: { id: xnRows[0].id }, data: { reason: "sửa" } })).rejects.toThrow(/WC_IMMUTABLE/);
    expect((await db.auditLog.findMany({ where: { entityType: "WorkUnit", entityId: ds[0].id } })).map((a) => a.action)).toEqual(["PT_WORKUNIT_CREATED"]);
    // Sau khi đọc lại: đơn vị hiệu lực, không cũ.
    expect((await dongCua(ngay, s, gv))!.donVi).toMatchObject({ hieuLuc: "CONFIRMED", lyDoCu: null });
  });

  it("[P5-DB-02][P5-DB-03] DẠY THAY: B (người thay) nhận đơn vị MAIN_TEACHING · assignmentType SUBSTITUTE; A (GV lớp) không có dòng nào để xác nhận", async () => {
    const ngay = "2026-11-03";
    // Đường thật: A được phân (đã gán), SAU ĐÓ buổi có người thay B ⇒ đồng bộ THAY phân công của A (REPLACED), B được gán.
    const s = (await buoiMoi(await lopMoi({ teacherId: gv }), ngay)).id;
    await dong([{ sourceType: "CLASS_SESSION", sourceId: s }]);
    await db.classSession.update({ where: { id: s }, data: { substituteTeacherId: gv2 } });
    await dong([{ sourceType: "CLASS_SESSION", sourceId: s }]);
    await db.classSession.update({ where: { id: s }, data: { status: "COMPLETED", actualTeacherId: gv2 } });
    expect((await db.sessionStaffAssignment.findMany({ where: { sourceId: s, role: "MAIN_TEACHER" }, orderBy: { createdAt: "asc" } })).map((x) => [x.userId === gv ? "A" : "B", x.status])).toEqual([
      ["A", "REPLACED"],
      ["B", "ACCEPTED"],
    ]);
    await coMatDu(gv2, ngay);
    await coMatDu(gv, ngay); // A cũng có mặt ở cơ sở — vẫn không được gì
    const ds = (await doc(ngay)).dong.filter((r) => r.bc.sourceId === s);
    expect(ds.map((r) => [r.bc.userId === gv2 ? "B" : "A", r.ungVien.lop])).toEqual([["B", "TU_DONG"]]);
    expect(await xn(ds[0])).toMatchObject({ ok: true });
    expect((await db.workUnit.findMany({ where: { sourceId: s } })).map((w) => [w.userId === gv2 ? "B" : "A", w.workUnitType, w.assignmentType])).toEqual([["B", "MAIN_TEACHING", "SUBSTITUTE"]]);
  });

  it("[P5-DB-04] HỌC BÙ đứng chính ⇒ MAIN_TEACHING · activityType MAKEUP (không lối tắt riêng)", async () => {
    const ngay = "2026-11-04";
    const c = await db.makeupCase.create({
      data: { centerId: cs1, courseId: khoa, lessonId: bai, date: new Date(`${ngay}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv, status: "SCHEDULED", createdById: gv },
      select: { id: true },
    });
    await dong([{ sourceType: "MAKEUP_CASE", sourceId: c.id }]);
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    await coMatDu(gv, ngay);
    const r = (await dongCua(ngay, c.id, gv))!;
    expect(r.ungVien.lop).toBe("TU_DONG");
    expect(await xn(r)).toMatchObject({ ok: true });
    expect(await db.workUnit.findMany({ where: { sourceId: c.id } })).toMatchObject([{ workUnitType: "MAIN_TEACHING", activityType: "MAKEUP", sourceType: "MAKEUP_CASE" }]);
    // NO_SHOW (mọi bé vắng) ⇒ xem tay, không tự động.
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "NO_SHOW" } });
    expect((await dongCua(ngay, c.id, gv))!.ungVien).toMatchObject({ lop: "XEM_TAY", lyDo: ["HOC_BU_VANG_MAT"] });
  });

  it("[P5-DB-05] TRỢ GIẢNG ⇒ ASSISTANT_TEACHING 1 × 100' · 80.000đ, không cần khớp thực dạy", async () => {
    const ngay = "2026-11-05";
    const s = await buoiDaDay(ngay, { assistantId: ta });
    await coMatDu(ta, ngay);
    const r = (await dongCua(ngay, s, ta))!;
    expect(await xn(r)).toMatchObject({ ok: true });
    const [w] = await donViCua(r.bc.assignmentId);
    expect(w).toMatchObject({ workUnitType: "ASSISTANT_TEACHING", role: "TEACHING_ASSISTANT", standardMinutes: 100, rateSnapshot: 80000, rankSnapshot: null });
  });

  it("[P5-DB-06] TRIAL không thành tiết đứng chính — xác nhận bị từ chối, không sinh đơn vị", async () => {
    const ngay = "2026-11-06";
    const tc = await db.trialClassV2.create({ data: { code: `${TAG}-tc`, name: "Trial p5", centerId: cs1, sessionCount: 1 }, select: { id: true } });
    const t = await db.trialClassSession.create({ data: { trialClassId: tc.id, seq: 1, date: new Date(`${ngay}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv }, select: { id: true } });
    await dong([{ sourceType: "TRIAL_SESSION", sourceId: t.id }]);
    await coMatDu(gv, ngay);
    const r = (await dongCua(ngay, t.id, gv))!;
    expect(r.ungVien).toMatchObject({ lop: "KHONG_AP_DUNG", lyDo: ["TRIAL_TACH_RIENG"], loai: null });
    expect(await xn(r)).toMatchObject({ ok: false });
    expect(await db.workUnit.count({ where: { sourceId: t.id } })).toBe(0);
  });

  it("[P5-DB-07][P5-DB-08] không bằng chứng / sai người đứng lớp ⇒ không sinh đơn vị (kể cả có lý do)", async () => {
    const ngay = "2026-11-07";
    const khongCoMat = await buoiDaDay(ngay);
    const r1 = (await dongCua(ngay, khongCoMat, gv))!;
    expect(r1.ungVien.lop).toBe("CHAN");
    expect(await xn(r1, { lyDo: "QLCS thấy có dạy" })).toMatchObject({ ok: false });
    const lech = await buoiDaDay(ngay, { startTime: "14:00", endTime: "15:30", thucDay: gv2 });
    await quet(gv, ngay, "CHECK_IN", "13:40");
    await quet(gv, ngay, "CHECK_OUT", "15:40");
    const r2 = (await dongCua(ngay, lech, gv))!;
    expect(r2.ungVien).toMatchObject({ lop: "CHAN", lyDo: ["SAI_NGUOI_DUNG_LOP"] });
    expect(await xn(r2, { lyDo: "xác nhận đại cho xong" })).toMatchObject({ ok: false });
    expect(await db.workUnit.count({ where: { sourceId: { in: [khongCoMat, lech] } } })).toBe(0);
  });

  it("[P5-DB-09] bấm lại + hai lượt CÙNG LÚC ⇒ đúng MỘT đơn vị sống", async () => {
    const ngay = "2026-11-09";
    const s = await buoiDaDay(ngay);
    await coMatDu(gv, ngay);
    const r = (await dongCua(ngay, s, gv))!;
    const [a, b] = await Promise.all([xn(r), xn(r)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await xn(r)).toMatchObject({ ok: true, daCo: true });
    expect(await db.workUnit.count({ where: { assignmentId: r.bc.assignmentId, status: { not: "VOIDED" } } })).toBe(1);
  });

  it("[P5-DB-10] lịch đổi SAU khi xác nhận ⇒ đơn vị CŨ (đọc thấy ngay, đánh dấu được); nhận lại + xác nhận lại ⇒ cũ VOIDED, mới CONFIRMED", async () => {
    const ngay = "2026-11-10";
    const s = await buoiDaDay(ngay);
    await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "21:00");
    const r = (await dongCua(ngay, s, gv))!;
    expect(await xn(r)).toMatchObject({ ok: true });
    // Buổi đã chốt thì bộ đồng bộ không đụng phân công ⇒ đường thật: quản trị MỞ LẠI buổi rồi dời giờ.
    await db.classSession.update({ where: { id: s }, data: { status: "SCHEDULED", date: vn(ngay, "19:00") } });
    await dong([{ sourceType: "CLASS_SESSION", sourceId: s }]);
    const sau = (await dongCua(ngay, s, gv))!;
    expect(sau.bc.assignmentVersion).toBe(2);
    expect(sau.donVi).toMatchObject({ hieuLuc: "STALE", lyDoCu: "PHIEN_BAN_DOI", status: "CONFIRMED" });
    expect(await wu.danhDauDonViCu({ centerId: cs1, tu: ngay, den: ngay, now: vn(ngay, "22:00"), actor: { id: ql, name: "QL" } })).toBe(1);
    expect(await wu.danhDauDonViCu({ centerId: cs1, tu: ngay, den: ngay, now: vn(ngay, "22:00"), actor: { id: ql, name: "QL" } })).toBe(0);
    expect((await donViCua(r.bc.assignmentId)).map((w) => [w.assignmentVersion, w.status, w.staleReason])).toEqual([[1, "STALE", "PHIEN_BAN_DOI"]]);
    await db.classSession.update({ where: { id: s }, data: { status: "COMPLETED" } });
    const moi = (await dongCua(ngay, s, gv))!;
    expect(moi.ungVien.lop).toBe("TU_DONG");
    expect(await xn(moi)).toMatchObject({ ok: true, daCo: false });
    expect((await donViCua(r.bc.assignmentId)).map((w) => [w.assignmentVersion, w.status])).toEqual([
      [1, "VOIDED"],
      [2, "CONFIRMED"],
    ]);
  });

  it("[P5-DB-10b] BẰNG CHỨNG đổi sau khi xác nhận (lượt bị gỡ) ⇒ CŨ BANG_CHUNG_DOI", async () => {
    const ngay = "2026-11-11";
    const s = await buoiDaDay(ngay);
    const vao = await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    const r = (await dongCua(ngay, s, gv))!;
    expect(await xn(r)).toMatchObject({ ok: true });
    await db.staffTimeLog.update({ where: { id: vao.id }, data: { reviewStatus: "DISMISSED" } });
    expect((await dongCua(ngay, s, gv))!.donVi).toMatchObject({ hieuLuc: "STALE", lyDoCu: "BANG_CHUNG_DOI" });
  });

  it("[P5-DB-FP] dấu vân P4 ỔN ĐỊNH theo thời gian và lượt của người khác; đổi khi lượt của chính người đó đổi", async () => {
    const ngay = "2026-11-12";
    const s = await buoiDaDay(ngay);
    const ra = await coMatDu(gv, ngay);
    const a = (await dongCua(ngay, s, gv, vn(ngay, "20:30")))!.bc.dauVan;
    const b = (await dongCua(ngay, s, gv, new Date(vn(ngay, "19:30").getTime() + 3 * 86_400_000)))!.bc.dauVan;
    await coMatDu(gv2, ngay);
    const c = (await dongCua(ngay, s, gv))!.bc.dauVan;
    expect([b, c]).toEqual([a, a]);
    await db.staffTimeLog.update({ where: { id: ra.id }, data: { loggedAt: vn(ngay, "19:40") } });
    expect((await dongCua(ngay, s, gv))!.bc.dauVan).not.toBe(a);
  });

  it("[P5-DB-11] ngày LEGACY (trước 15/10): phân công + nhận + chấm công đủ vẫn KHÔNG_AP_DUNG, không sinh đơn vị", async () => {
    const ngay = "2026-10-13";
    const s = await buoiMoi(await lopMoi(), ngay);
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: gv } });
    // Sync không dựng phân công cho ngày LEGACY ⇒ dựng tay (như dữ liệu chuyển đổi) để dòng TỒN TẠI — khẳng định không rỗng.
    const pc = await db.sessionStaffAssignment.create({
      data: { sourceType: "CLASS_SESSION", sourceId: s.id, centerId: cs1, ngay: new Date(`${ngay}T00:00:00Z`), gioBatDau: "18:00", gioKetThuc: "19:30", userId: gv, role: "MAIN_TEACHER", activityType: "REGULAR_CLASS", assignmentType: "MANUAL", nguonGiao: "TAY", status: "ACCEPTED" },
    });
    await db.staffAssignmentAcceptance.create({ data: { assignmentId: pc.id, assignmentVersion: 1, userId: gv, decision: "ACCEPTED", roleSnapshot: "MAIN_TEACHER", scheduleSnapshot: {}, requestedAt: new Date(), centerId: cs1 } });
    await coMatDu(gv, ngay);
    const r = (await dongCua(ngay, s.id, gv))!;
    expect(r.ungVien).toMatchObject({ lop: "KHONG_AP_DUNG", lyDo: ["LEGACY"] });
    expect(await xn(r)).toMatchObject({ ok: false });
    expect(await db.workUnit.count({ where: { assignmentId: pc.id } })).toBe(0);
  });

  it("[P5-DB-12] thời lượng KHÔNG chuẩn (lớp 60') ⇒ CHAN, không xác nhận được kể cả có lý do (Q1 còn mở)", async () => {
    const ngay = "2026-11-13";
    const s = await buoiDaDay(ngay, { endTime: "19:00" });
    await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:05");
    const r = (await dongCua(ngay, s, gv))!;
    expect(r.ungVien).toMatchObject({ lop: "CHAN", lyDo: ["THOI_LUONG_KHONG_CHUAN"], thoiLuongDayPhut: 60 });
    expect(await xn(r, { lyDo: "QLCS xác nhận có dạy" })).toMatchObject({ ok: false });
    expect(await db.workUnit.count({ where: { sourceId: s } })).toBe(0);
  });

  it("[P5-DB-13] RANK ảnh chụp tại ngày làm; thêm lịch sử Rank SAU KHI xác nhận KHÔNG viết lại đơn vị cũ", async () => {
    const ngay = "2026-11-16";
    await db.teacherRankHistory.create({ data: { userId: gv, rank: 2, effectiveFrom: new Date("2026-11-01T00:00:00Z"), reason: "BLĐ duyệt" } });
    await db.teacherRankHistory.create({ data: { userId: gv, rank: 4, effectiveFrom: new Date("2026-11-20T00:00:00Z"), reason: "sau ngày làm — không áp" } });
    const s = await buoiDaDay(ngay);
    await coMatDu(gv, ngay);
    const r = (await dongCua(ngay, s, gv))!;
    expect(await xn(r)).toMatchObject({ ok: true });
    await db.teacherRankHistory.create({ data: { userId: gv, rank: 3, effectiveFrom: new Date("2026-11-10T00:00:00Z"), reason: "bổ sung muộn" } });
    const [w] = await donViCua(r.bc.assignmentId);
    expect([w.rankSnapshot, w.rateSnapshot]).toEqual([2, 140000]);
    expect((await dongCua(ngay, s, gv))!.donVi?.hieuLuc).toBe("CONFIRMED");
    await db.teacherRankHistory.deleteMany({ where: { userId: gv } });
  });

  it("[P5-DB-14] cổng: tự xác nhận công của mình · ngoại lệ không lý do · hàng loạt dòng ngoại lệ ⇒ từ chối, không ghi gì", async () => {
    const ngay = "2026-11-17";
    const s = await buoiDaDay(ngay);
    await quet(gv, ngay, "CHECK_IN", "17:58"); // muộn 8'
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    const r = (await dongCua(ngay, s, gv))!;
    expect(r.ungVien).toMatchObject({ lop: "XEM_TAY", lyDo: ["DI_MUON"] });
    expect(await xn(r, { nguoi: gv, lyDo: "tự xác nhận" })).toMatchObject({ ok: false });
    expect(await xn(r)).toMatchObject({ ok: false });
    expect(await xn(r, { hangLoat: true })).toMatchObject({ ok: false });
    expect(await xn(r, { hangLoat: true, lyDo: "lý do đủ dài vẫn không được" })).toMatchObject({ ok: false });
    expect(await db.workConfirmation.count({ where: { assignmentId: r.bc.assignmentId } })).toBe(0);
    // Có lý do ⇒ được; đơn vị vẫn là 1 tiết (muộn KHÔNG giảm quantity — điều chỉnh tiền là P5c).
    expect(await xn(r, { lyDo: "GV báo kẹt xe, đã dạy đủ" })).toMatchObject({ ok: true });
    const [w] = await donViCua(r.bc.assignmentId);
    expect([w.quantity.toString(), w.standardMinutes, w.evidenceStatus]).toEqual(["1", 100, "DI_MUON"]);
  });

  it("[P5-DB-15] TỪ CHỐI sau khi đã xác nhận ⇒ đơn vị VOIDED (không xoá), có audit; NEEDS_INFO không đụng đơn vị", async () => {
    const ngay = "2026-11-18";
    const s = await buoiDaDay(ngay);
    await coMatDu(gv, ngay);
    const r = (await dongCua(ngay, s, gv))!;
    await xn(r);
    expect(await xn(r, { quyetDinh: "NEEDS_INFO", lyDo: "Bổ sung ảnh lớp" })).toMatchObject({ ok: true, workUnitId: null });
    expect((await donViCua(r.bc.assignmentId)).map((w) => w.status)).toEqual(["CONFIRMED"]);
    expect(await xn(r, { quyetDinh: "REJECTED", lyDo: "Không đúng người dạy" })).toMatchObject({ ok: true });
    const ds = await donViCua(r.bc.assignmentId);
    expect(ds.map((w) => [w.status, w.voidReason])).toEqual([["VOIDED", "QLCS từ chối"]]);
    expect((await db.workConfirmation.findMany({ where: { assignmentId: r.bc.assignmentId }, orderBy: { decidedAt: "asc" } })).map((x) => x.decision)).toEqual(["CONFIRMED", "NEEDS_INFO", "REJECTED"]);
  });

  it("[P5-DB-16] KỲ CÔNG KHOÁ: không xác nhận được; đơn vị đã có KHÔNG bị coi là cũ dù bằng chứng đổi", async () => {
    const ngay = "2026-12-01";
    const s = await buoiDaDay(ngay);
    const vao = await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    const r = (await dongCua(ngay, s, gv))!;
    expect(await xn(r)).toMatchObject({ ok: true });
    await db.attendancePeriod.create({ data: { centerId: cs1, periodKey: "2026-12", status: "LOCKED" } });
    await db.staffTimeLog.update({ where: { id: vao.id }, data: { reviewStatus: "DISMISSED" } });
    const sau = (await dongCua(ngay, s, gv))!;
    expect(sau.kyKhoa).toBe(true);
    expect(sau.donVi).toMatchObject({ hieuLuc: "CONFIRMED", lyDoCu: null });
    expect(await wu.danhDauDonViCu({ centerId: cs1, tu: ngay, den: ngay, now: vn(ngay, "22:00"), actor: { id: ql, name: "QL" } })).toBe(0);
    expect(await xn(sau, { quyetDinh: "REJECTED", lyDo: "thử khi kỳ khoá" })).toMatchObject({ ok: false });
  });

  it("[P5-DB-17] số câu tra của đối soát KHÔNG đổi khi phân công tăng (3 vs 15 buổi)", async () => {
    const mot = "2026-11-23";
    const nhieu = "2026-11-24";
    for (let i = 0; i < 3; i++) await buoiDaDay(mot, { startTime: `${String(8 + i * 2).padStart(2, "0")}:00`, endTime: `${String(9 + i * 2).padStart(2, "0")}:30`, assistantId: ta });
    for (let i = 0; i < 15; i++) await buoiDaDay(nhieu, { startTime: `${String(7 + (i % 12)).padStart(2, "0")}:${i < 12 ? "00" : "30"}`, endTime: `${String(8 + (i % 12)).padStart(2, "0")}:${i < 12 ? "30" : "59"}`, assistantId: ta });
    const dem = async (ngay: string) => {
      ctl.dem = 0;
      const r = await doc(ngay);
      return { so: r.dong.length, cau: ctl.dem };
    };
    const a = await dem(mot);
    const b = await dem(nhieu);
    expect([a.so, b.so]).toEqual([6, 30]);
    expect(b.cau).toBe(a.cau);
  });
});
