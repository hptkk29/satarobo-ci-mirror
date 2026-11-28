// @vitest-environment node
/**
 * HO-SCOPE (OD-26-02, 27/11/2026) — tầm nhìn HỌC VIÊN của vai Hội sở, bằng RBAC THẬT trên Postgres:
 * `seedRoles` thật + `UserOrgRole` thật + `resolveActorUncached` thật (KHÔNG actor viết tay) → `can()` v1/v2 → `scopedDb`.
 *
 * Finding: `getModelVisibleCenterIdsGoc` trả "ALL" cho actor neo Hội sở THIẾU mọi `students:*` (nhánh fallback
 * `isHoLevel ? "ALL"`) ⇒ nhân sự Hội sở nào qua được MỘT cổng `can()` khác (Sale Hội sở: `leads:create` → ô tìm
 * người giới thiệu) cũng thấy học viên `centerId = NULL` (Online-only / chưa quy cơ sở). OD-26-02: "không tự cấp cho
 * mọi NV Hội sở". Vá: họ `students:` + Hội sở thiếu quyền ⇒ `visibleCenterIds` (mọi cơ sở TRONG CÂY), không "ALL".
 *
 * Dữ liệu scope KHÔNG đọc cờ RBAC_V2_ENABLED (chỉ đọc Actor) ⇒ v1 và v2 chỉ khác nhau ở CỔNG; ca [HOSC-02] in và
 * ghim cổng cả hai đường. Mã ca [HOSC-*]. Bảng dữ liệu dùng tiền tố `HOSC_`, dọn theo tiền tố; OrgUnit/Center tự tạo thì trả lại.
 * ⚠️ Tự SKIP khi không có Postgres test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS, assertTenDbTest } from "../_helpers/db-gate";
import { seedOrgUnits } from "../../prisma/seed-orgunit";
import { seedRoles } from "../../prisma/seed-roles";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { evaluatePermission } from "../../lib/auth/permission-eval";
import { resolveGrant } from "../../lib/permissions/can";
import { getModelVisibleCenterIds, scopedDb } from "../../lib/db-scope";
import { timNguoiGioiThieu } from "../../lib/nguon/tim-nguoi-gioi-thieu";

const db = new PrismaClient();
const CO_DB = RUN_DB_TESTS && (await db.student.count().then(() => true).catch(() => false));
if (!CO_DB) console.warn("[ho-scope-hoc-vien] SKIP: không có Postgres test.");

const P = "HOSC_";
type Legacy = "SUPER_ADMIN" | "MARKETING" | "SALES_CSM" | "CENTER_MANAGER" | "TRAINING" | "ACCOUNTANT";

describe.skipIf(!CO_DB)("[HOSC] Hội sở thiếu students:* — tầm nhìn học viên (RBAC thật)", () => {
  const actor: Record<string, Actor> = {};
  const legacy: Record<string, Legacy> = {};
  const hv: Record<"cs1" | "cs2" | "khongCoSo", string> = { cs1: "", cs2: "", khongCoSo: "" };
  let orgUnitCoTruoc = new Set<string>();
  let centerCoTruoc = new Set<string>();

  async function don() {
    await db.student.deleteMany({ where: { name: { startsWith: P } } });
    const ids = (await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } })).map((u) => u.id);
    await db.userPermissionGrant.deleteMany({ where: { userId: { in: ids } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { email: { startsWith: P.toLowerCase() } } });
  }

  beforeAll(async () => {
    assertTenDbTest();
    await don();
    orgUnitCoTruoc = new Set((await db.orgUnit.findMany({ select: { id: true } })).map((x) => x.id));
    centerCoTruoc = new Set((await db.center.findMany({ select: { id: true } })).map((x) => x.id));
    for (const [code, name] of [["CS1", "HOSC Cơ sở 1"], ["CS2", "HOSC Cơ sở 2"]] as const) {
      await db.center.upsert({ where: { code }, update: { isActive: true }, create: { code, name, slug: code.toLowerCase(), address: "1 Đường Thử", isActive: true } });
    }
    await seedOrgUnits(db, ["HO", "CS1", "CS2"]);
    await seedRoles(db);
    const ou = async (code: string) => db.orgUnit.findFirstOrThrow({ where: { code }, select: { id: true, centerId: true } });
    const [ho, u1, u2] = [await ou("HO"), await ou("CS1"), await ou("CS2")];

    const tao = async (khoa: string, role: string, noiNeo: { id: string }, vaiCu: Legacy, grant?: string) => {
      const u = await db.user.create({ data: { name: `${P}${khoa}`, email: `${P.toLowerCase()}${khoa.toLowerCase()}@example.test`, role: vaiCu, roles: [vaiCu] } });
      const r = await db.roleDef.findUniqueOrThrow({ where: { code: role }, select: { id: true } });
      // effectiveFrom lùi 1 phút: lệch đồng hồ Node ↔ DB làm vai "chưa hiệu lực" (ca flaky đã gặp ở [AMQ]).
      await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: noiNeo.id, roleId: r.id, grantedById: u.id, effectiveFrom: new Date(Date.now() - 60_000) } });
      if (grant) await db.userPermissionGrant.create({ data: { userId: u.id, action: grant, grant: "ALLOW", grantedBy: u.id, reason: `${P}đo R-QDB-07` } });
      legacy[khoa] = vaiCu;
      actor[khoa] = await resolveActorUncached(u.id);
    };
    await tao("SUPER_ADMIN", "SUPER_ADMIN", ho, "SUPER_ADMIN");
    await tao("HO_MARKETING", "HO_MARKETING", ho, "MARKETING"); // Hội sở CÓ students:view-all — đối chứng dương
    await tao("HO_SALE", "HO_SALE", ho, "SALES_CSM");
    await tao("TRAINING", "TRAINING", ho, "TRAINING");
    await tao("AUDITOR", "AUDITOR", ho, "TRAINING");
    await tao("GIAM_DOC", "GIAM_DOC", ho, "ACCOUNTANT");
    await tao("CM_CS1", "CENTER_MANAGER", u1, "CENTER_MANAGER");
    await tao("SALE_CS1_GRANT", "CENTER_SALES_CSM", u1, "SALES_CSM", "students:import");

    for (const [k, centerId] of [["cs1", u1.centerId], ["cs2", u2.centerId], ["khongCoSo", null]] as const) {
      const s = await db.student.create({ data: { name: `${P}Bé ${k}`, parentName: `${P}PH ${k}`, centerId } });
      hv[k] = s.id;
    }
  }, 120_000);

  afterAll(async () => {
    if (!CO_DB) return;
    await don();
    const moi = await db.orgUnit.findMany({ where: { id: { notIn: [...orgUnitCoTruoc] } }, select: { id: true }, orderBy: { depth: "desc" } });
    for (const o of moi) await db.orgUnit.delete({ where: { id: o.id } });
    await db.center.deleteMany({ where: { id: { notIn: [...centerCoTruoc] } } });
    await db.$disconnect();
  });

  /** Học viên `HOSC_` actor đọc được qua scopedDb (đúng truy vấn của /admin/hoc-ba, /admin/students). */
  async function thay(khoa: string): Promise<string[]> {
    const rows = await scopedDb(actor[khoa]).student.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
    const ten = Object.fromEntries(Object.entries(hv).map(([k, id]) => [id, k]));
    return rows.map((r) => ten[r.id]).sort();
  }

  it("[HOSC-01] vai Hội sở THIẾU students:* thấy học viên mọi cơ sở trong cây nhưng KHÔNG thấy học viên không cơ sở (centerId NULL)", async () => {
    for (const khoa of ["HO_SALE", "TRAINING", "AUDITOR", "GIAM_DOC"]) {
      expect(actor[khoa].isHoLevel, khoa).toBe(true);
      expect(actor[khoa].permissions.some((p) => p.action.startsWith("students:")), `${khoa} không giữ students:*`).toBe(false);
      expect(getModelVisibleCenterIds("Student", actor[khoa]), khoa).not.toBe("ALL");
      expect(await thay(khoa), khoa).toEqual(["cs1", "cs2"]);
    }
  });

  it("[HOSC-02] cổng can() v1 (cột vai cũ) / v2 (RoleDef) — dữ liệu scope không đọc cờ; PermissionGrant mới không can thiệp", () => {
    const KHOA = [
      "students:view-all", "students:view-own-class", "curriculum:view", "leads:create", "session-feedback:share",
      "entitlements:view", "elearning:progress:view-all", "enrollments:create", "completions:manage", "bao-luu:create",
      "notifications:manage", "parent-feedback:view", "satacoin:manage", "evaluations:view-detail", "media:view",
    ];
    const bang: Record<string, Record<string, string>> = {};
    for (const khoa of ["HO_SALE", "TRAINING", "AUDITOR", "GIAM_DOC", "HO_MARKETING"]) {
      bang[khoa] = {};
      for (const k of KHOA) {
        expect(resolveGrant(actor[khoa], k).hit, `${khoa} ${k}`).toBe(false);
        const di = (flagOn: boolean) =>
          evaluatePermission({ sessionUser: { role: legacy[khoa], roles: [legacy[khoa]] }, actor: actor[khoa], action: k, flagOn, logger: { warn: () => {} } });
        bang[khoa][k] = `v1=${di(false) ? 1 : 0} v2=${di(true) ? 1 : 0}`;
      }
    }
    console.log("[HOSC-02] cổng theo vai (v1 theo cột vai cũ, v2 theo RoleDef neo HO):\n" + JSON.stringify(bang, null, 1));
    // Đường lọt đã đo: Sale Hội sở qua cổng ô tìm người giới thiệu (`leads:create`) ở CẢ HAI đường; KHÔNG có students:view-all ở v2.
    expect(bang.HO_SALE["leads:create"]).toBe("v1=1 v2=1");
    expect(bang.HO_SALE["students:view-all"]).toBe("v1=1 v2=0"); // v1 suy từ cột vai cũ SALES_CSM — không biết nơi neo
    // Đào tạo qua cổng /admin/hoc-ba (`curriculum:view`) ở cả hai đường, không giữ students:view-all ở v2.
    expect(bang.TRAINING["curriculum:view"]).toBe("v1=1 v2=1");
    expect(bang.TRAINING["students:view-all"]).toBe("v1=0 v2=0");
  });

  it("[HOSC-03] đường thật: ô tìm người giới thiệu (PHU_HUYNH) của Sale Hội sở KHÔNG trả học viên không cơ sở; vẫn trả CS1 + CS2", async () => {
    const kq = await timNguoiGioiThieu(actor.HO_SALE, { loai: "PHU_HUYNH", q: `${P}PH`, gioiHan: 20, coTheTimTheoSdt: false, canViewPii: true, now: new Date() });
    const ids = kq.map((x) => (x.loai === "PHU_HUYNH" ? x.studentId : "")).sort();
    expect(ids).toEqual([hv.cs1, hv.cs2].sort());
  });

  it("[HOSC-04] đối chứng: Hội sở CÓ students:* và SUPER_ADMIN thấy cả 3; QLCS CS1 chỉ CS1", async () => {
    expect(getModelVisibleCenterIds("Student", actor.HO_MARKETING)).toBe("ALL");
    expect(await thay("HO_MARKETING")).toEqual(["cs1", "cs2", "khongCoSo"]);
    expect(await thay("SUPER_ADMIN")).toEqual(["cs1", "cs2", "khongCoSo"]);
    expect(await thay("CM_CS1")).toEqual(["cs1"]);
  });

  it("[HOSC-05] KHÔNG lan sang model khác: vai Hội sở thiếu quyền model vẫn 'ALL' ở Lead/Class/Enrollment (hành vi cũ giữ nguyên)", () => {
    expect(getModelVisibleCenterIds("Lead", actor.TRAINING)).toBe("ALL");
    expect(getModelVisibleCenterIds("Enrollment", actor.TRAINING)).toBe("ALL");
    expect(getModelVisibleCenterIds("Class", actor.HO_SALE)).toBe("ALL");
  });

  // R-QDB-07 (docs/taicautruc/02-prd-franchise-platform.md:247, trạng thái ✗) — grant ALLOW theo NGƯỜI khớp tiền tố
  // model ⇒ "ALL". Đo: QLCS/Sale neo CS1 có grant `students:import` thấy học viên CS2 + không cơ sở. CHƯA VÁ trong PR
  // này: chú thích mã + [RXT-DB-*] coi grant là "ngoại lệ toàn cục có chủ đích", và GD-23 (04-assumptions.md) đòi đo
  // grant ALLOW trên PROD trước khi cắt ⇒ Owner quyết. `it.fails` = mô tả hành vi ĐÚNG theo R-QDB-07; vá xong ⇒ gỡ.
  it.fails("[HOSC-06] (R-QDB-07, chờ Owner) Sale CS1 có grant ALLOW students:import vẫn chỉ thấy CS1", async () => {
    // Đối chứng: KHÔNG có grant thì cùng vai neo CS1 chỉ thấy CS1 — nên ca này đỏ ĐÚNG vì grant, không vì fixture.
    expect(actor.SALE_CS1_GRANT.isHoLevel).toBe(false);
    expect(getModelVisibleCenterIds("Student", { ...actor.SALE_CS1_GRANT, grantsAllow: new Set() })).toEqual(actor.SALE_CS1_GRANT.visibleCenterIds);
    const thayDuoc = await thay("SALE_CS1_GRANT");
    console.log(`[HOSC-06] Sale CS1 + grant students:import thấy: ${JSON.stringify(thayDuoc)}`);
    expect(thayDuoc).toEqual(["cs1"]);
  });
});
