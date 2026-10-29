// tests/cham-cong/phan-cong-gop-chot-ky.spec.ts — GĐ6: ghi cứng WorkUnit lúc CHỐT KỲ (chốt 10) + cổng xác nhận tay theo CỜ KỲ, Postgres THẬT.
// CẤU HÌNH MẶC ĐỊNH: `shift.parttimeLuatCongMoiTuKy` KHÔNG mock (= "2026-11" của registry) — đây là chỗ khẳng định CẢ HAI vế cờ ở cấu hình
// thật (kỳ 10 giữ luồng xác nhận tay, kỳ 11 ghi cứng lúc chốt). Mỗi ca tự dựng + dọn (luật 18); `now` truyền tay (luật 19).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/phan-cong-gop-chot-ky] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    // CHỈ công tắc bật/tắt (đuôi `Enabled`) — cờ kỳ `shift.parttimeLuatCongMoiTuKy` đi giá trị THẬT của registry.
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "pcg6ck";
const N11 = "2026-11-18";
const N10 = "2026-10-21";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const SAU_KY11 = vn("2026-12-02", "09:00");
const SAU_KY10 = vn("2026-11-02", "09:00");

d("[CK-DB] ghi cứng công lúc chốt kỳ — Postgres thật, cấu hình mặc định", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let period: typeof import("../../lib/cham-cong/period");
  let pa: typeof import("../../lib/phan-cong/phan-anh-db");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let tm: typeof import("../../lib/phan-cong/tran-moc-db");
  let cs = "";
  let gv = "";
  let ql = "";
  let khoa = "";
  const actor = { id: "", name: "QL ck" };

  async function don() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const wus = (await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((w) => w.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: wus } } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    // WorkConfirmation BẤT BIẾN (trigger) — dọn bằng đúng khuôn của bộ P5 (`parttime-workunit.spec.ts`).
    if (cs)
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER "WorkConfirmation_bat_bien"`,
        db.workConfirmation.deleteMany({ where: { centerId: cs } }),
        db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER "WorkConfirmation_bat_bien"`,
      ]);
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    const pas = (await db.phanAnhCong.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pas } } });
    await db.phanAnhCong.deleteMany({ where: { userId: { in: ids } } });
    const pcs = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pcs } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = (await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
    await db.classSession.deleteMany({ where: { classId: { in: cls } } });
    await db.class.deleteMany({ where: { id: { in: cls } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    const trs = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((t) => t.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: trs } } });
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    if (cs) await db.attendancePeriod.deleteMany({ where: { centerId: cs } });
    await db.domainEvent.deleteMany({ where: { type: { in: ["parttime.staffing_dirty", "class.session_changed"] } } });
  }

  beforeAll(async () => {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238");
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "SR.QD.238", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]!) },
    });
    period = await import("../../lib/cham-cong/period");
    pa = await import("../../lib/phan-cong/phan-anh-db");
    wu = await import("../../lib/parttime/workunit-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    tm = await import("../../lib/phan-cong/tran-moc-db");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS ck", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV ck", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await don();
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "GV ck", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    ql = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL ck", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
    actor.id = ql;
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    khoa = (await db.course.create({ data: { name: "Khoá ck", slug: `${TAG}-k` }, select: { id: true } })).id;
  });
  afterEach(() => don());
  afterAll(async () => {
    await don();
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-cs` } });
    await db.center.deleteMany({ where: { slug: `${TAG}-cs` } });
    await db.$disconnect();
  });

  /** Buổi lớp 14:00–15:30 (ca C) của GV, đã đồng bộ phân công; `xong` ⇒ buổi đã chốt (điểm danh xong) như thật. */
  async function buoiLop(ngay: string, xong = true) {
    const lop = await db.class.create({ data: { name: `${TAG} L${ngay}`, courseId: khoa, centerId: cs, teacherId: gv, startTime: "14:00", endTime: "15:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(ngay, "14:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    if (xong) await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: gv } });
    return (await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: s.id, role: "MAIN_TEACHER" }, select: { id: true } })).id;
  }
  const quet = (ngay: string, hhmm: string, direction: "CHECK_IN" | "CHECK_OUT") =>
    db.staffTimeLog.create({ data: { userId: gv, centerId: cs, direction, loggedAt: vn(ngay, hhmm), workDate: new Date(`${ngay}T00:00:00Z`), source: "TICKET", result: "ACCEPTED" } });
  const chot = (periodKey: string, now: Date) => period.lockPeriod({ centerId: cs, periodKey, actorId: ql, reason: "test ck", boQuaBuoiChuaChot: true, boQuaKhieuNai: false, now });
  const moLai = (periodKey: string, now: Date) => period.reopenPeriod({ centerId: cs, periodKey, actorId: ql, reason: "mở lại test ck", now });
  const donVi = () => db.workUnit.findMany({ where: { userId: gv, status: "CONFIRMED" }, select: { workUnitType: true, confirmedById: true, assignmentId: true } });

  it("[CK-DB-01] kỳ 2026-11: chốt kỳ ⇒ ô TỰ ĐỘNG được ghi cứng MỘT WorkUnit đứng chính, người ghi = NGƯỜI CHỐT; kết quả nói rõ số đơn vị", async () => {
    const pcId = await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    await quet(N11, "15:45", "CHECK_OUT");
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 1, soOChuaTinh: 0 } });
    expect(await donVi()).toEqual([{ workUnitType: "MAIN_TEACHING", confirmedById: ql, assignmentId: pcId }]);
    expect(await db.workConfirmation.findFirstOrThrow({ where: { assignmentId: pcId } })).toMatchObject({ decision: "CONFIRMED", decidedById: ql });
  });

  it("[CK-DB-02] ô CẦN XEM (thiếu lượt ra, chưa phản ánh) ⇒ KHÔNG ghi đơn vị nào, đếm vào 'ô chưa tính'", async () => {
    await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0, soOChuaTinh: 1 } });
    expect(await donVi()).toEqual([]);
  });

  it("[CK-DB-03] chốt → MỞ → chốt lại ⇒ KHÔNG nhân đôi; phản ánh được duyệt giữa hai lần chốt ⇒ ô thành tự động và có đơn vị ở lần chốt sau", async () => {
    await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    expect((await chot("2026-11", SAU_KY11)).ok).toBe(true);
    expect(await donVi()).toEqual([]);
    expect((await moLai("2026-11", SAU_KY11)).ok).toBe(true);
    const { id } = await pa.guiPhanAnh({ userId: gv, centerId: cs, ngay: N11, ca: "C", lyDo: "Quên quét ra", moc: [null, "15:40"], homNay: "2026-12-02" });
    await pa.duyetPhanAnh({ id, actor: { id: ql, name: "QL" }, duyet: true, ghiChu: null, now: SAU_KY11 });
    const lan2 = await chot("2026-11", SAU_KY11);
    expect(lan2).toMatchObject({ ok: true, ghiCung: { soDonViDay: 1 } });
    expect(await moLai("2026-11", SAU_KY11)).toMatchObject({ ok: true });
    const lan3 = await chot("2026-11", SAU_KY11);
    expect(lan3).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0 } }); // đơn vị trùng dữ liệu ⇒ không ghi thêm
    expect(await donVi()).toHaveLength(1);
  });

  it("[CK-DB-04] cờ kỳ CẢ HAI vế ở cấu hình mặc định: kỳ 2026-10 ⇒ chốt KHÔNG ghi gì (ghiCung null), xác nhận tay ĐƯỢC; kỳ 2026-11 ⇒ xác nhận tay BỊ TỪ CHỐI", async () => {
    const pc10 = await buoiLop(N10);
    await quet(N10, "13:30", "CHECK_IN");
    await quet(N10, "15:45", "CHECK_OUT");
    const r = await chot("2026-10", SAU_KY10);
    expect(r).toMatchObject({ ok: true, ghiCung: null });
    expect(await donVi()).toEqual([]);
    await moLai("2026-10", SAU_KY10);
    const ds10 = await wu.docDoiSoatThucHien({ centerId: cs, tu: N10, den: N10, now: SAU_KY10 });
    const d10 = ds10.dong.find((x) => x.bc.assignmentId === pc10)!;
    const xn10 = await wu.xacNhanThucHien({ assignmentId: pc10, phienBanDaXem: d10.bc.assignmentVersion, dauVanDaXem: d10.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor, now: SAU_KY10 });
    expect(xn10).toMatchObject({ ok: true });
    const pc11 = await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    await quet(N11, "15:45", "CHECK_OUT");
    const ds11 = await wu.docDoiSoatThucHien({ centerId: cs, tu: N11, den: N11, now: SAU_KY11 });
    const d11 = ds11.dong.find((x) => x.bc.assignmentId === pc11)!;
    const xn11 = await wu.xacNhanThucHien({ assignmentId: pc11, phienBanDaXem: d11.bc.assignmentVersion, dauVanDaXem: d11.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor, now: SAU_KY11 });
    expect(xn11).toMatchObject({ ok: false, loi: expect.stringMatching(/tính công tự động/) });
  });

  it("[CK-DB-05] ô tự động nhưng buổi CHƯA CHỐT (P5: CHUA_XONG) ⇒ KHÔNG ghi, và KHÔNG bỏ im lặng: dòng bỏ qua mang lý do", async () => {
    const pcId = await buoiLop(N11, false);
    await quet(N11, "13:30", "CHECK_IN");
    await quet(N11, "15:45", "CHECK_OUT");
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0, boQua: [{ loai: "DAY", id: pcId, ngay: N11, lyDo: expect.stringMatching(/CHUA_XONG/) }] } });
    expect(await donVi()).toEqual([]);
  });

  it("[CK-DB-06] TRỰC: ô chỉ trực ca C, có mặt phủ ca ⇒ ô tự động ⇒ chốt kỳ ghi MỘT đơn vị OPERATIONS_DUTY trong giao dịch khoá kỳ, người ghi = người chốt", async () => {
    const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs, ngay: N11, shiftCode: "C", note: null, nguonGiao: "TAY", actor }));
    expect(g.ok).toBe(true);
    await quet(N11, "13:40", "CHECK_IN");
    await quet(N11, "17:35", "CHECK_OUT");
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0, soDonViTruc: 1 } });
    expect(await donVi()).toEqual([expect.objectContaining({ workUnitType: "OPERATIONS_DUTY", confirmedById: ql })]);
  });

  // GĐ6-E (chốt 9) — trần mốc sửa giờ = số cặp kỳ vọng × 2 ở ngày Parttime kỳ luật mới; còn lại hằng cũ 4.
  it("[TRM-DB-01] cờ kỳ CẢ HAI vế: một buổi dạy (1 cặp) ⇒ kỳ 11 trần 2, kỳ 10 trần 4; người không có việc ⇒ 4", async () => {
    await buoiLop(N11);
    await buoiLop(N10);
    expect(Object.fromEntries(await tm.tranMocChoNguoi([gv, ql], N11))).toEqual({ [gv]: 2, [ql]: 4 });
    expect(await tm.tranMocCuaNgay(gv, N10)).toBe(4);
  });

  it("[TRM-DB-02] trực S + trực T + dạy C (3 cặp) ⇒ trần 6 — vượt hằng cũ; trực huỷ thì về theo số cặp còn lại", async () => {
    await buoiLop(N11);
    for (const shiftCode of ["S", "T"]) {
      const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs, ngay: N11, shiftCode, note: null, nguonGiao: "TAY", actor }));
      expect(g.ok).toBe(true);
    }
    expect(await tm.tranMocCuaNgay(gv, N11)).toBe(6);
    await db.operationsDutyAssignment.updateMany({ where: { userId: gv, shiftCode: "T" }, data: { status: "CANCELLED" } });
    expect(await tm.tranMocCuaNgay(gv, N11)).toBe(4);
  });
});
