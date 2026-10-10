/**
 * Task #07 (DoD#4) — Cách ly cơ sở cho luồng IMPORT lead "đã đăng ký" + xếp trải nghiệm.
 * Postgres LOCAL (.env.test). Actor resolve THẬT từ DB (OrgUnit + RoleDef + UserOrgRole).
 *
 * Mục tiêu (2 luồng của #07):
 *   1. IMPORT: Sale CS1 nạp file có dòng gắn CS2 → passesScope LOẠI trên đường TẠO
 *      (route registered chỉ scope READ; WRITE chốt bằng passesScope per-lead) →
 *      KHÔNG tạo lead CS2. Đối chứng: Sale CS2 chỉ tạo CS2; HO cross-center tạo cả 2.
 *   2. XẾP TRẢI NGHIỆM: picker/scopedDb của Sale CS1 KHÔNG thấy/không chạm lớp
 *      TrialClassV2 của CS2 (IDOR theo id + không lọt qua findMany), và ngược lại.
 *
 * ⚠️ Test chạy TRỰC TIẾP trên các building-block mà route/action dùng (parseRegisteredSheets
 * + planRegisteredImport + passesScope + scopedDb) — KHÔNG dựng HTTP server/auth().
 * Cùng phong cách security-gate.spec.ts (R7-00-C4).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import { passesScope, scopedDb } from "../../../lib/db-scope";
import {
  parseRegisteredSheets,
  planRegisteredImport,
  buildCourseKeyMap,
  type LeadCreatePlan,
  type ExistingLead,
  type SheetAoA,
} from "../../../lib/lead/import-registered";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string): Promise<string> {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function roleId(code: string): Promise<string> {
  return (await db.roleDef.findUnique({ where: { code }, select: { id: true } }))!.id;
}
/** Tạo user + gán 1 role tại 1 orgUnit → actor resolve thật. */
async function makeActor(slug: string, orgCode: string, roleCode: string): Promise<Actor> {
  const u = await seedUser({ email: testEmail(roleCode, slug), role: "SALES_CSM" });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: await orgId(orgCode),
    roleId: await roleId(roleCode),
    reason: "seed #07 isolation",
  });
  return resolveActorUncached(u.id);
}

/**
 * File "đã đăng ký" tối giản: 1 dòng gắn CS1 + 1 dòng gắn CS2 (cột "Cơ sở" như
 * file thật "CS2: Hoàng Diệu"). Header khớp findHeader (cần "Số điện thoại" +
 * "Họ và Tên học viên").
 */
function twoCenterSheet(): SheetAoA[] {
  return [
    {
      name: "Tháng 7",
      rows: [
        ["Họ và Tên học viên", "Số điện thoại", "Cơ sở", "Lớp"],
        ["Bé An", "0900000011", "CS1: Nguyễn Hữu Thọ", "Lớp 3"],
        ["Bé Bảo", "0900000022", "CS2: Hoàng Diệu", "Lớp 4"],
      ],
    },
  ];
}

/** Guard cách-ly y HỆT route registered (đường TẠO): centerId null → giữ; else passesScope. */
function partitionByScope(
  creates: LeadCreatePlan[],
  actor: Actor,
): { kept: LeadCreatePlan[]; rejected: LeadCreatePlan[] } {
  const kept: LeadCreatePlan[] = [];
  const rejected: LeadCreatePlan[] = [];
  for (const c of creates) {
    if (c.centerId == null || passesScope("Lead", { centerId: c.centerId }, actor)) kept.push(c);
    else rejected.push(c);
  }
  return { kept, rejected };
}

/** Dựng plan.creates từ file 2 cơ sở (như route: parse → resolve maps → plan). */
async function planFromTwoCenterSheet(): Promise<LeadCreatePlan[]> {
  const parsed = parseRegisteredSheets(twoCenterSheet());
  const centers = await db.center.findMany({
    where: { code: { not: null } },
    select: { id: true, code: true },
  });
  const orgUnits = await db.orgUnit.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true },
  });
  const plan = planRegisteredImport(parsed, {
    centerByCode: new Map(centers.filter((c) => c.code).map((c) => [c.code as string, c.id])),
    orgUnitByCode: new Map(orgUnits.filter((o) => o.code).map((o) => [o.code, o.id])),
    courseByKey: buildCourseKeyMap([]),
    salesUsers: [],
    existingByPhone: new Map<string, ExistingLead>(),
  });
  return plan.creates;
}

/** Ghi các create GIỮ LẠI (mô phỏng mode=confirm) — chỉ field cần cho assert cách ly. */
async function writeCreates(creates: LeadCreatePlan[]): Promise<void> {
  for (const c of creates) {
    await db.lead.create({
      data: {
        parentName: c.parentName,
        phone: c.phone,
        centerId: c.centerId,
        orgUnitId: c.orgUnitId,
        courseId: c.courseId,
        status: "DA_DANG_KY",
      },
    });
  }
}

test.describe("[#07-ISO] Import 'đã đăng ký' + xếp trải nghiệm — cách ly cơ sở", () => {
  let cs1 = "";
  let cs2 = "";
  let saleCs1!: Actor;
  let saleCs2!: Actor;
  let hoAcc!: Actor;

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-imp07", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-imp07", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = await centerId("CS1");
    cs2 = await centerId("CS2");
    saleCs1 = await makeActor("cs1", "CS1", "CENTER_SALES_CSM");
    saleCs2 = await makeActor("cs2", "CS2", "CENTER_SALES_CSM");
    // Đối chứng cross-center: HO_ACCOUNTANT@HO → getModelVisibleCenterIds('Lead') = ALL
    // (đã chứng minh ở R7-00-C4-05) → passesScope mọi cơ sở.
    hoAcc = await makeActor("ho", "HO", "HO_ACCOUNTANT");
  });

  // ── Luồng 1: IMPORT ────────────────────────────────────────────────────────
  test("[#07-ISO-01] Sale CS1 import dòng gắn CS2 → passesScope LOẠI, KHÔNG tạo lead CS2", async () => {
    // Bất biến gốc mà guard dựa vào.
    expect(passesScope("Lead", { centerId: cs1 }, saleCs1)).toBe(true);
    expect(passesScope("Lead", { centerId: cs2 }, saleCs1)).toBe(false);

    const creates = await planFromTwoCenterSheet();
    expect(creates).toHaveLength(2); // plan có cả CS1 lẫn CS2 (chưa lọc)

    const { kept, rejected } = partitionByScope(creates, saleCs1);
    // CS1 giữ, CS2 loại.
    expect(kept.map((c) => c.centerId)).toEqual([cs1]);
    expect(rejected.map((c) => c.centerId)).toEqual([cs2]);
    expect(rejected.map((c) => c.phone)).toEqual(["84900000022"]);

    // Mô phỏng mode=confirm: chỉ ghi phần GIỮ LẠI → không có lead CS2 nào ra đời.
    await writeCreates(kept);
    expect(await db.lead.count({ where: { centerId: cs2 } })).toBe(0);
    expect(await db.lead.count({ where: { centerId: cs1 } })).toBe(1);
  });

  test("[#07-ISO-02] Sale CS2 import cùng file → chỉ tạo lead CS2, LOẠI CS1 (đối chứng)", async () => {
    expect(passesScope("Lead", { centerId: cs2 }, saleCs2)).toBe(true);
    expect(passesScope("Lead", { centerId: cs1 }, saleCs2)).toBe(false);

    const creates = await planFromTwoCenterSheet();
    const { kept, rejected } = partitionByScope(creates, saleCs2);
    expect(kept.map((c) => c.centerId)).toEqual([cs2]);
    expect(rejected.map((c) => c.centerId)).toEqual([cs1]);

    await writeCreates(kept);
    expect(await db.lead.count({ where: { centerId: cs1 } })).toBe(0);
    expect(await db.lead.count({ where: { centerId: cs2 } })).toBe(1);
  });

  test("[#07-ISO-03] HO (cross-center) import → tạo được cả CS1 lẫn CS2 (guard KHÔNG chặn nhầm)", async () => {
    expect(passesScope("Lead", { centerId: cs1 }, hoAcc)).toBe(true);
    expect(passesScope("Lead", { centerId: cs2 }, hoAcc)).toBe(true);

    const creates = await planFromTwoCenterSheet();
    const { kept, rejected } = partitionByScope(creates, hoAcc);
    expect(rejected).toHaveLength(0);
    expect(new Set(kept.map((c) => c.centerId))).toEqual(new Set([cs1, cs2]));

    await writeCreates(kept);
    expect(await db.lead.count({ where: { centerId: cs1 } })).toBe(1);
    expect(await db.lead.count({ where: { centerId: cs2 } })).toBe(1);
  });

  // ── Luồng 2: XẾP TRẢI NGHIỆM (TrialClassV2) ─────────────────────────────────
  test("[#07-ISO-04] Picker/scopedDb Sale CS1 KHÔNG thấy & KHÔNG chạm lớp trải nghiệm CS2", async () => {
    const tcCs1 = await db.trialClassV2.create({
      data: { code: "TCV2-CS1", name: "Lớp TN CS1", centerId: cs1, startTime: "18:00", endTime: "19:30", capacity: 8, sessionCount: 4 },
    });
    const tcCs2 = await db.trialClassV2.create({
      data: { code: "TCV2-CS2", name: "Lớp TN CS2", centerId: cs2, startTime: "18:00", endTime: "19:30", capacity: 8, sessionCount: 4 },
    });

    // Picker (searchTrialCandidates dùng scopedDb.findMany) — Sale CS1 chỉ thấy lớp CS1.
    const visible = await scopedDb(saleCs1).trialClassV2.findMany({
      where: { status: "OPEN" },
      select: { id: true, centerId: true },
    });
    expect(visible.map((c) => c.id)).toEqual([tcCs1.id]);
    expect(visible.some((c) => c.centerId === cs2)).toBe(false);

    // loadScopedTrialClass (findUnique theo id + passesScope) — chống IDOR ghi thẳng id CS2.
    const idorRow = await scopedDb(saleCs1).trialClassV2.findUnique({ where: { id: tcCs2.id } });
    expect(idorRow).toBeNull();
    expect(passesScope("TrialClassV2", { centerId: cs2 }, saleCs1)).toBe(false);
    // đối chứng: lớp cùng cơ sở vẫn nạp được.
    expect(await scopedDb(saleCs1).trialClassV2.findUnique({ where: { id: tcCs1.id } })).not.toBeNull();

    // Sale CS2 đối xứng: thấy CS2, không thấy/không chạm CS1.
    const visible2 = await scopedDb(saleCs2).trialClassV2.findMany({
      where: { status: "OPEN" },
      select: { id: true },
    });
    expect(visible2.map((c) => c.id)).toEqual([tcCs2.id]);
    expect(await scopedDb(saleCs2).trialClassV2.findUnique({ where: { id: tcCs1.id } })).toBeNull();
  });
});
