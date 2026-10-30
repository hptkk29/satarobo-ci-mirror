// @vitest-environment node
/**
 * DANH MỤC PAGE (`FacebookPageMapping`) — thêm / sửa / tắt-bật bằng giao diện (trước đây không có đường nào). Postgres LOCAL thật, RBAC v2 THẬT.
 *
 *   [DMPD-01] Quản trị tối cao thêm Page HO ⇒ có dòng, AuditLog THEM trước/sau + lý do; KHÔNG đổi bảng Page→nguồn, KHÔNG đổi lead/attribution
 *   [DMPD-02] vai KHÔNG phải Quản trị tối cao (kể cả Marketing có `sources:manage`) ⇒ từ chối, 0 dòng, 0 audit
 *   [DMPD-03] không đổi gì ⇒ KHONG_DOI, 0 audit; đổi phạm vi ⇒ SUA, audit có cũ + mới, cảnh báo nói Messenger MỚI
 *   [DMPD-04] thiếu lý do / mã sai / Page mẫu / thiếu cơ sở ⇒ từ chối TRƯỚC phép ghi (0 dòng, 0 audit)
 *   [DMPD-05] đầu–cuối: Page vừa thêm ⇒ `luuNguonCuaPage` gán `PAID_ADS` THÀNH CÔNG (bước mà trước đây chặn: "Page không có trong danh mục")
 *   [DMPD-06] gợi ý: Page đã cấp cho Agent AI Lead mà chưa có trong danh mục hiện là gợi ý; thêm xong thì hết gợi ý
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `DMPD` / `dmpd-`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));

import { db } from "../../lib/db";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { seedOrg, seedRoles } from "../e2e/_helpers/seed";
import { docGoiYPageAiLead, ghiPageDanhMuc, type NhapPageDanhMuc } from "../../lib/nguon/danh-muc-page";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon } from "./_nguon-fixture";
import { luuNguonCuaPage } from "../hoa-hong/_nguon-dong";

const RUN = RUN_DB_TESTS;
const P = "DMPD_";
const CASE = 90_000;
const LY_DO = "Thêm Page canary cho AI Lead";

async function don(): Promise<void> {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { entityType: "FacebookPageMapping", entityId: { startsWith: "dmpd-" } } });
  await db.facebookPageMapping.deleteMany({ where: { pageId: { startsWith: "dmpd-" } } });
  await db.aiLeadAgentPage.deleteMany({ where: { pageId: { startsWith: "dmpd-" } } });
  await db.aiLeadAgent.deleteMany({ where: { name: { startsWith: P } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

async function dungActor(roleDef: string, roleEnum: string): Promise<Actor> {
  const email = `${P}${roleDef.toLowerCase()}@example.test`;
  const u = await db.user.create({ data: { name: `${P}${roleDef}`, email, role: roleEnum as never, roles: [roleEnum as never], centerId: null, isActive: true }, select: { id: true } });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "HO" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: roleDef }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "dmpd", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  return resolveActorUncached(u.id);
}

const nhap = (o: Partial<NhapPageDanhMuc> = {}): NhapPageDanhMuc => ({ pageId: "dmpd-canary-1", pageName: `${P}Page`, phamVi: "HO", centerId: null, isActive: true, lyDo: LY_DO, ...o });
const demAudit = () => db.auditLog.count({ where: { entityType: "FacebookPageMapping", entityId: { startsWith: "dmpd-" } } });

describe.skipIf(!RUN)("Danh mục Page — thêm / sửa bằng giao diện", () => {
  const truocRbac = process.env.RBAC_V2_ENABLED;
  let cs1 = "";

  beforeAll(async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  }, 180_000);

  beforeEach(async () => {
    process.env.RBAC_V2_ENABLED = "true";
    await don();
    await damBaoDanhMucGoc(db);
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
  }, CASE);

  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    await don();
    await db.$disconnect();
  }, 180_000);

  it("[DMPD-01] Quản trị tối cao thêm Page HO ⇒ dòng + audit THEM; không đụng bảng Page→nguồn / lead", async () => {
    const actor = await dungActor("SUPER_ADMIN", "SUPER_ADMIN");
    const leadTruoc = await db.lead.count();
    const attrTruoc = await db.leadAttribution.count();
    const r = await ghiPageDanhMuc({ actor, actorName: "QTTC", nhap: nhap() });
    expect(r).toMatchObject({ ok: true, hanhDong: "THEM" });
    const h = await db.facebookPageMapping.findUniqueOrThrow({ where: { pageId: "dmpd-canary-1" } });
    expect(h).toMatchObject({ scopeType: "HO", centerId: null, isActive: true });
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "FacebookPageMapping", entityId: "dmpd-canary-1" } });
    expect(a.action).toBe("PAGE_DANH_MUC_THEM");
    expect(a.reason).toBe(LY_DO);
    expect((a.newValues as { scopeType?: string }).scopeType).toBe("HO");
    expect(await db.systemSetting.count({ where: { key: "nguon.bangNguonTheoPage" } })).toBe(0);
    expect(await db.lead.count()).toBe(leadTruoc);
    expect(await db.leadAttribution.count()).toBe(attrTruoc);
  }, CASE);

  it("[DMPD-02] vai không phải Quản trị tối cao (Marketing) ⇒ từ chối; 0 dòng, 0 audit", async () => {
    const actor = await dungActor("HO_MARKETING", "MARKETING");
    const r = await ghiPageDanhMuc({ actor, actorName: "MKT", nhap: nhap() });
    expect(r).toMatchObject({ ok: false, truong: "quyen" });
    expect(await db.facebookPageMapping.count({ where: { pageId: "dmpd-canary-1" } })).toBe(0);
    expect(await demAudit()).toBe(0);
  }, CASE);

  it("[DMPD-03] không đổi ⇒ KHONG_DOI, không audit thêm; đổi phạm vi ⇒ SUA kèm audit cũ+mới và cảnh báo Messenger MỚI", async () => {
    const actor = await dungActor("SUPER_ADMIN", "SUPER_ADMIN");
    await ghiPageDanhMuc({ actor, actorName: "QTTC", nhap: nhap() });
    const lai = await ghiPageDanhMuc({ actor, actorName: "QTTC", nhap: nhap() });
    expect(lai).toMatchObject({ ok: true, hanhDong: "KHONG_DOI" });
    expect(await demAudit()).toBe(1);
    const sua = await ghiPageDanhMuc({ actor, actorName: "QTTC", nhap: nhap({ phamVi: "CENTER", centerId: cs1, lyDo: "Chuyển Page về CS1 theo chỉ đạo" }) });
    expect(sua).toMatchObject({ ok: true, hanhDong: "SUA" });
    if (sua.ok) expect(sua.canhBao.join(" ")).toMatch(/Messenger CRM MỚI/);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "FacebookPageMapping", entityId: "dmpd-canary-1", action: "PAGE_DANH_MUC_SUA" } });
    expect((a.oldValues as { scopeType?: string }).scopeType).toBe("HO");
    expect((a.newValues as { scopeType?: string }).scopeType).toBe("CENTER");
    expect((await db.facebookPageMapping.findUniqueOrThrow({ where: { pageId: "dmpd-canary-1" } })).centerId).toBe(cs1);
  }, CASE);

  it("[DMPD-04] thiếu lý do / mã sai / Page mẫu / thiếu cơ sở / cơ sở không có ⇒ từ chối trước phép ghi", async () => {
    const actor = await dungActor("SUPER_ADMIN", "SUPER_ADMIN");
    const truoc = await db.facebookPageMapping.count();
    const xau = [nhap({ lyDo: "ngắn" }), nhap({ pageId: "x" }), nhap({ pageId: "104500000000001" }), nhap({ phamVi: "CENTER", centerId: null }), nhap({ phamVi: "CENTER", centerId: "khong-co-co-so-nay" })];
    for (const x of xau) expect((await ghiPageDanhMuc({ actor, actorName: "QTTC", nhap: x })).ok).toBe(false);
    // Đếm TOÀN BẢNG trước/sau (ca khác có thể đã để lại dòng Page mẫu — luật 18: không giả định bảng sạch).
    expect(await db.facebookPageMapping.count()).toBe(truoc);
    expect(await demAudit()).toBe(0);
  }, CASE);

  it("[DMPD-05] đầu–cuối: Page vừa thêm gán được PAID_ADS (trước đây: 'Page không có trong danh mục')", async () => {
    const actor = await dungActor("SUPER_ADMIN", "SUPER_ADMIN");
    const truoc = await luuNguonCuaPage({ actor, actorName: "QTTC", pageId: "dmpd-canary-1", groupCode: "PAID_ADS", campaignCode: null });
    expect(truoc.ok).toBe(false);
    await ghiPageDanhMuc({ actor, actorName: "QTTC", nhap: nhap() });
    const sau = await luuNguonCuaPage({ actor, actorName: "QTTC", pageId: "dmpd-canary-1", groupCode: "PAID_ADS", campaignCode: null });
    expect(sau).toMatchObject({ ok: true, doi: true });
    const bang = (await db.systemSetting.findUniqueOrThrow({ where: { key: "nguon.bangNguonTheoPage" } })).valueJson as Record<string, { groupCode: string }>;
    expect(bang["dmpd-canary-1"]?.groupCode).toBe("PAID_ADS");
  }, CASE);

  it("[DMPD-06] Page đã cấp cho Agent AI Lead mà chưa có trong danh mục ⇒ là gợi ý; thêm xong ⇒ hết gợi ý", async () => {
    const actor = await dungActor("SUPER_ADMIN", "SUPER_ADMIN");
    const ag = await db.aiLeadAgent.create({ data: { name: `${P}agent`, environment: "TEST" } });
    await db.aiLeadAgentPage.create({ data: { agentId: ag.id, pageId: "dmpd-canary-1" } });
    const truoc = (await docGoiYPageAiLead()).find((g) => g.pageId === "dmpd-canary-1");
    expect(truoc).toMatchObject({ trongDanhMuc: false, agent: `${P}agent` });
    await ghiPageDanhMuc({ actor, actorName: "QTTC", nhap: nhap() });
    expect((await docGoiYPageAiLead()).find((g) => g.pageId === "dmpd-canary-1")?.trongDanhMuc).toBe(true);
  }, CASE);
});
