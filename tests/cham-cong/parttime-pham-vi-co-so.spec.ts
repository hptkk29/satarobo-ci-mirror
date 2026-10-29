// [SCOPE-*] H3 — PHẠM VI CƠ SỞ của các thao tác P5 (xác nhận thực hiện · giao / huỷ / xác nhận trực · quyết điều chỉnh tiền) chứng minh
// trên Postgres THẬT với RBAC THẬT (RoleDef + UserOrgRole seed, `checkPermission` thật) qua ĐÚNG server action. Chỉ `@/lib/auth` (phiên)
// và `next/*` bị giả lập. Cơ sở của bản ghi luôn TRA TỪ DB ở action — test cố tình gửi id của bản ghi cơ sở khác.
//
// Mỗi ô có ĐỐI CHỨNG DƯƠNG (luật 11): cùng người, cùng action, bản ghi ở cơ sở của mình ⇒ QUA và ghi thật. "Chặn" = trả đúng câu cổng
// quyền VÀ không có dòng nào được ghi.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-pham-vi-co-so] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; name: string; email: string; role: string; roles: string[] } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("next/cache", async (goc) => ({ ...(await goc<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest-h3" }), cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return { ...goc, getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => (/^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts))) as typeof goc.getSetting };
});

const P = "h3scope-";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
type Ten = "qlcs1" | "qlcs2" | "hoHr" | "gvA" | "gvB" | "multi";
const NGUOI: Record<Ten, { role: Role; vais: { vai: string; donVi: "HO" | "CS1" | "CS2" }[]; nha: "CS1" | "CS2" }> = {
  qlcs1: { role: "CENTER_MANAGER", vais: [{ vai: "CENTER_MANAGER", donVi: "CS1" }], nha: "CS1" },
  qlcs2: { role: "CENTER_MANAGER", vais: [{ vai: "CENTER_MANAGER", donVi: "CS2" }], nha: "CS2" },
  hoHr: { role: "HR", vais: [{ vai: "HO_HR", donVi: "HO" }], nha: "CS1" },
  gvA: { role: "TEACHER", vais: [{ vai: "TEACHER", donVi: "CS1" }], nha: "CS1" },
  gvB: { role: "TEACHER", vais: [{ vai: "TEACHER", donVi: "CS2" }], nha: "CS2" },
  // QLCS ở CS1 + giáo viên ở CS2 — người đa vai: vai GV ở CS2 KHÔNG được mở cổng quản lý ở CS2.
  multi: { role: "CENTER_MANAGER", vais: [{ vai: "CENTER_MANAGER", donVi: "CS1" }, { vai: "TEACHER", donVi: "CS2" }], nha: "CS1" },
};
const DS = Object.keys(NGUOI) as Ten[];
const CHAN = /không có quyền|Không có quyền/;

d("[SCOPE] phạm vi cơ sở thao tác P5 — Postgres + RBAC thật", () => {
  let seed: typeof import("../e2e/_helpers/seed");
  let db: typeof import("../../lib/db")["db"];
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let act: typeof import("../../app/(admin)/admin/cham-cong/phan-cong/_actions");
  let actTruc: typeof import("../../app/(admin)/admin/cham-cong/phan-cong/_actions-truc");
  let actDc: typeof import("../../app/(admin)/admin/cham-cong/phan-cong/_actions-dieu-chinh");
  let gvAct: typeof import("../../app/(teacher)/teacher/phan-cong/_actions");
  let gvTruc: typeof import("../../app/(teacher)/teacher/phan-cong/_actions-truc");
  const rbacGoc = process.env.RBAC_V2_ENABLED;
  const id = {} as Record<Ten, string>;
  const cs = {} as Record<"CS1" | "CS2", string>;
  let khoa = "";
  let soLop = 0;
  const actor = { id: null as string | null, name: "h3" };
  const nhap = (n: Ten) => {
    h.session = { user: { id: id[n], name: `${P}${n}`, email: `${P}${n}@ci.test`, role: NGUOI[n].role, roles: [NGUOI[n].role] } };
  };
  const v2 = (bat: boolean) => {
    process.env.RBAC_V2_ENABLED = bat ? "true" : "false";
  };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  async function don() {
    const ids = (await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } })).map((u) => u.id);
    if (!ids.length) return;
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const dutyIds = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.compensationAdjustment.deleteMany({ where: { userId: { in: ids } } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    await db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER USER`;
    await db.workConfirmation.deleteMany({ where: { assignmentId: { in: [...pcIds, ...dutyIds] } } });
    await db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER USER`;
    await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...pcIds, ...dutyIds] } }, { actorId: { in: ids } }] } });
    await db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER USER`;
    await db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } });
    await db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER USER`;
    await db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" DISABLE TRIGGER USER`;
    await db.operationsDutyAcceptance.deleteMany({ where: { dutyId: { in: dutyIds } } });
    await db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" ENABLE TRIGGER USER`;
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const cls = await db.class.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: P } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeEach(() => {
    v2(true);
    h.session = null;
  });

  beforeAll(async () => {
    seed = await import("../e2e/_helpers/seed");
    db = (await import("../../lib/db")).db;
    dongBo = await import("../../lib/parttime/dong-bo");
    wu = await import("../../lib/parttime/workunit-db");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    act = await import("../../app/(admin)/admin/cham-cong/phan-cong/_actions");
    actTruc = await import("../../app/(admin)/admin/cham-cong/phan-cong/_actions-truc");
    actDc = await import("../../app/(admin)/admin/cham-cong/phan-cong/_actions-dieu-chinh");
    gvAct = await import("../../app/(teacher)/teacher/phan-cong/_actions");
    gvTruc = await import("../../app/(teacher)/teacher/phan-cong/_actions-truc");
    await don();
    await seed.seedOrg(["HO", "CS1", "CS2"]);
    await seed.seedRoles();
    await damBaoChinhSach();
    for (const c of ["CS1", "CS2"] as const) cs[c] = (await db.center.findUniqueOrThrow({ where: { code: c }, select: { id: true } })).id;
    for (const n of DS) {
      const u = await seed.seedUser({ email: `${P}${n}@ci.test`, name: `${P}${n}`, role: NGUOI[n].role, centerId: cs[NGUOI[n].nha] });
      id[n] = u.id;
      for (const g of NGUOI[n].vais) {
        const [vai, dv] = await Promise.all([
          db.roleDef.findUniqueOrThrow({ where: { code: g.vai }, select: { id: true } }),
          db.orgUnit.findUniqueOrThrow({ where: { code: g.donVi }, select: { id: true } }),
        ]);
        await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: dv.id, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") } });
      }
    }
    khoa = (await db.course.create({ data: { name: "Sata 4 h3", slug: `${P}k` }, select: { id: true } })).id;
  }, 180_000);

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      await don();
    } finally {
      await db.$disconnect();
    }
  });

  // ── fixture: buổi ĐÃ DẠY ở một cơ sở (phân — đã gán từ 20/10 + chốt + có mặt đủ) ⇒ dòng đối soát có dấu vân để xác nhận ──
  async function buoiDaDay(c: "CS1" | "CS2", ymd: string, gv: string) {
    soLop++;
    const lop = await db.class.create({ data: { name: `${P}L${soLop}`, classCode: `H3-L${soLop}`, courseId: khoa, centerId: cs[c], teacherId: gv, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs[c], status: "SCHEDULED", date: vn(ymd, "18:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: gv } });
    for (const [dir, hhmm] of [["CHECK_IN", "17:45"], ["CHECK_OUT", "19:35"]] as const) {
      await db.staffTimeLog.create({ data: { userId: gv, centerId: cs[c], direction: dir, loggedAt: vn(ymd, hhmm), workDate: ngayDb(ymd), result: "ACCEPTED", reviewStatus: "PENDING" } });
    }
    // Action đọc ĐỒNG HỒ THẬT (`new Date()`) ⇒ dấu vân phải tính với cùng đồng hồ; buổi đặt ở ngày ĐÃ QUA (từ 15/10/2026) nên
    // bằng chứng không còn đổi theo giờ chạy (luật 19: ngày tuyệt đối ở phía đã qua, không phải phía tương lai).
    const dong = (await wu.docDoiSoatThucHien({ centerId: cs[c], tu: ymd, den: ymd, now: new Date() })).dong.find((r) => r.bc.sourceId === s.id);
    if (!dong) throw new Error("không thấy dòng đối soát");
    return { sessionId: s.id, muc: { assignmentId: dong.bc.assignmentId, phienBanDaXem: dong.bc.assignmentVersion, dauVanDaXem: dong.bc.dauVan } };
  }
  const daXacNhan = (assignmentId: string) => db.workConfirmation.count({ where: { assignmentId } });
  async function khoanDeXuat(c: "CS1" | "CS2", ymd: string, gv: string) {
    const b = await buoiDaDay(c, ymd, gv);
    const r = await wu.xacNhanThucHien({ ...b.muc, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor: { id: id.qlcs1, name: "seed" }, now: new Date() });
    if (!r.ok) throw new Error(r.loi);
    const w = await db.workUnit.findFirstOrThrow({ where: { assignmentId: b.muc.assignmentId, status: "CONFIRMED" }, select: { id: true } });
    return (
      await db.compensationAdjustment.create({
        data: { userId: gv, centerId: cs[c], workDate: ngayDb(ymd), workUnitId: w.id, type: "LATE_ARRIVAL", amount: -30000, ruleCode: "H3_FIXTURE", policyVersionId: "cpv_sr_qd_238", evidenceSnapshot: {}, sourceType: "P4_EVIDENCE", sourceId: b.sessionId },
        select: { id: true },
      })
    ).id;
  }
  async function trucCho(c: "CS1" | "CS2", ymd: string, u: string) {
    const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: u, centerId: cs[c], ngay: ymd, shiftCode: "T", note: null, nguonGiao: "TAY", actor: { id: id.qlcs1, name: "seed" } }));
    if (!g.ok) throw new Error(g.loi);
    return g.id;
  }

  it("[SCOPE-01][SCOPE-04] xác nhận thực hiện: QLCS CS1 ⇒ CS2 BỊ CHẶN (không dòng xác nhận / đơn vị nào); CS1 QUA và ghi thật. Đa vai (QLCS@CS1 + GV@CS2) cũng bị chặn ở CS2", async () => {
    const ngay = "2026-10-16";
    const b2 = await buoiDaDay("CS2", ngay, id.gvB);
    const b1 = await buoiDaDay("CS1", ngay, id.gvA);
    for (const n of ["qlcs1", "multi"] as const) {
      nhap(n);
      const r = await act.xacNhanThucHienAction({ ...b2.muc, quyetDinh: "CONFIRMED" });
      expect(r, n).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    }
    expect(await daXacNhan(b2.muc.assignmentId)).toBe(0);
    expect(await db.workUnit.count({ where: { assignmentId: b2.muc.assignmentId } })).toBe(0);
    nhap("qlcs1");
    expect(await act.xacNhanThucHienAction({ ...b1.muc, quyetDinh: "CONFIRMED" })).toEqual({ ok: true, message: expect.any(String) });
    expect(await db.workUnit.count({ where: { assignmentId: b1.muc.assignmentId, status: "CONFIRMED" } })).toBe(1);
    // Hàng loạt: mục CS2 bị chặn TỪNG MỤC, không nuốt im lặng.
    const b2b = await buoiDaDay("CS2", "2026-10-17", id.gvB);
    const hl = await act.xacNhanHangLoatAction({ muc: [b2b.muc] });
    expect(hl.ketQua?.[0]).toMatchObject({ assignmentId: b2b.muc.assignmentId, ok: false });
    expect(await daXacNhan(b2b.muc.assignmentId)).toBe(0);
    // Đối chứng dương phía CS2: QLCS CS2 xác nhận được chính dòng đã chặn QLCS CS1.
    nhap("qlcs2");
    expect(await act.xacNhanThucHienAction({ ...b2.muc, quyetDinh: "CONFIRMED" })).toMatchObject({ ok: true });
  });

  it("[SCOPE-02][SCOPE-04] trực: QLCS CS1 KHÔNG giao / huỷ / xác nhận được trực ở CS2 (không dòng nào đổi); ở CS1 thì được", async () => {
    const ngay = "2026-11-04";
    nhap("qlcs1");
    expect(await actTruc.giaoTrucAction({ userId: id.gvB, centerId: cs.CS2, ngay, shiftCode: "T" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    expect(await db.operationsDutyAssignment.count({ where: { userId: id.gvB, workDate: ngayDb(ngay) } })).toBe(0);
    const t2 = await trucCho("CS2", ngay, id.gvB);
    expect(await actTruc.huyTrucAction({ dutyId: t2, lyDo: "Đổi lịch trực tuần" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    // GĐ2 (chốt GĐ0 số 1): giao trực là có hiệu lực ⇒ trạng thái gốc là ACCEPTED; huỷ bị chặn thì nó phải ĐỨNG YÊN.
    expect((await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: t2 } })).status).toBe("ACCEPTED");
    expect(await actTruc.xacNhanTrucAction({ dutyId: t2, phienBanDaXem: 1, dauVanDaXem: "x", quyetDinh: "CONFIRMED" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    expect(await db.workConfirmation.count({ where: { assignmentId: t2 } })).toBe(0);
    // Đối chứng dương: CS1.
    expect(await actTruc.giaoTrucAction({ userId: id.gvA, centerId: cs.CS1, ngay, shiftCode: "T" })).toMatchObject({ ok: true });
    const t1 = (await db.operationsDutyAssignment.findFirstOrThrow({ where: { userId: id.gvA, workDate: ngayDb(ngay) } })).id;
    expect(await actTruc.huyTrucAction({ dutyId: t1, lyDo: "Đổi lịch trực tuần" })).toMatchObject({ ok: true });
    expect((await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: t1 } })).status).toBe("CANCELLED");
  });

  it("[SCOPE-03][SCOPE-04] điều chỉnh tiền: QLCS CS1 KHÔNG xác nhận / không áp / dựng đề xuất / đánh dấu cũ ở CS2; khoản CS1 thì được", async () => {
    const a2 = await khoanDeXuat("CS2", "2026-10-17", id.gvB);
    const a1 = await khoanDeXuat("CS1", "2026-10-17", id.gvA);
    nhap("qlcs1");
    for (const quyet of ["CONFIRMED", "REJECTED"] as const) {
      expect(await actDc.quyetDieuChinhAction({ id: a2, quyet, lyDo: "Kiểm tra phạm vi cơ sở" }), quyet).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    }
    expect((await db.compensationAdjustment.findUniqueOrThrow({ where: { id: a2 } })).status).toBe("PROPOSED");
    expect(await actDc.dongBoDeXuatAction({ centerId: cs.CS2, tu: "2026-10-17", den: "2026-10-17" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    expect(await actDc.danhDauCuAction({ centerId: cs.CS2, tu: "2026-10-17", den: "2026-10-17" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    expect(await actDc.quyetDieuChinhAction({ id: a1, quyet: "CONFIRMED", lyDo: "Đúng bằng chứng" })).toMatchObject({ ok: true });
    expect((await db.compensationAdjustment.findUniqueOrThrow({ where: { id: a1 } })).status).toBe("CONFIRMED");
  });

  it("[SCOPE-05] vai Hội sở theo chính sách quyền HIỆN HÀNH: HO_HR (hr_attendance:assign GLOBAL) giao trực ở CẢ HAI cơ sở; KHÔNG có hr_attendance:approve ⇒ không quyết khoản tiền ở cơ sở nào", async () => {
    const ngay = "2026-11-06";
    nhap("hoHr");
    for (const c of ["CS1", "CS2"] as const) {
      expect(await actTruc.giaoTrucAction({ userId: c === "CS1" ? id.gvA : id.gvB, centerId: cs[c], ngay, shiftCode: "T" }), c).toMatchObject({ ok: true });
    }
    const a2 = await khoanDeXuat("CS2", "2026-10-16", id.gvB);
    expect(await actDc.quyetDieuChinhAction({ id: a2, quyet: "CONFIRMED", lyDo: "Kiểm tra vai Hội sở" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
  });

  it("[SCOPE-06] giáo viên: không xác nhận thực hiện / không quyết khoản tiền (kể cả của mình); không nhận / từ chối phân công (lời mời cũ) hay trực của NGƯỜI KHÁC", async () => {
    const ngay = "2026-10-15";
    const bA = await buoiDaDay("CS1", ngay, id.gvA);
    const aA = await khoanDeXuat("CS1", "2026-10-16", id.gvA);
    nhap("gvA");
    expect(await act.xacNhanThucHienAction({ ...bA.muc, quyetDinh: "CONFIRMED" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    expect(await actDc.quyetDieuChinhAction({ id: aA, quyet: "REJECTED", lyDo: "Tôi không đồng ý khoản này" })).toMatchObject({ ok: false, error: expect.stringMatching(CHAN) });
    expect((await db.compensationAdjustment.findUniqueOrThrow({ where: { id: aA } })).status).toBe("PROPOSED");
    // Phân công / trực của gvB: gvA gửi đúng id + phiên bản ⇒ dịch vụ từ chối (quyền là QUAN HỆ, kiểm trong giao dịch).
    soLop++;
    const lop = await db.class.create({ data: { name: `${P}L${soLop}`, classCode: `H3-L${soLop}`, courseId: khoa, centerId: cs.CS2, teacherId: id.gvB, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs.CS2, status: "SCHEDULED", date: vn("2026-11-11", "18:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    // Lời mời cũ trước 20/10: đường nhận / từ chối chỉ còn cho WAITING_ACCEPTANCE ⇒ dựng đúng hình dạng đó, để cổng QUAN HỆ
    // (không phải cổng trạng thái) là thứ chặn gvA.
    const pcB = await db.sessionStaffAssignment.update({ where: { id: (await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: s.id, userId: id.gvB } })).id }, data: { status: "WAITING_ACCEPTANCE" } });
    expect(await gvAct.quyetDinhAction({ assignmentId: pcB.id, phienBan: pcB.assignmentVersion, quyetDinh: "ACCEPTED" })).toMatchObject({ ok: false });
    expect(await gvAct.quyetDinhAction({ assignmentId: pcB.id, phienBan: pcB.assignmentVersion, quyetDinh: "DECLINED", lyDo: "Thử từ chối hộ người khác" })).toMatchObject({ ok: false });
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: pcB.id } })).toBe(0);
    const tB = await trucCho("CS2", "2026-11-11", id.gvB);
    // Lời mời trực CŨ (trước GĐ2) — để cổng QUAN HỆ chặn gvA, không phải cổng trạng thái (luật 11: chặn đúng lý do).
    await db.operationsDutyAssignment.update({ where: { id: tB }, data: { status: "WAITING_ACCEPTANCE" } });
    expect(await gvTruc.quyetDinhTrucAction({ dutyId: tB, phienBan: 1, quyetDinh: "ACCEPTED" })).toMatchObject({ ok: false });
    expect(await db.operationsDutyAcceptance.count({ where: { dutyId: tB } })).toBe(0);
    // Đối chứng dương: gvB nhận được phân công của chính mình.
    nhap("gvB");
    expect(await gvAct.quyetDinhAction({ assignmentId: pcB.id, phienBan: pcB.assignmentVersion, quyetDinh: "ACCEPTED" })).toMatchObject({ ok: true });
  });

  // Trước 18/10/2026 ca này GHIM lỗ: RBAC v1 (mặc định trong code) KHÔNG xét cơ sở ⇒ QLCS CS1 xác nhận được dòng CS2. Nay
  // mọi thao tác GHI Parttime FAIL CLOSED khi RBAC_V2_ENABLED khác "true" (`congThaoTacParttime`, M-RBAC-01).
  it("[SCOPE-V1] RBAC v1 ⇒ mọi thao tác GHI Parttime bị chặn RBAC_V2_REQUIRED_FOR_PARTTIME, không dòng nào được ghi — kể cả đúng cơ sở của mình", async () => {
    const b2 = await buoiDaDay("CS2", "2026-10-15", id.gvB); // dữ liệu dựng dưới v2 (beforeEach)
    const t1 = await trucCho("CS1", "2026-10-16", id.gvA);
    v2(false);
    const chan = expect.objectContaining({ ok: false, error: expect.stringContaining("RBAC_V2_REQUIRED_FOR_PARTTIME") });
    nhap("qlcs1");
    expect(await act.xacNhanThucHienAction({ ...b2.muc, quyetDinh: "CONFIRMED" })).toEqual(chan);
    expect(await actTruc.giaoTrucAction({ userId: id.gvA, centerId: cs.CS1, ngay: "2026-10-17", shiftCode: "T" })).toEqual(chan);
    nhap("qlcs2");
    expect(await act.xacNhanThucHienAction({ ...b2.muc, quyetDinh: "CONFIRMED" })).toEqual(chan);
    nhap("gvA");
    expect(await gvTruc.quyetDinhTrucAction({ dutyId: t1, phienBan: 1, quyetDinh: "ACCEPTED" })).toEqual(chan);
    expect(await daXacNhan(b2.muc.assignmentId)).toBe(0);
    expect(await db.operationsDutyAssignment.count({ where: { userId: id.gvA, workDate: ngayDb("2026-10-17") } })).toBe(0);
    expect(await db.operationsDutyAcceptance.count({ where: { dutyId: t1 } })).toBe(0);
    // Đối chứng dương: bật lại v2 ⇒ QLCS CS2 xác nhận được dòng của chính cơ sở mình.
    v2(true);
    nhap("qlcs2");
    expect(await act.xacNhanThucHienAction({ ...b2.muc, quyetDinh: "CONFIRMED" })).toMatchObject({ ok: true });
  });
});
