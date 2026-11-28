// @vitest-environment node
/**
 * [NH-DB-*] P7 · "Người học": tiến độ gom theo người, CÁCH LY cơ sở (Postgres thật). Cùng khuôn fixture với `bao-cao-tam-nhin.spec.ts` (F-01).
 *
 * Mỗi ca âm tính có ĐỐI CHỨNG DƯƠNG (luật 11): "không thấy CS2" chỉ có nghĩa khi cùng người ĐÓ thấy CS1.
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `CI_ELNH_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ phien: null as null | { user: Record<string, unknown> } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.phien }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => undefined }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { scopedDb } from "../../lib/db-scope";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";
import { coSoCuaPhamVi, loaiQuyenBaoCao } from "../../lib/elearning/report-scope";
import { gomTheoNguoi } from "../../lib/elearning/nguoi-hoc";
import { demChungNhanHopLe, nhacHocHomNay, traMotNguoiHoc, traNguoiHoc } from "../../lib/elearning/nguoi-hoc-query";
import { nhacHocNguoi } from "../../lib/elearning/nhac-hoc";
import { nhacHocAction } from "../../app/(elearning)/elearning/nguoi-hoc/_actions";

const P = "CI_ELNH_";
const HOOK = 180_000;
const NOW = new Date();
const ngay = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

let F: { qlGrant: string; qlCs1: string; traHo: string; hv1: string; hv2: string; hv3: string; cn2: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.staffNotification.deleteMany({ where: { userId: { in: ids }, dedupeKey: { startsWith: "nhac-hoc:" } } });
  await db.auditLog.deleteMany({ where: { module: "elearning", action: "REMIND", entityId: { in: ids } } });
  await db.trnCertificate.deleteMany({ where: { certCode: { startsWith: P } } });
  await db.trnEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { assignment: { title: { startsWith: P } } }] } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) {
    await db.userPermissionGrant.deleteMany({ where: { userId: { in: ids } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}
async function gan(userId: string, orgUnitId: string, vai: string) {
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: rd.id, status: "ACTIVE", grantedById: userId } });
}

describe.skipIf(!RUN)("[NH-DB] người học — gom theo người + cách ly cơ sở (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [ho, cs1, cs2] = await Promise.all(["HO", "CS1", "CS2"].map((c) => db.orgUnit.findUniqueOrThrow({ where: { code: c }, select: { id: true, centerId: true } })));
    const qlCs1 = await seedUser({ email: `${P}ql1@ci.test`, name: `${P}QL1`, role: "CENTER_MANAGER" });
    const traHo = await seedUser({ email: `${P}ho@ci.test`, name: `${P}HO`, role: "TRAINING" });
    const hv1 = await seedUser({ email: `${P}hv1@ci.test`, name: `${P}Hv1 Nguyễn`, role: "TEACHER" });
    const hv2 = await seedUser({ email: `${P}hv2@ci.test`, name: `${P}Hv2 Trần`, role: "TEACHER" });
    const hv3 = await seedUser({ email: `${P}hv3@ci.test`, name: `${P}Hv3 Lê`, role: "TEACHER" });
    const qlGrant = await seedUser({ email: `${P}qlg@ci.test`, name: `${P}QLG`, role: "CENTER_MANAGER" });
    await gan(qlCs1.id, cs1.id, "CENTER_MANAGER");
    await gan(qlGrant.id, cs1.id, "CENTER_MANAGER");
    // Grant cá nhân `elearning:*` ⇒ `scopedDb` nới thành MỌI cơ sở (bẫy F-01): bộ lọc cơ sở tường minh của module này phải chịu được.
    await db.userPermissionGrant.create({ data: { userId: qlGrant.id, action: ["elearning", "exam", "grade"].join(":"), grant: "ALLOW", grantedBy: qlGrant.id, reason: "CI_ELNH" } });
    await gan(traHo.id, ho.id, "TRAINING");

    const khoa = await db.trnCourse.create({ data: { code: `${P}K`, slug: `${P.toLowerCase()}k`, title: `${P}Khoá An toàn điện`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" }, select: { id: true } });
    const ver = await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED" }, select: { id: true } });
    const coSoHo = (await db.center.findFirst({ where: { code: "HO" }, select: { id: true } })) ?? (await db.center.create({ data: { code: "HO", name: "Hội sở (test)", slug: "ho-test-elnh", address: "CI_ELNH" }, select: { id: true } }));
    const giao = (ten: string, batBuoc: boolean) =>
      db.trnAssignment.create({
        data: { title: `${P}${ten}`, contentType: "COURSE", contentId: khoa.id, audienceMode: "STATIC", status: "ACTIVE", allowLate: true, isMandatory: batBuoc, completionRuleJson: { kieu: "MOI_BAI_BAT_BUOC" }, centerId: coSoHo.id, orgUnitId: ho.id, createdByUserId: traHo.id },
        select: { id: true },
      });
    const [aBatBuoc, aTuyChon] = [await giao("BAT_BUOC", true), await giao("TUY_CHON", false)];
    let cycle = 0;
    const ghi = (userId: string, assignmentId: string, cs: { id: string; centerId: string | null }, o: { status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "COMPLETED_LATE"; han: Date; tienDo?: number }) =>
      db.trnEnrollment.create({
        data: {
          courseId: khoa.id, courseVersionId: ver.id, userId, assignmentId, cycle: ++cycle, status: o.status, progressPercent: o.tienDo ?? 0,
          dueAt: o.han, dueAtOriginal: o.han, centerId: cs.centerId as string, orgUnitId: cs.id, source: "ASSIGNMENT", snapJobTitle: "Giáo viên",
          startedAt: o.status === "NOT_STARTED" ? null : ngay(-20), completedAt: o.status.startsWith("COMPLETED") ? ngay(-3) : null,
        },
        select: { id: true },
      });
    // hv1 (CS1): bắt buộc trễ 4,5 ngày (`soNgayTre` làm tròn LÊN ⇒ 5) chưa bắt đầu ⇒ ĐANG TRỄ; tuỳ chọn đã xong đúng hạn
    await ghi(hv1.id, aBatBuoc.id, cs1, { status: "NOT_STARTED", han: ngay(-4.5) });
    await ghi(hv1.id, aTuyChon.id, cs1, { status: "COMPLETED", han: ngay(10), tienDo: 100 });
    // hv3 (CS1): bắt buộc đã xong đúng hạn, KHÔNG trễ
    await ghi(hv3.id, aBatBuoc.id, cs1, { status: "COMPLETED", han: ngay(10), tienDo: 100 });
    // hv2 (CS2): bắt buộc đang học, trễ 1,5 ngày (⇒ 2) — người của CƠ SỞ KHÁC
    const enr2 = await ghi(hv2.id, aBatBuoc.id, cs2, { status: "IN_PROGRESS", han: ngay(-1.5), tienDo: 30 });
    await db.trnCertificate.create({
      data: { certCode: `${P}CN2`, verifyToken: `${P}tok-cn2`, userId: hv2.id, courseId: khoa.id, courseVersionId: ver.id, enrollmentId: enr2.id, snapFullName: `${P}Hv2 Trần`, snapEmployeeCode: `${P}M2`, status: "VALID" },
    });
    F = { qlGrant: qlGrant.id, qlCs1: qlCs1.id, traHo: traHo.id, hv1: hv1.id, hv2: hv2.id, hv3: hv3.id, cn2: `${P}CN2` };
  }, HOOK);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK);

  const dsCuaToi = (ds: { userId: string }[]) => ds.map((x) => x.userId).filter((u) => [F.hv1, F.hv2, F.hv3].includes(u)).sort();

  it("[NH-DB-01] 🔴 quyền xem: CENTER_MANAGER ⇒ TEAM, TRAINING ⇒ ALL; quản lý CS1 chỉ thấy người CS1 (hv1, hv3), KHÔNG thấy hv2 (CS2); Đào tạo thấy cả ba", async () => {
    const ql = await resolveActorUncached(F.qlCs1);
    const ho = await resolveActorUncached(F.traHo);
    expect(loaiQuyenBaoCao(ql)).toBe("TEAM");
    expect(loaiQuyenBaoCao(ho)).toBe("ALL");
    const thayQl = await traNguoiHoc(scopedDb(ql), coSoCuaPhamVi("TEAM", ql));
    const thayHo = await traNguoiHoc(scopedDb(ho), coSoCuaPhamVi("ALL", ho));
    expect(dsCuaToi(thayHo.dong)).toEqual([F.hv1, F.hv1, F.hv2, F.hv3].sort()); // đối chứng dương: người có quyền toàn hệ thấy hv2
    expect(dsCuaToi(thayQl.dong)).toEqual([F.hv1, F.hv1, F.hv3].sort());
    expect(thayQl.dong.some((d) => d.userId === F.hv2)).toBe(false);
  }, 60_000);

  it("[NH-DB-02] 🔴 gom theo người đúng số liệu từ DB: hv1 ⇒ 1 lượt ĐANG TRỄ (5 ngày), bắt buộc 0/1; hv3 ⇒ bắt buộc 1/1, không trễ; hv2 ⇒ đang học trễ 2 ngày; người CẦN CHÚ Ý xếp trước", async () => {
    const ho = await resolveActorUncached(F.traHo);
    const { dong } = await traNguoiHoc(scopedDb(ho), coSoCuaPhamVi("ALL", ho));
    const tom = gomTheoNguoi(dong, new Date());
    const ma = (u: string) => tom.find((x) => x.userId === u)!;
    expect(ma(F.hv1)).toMatchObject({ soLuot: 2, batBuoc: 1, batBuocDat: 0, dangTre: 1, treNhieuNhat: 5, canChuY: true });
    expect(ma(F.hv3)).toMatchObject({ soLuot: 1, batBuoc: 1, batBuocDat: 1, dangTre: 0, canChuY: false });
    expect(ma(F.hv2)).toMatchObject({ batBuoc: 1, batBuocDat: 0, dangTre: 1, treNhieuNhat: 2, canChuY: true });
    const i1 = tom.findIndex((x) => x.userId === F.hv1);
    const i2 = tom.findIndex((x) => x.userId === F.hv2);
    const i3 = tom.findIndex((x) => x.userId === F.hv3);
    expect(i1).toBeLessThan(i2); // trễ 5 ngày trước trễ 2 ngày
    expect(i2).toBeLessThan(i3); // người cần chú ý trước người ổn
    expect(ma(F.hv1).ten).toContain("Hv1"); // tên từ User khi không có hồ sơ nhân sự
  }, 60_000);

  it("[NH-DB-03] 🔴 hồ sơ MỘT người: quản lý CS1 mở hv1 ⇒ có; mở hv2 (CS2) ⇒ null (không lộ người cơ sở khác); id không tồn tại ⇒ null; Đào tạo mở hv2 ⇒ có kèm chứng nhận", async () => {
    const ql = await resolveActorUncached(F.qlCs1);
    const ho = await resolveActorUncached(F.traHo);
    const coQl = coSoCuaPhamVi("TEAM", ql);
    const a = await traMotNguoiHoc(scopedDb(ql), coQl, F.hv1);
    expect(a?.dong).toHaveLength(2);
    expect(await traMotNguoiHoc(scopedDb(ql), coQl, F.hv2)).toBeNull();
    expect(await traMotNguoiHoc(scopedDb(ql), coQl, "khong-co-nguoi-nay")).toBeNull();
    const b = await traMotNguoiHoc(scopedDb(ho), coSoCuaPhamVi("ALL", ho), F.hv2);
    expect(b?.dong).toHaveLength(1);
    expect(b?.chungNhan.map((c) => c.certCode)).toEqual([F.cn2]);
  }, 60_000);

  it("[NH-DB-05] 🔴 BẪY F-01: quản lý CS1 có grant cá nhân (scopedDb nới ra mọi cơ sở) VẪN không thấy hv2 ở danh sách lẫn hồ sơ — bộ lọc cơ sở tường minh là hàng rào thật; đối chứng: thấy hv1", async () => {
    const q = await resolveActorUncached(F.qlGrant);
    expect(loaiQuyenBaoCao(q)).toBe("TEAM");
    const co = coSoCuaPhamVi("TEAM", q);
    const thay = await traNguoiHoc(scopedDb(q), co);
    expect(dsCuaToi(thay.dong)).toEqual([F.hv1, F.hv1, F.hv3].sort());
    expect((await traMotNguoiHoc(scopedDb(q), co, F.hv1))?.dong).toHaveLength(2);
    expect(await traMotNguoiHoc(scopedDb(q), co, F.hv2)).toBeNull();
  }, 60_000);

  it("[NH-DB-04] 🔴 đếm chứng nhận cũng CÁCH LY: chứng nhận của hv2 (CS2) tính 1 với phạm vi toàn hệ, 0 với phạm vi CS1", async () => {
    const ql = await resolveActorUncached(F.qlCs1);
    expect((await demChungNhanHopLe([F.hv2], "TAT_CA")).get(F.hv2)).toBe(1);
    expect((await demChungNhanHopLe([F.hv2], coSoCuaPhamVi("TEAM", ql))).get(F.hv2) ?? 0).toBe(0);
  }, 60_000);

  // ── Nhắc học (P7) ─────────────────────────────────────────────────────────────────────────────
  const nhac = async (actorId: string, ids: string[], now = new Date()) => {
    const a = await resolveActorUncached(actorId);
    const loai = loaiQuyenBaoCao(a)!;
    return nhacHocNguoi({ sdb: scopedDb(a), coSo: coSoCuaPhamVi(loai, a), userIds: ids, nguoiGui: { id: actorId, name: `${P}x` }, now });
  };
  const soThongBao = (userId: string) => db.staffNotification.count({ where: { userId, dedupeKey: { startsWith: "nhac-hoc:" } } });
  const soAudit = (userId: string) => db.auditLog.count({ where: { module: "elearning", action: "REMIND", entityId: userId } });

  it("[NH-DB-06] 🔴 Nhắc học: người còn nợ trong tầm nhìn ⇒ GỬI THẬT (1 thông báo + 1 dòng sổ); người cơ sở khác ⇒ khongThay, KHÔNG thông báo, KHÔNG sổ; người xong hết ⇒ khongCanNhac", async () => {
    const r = await nhac(F.qlCs1, [F.hv1, F.hv2, F.hv3]);
    expect(r.daNhac).toEqual([F.hv1]);
    expect(r.khongThay).toEqual([F.hv2]);
    expect(r.khongCanNhac).toEqual([F.hv3]);
    expect(await soThongBao(F.hv1)).toBe(1);
    expect(await soAudit(F.hv1)).toBe(1);
    expect(await soThongBao(F.hv2)).toBe(0);
    expect(await soAudit(F.hv2)).toBe(0);
    expect(await soThongBao(F.hv3)).toBe(0);
    const tb = await db.staffNotification.findFirstOrThrow({ where: { userId: F.hv1, dedupeKey: { startsWith: "nhac-hoc:" } }, select: { title: true, href: true } });
    expect(tb.title).toContain("trễ hạn"); // hv1 có khoá bắt buộc trễ
    expect(tb.href).toBe("/elearning/khoa-cua-toi");
  }, 60_000);

  it("[NH-DB-07] 🔴 MỘT lần/người/ngày: bấm lại cùng ngày ⇒ daNhacHomNay, không thêm thông báo, không thêm dòng sổ; sang NGÀY VN KHÁC ⇒ nhắc lại được; 'Đã nhắc hh:mm' đọc được từ sổ", async () => {
    // Phụ thuộc [NH-DB-06] đã nhắc hv1 hôm nay (đồng hồ thật); dựng lại độc lập để ca này chạy được MỘT MÌNH.
    await db.staffNotification.deleteMany({ where: { userId: F.hv1, dedupeKey: { startsWith: "nhac-hoc:" } } });
    await db.auditLog.deleteMany({ where: { module: "elearning", action: "REMIND", entityId: F.hv1 } });
    const t0 = new Date();
    expect((await nhac(F.traHo, [F.hv1], t0)).daNhac).toEqual([F.hv1]);
    const lai = await nhac(F.traHo, [F.hv1], t0);
    expect(lai.daNhac).toEqual([]);
    expect(lai.daNhacHomNay).toEqual([F.hv1]);
    expect(await soThongBao(F.hv1)).toBe(1);
    expect(await soAudit(F.hv1)).toBe(1);
    expect((await nhacHocHomNay([F.hv1, F.hv2], t0)).has(F.hv1)).toBe(true);
    expect((await nhacHocHomNay([F.hv1, F.hv2], t0)).has(F.hv2)).toBe(false); // đối chứng: hv2 chưa được nhắc
    // Ngày VN kế tiếp: khoá chống trùng khác ⇒ nhắc lại được (sổ "hôm nay" tính theo mốc `now` truyền vào).
    const mai = new Date(t0.getTime() + 24 * 3600_000);
    expect((await nhacHocHomNay([F.hv1], mai)).has(F.hv1)).toBe(false);
  }, 60_000);

  it("[NH-DB-08] 🔴 BẪY F-01: quản lý CS1 có grant cá nhân (scopedDb nới ra mọi cơ sở) VẪN không nhắc được hv2; đối chứng: nhắc được hv1", async () => {
    await db.staffNotification.deleteMany({ where: { userId: { in: [F.hv1, F.hv2] }, dedupeKey: { startsWith: "nhac-hoc:" } } });
    await db.auditLog.deleteMany({ where: { module: "elearning", action: "REMIND", entityId: { in: [F.hv1, F.hv2] } } });
    const r = await nhac(F.qlGrant, [F.hv1, F.hv2]);
    expect(r.daNhac).toEqual([F.hv1]);
    expect(r.khongThay).toEqual([F.hv2]);
    expect(await soThongBao(F.hv2)).toBe(0);
  }, 60_000);

  it("[NH-DB-09] 🔴 Server action: phiên người học thuần ⇒ PERMISSION_DENIED (không gửi gì); chưa đăng nhập ⇒ AUTH; danh sách rỗng/quá trần ⇒ VALIDATION; Đào tạo ⇒ ok", async () => {
    await db.staffNotification.deleteMany({ where: { userId: { in: [F.hv1, F.hv2] }, dedupeKey: { startsWith: "nhac-hoc:" } } });
    await db.auditLog.deleteMany({ where: { module: "elearning", action: "REMIND", entityId: { in: [F.hv1, F.hv2] } } });
    const phien = (id: string, role: string) => ({ user: { id, role, roles: [role], name: `${P}x`, email: `${P}x@ci.test` } });
    process.env.ELEARNING_ENABLED = "true";
    h.phien = null;
    expect(await nhacHocAction({ userIds: [F.hv1] })).toMatchObject({ ok: false, error: { code: "AUTH" } });
    h.phien = phien(F.hv3, "TEACHER");
    expect(await nhacHocAction({ userIds: [F.hv1] })).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(await soThongBao(F.hv1)).toBe(0);
    h.phien = phien(F.traHo, "TRAINING");
    expect(await nhacHocAction({ userIds: [] })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await nhacHocAction({ userIds: Array.from({ length: 501 }, (_, i) => `x${i}`) })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    const ok = await nhacHocAction({ userIds: [F.hv2] });
    expect(ok.ok && ok.data.daNhac).toEqual([F.hv2]);
    h.phien = null;
  }, 60_000);
});
