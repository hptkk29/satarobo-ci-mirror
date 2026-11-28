// @vitest-environment node
/**
 * [ATH-DB-*] P7 · "Chạy thử luật" trên Postgres thật: đọc đúng người trong cửa sổ 7 ngày, CHỈ ĐỌC (không nhật ký thi hành, không AuditLog,
 * không ghi danh), cách ly cơ sở, cổng quyền `program:manage`. Dọn theo tiền tố `CI_ELTH_`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ phien: null as null | { user: Record<string, unknown> } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.phien }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { scopedDb } from "../../lib/db-scope";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";
import { chayThuLuat } from "../../lib/elearning/automation-thu";
import { chayThuLuatAction } from "../../app/(elearning)/elearning/tu-dong-hoa/_actions";

const P = "CI_ELTH_";
const HOOK = 180_000;
const ngay = (d: number) => new Date(Date.now() + d * 86_400_000);
let F: { traHo: string; qlCs1: string; hv: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}
async function gan(userId: string, orgUnitId: string, vai: string) {
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: rd.id, status: "ACTIVE", grantedById: userId } });
}
const dem = async () => ({
  nhatKy: await db.trnAutomationLog.count(),
  audit: await db.auditLog.count({ where: { module: "elearning" } }),
  ghiDanh: await db.trnEnrollment.count(),
});

describe.skipIf(!RUN)("[ATH-DB] chạy thử luật (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    process.env.ELEARNING_ENABLED = "true";
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [ho, cs1, cs2] = await Promise.all(["HO", "CS1", "CS2"].map((c) => db.orgUnit.findUniqueOrThrow({ where: { code: c }, select: { id: true, centerId: true } })));
    const traHo = await seedUser({ email: `${P}ho@ci.test`, name: `${P}HO`, role: "TRAINING" });
    const qlCs1 = await seedUser({ email: `${P}ql1@ci.test`, name: `${P}QL1`, role: "CENTER_MANAGER" });
    const hv = await seedUser({ email: `${P}hv@ci.test`, name: `${P}HV`, role: "TEACHER" });
    await gan(traHo.id, ho.id, "TRAINING");
    await gan(qlCs1.id, cs1.id, "CENTER_MANAGER");
    const nv = async (ma: string, user: { id: string }, joined: Date, cs: { id: string; centerId: string | null }) => {
      const e = await db.employee.create({
        data: { employeeCode: `${P}${ma}`, fullName: `${P}Nv ${ma}`, jobTitle: "Giáo viên", department: "DAO_TAO", isActive: true, status: "ACTIVE", joinedAt: joined, centerId: cs.centerId as string, orgUnitId: cs.id },
        select: { id: true },
      });
      await db.user.update({ where: { id: user.id }, data: { employeeId: e.id } });
    };
    await nv("MOI1", hv, ngay(-2), cs1); // CS1, mới vào 2 ngày
    const u2 = await seedUser({ email: `${P}u2@ci.test`, name: `${P}U2`, role: "TEACHER" });
    await nv("MOI2", u2, ngay(-3), cs2); // CS2, mới vào 3 ngày
    const u3 = await seedUser({ email: `${P}u3@ci.test`, name: `${P}U3`, role: "TEACHER" });
    await nv("CU", u3, ngay(-40), cs1); // vào làm 40 ngày trước — ngoài cửa sổ 7 ngày
    F = { traHo: traHo.id, qlCs1: qlCs1.id, hv: hv.id };
  }, HOOK);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK);

  const thu = async (actorId: string, trigger = "NHAN_SU_MOI", dk: unknown = { trongVongNgay: 5 }) =>
    chayThuLuat(scopedDb(await resolveActorUncached(actorId)), { trigger, conditionJson: dk, now: new Date() });
  const tenTrong = (r: Awaited<ReturnType<typeof thu>>) => ("dong" in r ? r.dong.map((d) => d.ten).filter((t) => t.startsWith(P)).sort() : []);

  it("[ATH-DB-01] 🔴 nhân sự mới: Đào tạo (toàn hệ) thấy hai người vào làm ≤ 7 ngày, KHÔNG thấy người vào làm 40 ngày trước; cả hai sẽ thi hành (ngưỡng 5 ngày)", async () => {
    const r = await thu(F.traHo);
    expect("dong" in r && r.soKhop).toBeGreaterThanOrEqual(2);
    expect(tenTrong(r)).toEqual([`${P}Nv MOI1`, `${P}Nv MOI2`]);
    expect("dong" in r && r.dong.filter((d) => d.ten.startsWith(P)).every((d) => d.khop)).toBe(true);
  }, 60_000);

  it("[ATH-DB-02] 🔴 ngưỡng hẹp hơn ⇒ người vào làm 3 ngày trước thành bỏ qua KÈM LÝ DO (đối chứng: người 2 ngày vẫn khớp)", async () => {
    const r = await thu(F.traHo, "NHAN_SU_MOI", { trongVongNgay: 2 });
    const moi2 = "dong" in r ? r.dong.find((d) => d.ten === `${P}Nv MOI2`) : undefined;
    const moi1 = "dong" in r ? r.dong.find((d) => d.ten === `${P}Nv MOI1`) : undefined;
    expect(moi1?.khop).toBe(true);
    expect(moi2?.khop).toBe(false);
    expect(moi2?.lyDo).toMatch(/quá ngưỡng 2 ngày/);
  }, 60_000);

  it("[ATH-DB-03] 🔴 CÁCH LY cơ sở: quản lý CS1 chỉ thấy người CS1 (MOI1), không thấy MOI2 (CS2)", async () => {
    expect(tenTrong(await thu(F.qlCs1))).toEqual([`${P}Nv MOI1`]);
  }, 60_000);

  it("[ATH-DB-04] 🔴 CHỈ ĐỌC: chạy thử không đổi số dòng nhật ký thi hành, AuditLog e-learning, hay ghi danh của ai", async () => {
    const truoc = await dem();
    await thu(F.traHo);
    await thu(F.traHo, "KHOA_HOAN_THANH", {});
    await thu(F.traHo, "CHUNG_NHAN_HET_HAN", {});
    h.phien = { user: { id: F.traHo, role: "TRAINING", roles: ["TRAINING"], name: `${P}x`, email: `${P}x@ci.test` } };
    const r = await chayThuLuatAction({ trigger: "NHAN_SU_MOI", conditionJson: { trongVongNgay: 5 } });
    h.phien = null;
    expect(r.ok).toBe(true);
    expect(await dem()).toEqual(truoc);
  }, 60_000);

  it("[ATH-DB-05] kích hoạt YEU_CAU_MOI_AP_DUNG ⇒ nói thẳng không chạy thử được (không bịa danh sách); kích hoạt lạ / điều kiện sai khoá ⇒ lỗi", async () => {
    expect(await thu(F.traHo, "YEU_CAU_MOI_AP_DUNG", {})).toMatchObject({ ok: false, khongHoTro: expect.stringContaining("không có dữ liệu cũ") });
    expect(await thu(F.traHo, "KICH_HOAT_LA", {})).toMatchObject({ ok: false, loi: expect.any(String) });
    expect(await thu(F.traHo, "NHAN_SU_MOI", { khoaLa: 1 })).toMatchObject({ ok: false, loi: expect.any(String) });
  }, 60_000);

  it("[ATH-DB-06] 🔴 action: chưa đăng nhập ⇒ AUTH; người học thuần và QUẢN LÝ CƠ SỞ (không có program:manage) ⇒ PERMISSION_DENIED; Đào tạo ⇒ ok", async () => {
    const phien = (id: string, role: string) => ({ user: { id, role, roles: [role], name: `${P}x`, email: `${P}x@ci.test` } });
    const vao = { trigger: "NHAN_SU_MOI", conditionJson: { trongVongNgay: 5 } };
    h.phien = null;
    expect(await chayThuLuatAction(vao)).toMatchObject({ ok: false, error: { code: "AUTH" } });
    h.phien = phien(F.hv, "TEACHER");
    expect(await chayThuLuatAction(vao)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    h.phien = phien(F.qlCs1, "CENTER_MANAGER");
    expect(await chayThuLuatAction(vao)).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    h.phien = phien(F.traHo, "TRAINING");
    const ok = await chayThuLuatAction(vao);
    expect(ok.ok && "soKhop" in ok.data && ok.data.soKhop).toBeGreaterThanOrEqual(2);
    h.phien = null;
  }, 60_000);
});
