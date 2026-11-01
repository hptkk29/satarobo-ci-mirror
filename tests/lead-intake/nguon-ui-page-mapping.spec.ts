// @vitest-environment node
/**
 * PR7 — BẢNG PAGE MAPPING (06 §5.1): đọc + ghi một dòng + Server Action. Postgres LOCAL thật, quyền RBAC v2 THẬT.
 *
 *   [NHH-UI-PMD-01..03] `docBangPageMapping`: Page chưa map đứng đầu; Page tắt không phải "việc phải làm"; Page mồ côi; cách ly cơ sở
 *   [NHH-UI-PMD-04..08] `luuNguonCuaPage`: gán/gỡ, mã chiến dịch, AuditLog cùng giao dịch, nhóm không chọn được bị từ chối, không đổi ⇒ không audit
 *   [NHH-UI-PMD-09]     KHÔNG MẤT CẬP NHẬT: nhiều người sửa nhiều Page cùng lúc ⇒ mọi lượt báo "đã lưu" đều CÒN trong bảng
 *   [NHH-UI-PMA-01..04] `luuPageMappingAction`: đăng nhập · quyền `sources:manage` Ở ĐẦU HÀM · cờ · lỗi map về field
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `NUIP` / `nuip-`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));

import { db } from "../../lib/db";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { seedOrg, seedRoles } from "../e2e/_helpers/seed";
import { demPageChuaMap, docBangPageMapping } from "../../lib/nguon/bang-nguon-theo-page";
import { luuPageMappingAction } from "../../app/(admin)/admin/nguon-hoa-hong/nguon/_actions";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon, type IdNhom } from "./_nguon-fixture";
import { LY_DO_PAGE_MAC_DINH, luuNguonCuaPage } from "../hoa-hong/_nguon-dong";

const RUN = RUN_DB_TESTS;
const P = "NUIP_";
const CASE = 90_000;
const KEY = "nguon.bangNguonTheoPage";
/** Đồng hồ cố định (luật 19): `docBangPageMapping` / `luuNguonCuaPage` nhận `now` BẮT BUỘC. */
const NOW = new Date("2026-11-20T03:00:00.000Z");

type Vai = { roleDef: string; roleEnum: string; donVi: "HO" | "CS1" | "CS2" };
const VAI = {
  qlcs1: { roleDef: "CENTER_MANAGER", roleEnum: "CENTER_MANAGER", donVi: "CS1" },
  marketing: { roleDef: "HO_MARKETING", roleEnum: "MARKETING", donVi: "HO" },
  admin: { roleDef: "SUPER_ADMIN", roleEnum: "SUPER_ADMIN", donVi: "HO" },
  sale1: { roleDef: "CENTER_SALES_CSM", roleEnum: "SALES_CSM", donVi: "CS1" },
} satisfies Record<string, Vai>;

async function don(): Promise<void> {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.facebookPageMapping.deleteMany({ where: { pageId: { startsWith: "nuip-" } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } }); // nguồn do ADMIN tạo trong ca [NHH-UI-PMD-06b]
  await db.auditLog.deleteMany({ where: { entityType: "SystemSetting", entityId: KEY } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

async function dungNguoiDung(v: Vai): Promise<{ id: string; actor: Actor }> {
  const email = `${P}${v.roleDef.toLowerCase()}@example.test`;
  const centerId = v.donVi === "HO" ? null : (await db.center.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } })).id;
  const u = await db.user.create({
    data: { name: `${P}${v.roleDef}`, email, role: v.roleEnum as never, roles: [v.roleEnum as never], centerId, isActive: true },
    select: { id: true },
  });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: v.donVi }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: v.roleDef }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "nuip", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  SESS.current = { user: { id: u.id, role: v.roleEnum, roles: [v.roleEnum], centerId, name: `${P}${v.roleDef}`, email } };
  return { id: u.id, actor: await resolveActorUncached(u.id) };
}

describe.skipIf(!RUN)("PR7 — Page mapping: đọc, ghi một dòng, Server Action", () => {
  let nhom: IdNhom;
  let cs1 = "";
  let cs2 = "";
  const truocRbac = process.env.RBAC_V2_ENABLED;

  const dungPage = (id: string, o: { centerId?: string | null; isActive?: boolean; ten?: string } = {}) =>
    db.facebookPageMapping.create({
      data: {
        pageId: `nuip-${id}`,
        pageName: o.ten ?? `${P}Page ${id}`,
        scopeType: o.centerId === null ? "HO" : "CENTER",
        centerId: o.centerId === undefined ? cs1 : o.centerId,
        isActive: o.isActive ?? true,
      },
    });
  const bang = async (): Promise<Record<string, { groupCode: string; campaignCode?: string }>> => {
    const r = await db.systemSetting.findUnique({ where: { key: KEY } });
    return (r?.valueJson ?? {}) as Record<string, { groupCode: string; campaignCode?: string }>;
  };
  const demAudit = () => db.auditLog.count({ where: { entityType: "SystemSetting", entityId: KEY, action: "PAGE_MAPPING" } });

  // Dữ liệu NỀN (cơ sở · cây đơn vị · vai) tự dựng, idempotent (upsert, không xoá): bộ này KHÔNG mượn trạng thái mà `test:chat-db` để lại
  // (luật 18 — chạy riêng nó trên DB trắng phải xanh).
  beforeAll(async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  }, 180_000);

  beforeEach(async () => {
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
    SESS.current = null;
  }, CASE);

  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    await don();
    await db.$disconnect();
  }, 180_000);

  // ── đọc ────────────────────────────────────────────────────────────────────────────────────────────
  it("[NHH-UI-PMD-01] Page CHƯA map đứng đầu; Page tắt KHÔNG tính là việc phải làm; đã map xuống cuối; đếm = đúng số hàng đầu", async () => {
    const { actor } = await dungNguoiDung(VAI.admin);
    await dungPage("a", { ten: `${P}Z Đã map` });
    await dungPage("b", { ten: `${P}A Chưa map` });
    await dungPage("c", { ten: `${P}M Tắt`, isActive: false });
    await datCoNguon(CO_NGUON_DAY_DU, { [KEY]: { "nuip-a": { groupCode: "PAID_ADS" } } });
    const r = await docBangPageMapping(actor, NOW);
    const mine = r.dong.filter((d) => d.pageId.startsWith("nuip-"));
    expect(mine.map((d) => d.pageId)).toEqual(["nuip-b", "nuip-c", "nuip-a"]);
    expect(mine.find((d) => d.pageId === "nuip-c")!.dangTat).toBe(true);
    expect(mine.find((d) => d.pageId === "nuip-a")!.map).toEqual({ groupCode: "PAID_ADS", campaignCode: null });
    // số trên công tắc = số Page chưa map thật (Page tắt không đếm)
    const them = r.dong.filter((d) => !d.pageId.startsWith("nuip-") && d.map === null && !d.dangTat).length;
    expect(r.soChuaMap).toBe(1 + them);
    expect(await demPageChuaMap(actor)).toBe(r.soChuaMap);
  }, CASE);

  it("[NHH-UI-PMD-02] Page mồ côi (bảng nguồn nhắc tới, danh mục không có) hiện để GỠ được; danh sách nhóm chọn được KHÔNG có UNKNOWN", async () => {
    const { actor } = await dungNguoiDung(VAI.admin);
    await datCoNguon(CO_NGUON_DAY_DU, { [KEY]: { "nuip-ma-coi": { groupCode: "WALK_IN", campaignCode: "X" } } });
    const r = await docBangPageMapping(actor, NOW);
    const moCoi = r.dong.find((d) => d.pageId === "nuip-ma-coi")!;
    expect(moCoi).toMatchObject({ trongDanhMuc: false, tenPage: null, map: { groupCode: "WALK_IN", campaignCode: "X" } });
    expect(r.nhom.map((n) => n.code)).not.toContain("UNKNOWN");
    // Chỉ nhóm KHÔNG bắt người giới thiệu mới gán được cho cả một Page (xem [NHH-UI-PMD-06b]): 11 nguồn − 6 nguồn có người = 5.
    expect(r.nhom.map((n) => n.code).sort()).toEqual(["PAID_ADS", "CENTER_ORGANIC", "EVENT", "OTHER", "WALK_IN"].sort());
  }, CASE);

  it("[NHH-UI-PMD-06b] nhóm BẮT NGƯỜI giới thiệu (nhân sự · phụ huynh · đối tác) KHÔNG gán được cho cả một Page: mỗi lead từ Page ấy sẽ mang nhóm cần người mà không có người, lại bị khoá ngoài hàng chờ; nhóm không bắt người (đối chứng dương) ⇒ gán được", async () => {
    // Cấy bỏ cổng nhóm ở luuNguonCuaPage: Page gán 'Sale giới thiệu' ⇒ lead nào vào từ Page đó có referrerMissing=false, nhóm cần người, KHÔNG người hưởng.
    const { actor } = await dungNguoiDung(VAI.admin);
    await dungPage("g3b");
    // Nguồn do ADMIN tạo (không nằm trong 9 mã gốc) mà BẮT nhân sự: cổng đo THUỘC TÍNH `referrerRequirement`, không đo mã — nên nó cũng phải bị từ chối.
    // Sau khi bốn nhóm nhân sự gộp thành MỘT, đây là ca duy nhất còn chứng minh cổng không so mã.
    await db.leadSourceGroup.create({ data: { code: `${P}NHOM_NV`, name: `${P}Nhóm nhân sự do admin tạo`, referrerRequirement: "EMPLOYEE", sortOrder: 120 } });
    for (const ma of ["EMPLOYEE_REFERRAL", `${P}NHOM_NV`, "PARENT_REFERRAL", "PARTNER"]) {
      const r = await ghi(actor, "nuip-g3b", ma);
      expect(r, ma).toMatchObject({ ok: false, truong: "nguon" });
    }
    expect(await bang()).toEqual({});
    expect(await demAudit()).toBe(0);
    expect(await ghi(actor, "nuip-g3b", "WALK_IN")).toMatchObject({ ok: true, doi: true });
    expect(await bang()).toEqual({ "nuip-g3b": { groupCode: "WALK_IN" } });
  }, CASE);

  it("[NHH-UI-PMD-03] CÁCH LY CƠ SỞ: QLCS CS1 thấy Page CS1 + Page toàn hệ, KHÔNG thấy Page CS2; admin thấy cả hai", async () => {
    await dungPage("cs1", { centerId: cs1 });
    await dungPage("cs2", { centerId: cs2 });
    await dungPage("ho", { centerId: null });
    const q = await dungNguoiDung(VAI.qlcs1);
    const ids = (await docBangPageMapping(q.actor, NOW)).dong.map((d) => d.pageId);
    expect(ids).toContain("nuip-cs1");
    expect(ids).toContain("nuip-ho");
    expect(ids).not.toContain("nuip-cs2");
    const a = await dungNguoiDung(VAI.admin);
    expect((await docBangPageMapping(a.actor, NOW)).dong.map((d) => d.pageId)).toContain("nuip-cs2");
  }, CASE);

  it("[NHH-UI-PMD-10] số trên công tắc `demPageChuaMap` cũng CÁCH LY CƠ SỞ: Page CS2 chưa map KHÔNG tính cho QLCS CS1 (Page CS1 và toàn hệ thì tính); admin tính cả ba", async () => {
    // Cấy bỏ `.filter(pageTrongTamNhin)` trong demPageChuaMap: bảng đã lọc đúng nhưng con số trên công tắc đếm cả Page cơ sở khác.
    const a = await dungNguoiDung(VAI.admin);
    const gocAdmin = await demPageChuaMap(a.actor);
    const q = await dungNguoiDung(VAI.qlcs1);
    const gocQl = await demPageChuaMap(q.actor);
    await dungPage("cs2", { centerId: cs2 });
    expect(await demPageChuaMap(q.actor)).toBe(gocQl); // Page CS2 chưa map: không thuộc tầm nhìn
    await dungPage("cs1", { centerId: cs1 });
    await dungPage("ho", { centerId: null });
    expect(await demPageChuaMap(q.actor)).toBe(gocQl + 2);
    expect((await docBangPageMapping(q.actor, NOW)).soChuaMap).toBe(gocQl + 2); // hai đường đếm cùng một con số (luật 12b)
    expect(await demPageChuaMap(a.actor)).toBe(gocAdmin + 3);
  }, CASE);

  it("[NHH-UI-PMD-11] Page cơ sở KHÁC đã map KHÔNG bị coi là 'mồ côi' trong mắt người cơ sở này: QLCS CS1 không thấy dòng nào của nó; admin thấy đúng 1 dòng 'trong danh mục'", async () => {
    // Cấy `new Set(pages…)` thay `new Set(tatCaPage…)`: Page CS2 nằm trong bảng nguồn mà không nằm trong phần-đã-lọc ⇒ hiện cho CS1 như Page mồ côi.
    await dungPage("cs2", { centerId: cs2 });
    await datCoNguon(CO_NGUON_DAY_DU, { [KEY]: { "nuip-cs2": { groupCode: "WALK_IN" } } });
    const q = await dungNguoiDung(VAI.qlcs1);
    expect((await docBangPageMapping(q.actor, NOW)).dong.filter((d) => d.pageId === "nuip-cs2")).toEqual([]);
    const a = await dungNguoiDung(VAI.admin);
    const hang = (await docBangPageMapping(a.actor, NOW)).dong.filter((d) => d.pageId === "nuip-cs2");
    expect(hang).toHaveLength(1);
    expect(hang[0]).toMatchObject({ trongDanhMuc: true, map: { groupCode: "WALK_IN" } });
  }, CASE);

  // ── ghi ────────────────────────────────────────────────────────────────────────────────────────────
  const ghi =(actor: Actor, pageId: string, groupCode: string | null, campaignCode: string | null = null) =>
    luuNguonCuaPage({ actor, actorName: "Người sửa", pageId, groupCode, campaignCode, now: NOW });

  it("[NHH-UI-PMD-04] gán Page ⇒ bảng có đúng dòng + mã chiến dịch đã trim + MỘT AuditLog (cũ → mới, có lý do); gỡ ⇒ dòng biến mất + audit thứ hai", async () => {
    const { actor } = await dungNguoiDung(VAI.admin);
    await dungPage("g1");
    expect(await ghi(actor, "nuip-g1", "PAID_ADS", "  THANG10  ")).toEqual({ ok: true, doi: true });
    expect((await bang())["nuip-g1"]).toEqual({ groupCode: "PAID_ADS", campaignCode: "THANG10" });
    expect(await demAudit()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "SystemSetting", entityId: KEY, action: "PAGE_MAPPING" }, orderBy: { createdAt: "desc" } });
    expect(a.module).toBe("nguon-hoa-hong");
    expect(a.oldValues).toMatchObject({ pageId: "nuip-g1", nguon: null });
    expect(a.newValues).toMatchObject({ pageId: "nuip-g1", nguon: { groupCode: "PAID_ADS", campaignCode: "THANG10" } });
    expect(a.reason, "audit mang LÝ DO người dùng gõ (W2), không còn câu tự sinh").toBe(LY_DO_PAGE_MAC_DINH);
    expect(await ghi(actor, "nuip-g1", null)).toEqual({ ok: true, doi: true });
    expect((await bang())["nuip-g1"]).toBeUndefined();
    expect(await demAudit()).toBe(2);
  }, CASE);

  it("[NHH-UI-PMD-05] lưu GIỐNG HỆT giá trị đang có ⇒ ok nhưng KHÔNG ghi, KHÔNG audit; mã chiến dịch rỗng ⇒ không có trường campaignCode", async () => {
    const { actor } = await dungNguoiDung(VAI.admin);
    await dungPage("g2");
    expect(await ghi(actor, "nuip-g2", "WALK_IN", "")).toEqual({ ok: true, doi: true });
    expect((await bang())["nuip-g2"]).toEqual({ groupCode: "WALK_IN" });
    const truoc = await demAudit();
    expect(await ghi(actor, "nuip-g2", "WALK_IN", "")).toEqual({ ok: true, doi: false });
    expect(await demAudit()).toBe(truoc);
  }, CASE);

  it("[NHH-UI-PMD-06] nhóm KHÔNG chọn được (UNKNOWN · không tồn tại · đã ngừng) ⇒ từ chối field 'nguon', bảng và audit không đổi", async () => {
    const { actor } = await dungNguoiDung(VAI.admin);
    await dungPage("g3");
    await db.leadSourceGroup.update({ where: { id: nhom.PARTNER }, data: { status: "INACTIVE" } });
    try {
      for (const ma of ["UNKNOWN", "KHONG_CO_NHOM_NAY", "PARTNER"]) {
        const r = await ghi(actor, "nuip-g3", ma);
        expect(r, ma).toMatchObject({ ok: false, truong: "nguon" });
      }
    } finally {
      await db.leadSourceGroup.update({ where: { id: nhom.PARTNER }, data: { status: "ACTIVE" } });
    }
    expect(await bang()).toEqual({});
    expect(await demAudit()).toBe(0);
  }, CASE);

  it("[NHH-UI-PMD-07] Page KHÔNG có trong danh mục của người sửa ⇒ từ chối field 'page' (QLCS CS1 không gán được Page CS2); mã chiến dịch > 64 ký tự ⇒ field 'chienDich'", async () => {
    await dungPage("cs2", { centerId: cs2 });
    const q = await dungNguoiDung(VAI.qlcs1);
    expect(await ghi(q.actor, "nuip-cs2", "PAID_ADS")).toMatchObject({ ok: false, truong: "page" });
    expect(await ghi(q.actor, "nuip-khong-co", "PAID_ADS")).toMatchObject({ ok: false, truong: "page" });
    await dungPage("cs1", { centerId: cs1 });
    expect(await ghi(q.actor, "nuip-cs1", "PAID_ADS", "x".repeat(65))).toMatchObject({ ok: false, truong: "chienDich" });
    expect(await bang()).toEqual({});
    expect(await demAudit()).toBe(0);
    // đối chứng dương: cùng người, Page của cơ sở mình ⇒ được
    expect(await ghi(q.actor, "nuip-cs1", "PAID_ADS")).toEqual({ ok: true, doi: true });
  }, CASE);

  it("[NHH-UI-PMD-07b] GỠ nguồn của Page cơ sở khác cũng bị từ chối (gỡ cũng là sửa cấu hình của họ); admin gỡ được — đối chứng dương", async () => {
    await dungPage("cs2", { centerId: cs2 });
    await datCoNguon(CO_NGUON_DAY_DU, { [KEY]: { "nuip-cs2": { groupCode: "WALK_IN" } } });
    const q = await dungNguoiDung(VAI.qlcs1);
    expect(await ghi(q.actor, "nuip-cs2", null)).toMatchObject({ ok: false, truong: "page" });
    expect((await bang())["nuip-cs2"]).toEqual({ groupCode: "WALK_IN" });
    expect(await demAudit()).toBe(0);
    const a = await dungNguoiDung(VAI.admin);
    expect(await ghi(a.actor, "nuip-cs2", null)).toEqual({ ok: true, doi: true });
  }, CASE);

  it("[NHH-UI-PMD-08] Page mồ côi chỉ GỠ được (không gán mới); bản ghi sai định dạng ⇒ KHÔNG ghi đè (báo người vận hành)", async () => {
    const { actor } = await dungNguoiDung(VAI.admin);
    await datCoNguon(CO_NGUON_DAY_DU, { [KEY]: { "nuip-mo-coi": { groupCode: "WALK_IN" } } });
    expect(await ghi(actor, "nuip-mo-coi", "PAID_ADS")).toMatchObject({ ok: false, truong: "page" });
    expect(await ghi(actor, "nuip-mo-coi", null)).toEqual({ ok: true, doi: true });
    expect(await bang()).toEqual({});
    // bản ghi hỏng (trường lạ — schema `.strict()`)
    await db.systemSetting.update({ where: { key: KEY }, data: { valueJson: { "nuip-x": { groupCode: "WALK_IN", sourceId: "lạ" } } } });
    await dungPage("g4");
    const hong = await ghi(actor, "nuip-g4", "PAID_ADS");
    expect(hong).toMatchObject({ ok: false });
    expect((await bang())["nuip-x"]).toEqual({ groupCode: "WALK_IN", sourceId: "lạ" }); // không bị xoá mất
    expect((await bang())["nuip-g4"]).toBeUndefined();
  }, CASE);

  it("[NHH-UI-PMD-09] KHÔNG MẤT CẬP NHẬT: 8 lượt sửa 8 Page khác nhau CÙNG LÚC ⇒ mọi lượt báo 'đã lưu' đều CÒN trong bảng, lượt còn lại báo 'vừa được đổi'", async () => {
    const { actor } = await dungNguoiDung(VAI.admin);
    const ids = Array.from({ length: 8 }, (_, i) => `nuip-song-${i}`);
    for (const id of ids) await dungPage(id.replace("nuip-", ""));
    // bảng đã tồn tại sẵn (nhánh updateMany có điều kiện) VÀ trường hợp chưa tồn tại (nhánh create) đều phải đúng
    for (const truocCo of [true, false]) {
      await db.systemSetting.deleteMany({ where: { key: KEY } });
      if (truocCo) await db.systemSetting.create({ data: { key: KEY, valueJson: { "nuip-co-san": { groupCode: "WALK_IN" } } } });
      const kq = await Promise.all(ids.map((id) => ghi(actor, id, "PAID_ADS")));
      const cuoi = await bang();
      kq.forEach((r, i) => {
        if (r.ok) expect(cuoi[ids[i]!], `${truocCo ? "có sẵn" : "chưa có"} · ${ids[i]} báo ok mà mất`).toEqual({ groupCode: "PAID_ADS" });
        else expect(r).toMatchObject({ truong: "vuaDoi" });
      });
      expect(kq.some((r) => r.ok), "ít nhất một lượt phải thành công").toBe(true);
      if (truocCo) expect(cuoi["nuip-co-san"]).toEqual({ groupCode: "WALK_IN" }); // dòng có sẵn không bị đè
      // số audit = số lượt thành công (không audit cho lượt bị từ chối)
      expect(await demAudit()).toBe(kq.filter((r) => r.ok && r.doi).length);
      await db.auditLog.deleteMany({ where: { entityType: "SystemSetting", entityId: KEY } });
    }
  }, CASE);

  // ── Server Action ──────────────────────────────────────────────────────────────────────────────────
  it("[NHH-UI-PMA-01] chưa đăng nhập ⇒ từ chối; Sale (không sources:manage) ⇒ từ chối field 'quyen' và bảng KHÔNG đổi; QLCS (chỉ sources:view) cũng vậy", async () => {
    await dungPage("a1");
    expect(await luuPageMappingAction({ pageId: "nuip-a1", groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" })).toEqual({ ok: false, error: "Chưa đăng nhập" });
    for (const v of [VAI.sale1, VAI.qlcs1]) {
      await db.user.deleteMany({ where: { email: { startsWith: P } } }).catch(() => {});
      await don();
      await dungPage("a1");
      await datCoNguon(CO_NGUON_DAY_DU);
      await dungNguoiDung(v);
      const r = await luuPageMappingAction({ pageId: "nuip-a1", groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" });
      expect(r, v.roleDef).toMatchObject({ ok: false, field: "quyen" });
      expect((r as { error: string }).error).toContain("sources:manage");
      expect(await bang(), v.roleDef).toEqual({});
    }
  }, CASE);

  it("[NHH-UI-PMA-02] Marketing (sources:manage) lưu được; cờ master TẮT ⇒ 'chưa được bật' và KHÔNG ghi; đối chứng: bật lại ⇒ ghi", async () => {
    await dungPage("a2");
    await dungNguoiDung(VAI.marketing);
    await datCoNguon({});
    const tat = await luuPageMappingAction({ pageId: "nuip-a2", groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" });
    expect((tat as { error: string }).error).toMatch(/chưa được bật/);
    expect(await bang()).toEqual({});
    await datCoNguon(CO_NGUON_DAY_DU);
    expect(await luuPageMappingAction({ pageId: "nuip-a2", groupCode: "PAID_ADS", campaignCode: "  ĐỢT 1 ", lyDo: "Chủ dự án chốt ngày 10/10/2026" })).toEqual({ ok: true, doi: true });
    expect((await bang())["nuip-a2"]).toEqual({ groupCode: "PAID_ADS", campaignCode: "ĐỢT 1" });
  }, CASE);

  it("[NHH-UI-PMA-03] lỗi map về field: nhóm sai ⇒ 'nguon'; Page lạ ⇒ 'page'; đầu vào hỏng ⇒ từ chối trước khi đụng DB", async () => {
    await dungPage("a3");
    await dungNguoiDung(VAI.marketing);
    expect(await luuPageMappingAction({ pageId: "nuip-a3", groupCode: "UNKNOWN", lyDo: "Chủ dự án chốt ngày 10/10/2026" })).toMatchObject({ ok: false, field: "nguon" });
    expect(await luuPageMappingAction({ pageId: "nuip-khong-co", groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" })).toMatchObject({ ok: false, field: "page" });
    expect(await luuPageMappingAction({ pageId: "", groupCode: "PAID_ADS", lyDo: "Chủ dự án chốt ngày 10/10/2026" })).toMatchObject({ ok: false });
    expect(await luuPageMappingAction({ pageId: "nuip-a3" })).toMatchObject({ ok: false }); // thiếu groupCode
    expect(await luuPageMappingAction(null)).toMatchObject({ ok: false });
    expect(await bang()).toEqual({});
  }, CASE);

  it("[NHH-UI-PMA-04] gỡ qua action (groupCode null) ⇒ dòng biến mất, campaignCode bị bỏ theo", async () => {
    await dungPage("a4");
    await dungNguoiDung(VAI.marketing);
    await luuPageMappingAction({ pageId: "nuip-a4", groupCode: "WALK_IN", campaignCode: "C1", lyDo: "Chủ dự án chốt ngày 10/10/2026" });
    expect(await luuPageMappingAction({ pageId: "nuip-a4", groupCode: null, campaignCode: "C1", lyDo: "Chủ dự án chốt ngày 10/10/2026" })).toEqual({ ok: true, doi: true });
    expect((await bang())["nuip-a4"]).toBeUndefined();
  }, CASE);
});
