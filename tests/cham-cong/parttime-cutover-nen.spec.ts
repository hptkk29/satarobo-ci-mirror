// [Q1-DB-*] [GRACE-DB-*] [CUT-DX] nền cutover Parttime — Postgres THẬT: ghi đè số tiết Q1 (`TeachingUnitPolicyOverride`) đi tới
// WorkUnit qua ĐÚNG đường xác nhận thật; grace Q5 (`assignmentType = CUTOVER` + mốc grace theo cơ sở) qua ĐÚNG đường chấm công
// thật. Thuần: lib/parttime/don-vi-tiet.test.ts · cutover-luat.test.ts · workunit.test.ts [Q1-*] [GRACE-P1].
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-cutover-nen] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

// ⚠️ GĐ6 (05/11/2026): bộ này ghim LUỒNG XÁC NHẬN TAY của QLCS (luật CŨ) trên ngày tháng 11/2026 ⇒ cờ theo kỳ
// `shift.parttimeLuatCongMoiTuKy` được đặt `2099-01` để các kỳ ở đây đi luật cũ (đường mã y hệt kỳ 10/2026). Hai vế cờ ở cấu hình MẶC
// ĐỊNH (2026-11, KHÔNG mock) canh ở `tests/cham-cong/phan-cong-gop-chot-ky.spec.ts` [CK-DB-*] + `lib/parttime/workunit.test.ts` [P5-GATE-05].
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      key === "shift.parttimeLuatCongMoiTuKy" ? "2099-01" : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "cutnen";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const NGL = "CHAM_NGOAI_LICH";
const KHOA_BAT = ["shift.parttimeStaffingEnabled", "shift.parttimeAttendanceContextEnabled", "shift.parttimeWorkUnitShadowEnabled"];

d("[CUTOVER-NEN] Q1 ghi đè số tiết + Q5 grace — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let tl: typeof import("../../lib/cham-cong/timelog");
  let cs = "";
  let ou = "";
  let wl = "";
  let gv = "";
  let gv2 = "";
  let ql = "";
  let khoa = "";
  let soLop = 0;
  const actor = { id: null as string | null, name: "QLCS cutnen" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }
  const datGrace = async (den: string) => {
    await db.centerSetting.deleteMany({ where: { key: "shift.parttimeCutoverGraceDen" } });
    if (den) await db.centerSetting.create({ data: { orgUnitId: ou, key: "shift.parttimeCutoverGraceDen", valueJson: den, updatedByName: TAG } });
  };

  async function cleanup() {
    await db.teachingUnitPolicyOverride.deleteMany({ where: { reason: { startsWith: TAG } } });
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    for (const u of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `attday:${u}:` } } });
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pcIds } } });
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
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
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
    tl = await import("../../lib/cham-cong/timelog");
    const c = await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS cutnen", address: "x", code: `${TAG.toUpperCase()}-CS` }, select: { id: true } });
    const o = await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV cutnen", path: `/${TAG}-cs/`, depth: 0, centerId: c.id }, select: { id: true } });
    const w = await db.workLocation.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { code: `${TAG}-cs`, name: "Quầy cutnen", centerId: c.id, orgUnitId: o.id }, select: { id: true } });
    [cs, ou, wl] = [c.id, o.id, w.id];
    await cleanup();
    for (const key of KHOA_BAT) await db.systemSetting.upsert({ where: { key }, update: { valueJson: true }, create: { key, valueJson: true, updatedByName: TAG } });
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } });
    gv = (await mk("gv", "GV cutnen")).id;
    gv2 = (await mk("gv2", "GV2 cutnen")).id;
    ql = (await mk("ql", "QL cutnen")).id;
    khoa = (await db.course.create({ data: { name: "Sata 3 cutnen", slug: `${TAG}-k` }, select: { id: true } })).id;
  });

  beforeEach(() => datGrace(""));
  afterEach(() => datGrace(""));

  afterAll(async () => {
    await cleanup();
    await db.centerSetting.deleteMany({ where: { orgUnitId: ou } });
    for (const key of KHOA_BAT) await db.systemSetting.deleteMany({ where: { key, updatedByName: TAG } });
    await db.workLocation.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  /** Lớp + một buổi; `kieu` = cách dựng phân công: đồng bộ thường (SYSTEM) hoặc NHẬP cutover (CUTOVER). Cả hai đã gán (ĐẢO 20/10/2026). */
  const lopBuoi = async (ymd: string, p: { batDau?: string; ketThuc?: string; kieu?: "DONG_BO" | "CUTOVER" } = {}) => {
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `CN-L${soLop}`, courseId: khoa, centerId: cs, teacherId: gv, startTime: p.batDau ?? "18:00", endTime: p.ketThuc ?? "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(ymd, p.batDau ?? "18:00") }, select: { id: true } });
    const nguon = { sourceType: "CLASS_SESSION" as const, sourceId: s.id };
    if (p.kieu === "CUTOVER") {
      const r = await db.$transaction((tx) => svc.phanCongVaoBuoi(tx, { nguon, userId: gv, role: "MAIN_TEACHER", assignmentType: "CUTOVER", nguonGiao: "DONG_BO", actor, note: "Nhập lúc chuyển đổi (test)" }));
      if (!r.ok) throw new Error(r.loi);
    } else await dongBo.dongBoNgay([nguon], "TAO_BUOI", actor);
    return { lopId: lop.id, sessionId: s.id };
  };
  /**
   * Lời mời cũ trước 20/10: mọi phân công của buổi về WAITING_ACCEPTANCE. Grace cutover + cờ "chưa nhận" (H1) chỉ còn áp cho
   * dòng cũ chưa nhận — phân công tạo từ 20/10 đã gán ngay.
   */
  const moiCuCuaBuoi = (sessionId: string) => db.sessionStaffAssignment.updateMany({ where: { sourceId: sessionId }, data: { status: "WAITING_ACCEPTANCE" } });
  /** Buổi đã dạy: chốt + có mặt đủ khung. Trả dòng đối soát của GV. */
  const daDay = async (ymd: string, sessionId: string, vao: string, ra: string) => {
    await db.classSession.update({ where: { id: sessionId }, data: { status: "COMPLETED", actualTeacherId: gv } });
    for (const [dir, hhmm] of [["CHECK_IN", vao], ["CHECK_OUT", ra]] as const)
      await db.staffTimeLog.create({ data: { userId: gv, centerId: cs, direction: dir, loggedAt: vn(ymd, hhmm), workDate: ngayDb(ymd), result: "ACCEPTED", reviewStatus: "PENDING" } });
    const now = vn(ymd, "22:30");
    const dong = (await wu.docDoiSoatThucHien({ centerId: cs, tu: ymd, den: ymd, now })).dong.find((r) => r.bc.sourceId === sessionId && r.bc.userId === gv);
    if (!dong) throw new Error("không thấy dòng đối soát");
    return { dong, now };
  };
  const xacNhan = (dong: Awaited<ReturnType<typeof daDay>>["dong"], now: Date) =>
    wu.xacNhanThucHien({ assignmentId: dong.bc.assignmentId, phienBanDaXem: dong.bc.assignmentVersion, dauVanDaXem: dong.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor: { id: ql, name: "QL" }, now });

  it("[Q1-DB-01] buổi 60' KHÔNG ghi đè ⇒ NEEDS_POLICY_DECISION: xác nhận bị từ chối, 0 WorkUnit (không tự thành 0,6 / 0,67 / 1)", async () => {
    const ngay = "2026-11-02";
    const b = await lopBuoi(ngay, { ketThuc: "19:00" });
    const { dong, now } = await daDay(ngay, b.sessionId, "17:48", "19:05");
    expect(dong.ungVien).toMatchObject({ lop: "CHAN", lyDo: expect.arrayContaining(["THOI_LUONG_KHONG_CHUAN"]), thoiLuongDayPhut: 60, donViTiet: { trangThai: "NEEDS_POLICY_DECISION", donVi: null } });
    expect(await xacNhan(dong, now)).toMatchObject({ ok: false });
    expect(await db.workUnit.count({ where: { assignmentId: dong.bc.assignmentId } })).toBe(0);
  });

  it("[Q1-DB-02] buổi 60' CÓ ghi đè lớp 0,67 tiết (đã duyệt) ⇒ TU_DONG; xác nhận ⇒ WorkUnit quantity 0,67 · đơn giá MỘT tiết theo Rank", async () => {
    const ngay = "2026-11-03";
    const b = await lopBuoi(ngay, { ketThuc: "19:00" });
    await db.teachingUnitPolicyOverride.create({
      data: { scopeType: "CLASS", scopeId: b.lopId, effectiveFrom: ngayDb("2026-10-15"), teachingDurationMinutes: 60, teachingUnits: "0.67", policyVersionId: "cpv_sr_qd_238", reason: `${TAG} lớp 60' (fixture — không phải số thật)`, approvedAt: new Date("2026-10-18T00:00:00Z") },
    });
    const { dong, now } = await daDay(ngay, b.sessionId, "17:48", "19:05");
    expect(dong.ungVien).toMatchObject({ lop: "TU_DONG", donViTiet: { trangThai: "GHI_DE", donVi: "0.67" } });
    const r = await xacNhan(dong, now);
    expect(r).toMatchObject({ ok: true });
    const w = await db.workUnit.findFirstOrThrow({ where: { assignmentId: dong.bc.assignmentId, status: "CONFIRMED" } });
    expect(w.quantity.toFixed(2)).toBe("0.67");
    expect(w.rateSnapshot).toBe(120000); // Rank 1 mặc định (PL01: 120.000đ) — đơn giá MỘT tiết, không nhân thời lượng
    expect(w.standardMinutes).toBe(100);
  });

  it("[Q1-DB-03] CHECK ở DB: số tiết 0 hoặc > 4, lý do quá ngắn ⇒ bị từ chối", async () => {
    const base = { scopeType: "COURSE" as const, scopeId: khoa, effectiveFrom: ngayDb("2026-10-15"), policyVersionId: "cpv_sr_qd_238", approvedAt: new Date() };
    await expect(db.teachingUnitPolicyOverride.create({ data: { ...base, teachingUnits: "0", reason: `${TAG} số 0` } })).rejects.toThrow();
    await expect(db.teachingUnitPolicyOverride.create({ data: { ...base, teachingUnits: "5", reason: `${TAG} số 5` } })).rejects.toThrow();
    await expect(db.teachingUnitPolicyOverride.create({ data: { ...base, teachingUnits: "1", reason: "x" } })).rejects.toThrow();
  });

  it("[GRACE-DB-01] nhập cutover là lời mời CŨ chưa xác nhận, trong grace ⇒ chấm công không cờ ngoài lịch; KHÔNG có xác nhận nào; ứng viên CUTOVER_GRACE (không đơn vị)", async () => {
    const ngay = "2026-11-04";
    await datGrace("2026-11-10");
    const b = await lopBuoi(ngay, { kieu: "CUTOVER" });
    expect((await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: b.sessionId } })).status).toBe("ACCEPTED");
    await moiCuCuaBuoi(b.sessionId); // lời mời cũ trước 20/10 — grace chỉ áp cho CUTOVER còn chờ nhận
    const pc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: b.sessionId } });
    expect(pc).toMatchObject({ assignmentType: "CUTOVER", status: "WAITING_ACCEPTANCE" });
    const r = await tl.recordTimeLog({ userId: gv, workLocationId: wl, direction: "CHECK_IN", now: vn(ngay, "17:47") });
    if (!r.ok) throw new Error(r.error);
    expect(r.flags).not.toContain(NGL);
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: pc.id } })).toBe(0);
    const { dong, now } = await daDay(ngay, b.sessionId, "17:47", "19:35");
    expect(dong.bc).toMatchObject({ daNhan: false, graceCutover: true });
    expect(dong.ungVien).toMatchObject({ lop: "CHAN", lyDo: expect.arrayContaining(["CUTOVER_GRACE"]) });
    expect(await xacNhan(dong, now)).toMatchObject({ ok: false });
    expect(await db.workUnit.count({ where: { assignmentId: pc.id } })).toBe(0);
  });

  it("[GRACE-DB-02] phân công THƯỜNG lời mời CŨ chưa nhận, cùng grace ⇒ VẪN cờ ngoài lịch (grace chỉ cho CUTOVER — luật H1 nguyên vẹn)", async () => {
    const ngay = "2026-11-05";
    await datGrace("2026-11-10");
    await moiCuCuaBuoi((await lopBuoi(ngay)).sessionId); // lời mời cũ trước 20/10
    const r = await tl.recordTimeLog({ userId: gv, workLocationId: wl, direction: "CHECK_IN", now: vn(ngay, "17:47") });
    if (!r.ok) throw new Error(r.error);
    expect(r.flags).toContain(NGL);
  });

  it("[GRACE-DB-03] nhập cutover (lời mời CŨ chưa nhận) QUÁ mốc grace (hoặc không khai grace) ⇒ cờ ngoài lịch như phân công chưa nhận", async () => {
    await datGrace("2026-11-05");
    const n1 = "2026-11-06";
    await moiCuCuaBuoi((await lopBuoi(n1, { kieu: "CUTOVER" })).sessionId); // lời mời cũ trước 20/10
    const r1 = await tl.recordTimeLog({ userId: gv, workLocationId: wl, direction: "CHECK_IN", now: vn(n1, "17:47") });
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.flags).toContain(NGL);
    await datGrace("");
    const n2 = "2026-11-07";
    await moiCuCuaBuoi((await lopBuoi(n2, { kieu: "CUTOVER" })).sessionId); // lời mời cũ trước 20/10
    const r2 = await tl.recordTimeLog({ userId: gv, workLocationId: wl, direction: "CHECK_IN", now: vn(n2, "17:47") });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.flags).toContain(NGL);
  });

  it("[CUT-DX] lớp đổi GV mặc định ⇒ phân công CUTOVER được THAY như phân công hệ thống (không bị coi là phân tay)", async () => {
    const ngay = "2026-11-09";
    const b = await lopBuoi(ngay, { kieu: "CUTOVER" });
    await db.class.update({ where: { id: b.lopId }, data: { teacherId: gv2 } });
    const kq = await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: b.sessionId }], "SUA_LOP", actor);
    expect(kq.ngoaiLe).toBe(0);
    const ds = await db.sessionStaffAssignment.findMany({ where: { sourceId: b.sessionId }, select: { userId: true, status: true } });
    expect(ds).toEqual(expect.arrayContaining([{ userId: gv, status: "REPLACED" }, { userId: gv2, status: "ACCEPTED" }]));
  });
});
