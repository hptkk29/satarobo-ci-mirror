// tests/cham-cong/phan-cong-gop-chot-ky.spec.ts — GĐ6: ghi cứng WorkUnit lúc CHỐT KỲ (chốt 10) + cổng xác nhận tay theo CỜ KỲ, Postgres THẬT.
// CỜ: mốc là NGÀY (chủ dự án chốt 29/10/2026 "áp từ 15/11/2026" = mặc định registry). Bộ này đặt "2026-11" (= 01/11) cho các ca cũ để
// khẳng định CẢ HAI vế cờ (kỳ 10 giữ luồng xác nhận tay, kỳ 11 ghi cứng lúc chốt); `[KY11-01]` khẳng định cấu hình MẶC ĐỊNH thật (không
// dòng cài đặt ⇒ kỳ 11 TRỘN: trước 15/11 luật cũ, từ 15/11 luật mới). Mỗi ca tự dựng + dọn (luật 18); `now` truyền tay (luật 19).
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
    // Công tắc bật/tắt (đuôi `Enabled`) bật hết. Cờ kỳ: `kyCaiDat.v` = giá trị NGƯỜI VẬN HÀNH đã đặt (mặc định ở bộ này "2026-11" —
    // mô phỏng chủ dự án đã bật luật mới); `null` = KHÔNG có dòng cài đặt ⇒ đi giá trị THẬT của registry (`[KY11-01]`).
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key)
        ? true
        : key === "shift.parttimeLuatCongMoiTuKy" && kyCaiDat.v !== null
          ? kyCaiDat.v
          : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const kyCaiDat = vi.hoisted(() => ({ v: "2026-11" as string | null }));
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
  let ck: typeof import("../../lib/phan-cong/chot-ky-cong-db");
  let vn2: typeof import("../../lib/parttime/viec-ngay-db");
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
    await db.trialClassV2.deleteMany({ where: { code: { startsWith: TAG } } });
    await db.lead.deleteMany({ where: { parentName: { startsWith: TAG } } });
    await db.trialCertificate.deleteMany({ where: { userId: { in: ids } } });
    await db.trialSupportPolicy.deleteMany({ where: { reason: { startsWith: TAG } } });
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
    ck = await import("../../lib/phan-cong/chot-ky-cong-db");
    vn2 = await import("../../lib/parttime/viec-ngay-db");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS ck", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV ck", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await don();
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    // GV PARTTIME (chủ dự án chốt 08–09/11/2026: chốt kỳ ghi theo phân công CHỈ cho `Employee.contractType = PARTTIME`).
    await db.employee.deleteMany({ where: { employeeCode: `${TAG}-gv` } });
    const nv = await db.employee.create({ data: { employeeCode: `${TAG}-gv`, fullName: "GV ck", jobTitle: "GV", department: "DAO_TAO", contractType: "PARTTIME" }, select: { id: true } });
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "GV ck", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs, employeeId: nv.id }, select: { id: true } })).id;
    ql = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL ck", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
    actor.id = ql;
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    khoa = (await db.course.create({ data: { name: "Khoá ck", slug: `${TAG}-k` }, select: { id: true } })).id;
  });
  afterEach(async () => {
    kyCaiDat.v = "2026-11";
    await db.employee.updateMany({ where: { employeeCode: `${TAG}-gv` }, data: { contractType: "PARTTIME" } });
    await don();
  });
  afterAll(async () => {
    await don();
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    await db.employee.deleteMany({ where: { employeeCode: `${TAG}-gv` } });
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-cs` } });
    await db.center.deleteMany({ where: { slug: `${TAG}-cs` } });
    await db.$disconnect();
  });

  /** Buổi lớp 14:00–15:30 (ca C) của GV, đã đồng bộ phân công; `xong` ⇒ buổi đã chốt (điểm danh xong) như thật. */
  async function buoiLop(ngay: string, xong = true, gio: [string, string] = ["14:00", "15:30"]) {
    const lop = await db.class.create({ data: { name: `${TAG} L${ngay}${gio[0]}`, courseId: khoa, centerId: cs, teacherId: gv, startTime: gio[0], endTime: gio[1] }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(ngay, gio[0]) }, select: { id: true } });
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

  // ĐẢO 09/11/2026 (chủ dự án: "Sửa chốt kỳ ghi theo phân công"): ô thiếu lượt quét KHÔNG còn bị bỏ — lượt quét chỉ là bằng chứng.
  it("[CK-DB-02] ô thiếu lượt RA (chưa phản ánh) ⇒ VẪN ghi MỘT đơn vị theo phân công; không có mục 'chưa tính'", async () => {
    const pcId = await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 1, soOChuaTinh: 0 } });
    expect(await donVi()).toEqual([{ workUnitType: "MAIN_TEACHING", confirmedById: ql, assignmentId: pcId }]);
  });

  it("[CK-DB-03] chốt → MỞ → chốt lại ⇒ KHÔNG nhân đôi, kể cả khi BẰNG CHỨNG đổi giữa hai lần chốt (phản ánh được duyệt ghi thêm lượt ra)", async () => {
    await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    expect((await chot("2026-11", SAU_KY11)).ok).toBe(true);
    expect(await donVi()).toHaveLength(1);
    expect((await moLai("2026-11", SAU_KY11)).ok).toBe(true);
    const { id } = await pa.guiPhanAnh({ userId: gv, centerId: cs, ngay: N11, ca: "C", lyDo: "Quên quét ra", moc: [null, "15:40"], homNay: "2026-12-02" });
    await pa.duyetPhanAnh({ id, actor: { id: ql, name: "QL" }, duyet: true, ghiChu: null, now: SAU_KY11 });
    const lan2 = await chot("2026-11", SAU_KY11);
    expect(lan2).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0 } }); // đã có đơn vị cùng phiên bản phân công ⇒ giữ nguyên, không void
    expect(await moLai("2026-11", SAU_KY11)).toMatchObject({ ok: true });
    const lan3 = await chot("2026-11", SAU_KY11);
    expect(lan3).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0 } }); // đơn vị trùng dữ liệu ⇒ không ghi thêm
    expect(await donVi()).toHaveLength(1);
  });

  // Chủ dự án chốt 08/11/2026: mặc định = 01/11 (đảo 15/11 của 29/10) ⇒ kỳ 11 đi luật mới TRỌN kỳ — kể cả ngày ĐẦU tháng.
  it("[KY11-01] cấu hình MẶC ĐỊNH (mốc 01/11): kỳ 11 MỚI trọn — buổi 02/11 và 18/11 đều tự động, trần 2, xác nhận tay BỊ TỪ CHỐI, chốt ghi cứng ĐÚNG HAI đơn vị", async () => {
    kyCaiDat.v = null;
    await db.systemSetting.deleteMany({ where: { key: "shift.parttimeLuatCongMoiTuKy" } });
    const DAU = "2026-11-02";
    const pcDau = await buoiLop(DAU);
    const pcSau = await buoiLop(N11);
    for (const n of [DAU, N11]) {
      await quet(n, "13:30", "CHECK_IN");
      await quet(n, "15:45", "CHECK_OUT");
    }
    expect(await tm.tranMocCuaNgay(gv, DAU)).toBe(2);
    expect(await tm.tranMocCuaNgay(gv, N11)).toBe(2);
    const ds = await wu.docDoiSoatThucHien({ centerId: cs, tu: DAU, den: N11, now: SAU_KY11 });
    const xac = (id: string) => {
      const d = ds.dong.find((x) => x.bc.assignmentId === id)!;
      return wu.xacNhanThucHien({ assignmentId: id, phienBanDaXem: d.bc.assignmentVersion, dauVanDaXem: d.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor, now: SAU_KY11 });
    };
    expect(await xac(pcDau)).toMatchObject({ ok: false, loi: expect.stringMatching(/tính công tự động/) });
    expect(await xac(pcSau)).toMatchObject({ ok: false, loi: expect.stringMatching(/tính công tự động/) });
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 2 } });
    expect((await donVi()).map((x) => x.assignmentId).sort()).toEqual([pcDau, pcSau].sort());
  });

  it("[CK-DB-04] cờ kỳ CẢ HAI vế khi người vận hành đặt kỳ 2026-11: kỳ 2026-10 ⇒ chốt KHÔNG ghi gì (ghiCung null), xác nhận tay ĐƯỢC; kỳ 2026-11 ⇒ xác nhận tay BỊ TỪ CHỐI", async () => {
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

  // ĐẢO 09/11/2026: điều kiện P5 (buổi đã chốt, đủ lượt…) không còn quyết công — phân công còn sống là căn cứ.
  it("[CK-DB-05] buổi CHƯA CHỐT nhưng đã phân công ⇒ VẪN ghi theo phân công (Lương dự kiến có tính nó)", async () => {
    const pcId = await buoiLop(N11, false);
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 1, boQua: [] } });
    expect(await donVi()).toEqual([expect.objectContaining({ assignmentId: pcId, workUnitType: "MAIN_TEACHING" })]);
  });

  it("[CK-DB-06] TRỰC: ô chỉ trực ca C ⇒ chốt kỳ ghi MỘT đơn vị OPERATIONS_DUTY trong giao dịch khoá kỳ, người ghi = người chốt", async () => {
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

  // ── Chủ dự án chốt 09/11/2026: "Sửa chốt kỳ ghi theo phân công" — ĐẲNG THỨC tiền (nghiệm thu) ─────────────────────────────────────
  it("[CK-PC-01] ĐẲNG THỨC: Σ tiền WorkUnit ghi lúc chốt = Σ Lương dự kiến (kế hoạch) = Σ tiền Bảng công ngày / site GV (docViecParttime); ô thiếu quét vẫn ghi", async () => {
    await buoiLop(N11); // ca C, có đủ quét
    await quet(N11, "13:30", "CHECK_IN");
    await quet(N11, "15:45", "CHECK_OUT");
    await buoiLop("2026-11-19", true, ["18:00", "19:30"]); // ca T, KHÔNG quét
    const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: gv, centerId: cs, ngay: "2026-11-20", shiftCode: "S", note: null, nguonGiao: "TAY", actor }));
    expect(g.ok).toBe(true); // ca S chỉ trực, KHÔNG quét
    // Hỗ trợ Trial (chủ dự án 09/11: "làm luôn trong PR này"): buổi Trial 20:00 ngày 18/11, 2 HV có mặt, có chứng nhận + chính sách 30.000đ/HV.
    const lop = await db.trialClassV2.create({ data: { code: `${TAG}-tr`, name: "Trial ck", centerId: cs, sessionCount: 1, teacherId: gv }, select: { id: true } });
    const buoiTr = await db.trialClassSession.create({ data: { trialClassId: lop.id, seq: 1, date: new Date(`${N11}T00:00:00Z`), startTime: "20:00", endTime: "21:00", teacherId: gv }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "TRIAL_SESSION", sourceId: buoiTr.id }], "TRIAL_TAO", actor);
    await db.sessionStaffAssignment.updateMany({ where: { sourceId: buoiTr.id }, data: { createdAt: vn("2026-11-01", "09:00") } });
    const lead = await db.lead.create({ data: { parentName: `${TAG} PH`, phone: "0900000002" }, select: { id: true } });
    for (const ten of ["Bé A", "Bé B"]) {
      const c = await db.leadChild.create({ data: { leadId: lead.id, fullName: ten }, select: { id: true } });
      const e = await db.trialEnrollment.create({ data: { trialClassId: lop.id, leadChildId: c.id, scheduledSessionId: buoiTr.id }, select: { id: true } });
      await db.trialAttendance.create({ data: { trialSessionId: buoiTr.id, trialEnrollmentId: e.id, status: "PRESENT" } });
    }
    await db.trialSupportPolicy.create({ data: { centerId: null, enabled: true, amountPerStudent: 30000, effectiveFrom: new Date("2026-10-15T00:00:00Z"), reason: `${TAG} chính sách thử`, approvedById: gv } });
    await db.trialCertificate.create({ data: { userId: gv, effectiveFrom: new Date("2026-10-15T00:00:00Z"), issuedById: gv } });
    const ke = await ck.docKeHoachGhiKy({ centerId: cs, periodKey: "2026-11", now: SAU_KY11 });
    expect(ke.ke.trial).toEqual([expect.objectContaining({ soCoMat: 2, donGia: 30000 })]);
    const viec = await vn2.docViecParttime({ centerIds: [cs], tu: "2026-11-01", den: "2026-11-30", now: SAU_KY11, userIds: [gv] });
    const tienBangCong = viec.reduce((s, v) => s + v.tien, 0);
    expect(viec.reduce((s, v) => s + v.chuaTinh, 0)).toBe(0);
    expect(tienBangCong).toBeGreaterThan(0);
    expect(ke.ke.tienSeGhi).toBe(tienBangCong);
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 3, soDonViTruc: 1, soOChuaTinh: 0 } }); // 2 tiết + 1 hỗ trợ Trial
    const ds = await db.workUnit.findMany({ where: { userId: gv, status: "CONFIRMED" }, select: { quantity: true, rateSnapshot: true, workUnitType: true } });
    expect(ds.filter((w) => w.workUnitType === "TRIAL_SUPPORT").map((w) => [Number(w.quantity), w.rateSnapshot])).toEqual([[2, 30000]]);
    expect(Math.round(ds.reduce((s, w) => s + Number(w.quantity) * w.rateSnapshot, 0))).toBe(tienBangCong);
  });

  it("[CK-PC-02] đơn vị ĐÃ xác nhận tay (luật cũ) GIỮ NGUYÊN khi chốt theo phân công — không void, không ghi thêm (như 5 đơn vị 01–14/11 trên prod)", async () => {
    kyCaiDat.v = "2026-12"; // kỳ 11 đi luật cũ ⇒ xác nhận tay được
    const pc = await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    await quet(N11, "15:45", "CHECK_OUT");
    const ds = await wu.docDoiSoatThucHien({ centerId: cs, tu: N11, den: N11, now: SAU_KY11 });
    const dd = ds.dong.find((x) => x.bc.assignmentId === pc)!;
    expect(await wu.xacNhanThucHien({ assignmentId: pc, phienBanDaXem: dd.bc.assignmentVersion, dauVanDaXem: dd.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor, now: SAU_KY11 })).toMatchObject({ ok: true });
    const truoc = await db.workUnit.findFirstOrThrow({ where: { assignmentId: pc, status: "CONFIRMED" }, select: { id: true } });
    kyCaiDat.v = "2026-11";
    // Bằng chứng đổi HẲN sau khi xác nhận (mất mọi lượt quét ⇒ dấu vân khác). Thêm một lượt ra muộn hơn KHÔNG đổi dấu vân (đo bằng cấy
    // lỗi 09/11: ca này từng xanh cả khi gỡ cổng giữ nguyên) — nên xoá lượt, không thêm lượt.
    await db.staffTimeLog.deleteMany({ where: { userId: gv } });
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0 } });
    expect(await db.workUnit.findMany({ where: { assignmentId: pc }, select: { id: true, status: true } })).toEqual([{ id: truoc.id, status: "CONFIRMED" }]);
  });

  it("[CK-PC-03] GV FULLTIME có đứng lớp ⇒ chốt KHÔNG ghi đơn vị Parttime (giữ công ô ca) — đối chứng âm", async () => {
    await db.employee.updateMany({ where: { employeeCode: `${TAG}-gv` }, data: { contractType: "FULLTIME" } });
    await buoiLop(N11);
    const r = await chot("2026-11", SAU_KY11);
    expect(r).toMatchObject({ ok: true, ghiCung: { soDonViDay: 0, soDonViTruc: 0 } });
    expect(await donVi()).toEqual([]);
  });

  // Chủ dự án chốt 09/11/2026 "Bảng công tháng + Excel: Có" — màn và file xuất cùng đọc `loadBangCongThang`.
  it("[BCT-PC-01] Bảng công tháng: GV parttime CHỈ có phân công (không khung ca / ô ca) VẪN có dòng; tổng = Σ docViecParttime; ô in mã ô, không công ô ca", async () => {
    await buoiLop(N11);
    await buoiLop("2026-11-19", true, ["18:00", "19:30"]);
    const bct = await import("../../lib/cham-cong/bang-cong-thang-db");
    const kq = await bct.loadBangCongThang({ sdb: db as never, coSo: cs, ky: "2026-11", orgUnitId: null, today: "2026-12-02", now: SAU_KY11, lockedStatus: null });
    const dong = kq.rows.find((r) => r.userId === gv);
    expect(dong).toBeDefined();
    const viec = await vn2.docViecParttime({ centerIds: [cs], tu: "2026-11-01", den: "2026-11-30", now: SAU_KY11, userIds: [gv] });
    expect(dong!.phanCong).toMatchObject({ tienSo: viec.reduce((s, v) => s + v.tien, 0), tietChinh: "2", soNgay: 2 });
    expect(dong!.phanCong!.tienSo).toBeGreaterThan(0);
    expect(dong!.tongCong).toBe(0);
    expect(dong!.o[18]).toMatchObject({ mau: "PHAN_CONG", code: "D", cong: 0 });
    expect(dong!.dem.nang).toBe(0);
  });

  it("[BCT-PC-02] GV FULLTIME chỉ có phân công ⇒ KHÔNG thêm dòng theo phân công (giữ đường cũ) — đối chứng âm", async () => {
    await db.employee.updateMany({ where: { employeeCode: `${TAG}-gv` }, data: { contractType: "FULLTIME" } });
    await buoiLop(N11);
    const bct = await import("../../lib/cham-cong/bang-cong-thang-db");
    const kq = await bct.loadBangCongThang({ sdb: db as never, coSo: cs, ky: "2026-11", orgUnitId: null, today: "2026-12-02", now: SAU_KY11, lockedStatus: null });
    expect(kq.rows.find((r) => r.userId === gv)).toBeUndefined();
  });

  // Chủ dự án chốt 09/11/2026 "GV parttime: kỳ công chỉ hiện tiết/trực/tiền" — Kỳ công + summaryJson lúc khoá.
  const ngayCongOCa = (ngay: string, cong: number) =>
    db.staffAttendanceDay.create({ data: { userId: gv, centerId: cs, workDate: new Date(`${ngay}T00:00:00Z`), dayType: "WORK", templateCode: "T", dayCreditExpected: cong, dayCreditEarned: cong, workedMinutes: 200, expectedMinutes: 225 } });

  it("[KYPC-01] kỳ 11: dòng GV parttime KHÔNG còn công ô ca (units 0) — phanCong.tien = Σ docViecParttime = Σ kế hoạch ghi; totals.units không cộng ô ca của họ", async () => {
    await buoiLop(N11);
    await ngayCongOCa(N11, 0.5); // ô ca lịch rảnh T 0,5 công — phải BIẾN MẤT khỏi kỳ công
    const kq = await period.buildPeriodSummary(cs, "2026-11");
    const dong = kq.rows.find((r) => r.userId === gv)!;
    const viec = await vn2.docViecParttime({ centerIds: [cs], tu: "2026-11-01", den: "2026-11-30", now: SAU_KY11, userIds: [gv] });
    const ke = await ck.docKeHoachGhiKy({ centerId: cs, periodKey: "2026-11", now: SAU_KY11 });
    expect(dong).toMatchObject({ units: 0, expectedUnits: 0, workedMinutes: 0, phanCong: { tuNgay: "2026-11-01", tietChinh: 1, soNgay: 1 } });
    expect(dong.phanCong!.tien).toBeGreaterThan(0);
    expect(dong.phanCong!.tien).toBe(viec.reduce((s, v) => s + v.tien, 0));
    expect(dong.phanCong!.tien).toBe(ke.ke.tienSeGhi);
    expect(dong.grid[N11]).toBe("D");
    expect(kq.totals.units).toBe(0);
    expect(kq.totals.tienPhanCong).toBe(dong.phanCong!.tien);
  });

  it("[KYPC-02] chốt kỳ: summaryJson LƯU đúng hình dạng mới (units 0 + phanCong), tiền = Σ WorkUnit vừa ghi", async () => {
    await buoiLop(N11);
    const r = await chot("2026-11", SAU_KY11);
    expect(r.ok).toBe(true);
    const p = await db.attendancePeriod.findFirstOrThrow({ where: { centerId: cs, periodKey: "2026-11" }, select: { summaryJson: true } });
    const dong = (p.summaryJson as { rows: { userId: string; units: number; phanCong?: { tien: number } }[] }).rows.find((x) => x.userId === gv)!;
    const wu = await db.workUnit.findMany({ where: { userId: gv, status: "CONFIRMED" }, select: { quantity: true, rateSnapshot: true } });
    expect(dong.units).toBe(0);
    expect(dong.phanCong!.tien).toBe(Math.round(wu.reduce((s, w) => s + Number(w.quantity) * w.rateSnapshot, 0)));
  });

  it("[KYPC-03] đối chứng: FULLTIME giữ công ô ca, không có phanCong; kỳ 10 (luật cũ) parttime cũng KHÔNG đổi", async () => {
    await ngayCongOCa(N10, 1);
    const k10 = await period.buildPeriodSummary(cs, "2026-10");
    expect(k10.rows.find((x) => x.userId === gv)).toMatchObject({ units: 1 });
    expect(k10.rows.find((x) => x.userId === gv)!.phanCong).toBeUndefined();
    expect(k10.totals.tienPhanCong).toBeUndefined();
    await db.employee.updateMany({ where: { employeeCode: `${TAG}-gv` }, data: { contractType: "FULLTIME" } });
    await ngayCongOCa(N11, 1);
    const k11 = await period.buildPeriodSummary(cs, "2026-11");
    expect(k11.rows.find((x) => x.userId === gv)).toMatchObject({ units: 1 });
    expect(k11.rows.find((x) => x.userId === gv)!.phanCong).toBeUndefined();
  });
});
