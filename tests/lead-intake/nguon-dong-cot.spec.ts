// @vitest-environment node
/**
 * NGUỒN ĐỘNG (SPEC 09/10/2026 §1) — các CỘT/ràng buộc mới của `LeadSourceGroup` + `LeadAttribution`, trên Postgres LOCAL thật.
 *
 *   [NHH-DYN-DB-01]  CHECK `LeadSourceGroup_cua_so_chk`: cửa sổ ghi công riêng phải trong (0, 3650] (NULL = dùng setting chung); SQLSTATE 23514
 *   [NHH-DYN-DB-02]  CHECK `LeadSourceGroup_hieu_luc_chk`: effectiveTo > effectiveFrom (thiếu một đầu = mở)
 *   [NHH-DYN-DB-03]  nguồn do admin tạo ra đời với mặc định AN TOÀN: sourceType OTHER, commissionEnabled FALSE, không chủ, không hiệu lực
 *   [NHH-DYN-DB-04]  enum `LeadSourceType` chỉ nhận tám giá trị
 *   [NHH-DYN-DB-05]  FK `ownerEmployeeId` và `referrerSaleUserId` là RESTRICT THẬT (tên ràng buộc + catalog `confdeltype`)
 *   [NHH-DYN-DB-06]  `nhanSuDangPhuTrachNguon` bắt nhân sự đang phụ trách một nguồn; không bắt oan
 *   [NHH-DYN-DB-07]  snapshot `referrerRoleCode` / `referrerSaleUserId` ghi và đọc lại đúng; không kéo theo ràng buộc người giới thiệu
 *   [NHH-DYN-W]      lưới dây nối: `deleteEmployeeAction` hỏi `nhanSuDangPhuTrachNguon(` TRƯỚC `employee.delete(`
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `NDC_`. Mỗi ca tự dựng thứ nó cần (luật 18) — chạy MỘT MÌNH trên DB trống đã
 * migrate + seed vai là xanh.
 *
 * KHÔNG khẳng định câu chữ lỗi của Postgres (PG 18 ở máy dev ≠ PG 16 ở CI): chỉ SQLSTATE, TÊN ràng buộc, và catalog.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { nhanSuDangPhuTrachNguon } from "../../lib/nguon/nguoi-gioi-thieu";
import { damBaoDanhMucGoc, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "NDC_";
const CASE = 60_000;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  if (leads.length > 0) await db.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } }); // Cascade kéo quy nguồn
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: P.toLowerCase() } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
}

/** Chạy `f`, trả "ok" hoặc một nhãn nói được VÌ SAO lỗi (SQLSTATE hoặc tên ràng buộc). */
async function ketQua(f: () => Promise<unknown>, tenRangBuoc: string): Promise<string> {
  try {
    await f();
    return "CHẤP NHẬN";
  } catch (e) {
    const s = String(e);
    if (s.includes(tenRangBuoc)) return "chặn";
    return `lỗi khác: ${s.slice(0, 160)}`;
  }
}

describe.skipIf(!RUN)("Nguồn động — cột/ràng buộc mới", () => {
  let nhom: IdNhom;
  let n = 0;
  const ma = () => `${P}${String(++n).padStart(3, "0")}`;
  const them = (extra: Record<string, unknown> = {}) =>
    db.leadSourceGroup.create({ data: { code: ma(), name: "Nguồn thử", ...extra } as never, select: { id: true, code: true } });
  const dungEmp = (hau: string) =>
    db.employee.create({ data: { employeeCode: `${P}${hau}`, fullName: `${P}NV ${hau}`, jobTitle: "x", department: "TUYEN_SINH", isActive: true }, select: { id: true } });
  const dungUser = (hau: string) =>
    db.user.create({ data: { name: `${P}U${hau}`, email: `${P.toLowerCase()}${hau}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], isActive: true }, select: { id: true } });
  /** `pg_constraint.confdeltype`: 'r' = RESTRICT, 'a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL. */
  const kieuXoaCuaFk = async (ten: string): Promise<string | undefined> =>
    (await db.$queryRaw<{ confdeltype: string }[]>`SELECT confdeltype::text AS confdeltype FROM pg_constraint WHERE conname = ${ten}`)[0]?.confdeltype;

  beforeEach(async () => {
    n = 0;
    await don();
    nhom = await damBaoDanhMucGoc(db);
  }, CASE);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 120_000);

  it("[NHH-DYN-DB-01] CHECK cửa sổ ghi công: 0, âm và >3650 bị chặn (đúng ràng buộc có tên, SQLSTATE 23514); NULL, 1, 90, 3650 chèn được", async () => {
    const lot: string[] = [];
    for (const v of [0, -1, -90, 3651, 36500]) {
      const kq = await ketQua(() => them({ attributionWindowDays: v }), "LeadSourceGroup_cua_so_chk");
      if (kq !== "chặn") lot.push(`cửa sổ ${v} ⇒ ${kq}`);
    }
    expect(lot).toEqual([]);
    // SQLSTATE (không câu chữ Postgres — PG 18 ở dev ≠ PG 16 ở CI): đi đường SQL thô để Prisma không bọc mã.
    for (const v of [0, -1, 3651]) {
      const loi = await db
        .$executeRaw`INSERT INTO "LeadSourceGroup" ("id","code","name","attributionWindowDays","updatedAt") VALUES (${`ndc-${Math.random()}`}, ${ma()}, 'x', ${v}, CURRENT_TIMESTAMP)`.then(
          () => null,
          (e: unknown) => e as { meta?: { code?: string; message?: string }; message?: string },
        );
      expect(loi, `cửa sổ ${v} phải bị chặn`).not.toBeNull();
      expect(loi?.meta?.code ?? `${loi?.message ?? ""}`, `SQLSTATE của ${v}`).toMatch(/23514/);
    }
    // Đối chứng dương: NULL (dùng setting chung), 1 (biên dưới), 90, 3650 (biên trên).
    for (const v of [null, 1, 90, 3650]) {
      const r = await them({ attributionWindowDays: v });
      expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: r.id } })).attributionWindowDays, String(v)).toBe(v);
    }
    // CHECK là THẬT trong catalog (Prisma 5 không đọc CHECK ⇒ ca này là lưới duy nhất).
    const c = await db.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conname = 'LeadSourceGroup_cua_so_chk' AND contype = 'c'`;
    expect(c).toHaveLength(1);
  }, CASE);

  it("[NHH-DYN-DB-02] CHECK hiệu lực: to == from và to < from bị chặn; thiếu một đầu hoặc to > from chèn được", async () => {
    const t = new Date("2026-11-01T00:00:00.000Z");
    const truoc = new Date("2026-10-01T00:00:00.000Z");
    const sau = new Date("2026-12-01T00:00:00.000Z");
    const lot: string[] = [];
    for (const [nhan, cot] of [
      ["to == from", { effectiveFrom: t, effectiveTo: t }],
      ["to < from", { effectiveFrom: t, effectiveTo: truoc }],
    ] as const) {
      const kq = await ketQua(() => them(cot), "LeadSourceGroup_hieu_luc_chk");
      if (kq !== "chặn") lot.push(`${nhan} ⇒ ${kq}`);
    }
    expect(lot).toEqual([]);
    // Đối chứng dương.
    for (const cot of [{ effectiveFrom: t, effectiveTo: sau }, { effectiveFrom: t }, { effectiveTo: sau }, {}]) {
      await expect(them(cot), JSON.stringify(cot)).resolves.toBeDefined();
    }
  }, CASE);

  it("[NHH-DYN-DB-03] nguồn admin tạo ra đời với mặc định AN TOÀN: OTHER · commissionEnabled FALSE · không chủ · không cửa sổ · không hiệu lực", async () => {
    const r = await them();
    const g = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: r.id } });
    expect({
      sourceType: g.sourceType,
      commissionEnabled: g.commissionEnabled,
      attributionWindowDays: g.attributionWindowDays,
      ownerEmployeeId: g.ownerEmployeeId,
      ownerOrgUnitId: g.ownerOrgUnitId,
      effectiveFrom: g.effectiveFrom,
      effectiveTo: g.effectiveTo,
      updatedById: g.updatedById,
      isSystem: g.isSystem,
      status: g.status,
      selectable: g.selectable,
    }).toEqual({
      sourceType: "OTHER",
      commissionEnabled: false, // bật hoa hồng theo nguồn phải là QUYẾT ĐỊNH CÓ CHỦ ĐÍCH, không phải mặc định
      attributionWindowDays: null,
      ownerEmployeeId: null,
      ownerOrgUnitId: null,
      effectiveFrom: null,
      effectiveTo: null,
      updatedById: null,
      isSystem: false,
      status: "ACTIVE",
      selectable: true,
    });
    // Đối chứng dương: 9 dòng gốc KHÔNG mang mặc định đó (sourceType/commissionEnabled do seed khai).
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "PAID_ADS" } })).commissionEnabled).toBe(true);
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "UNKNOWN" } })).sourceType).toBe("SYSTEM");
    expect(nhom.PAID_ADS).toBeTruthy();
  }, CASE);

  it("[NHH-DYN-DB-04] enum LeadSourceType: tám giá trị hợp lệ chèn được; giá trị lạ bị chặn", async () => {
    for (const v of ["REFERRAL", "MARKETING", "ORGANIC", "OFFLINE", "EVENT", "PARTNER", "OTHER", "SYSTEM"] as const) {
      const r = await them({ sourceType: v });
      expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: r.id } })).sourceType, v).toBe(v);
    }
    const enumVals = await db.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'LeadSourceType' ORDER BY e.enumsortorder`;
    expect(enumVals.map((x) => x.enumlabel)).toEqual(["REFERRAL", "MARKETING", "ORGANIC", "OFFLINE", "EVENT", "PARTNER", "OTHER", "SYSTEM"]);
    // Giá trị lạ phải bị chặn ĐÚNG VÌ enum (SQLSTATE 22P02 invalid_text_representation) — không phải một lỗi nào đó.
    const loi = await db
      .$executeRaw`INSERT INTO "LeadSourceGroup" ("id","code","name","sourceType","updatedAt") VALUES (${`ndc-${Math.random()}`}, ${ma()}, 'x', 'KHONG_CO'::"LeadSourceType", CURRENT_TIMESTAMP)`.then(
        () => "CHẤP NHẬN",
        (e: unknown) => String(e),
      );
    expect(loi).toMatch(/22P02/);
  }, CASE);

  it("[NHH-DYN-DB-05] FK Restrict thật: xoá nhân sự đang phụ trách nguồn / User đang là Sale snapshot ⇒ DB từ chối, nêu đúng ràng buộc", async () => {
    const e = await dungEmp("E5");
    await them({ ownerEmployeeId: e.id });
    await expect(db.employee.delete({ where: { id: e.id } })).rejects.toThrow(/LeadSourceGroup_ownerEmployeeId_fkey/);
    expect(await kieuXoaCuaFk("LeadSourceGroup_ownerEmployeeId_fkey")).toBe("r");

    const u = await dungUser("5");
    const l = await db.lead.create({ data: { parentName: `${P}L5`, phone: "0990600005", status: "MOI" }, select: { id: true } });
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: nhom.PARENT_REFERRAL,
        originalGroupId: nhom.PARENT_REFERRAL,
        identificationMethod: "MANUAL",
        matchedRule: "KHAI_TAY",
        reasonText: "t",
        referrerSaleUserId: u.id,
      },
    });
    await expect(db.user.delete({ where: { id: u.id } })).rejects.toThrow(/LeadAttribution_referrerSaleUserId_fkey/);
    expect(await kieuXoaCuaFk("LeadAttribution_referrerSaleUserId_fkey")).toBe("r");
    // Đối chứng dương: gỡ liên kết rồi xoá được (FK không khoá vĩnh viễn).
    await db.leadAttribution.update({ where: { leadId: l.id }, data: { referrerSaleUserId: null } });
    await db.user.delete({ where: { id: u.id } });
    await db.leadSourceGroup.updateMany({ where: { ownerEmployeeId: e.id }, data: { ownerEmployeeId: null } });
    await db.employee.delete({ where: { id: e.id } });
  }, CASE);

  it("[NHH-DYN-DB-06] nhanSuDangPhuTrachNguon: bắt nhân sự phụ trách nguồn (kể cả nguồn đã ARCHIVED); không bắt oan; không hỏi gì ⇒ false", async () => {
    const e = await dungEmp("E6");
    const roi = await dungEmp("E6R");
    expect(await nhanSuDangPhuTrachNguon({ employeeId: e.id })).toBe(false);
    const g = await them({ ownerEmployeeId: e.id });
    expect(await nhanSuDangPhuTrachNguon({ employeeId: e.id })).toBe(true);
    // FK vẫn chặn xoá khi nguồn đã ARCHIVED ⇒ câu hỏi cũng phải tính nguồn ARCHIVED (không lọc theo status).
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { status: "ARCHIVED" } });
    expect(await nhanSuDangPhuTrachNguon({ employeeId: e.id })).toBe(true);
    expect(await nhanSuDangPhuTrachNguon({ employeeId: roi.id })).toBe(false); // đối chứng âm
    expect(await nhanSuDangPhuTrachNguon({})).toBe(false);
  }, CASE);

  it("[NHH-DYN-DB-07] snapshot referrerRoleCode + referrerSaleUserId ghi/đọc lại đúng; không dính CHECK người giới thiệu", async () => {
    const u = await dungUser("7");
    const l = await db.lead.create({ data: { parentName: `${P}L7`, phone: "0990600007", status: "MOI" }, select: { id: true } });
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: nhom.EMPLOYEE_REFERRAL,
        originalGroupId: nhom.EMPLOYEE_REFERRAL,
        identificationMethod: "MANUAL",
        matchedRule: "KHAI_TAY",
        reasonText: "t",
        referrerRoleCode: "TEACHER",
        referrerSaleUserId: u.id,
      },
    });
    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: l.id } });
    expect([a.referrerRoleCode, a.referrerSaleUserId, a.referrerKind]).toEqual(["TEACHER", u.id, null]);
    // Snapshot KHÔNG tính lại: User đổi vai thì dòng này không đổi theo (nó là cột trần, không có trigger/đồng bộ).
    await db.user.update({ where: { id: u.id }, data: { roles: ["TEACHER"], role: "TEACHER" } });
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: l.id } })).referrerRoleCode).toBe("TEACHER");
  }, CASE);
});

describe("[NHH-DYN-W] lưới dây nối: xoá cứng nhân sự hỏi 'đang phụ trách nguồn' TRƯỚC khi xoá (đọc mã nguồn)", () => {
  const doc = (p: string) =>
    readFileSync(resolve(process.cwd(), p), "utf8")
      .split(/\r?\n/)
      .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");

  it("deleteEmployeeAction gọi `nhanSuDangPhuTrachNguon(` đúng MỘT lần, TRƯỚC `employee.delete(`, và trả lỗi tiếng Việt thay vì RESTRICT thô", () => {
    const ma = doc("app/(admin)/admin/nhan-su/actions.ts");
    expect(ma.match(/nhanSuDangPhuTrachNguon\(/g)).toHaveLength(1);
    const hoi = ma.indexOf("nhanSuDangPhuTrachNguon(");
    const xoa = ma.indexOf("sdb.employee.delete(");
    expect(hoi).toBeGreaterThan(0);
    expect(xoa).toBeGreaterThan(hoi);
    expect(ma.slice(hoi, xoa)).toMatch(/phụ trách nguồn/);
    expect(ma.slice(hoi, xoa)).toMatch(/return \{\s*ok: false/);
  });
});
