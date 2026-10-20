// [CUT-DB-*] [SHADOW-DB-*] công cụ chuyển đổi + chạy bóng Parttime — Postgres THẬT, qua ĐÚNG hàm mà `scripts/parttime-cutover.ts`
// gọi (`docCutover` / `nhapCutover` / `chayBong`). Thuần: lib/parttime/cutover.test.ts · chay-bong.test.ts · cutover-cong-cu.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-cutover-cong-cu] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "cutcc";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

d("[CUT-DB] công cụ cutover + chạy bóng — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let cd: typeof import("../../lib/parttime/cutover-db");
  let cb: typeof import("../../lib/parttime/chay-bong-db");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  const cs = { A: "", B: "" };
  const ma = { A: `${TAG.toUpperCase()}-A`, B: `${TAG.toUpperCase()}-B` };
  let gv = "";
  let gv2 = "";
  let khoa = "";
  const lop: Record<string, { lopId: string; sessionId: string }> = {};
  const actor = { id: null as string | null, name: "Công cụ cutcc" };
  const TU = "2026-11-16";

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  async function cleanup() {
    await db.auditLog.deleteMany({ where: { action: "PT_CUTOVER_IMPORT_BATCH", entityId: { startsWith: `cutover:${TAG}` } } });
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pcIds } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
    ]);
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classStaffingRequirement.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  const taoLop = async (ten: string, p: { co: "A" | "B"; batDau?: string; ketThuc?: string; gv?: string | null; ta?: string | null; ngay?: string; status?: "SCHEDULED" | "COMPLETED" }) => {
    const l = await db.class.create({
      data: { name: `${TAG} ${ten}`, classCode: `${TAG}-${ten}`, courseId: khoa, centerId: cs[p.co], teacherId: p.gv === undefined ? gv : p.gv, assistantId: p.ta ?? null, startTime: p.batDau ?? "18:00", endTime: p.ketThuc ?? "19:30", status: "ACTIVE" },
      select: { id: true },
    });
    const s = await db.classSession.create({ data: { classId: l.id, centerId: cs[p.co], status: p.status ?? "SCHEDULED", date: vn(p.ngay ?? TU, p.batDau ?? "18:00") }, select: { id: true } });
    lop[ten] = { lopId: l.id, sessionId: s.id };
    return lop[ten]!;
  };
  const demGhi = async () => ({ pc: await db.sessionStaffAssignment.count(), xn: await db.staffAssignmentAcceptance.count(), wu: await db.workUnit.count(), wc: await db.workConfirmation.count(), ca: await db.compensationAdjustment.count() });
  const theoLop = (kq: Awaited<ReturnType<typeof cd.docCutover>>, ten: string) => kq.ketQua.find((k) => k.sessionId === lop[ten]!.sessionId)!;

  beforeAll(async () => {
    await damBaoChinhSach();
    cd = await import("../../lib/parttime/cutover-db");
    cb = await import("../../lib/parttime/chay-bong-db");
    svc = await import("../../lib/parttime/phan-cong-db");
    for (const k of ["A", "B"] as const) {
      const c = await db.center.upsert({ where: { slug: `${TAG}-${k.toLowerCase()}` }, update: {}, create: { slug: `${TAG}-${k.toLowerCase()}`, name: `CS ${k}`, address: "x", code: ma[k] }, select: { id: true } });
      await db.orgUnit.upsert({ where: { code: `${TAG}-${k.toLowerCase()}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${k.toLowerCase()}`, name: `ĐV ${k}`, path: `/${TAG}-${k.toLowerCase()}/`, depth: 0, centerId: c.id } });
      cs[k] = c.id;
    }
    await cleanup();
    const mk = (e: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: e, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs.A }, select: { id: true } });
    gv = (await mk("gv")).id;
    gv2 = (await mk("gv2")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 cutcc", slug: `${TAG}-k` }, select: { id: true } })).id;
    await taoLop("CHUAN", { co: "A" });
    await taoLop("SAU_MUOI", { co: "A", batDau: "20:00", ketThuc: "21:00" });
    await taoLop("VUOT_CA", { co: "A", batDau: "09:45", ketThuc: "11:45" });
    await taoLop("KHONG_GV", { co: "A", gv: null });
    const ta = await taoLop("CAN_TA", { co: "A" });
    await db.classStaffingRequirement.create({ data: { classId: ta.lopId, centerId: cs.A, taRequired: true, reason: `${TAG} QLCS bắt buộc TA` } });
    await taoLop("CO_TA", { co: "A", ta: gv2 });
    await taoLop("CO_SO_B", { co: "B" });
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  it("[CUT-DB-01] DRY RUN: phân loại đúng từng buổi, đúng phạm vi cơ sở, KHÔNG một dòng nào được ghi", async () => {
    const truoc = await demGhi();
    const kq = await cd.docCutover({ tu: TU, den: null, maCoSo: [ma.A] });
    expect(await demGhi()).toEqual(truoc);
    expect(kq.ketQua.map((k) => k.sessionId).sort()).toEqual(["CHUAN", "SAU_MUOI", "VUOT_CA", "KHONG_GV", "CAN_TA", "CO_TA"].map((t) => lop[t]!.sessionId).sort());
    expect(theoLop(kq, "CHUAN")).toMatchObject({ nhom: "READY_TO_IMPORT", nhan: [], chinhSach: "CHUAN", seNhap: [{ role: "MAIN_TEACHER", userId: gv }] });
    expect(theoLop(kq, "SAU_MUOI")).toMatchObject({ nhom: "READY_TO_IMPORT", nhan: ["NON_STANDARD_DURATION"], chinhSach: "NEEDS_POLICY_DECISION", thoiLuongDayPhut: 60 });
    expect(theoLop(kq, "VUOT_CA")).toMatchObject({ nhan: ["NON_STANDARD_DURATION", "AMBIGUOUS_SHIFT"], thoiLuongDayPhut: 120 });
    expect(theoLop(kq, "KHONG_GV")).toMatchObject({ nhom: "MISSING_MAIN", seNhap: [] });
    expect(theoLop(kq, "CAN_TA")).toMatchObject({ nhom: "READY_TO_IMPORT", nhan: ["MISSING_TA"], yeuCauTA: "OVERRIDDEN_REQUIRED" });
    expect(theoLop(kq, "CO_TA").seNhap).toEqual([{ role: "MAIN_TEACHER", userId: gv }, { role: "TEACHING_ASSISTANT", userId: gv2 }]);
  });

  it("[CUT-DB-02] NHẬP: chỉ phân công CUTOVER chờ xác nhận, đúng vai còn thiếu; MISSING_MAIN không nhập; 0 xác nhận (M-CUT-01); có dòng audit lô", async () => {
    const truoc = await demGhi();
    const kq = await cd.docCutover({ tu: TU, den: null, maCoSo: [ma.A] });
    const r = await cd.nhapCutover({ ketQua: kq.ketQua, actor, maLo: `${TAG}1` });
    expect(r).toMatchObject({ soBuoi: 5, soTao: 6, loi: [] });
    const moi = await db.sessionStaffAssignment.findMany({ where: { sourceId: { in: Object.values(lop).map((x) => x.sessionId) } }, select: { sourceId: true, userId: true, role: true, assignmentType: true, status: true } });
    expect(moi).toHaveLength(6);
    expect(new Set(moi.map((m) => `${m.assignmentType}|${m.status}`))).toEqual(new Set(["CUTOVER|WAITING_ACCEPTANCE"]));
    expect(moi.some((m) => m.sourceId === lop.KHONG_GV!.sessionId || m.sourceId === lop.CO_SO_B!.sessionId)).toBe(false);
    const sau = await demGhi();
    expect(sau.xn).toBe(truoc.xn);
    expect(sau.pc - truoc.pc).toBe(6);
    expect(await db.auditLog.count({ where: { action: "PT_CUTOVER_IMPORT_BATCH", entityId: `cutover:${TAG}1` } })).toBe(1);
  });

  it("[CUT-DB-03] chạy lại = KHÔNG đổi gì (idempotent, tiếp tục được); buổi đã nhập ⇒ PENDING_ACCEPTANCE; GV nhận đủ ⇒ ACCEPTED", async () => {
    // Tự nhập (đã nhập ở ca trước thì đây là lượt chạy lại — cũng đúng điều đang kiểm): ca này XANH khi chạy MỘT MÌNH (luật 18).
    await cd.nhapCutover({ ketQua: (await cd.docCutover({ tu: TU, den: null, maCoSo: [ma.A] })).ketQua, actor, maLo: `${TAG}0` });
    const truoc = await demGhi();
    const kq = await cd.docCutover({ tu: TU, den: null, maCoSo: [ma.A] });
    expect(theoLop(kq, "CHUAN")).toMatchObject({ nhom: "PENDING_ACCEPTANCE", seNhap: [] });
    const r = await cd.nhapCutover({ ketQua: kq.ketQua, actor, maLo: `${TAG}2` });
    expect(r.soTao).toBe(0);
    expect((await demGhi()).pc).toBe(truoc.pc);
    const pc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: lop.CHUAN!.sessionId } });
    const n = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: gv, name: "gv" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
    expect(n.ok).toBe(true);
    expect(theoLop(await cd.docCutover({ tu: TU, den: null, maCoSo: [ma.A] }), "CHUAN").nhom).toBe("ACCEPTED");
  });

  it("[SHADOW-DB-01] chạy bóng: MATCH / POLICY_UNRESOLVED / MISSING_NEW đúng từng buổi; WorkUnit · WorkConfirmation · CompensationAdjustment KHÔNG đổi một dòng (M-SHADOW-01)", async () => {
    const N = "2026-12-07";
    const daDay = async (ten: string, p: { batDau?: string; ketThuc?: string; nguoiDay: string }) => {
      const b = await taoLop(ten, { co: "A", ngay: N, batDau: p.batDau, ketThuc: p.ketThuc });
      const r = await db.$transaction((tx) => svc.phanCongVaoBuoi(tx, { nguon: { sourceType: "CLASS_SESSION", sourceId: b.sessionId }, userId: gv, role: "MAIN_TEACHER", assignmentType: "SYSTEM", actor }));
      if (!r.ok) throw new Error(r.loi);
      const pc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: b.sessionId } });
      await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: gv, name: "gv" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: p.nguoiDay } });
      return b;
    };
    const s1 = await daDay("BONG_KHOP", { nguoiDay: gv });
    const s2 = await daDay("BONG_60", { batDau: "20:00", ketThuc: "21:00", nguoiDay: gv });
    const s3 = await daDay("BONG_SAI_NGUOI", { batDau: "15:00", ketThuc: "16:30", nguoiDay: gv2 });
    for (const [dir, hhmm] of [["CHECK_IN", "14:45"], ["CHECK_OUT", "21:05"]] as const)
      await db.staffTimeLog.create({ data: { userId: gv, centerId: cs.A, direction: dir, loggedAt: vn(N, hhmm), workDate: ngayDb(N), result: "ACCEPTED", reviewStatus: "PENDING" } });

    const truoc = await demGhi();
    const kq = await cb.chayBong({ centerId: cs.A, tu: N, den: N, now: vn(N, "23:30") });
    expect(await demGhi()).toEqual(truoc);
    expect(kq.bong.every((b) => ["SHADOW", "POLICY_UNRESOLVED", "CUTOVER_GRACE", "BLOCKED"].includes(b.trangThai))).toBe(true);
    const cua = (sessionId: string) => kq.soSanh.filter((x) => x.sourceId === sessionId).map((x) => `${x.loai}:${x.userIdCu ?? "-"}>${x.userIdMoi ?? "-"}`);
    expect(cua(s1.sessionId)).toEqual([`MATCH:${gv}>${gv}`]);
    expect(cua(s2.sessionId)).toEqual([`POLICY_UNRESOLVED:${gv}>${gv}`]);
    expect(cua(s3.sessionId)).toEqual([`MISSING_NEW:${gv2}>-`]);
    expect(kq.cong.dat).toBe(false);
    expect(kq.cong.chan).toEqual(["MISSING_NEW = 1", "POLICY_UNRESOLVED chưa loại trừ có chủ đích = 1"]);
  });
});
