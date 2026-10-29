// @vitest-environment node
/**
 * [AIK-DB] Cấu hình AI Lead — tầng DB THẬT (Postgres local). Chạy: `pnpm exec vitest run -c vitest.db.config.ts lib/ai-lead/dich-vu/cau-hinh-db.test.ts`
 * trên một database RIÊNG (vd `satarobo_test_ailead_k` đã `prisma migrate deploy`). KHÔNG `resetDb()`: dọn theo TIỀN TỐ (agent `AIK_*`, Page `AIKP_*`, cơ sở `AIK*`,
 * nhật ký của `aik-user`). Tự SKIP khi không có Postgres test / thiếu ALLOW_DB_RESET — thấy SKIP nghĩa là CHƯA kiểm được gì, không phải xanh.
 *
 * Giả định: database dành riêng cho bộ này (xuất bản catalog đọc MỌI Page đã cấp, nên Page của bộ khác trong cùng DB làm lệch ca đếm).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS, assertTenDbTest } from "../../../tests/_helpers/db-gate";

const RUN = RUN_DB_TESTS;
const KHOA_GOC_TEST = "aik-test-master-key-0123456789abcdef-0123456789";
const NG = { userId: "aik-user", userName: "AIK Tester" };
const LY_DO = "Lý do kiểm thử đủ dài";
/** Đồng hồ CỐ ĐỊNH (luật 19) — không test nào đọc đồng hồ thật. */
const LUC_CO_DINH = new Date("2026-11-08T03:00:00.000Z");

if (!RUN) console.warn("[AIK-DB] SKIP: không có Postgres test cục bộ hoặc thiếu ALLOW_DB_RESET=1.");

describe.skipIf(!RUN)("[AIK-DB] cấu hình AI Lead trên Postgres thật", () => {
  const db = new PrismaClient();
  let ch: typeof import("./cau-hinh");
  let kn: typeof import("./ket-noi");
  let settings: typeof import("@/lib/settings/service");
  let khoa: typeof import("../khoa");
  let coSo1: { id: string; code: string };
  let coSo2: { id: string; code: string };
  let khoaMasterCu: string | undefined;

  async function don() {
    const agents = await db.aiLeadAgent.findMany({ where: { name: { startsWith: "AIK_" } }, select: { id: true } });
    const ids = agents.map((a) => a.id);
    await db.aiLeadDraft.deleteMany({ where: { conversation: { agentId: { in: ids } } } }); // Restrict: xoá hồ sơ trước khi Agent kéo hội thoại đi
    await db.aiLeadVerificationRun.deleteMany({ where: { OR: [{ agentId: { in: ids } }, { runById: NG.userId }] } });
    await db.aiLeadAgent.deleteMany({ where: { id: { in: ids } } }); // cascade: Page, probe, incident, nonce, request
    await db.aiLeadCampusPublication.deleteMany({ where: { pageId: { startsWith: "AIKP_" } } });
    await db.aiLeadCatalogSnapshot.deleteMany({ where: { publishedById: NG.userId } });
    await db.auditLog.deleteMany({ where: { actorId: NG.userId } });
    await db.systemSetting.deleteMany({ where: { key: { in: ["ai.prodEnabled", "ai.consentPolicyStatus", "ai.rate.newConversationsPerDayPerPage", "ai.queueMaxAgeHours"] } } });
    settings?.clearSettingsCache();
  }

  beforeAll(async () => {
    assertTenDbTest();
    khoaMasterCu = process.env.AI_LEAD_AGENT_MASTER_KEY;
    process.env.AI_LEAD_AGENT_MASTER_KEY = KHOA_GOC_TEST;
    ch = await import("./cau-hinh");
    kn = await import("./ket-noi");
    settings = await import("@/lib/settings/service");
    khoa = await import("../khoa");
    await don();
    await db.userOrgRole.deleteMany({ where: { orgUnitId: { in: (await db.orgUnit.findMany({ where: { code: { startsWith: "AIK_OU" } }, select: { id: true } })).map((o) => o.id) } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: "AIK_OU" } } });
    await db.center.deleteMany({ where: { code: { startsWith: "AIK" } } });
    const c1 = await db.center.create({ data: { code: "AIK1", name: "AIK Cơ sở 1", slug: "aik-co-so-1", address: "1 Đường Thử" } });
    const c2 = await db.center.create({ data: { code: "AIK2", name: "AIK Cơ sở 2", slug: "aik-co-so-2", address: "2 Đường Thử" } });
    coSo1 = { id: c1.id, code: "AIK1" };
    coSo2 = { id: c2.id, code: "AIK2" };
    // Mỗi cơ sở THẬT có một OrgUnit type=CENTER. `getNonEnrollableCenterIds` coi Center KHÔNG có OrgUnit là «không nhận khách» NGAY KHI cây OrgUnit đã có dòng nào (bộ DB khác chạy trước trong CI
    // để lại CS1/CS2 + OrgUnit) ⇒ cơ sở thử không OrgUnit bị từ chối oan. Fixture phải mang hình dạng dữ liệu thật.
    await db.userOrgRole.deleteMany({ where: { orgUnitId: { in: (await db.orgUnit.findMany({ where: { code: { startsWith: "AIK_OU" } }, select: { id: true } })).map((o) => o.id) } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: "AIK_OU" } } });
    for (const [c, ma] of [[c1, "AIK_OU1"], [c2, "AIK_OU2"]] as const) {
      await db.orgUnit.create({ data: { type: "CENTER", code: ma, name: `AIK đơn vị ${ma}`, centerId: c.id, path: `/${ma.toLowerCase()}/`, depth: 2, isActive: true } });
    }
  });

  afterAll(async () => {
    await don();
    await db.userOrgRole.deleteMany({ where: { orgUnitId: { in: (await db.orgUnit.findMany({ where: { code: { startsWith: "AIK_OU" } }, select: { id: true } })).map((o) => o.id) } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: "AIK_OU" } } });
    await db.center.deleteMany({ where: { code: { startsWith: "AIK" } } });
    if (khoaMasterCu === undefined) delete process.env.AI_LEAD_AGENT_MASTER_KEY;
    else process.env.AI_LEAD_AGENT_MASTER_KEY = khoaMasterCu;
    await db.$disconnect();
  });

  beforeEach(async () => {
    process.env.AI_LEAD_AGENT_MASTER_KEY = KHOA_GOC_TEST;
    await don();
    await db.center.updateMany({ where: { code: { startsWith: "AIK" } }, data: { isActive: true } });
  });
  afterEach(() => vi.restoreAllMocks());

  async function moCongProd() {
    await db.systemSetting.createMany({
      data: [
        { key: "ai.prodEnabled", valueJson: true, updatedByName: "aik" },
        { key: "ai.consentPolicyStatus", valueJson: "APPROVED", updatedByName: "aik" },
      ],
    });
    settings.clearSettingsCache();
  }
  async function taoAgentTest(name = "AIK_agent") {
    const r = await ch.taoAgent(NG, { name, environment: "TEST" });
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  const P = (n: number) => `AIKP_${n}000`;

  // ── Khoá ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it("[AIK-DB-01] tạo Agent TEST: khoá trả MỘT lần = khoá dẫn xuất; KHÔNG nằm ở bất kỳ cột nào hay trong nhật ký", async () => {
    const spy = vi.spyOn(console, "log");
    const spyErr = vi.spyOn(console, "error");
    const r = await taoAgentTest();
    expect(r.agentSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(r.agentSecret).toBe(khoa.daoKhoaAgent(r.agentId, 1));
    const hang = await db.aiLeadAgent.findUniqueOrThrow({ where: { id: r.agentId } });
    expect(hang.secretVersion).toBe(1);
    expect(JSON.stringify(hang)).not.toContain(r.agentSecret);
    const audit = await db.auditLog.findMany({ where: { actorId: NG.userId } });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => a.module === "ai-lead")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(r.agentSecret);
    expect(JSON.stringify([spy.mock.calls, spyErr.mock.calls])).not.toContain(r.agentSecret);
  });

  it("[AIK-DB-02] thiếu AI_LEAD_AGENT_MASTER_KEY ⇒ TỪ CHỐI rõ ràng, KHÔNG tạo hàng nào", async () => {
    delete process.env.AI_LEAD_AGENT_MASTER_KEY;
    const r = await ch.taoAgent(NG, { name: "AIK_khong_khoa", environment: "TEST" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/AI_LEAD_AGENT_MASTER_KEY/);
    expect(await db.aiLeadAgent.count({ where: { name: "AIK_khong_khoa" } })).toBe(0);
    const t = await ch.taoLaiKhoa(NG, { agentId: "x".repeat(25), secretVersionDangThay: 1, lyDo: LY_DO });
    expect(t.ok).toBe(false);
  });

  it("[AIK-DB-03] cổng PROD ĐÓNG ⇒ không tạo được Agent PROD; MỞ (cả hai khoá) ⇒ tạo được", async () => {
    const dong = await ch.taoAgent(NG, { name: "AIK_prod", environment: "PROD" });
    expect(dong.ok).toBe(false);
    if (!dong.ok) expect(dong.error).toMatch(/Cổng PROD/);
    expect(await db.aiLeadAgent.count({ where: { name: "AIK_prod" } })).toBe(0);
    await db.systemSetting.create({ data: { key: "ai.prodEnabled", valueJson: true, updatedByName: "aik" } });
    settings.clearSettingsCache();
    expect((await ch.taoAgent(NG, { name: "AIK_prod", environment: "PROD" })).ok).toBe(false); // mới MỘT vế
    await db.systemSetting.create({ data: { key: "ai.consentPolicyStatus", valueJson: "APPROVED", updatedByName: "aik" } });
    settings.clearSettingsCache();
    const mo = await ch.taoAgent(NG, { name: "AIK_prod", environment: "PROD" });
    expect(mo.ok).toBe(true);
  });

  it("[AIK-DB-04] tạo lại khoá: version+1, khoá cũ chết ngay, version cũ bị từ chối KHÔNG trả khoá", async () => {
    const a = await taoAgentTest();
    const r = await ch.taoLaiKhoa(NG, { agentId: a.agentId, secretVersionDangThay: 1, lyDo: LY_DO });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.secretVersion).toBe(2);
    expect(r.agentSecret).toBe(khoa.daoKhoaAgent(a.agentId, 2));
    expect(r.agentSecret).not.toBe(a.agentSecret);
    // Khoá cũ không còn là khoá hiện hành của (agent, version hiện tại).
    const hang = await db.aiLeadAgent.findUniqueOrThrow({ where: { id: a.agentId } });
    expect(khoa.daoKhoaAgent(a.agentId, hang.secretVersion)).not.toBe(a.agentSecret);
    const cu = await ch.taoLaiKhoa(NG, { agentId: a.agentId, secretVersionDangThay: 1, lyDo: LY_DO });
    expect(cu.ok).toBe(false);
    if (!cu.ok) expect(cu.error).toMatch(/vừa được người khác đổi/);
    expect(JSON.stringify(cu)).not.toMatch(/[0-9a-f]{64}/);
    expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: a.agentId } })).secretVersion).toBe(2);
  });

  it("[AIK-DB-05] hai người cùng xoay MỘT version: đúng MỘT người thành công (điều kiện version)", async () => {
    const a = await taoAgentTest();
    const kq = await Promise.all([
      ch.taoLaiKhoa(NG, { agentId: a.agentId, secretVersionDangThay: 1, lyDo: LY_DO }),
      ch.taoLaiKhoa(NG, { agentId: a.agentId, secretVersionDangThay: 1, lyDo: LY_DO }),
    ]);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: a.agentId } })).secretVersion).toBe(2);
  });

  it("[AIK-DB-06] nhật ký xoay khoá: chỉ secretVersion + lý do, module ai-lead, KHÔNG chuỗi 64-hex nào", async () => {
    const a = await taoAgentTest();
    const r = await ch.taoLaiKhoa(NG, { agentId: a.agentId, secretVersionDangThay: 1, lyDo: LY_DO });
    expect(r.ok).toBe(true);
    const dong = await db.auditLog.findFirstOrThrow({ where: { actorId: NG.userId, action: "AI_LEAD_AGENT_TAO_LAI_KHOA" } });
    expect(dong.module).toBe("ai-lead");
    expect(dong.oldValues).toEqual({ secretVersion: 1 });
    expect(dong.newValues).toEqual({ secretVersion: 2 });
    expect(dong.reason).toBe(LY_DO);
    const tatCa = await db.auditLog.findMany({ where: { actorId: NG.userId } });
    expect(JSON.stringify(tatCa)).not.toMatch(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i);
  });

  it("[AIK-DB-07] công tắc khẩn: tắt/bật ghi nhật ký kèm lý do; bật Agent PROD khi cổng đóng bị từ chối", async () => {
    await moCongProd();
    const prod = await ch.taoAgent(NG, { name: "AIK_prod2", environment: "PROD" });
    if (!prod.ok) throw new Error(prod.error);
    expect((await ch.datHoatDongAgent(NG, { agentId: prod.agentId, active: false, lyDo: LY_DO })).ok).toBe(true);
    expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: prod.agentId } })).active).toBe(false);
    await db.systemSetting.deleteMany({ where: { key: "ai.prodEnabled" } });
    settings.clearSettingsCache();
    const bat = await ch.datHoatDongAgent(NG, { agentId: prod.agentId, active: true, lyDo: LY_DO });
    expect(bat.ok).toBe(false);
    expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: prod.agentId } })).active).toBe(false);
    const log = await db.auditLog.findFirstOrThrow({ where: { actorId: NG.userId, action: "AI_LEAD_AGENT_TAT" } });
    expect(log.reason).toBe(LY_DO);
  });

  // ── FIX-03: Agent TEST không được tồn tại / hoạt động trên máy chủ PROD ──────────────────────────────────────────────────
  it("[AIK-DB-24] máy chủ PROD (VERCEL_ENV=production): không tạo được Agent TEST, không bật lại được; TẮT vẫn được; Agent PROD không bị đụng", async () => {
    const tonTai = await taoAgentTest("AIK_test_cu"); // tạo ở máy chủ không-PROD (vitest)
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      const tao = await ch.taoAgent(NG, { name: "AIK_test_moi", environment: "TEST" });
      expect(tao.ok).toBe(false);
      expect(await db.aiLeadAgent.count({ where: { name: "AIK_test_moi" } })).toBe(0); // không tạo hàng nào
      // TẮT luôn được (công tắc khẩn); BẬT lại thì không.
      expect((await ch.datHoatDongAgent(NG, { agentId: tonTai.agentId, active: false, lyDo: LY_DO })).ok).toBe(true);
      const bat = await ch.datHoatDongAgent(NG, { agentId: tonTai.agentId, active: true, lyDo: LY_DO });
      expect(bat.ok).toBe(false);
      expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: tonTai.agentId } })).active).toBe(false);
      // Tạo lại KHOÁ cho Agent TEST trên máy chủ PROD cũng bị chặn, và không đổi secretVersion (review độc lập 28/10)
      const v = (await db.aiLeadAgent.findUniqueOrThrow({ where: { id: tonTai.agentId } })).secretVersion;
      expect((await ch.taoLaiKhoa(NG, { agentId: tonTai.agentId, secretVersionDangThay: v, lyDo: LY_DO })).ok).toBe(false);
      expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: tonTai.agentId } })).secretVersion).toBe(v);
      // Agent PROD vẫn đi qua cổng PROD như cũ (đối chứng dương)
      await moCongProd();
      expect((await ch.taoAgent(NG, { name: "AIK_prod_van_tao_duoc", environment: "PROD" })).ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("[AIK-DB-25] dọn Agent TEST trên PROD: tắt từng Agent TEST đang bật + MỘT dòng nhật ký mỗi Agent; idempotent; không đụng Agent PROD / Agent đã tắt; không xoá gì; từ chối ở máy chủ cho phép Agent TEST", async () => {
    const a1 = await taoAgentTest("AIK_cu_1");
    const a2 = await taoAgentTest("AIK_cu_2");
    const da = await taoAgentTest("AIK_cu_da_tat");
    await ch.datHoatDongAgent(NG, { agentId: da.agentId, active: false, lyDo: LY_DO });
    await moCongProd();
    const prod = await ch.taoAgent(NG, { name: "AIK_prod_giu", environment: "PROD" });
    if (!prod.ok) throw new Error(prod.error);
    // máy chủ TEST/dev ⇒ từ chối, không tắt gì
    const sai = await ch.voHieuHoaAgentTestTrenProd(NG, { lyDo: LY_DO });
    expect(sai.ok).toBe(false);
    expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: a1.agentId } })).active).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      const r = await ch.voHieuHoaAgentTestTrenProd(NG, { lyDo: LY_DO });
      expect(r.ok && [...r.agentIds].sort()).toEqual([a1.agentId, a2.agentId].sort());
      for (const id of [a1.agentId, a2.agentId]) expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id } })).active).toBe(false);
      expect((await db.aiLeadAgent.findUniqueOrThrow({ where: { id: prod.agentId } })).active).toBe(true);
      expect(await db.aiLeadAgent.count({ where: { id: { in: [a1.agentId, a2.agentId, da.agentId] } } })).toBe(3); // không xoá
      const log = await db.auditLog.findMany({ where: { actorId: NG.userId, action: "AI_LEAD_AGENT_TAT_TEST_TREN_PROD" } });
      expect(log.map((l) => l.entityId).sort()).toEqual([a1.agentId, a2.agentId].sort());
      expect(log.every((l) => l.reason === LY_DO)).toBe(true);
      // chạy lại: 0 Agent, không thêm nhật ký
      const lai = await ch.voHieuHoaAgentTestTrenProd(NG, { lyDo: LY_DO });
      expect(lai.ok && lai.soAgent).toBe(0);
      expect(await db.auditLog.count({ where: { actorId: NG.userId, action: "AI_LEAD_AGENT_TAT_TEST_TREN_PROD" } })).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("[AIK-DB-26] cấu hình/Trung tâm kết nối nói đúng: Agent TEST trên PROD ⇒ moiTruongHopLe=false và nhãn BLOCKED (không bao giờ xanh); cùng Agent ở máy chủ TEST ⇒ hợp lệ", async () => {
    const a = await taoAgentTest("AIK_hienthi");
    const actorHo = { userId: NG.userId, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as import("@/lib/auth/actor").Actor;
    expect((await ch.docCauHinh(new Date())).agents.find((x) => x.id === a.agentId)!.moiTruongHopLe).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      expect((await ch.docCauHinh(new Date())).agents.find((x) => x.id === a.agentId)!.moiTruongHopLe).toBe(false);
      const tt = (await kn.docTrungTamKetNoi(actorHo, new Date("2026-11-08T03:00:00.000Z"))).agents.find((x) => x.agent.id === a.agentId)!;
      expect(tt.tongHop.nhan).toBe("BLOCKED");
      expect(tt.tongHop.xanh).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // ── Page ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it("[AIK-DB-08] cấp Page: Page mẫu của gói bàn giao bị chặn; trùng bị từ chối; cơ sở nhận phải đang hoạt động", async () => {
    const a = await taoAgentTest();
    expect((await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: "104500000000001" })).ok).toBe(false);
    expect((await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(1), routingCenterId: coSo1.id })).ok).toBe(true);
    expect((await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(1) })).ok).toBe(false);
    await db.center.update({ where: { id: coSo2.id }, data: { isActive: false } });
    const r = await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(2), routingCenterId: coSo2.id });
    expect(r.ok).toBe(false);
    expect(await db.aiLeadAgentPage.count({ where: { agentId: a.agentId } })).toBe(1);
  });

  it("[AIK-DB-09] tạm dừng / bật lại Page ghi trạng thái + nhật ký kèm lý do; gỡ Page cần lý do và xoá hàng", async () => {
    const a = await taoAgentTest();
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(3) });
    expect((await ch.datTrangThaiPage(NG, { agentId: a.agentId, pageId: P(3), state: "PAUSED", lyDo: LY_DO })).ok).toBe(true);
    expect((await db.aiLeadAgentPage.findFirstOrThrow({ where: { agentId: a.agentId, pageId: P(3) } })).state).toBe("PAUSED");
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "AI_LEAD_PAGE_TAM_DUNG", actorId: NG.userId } })).reason).toBe(LY_DO);
    expect((await ch.datTrangThaiPage(NG, { agentId: a.agentId, pageId: "AIKP_khong_co", state: "PAUSED", lyDo: LY_DO })).ok).toBe(false);
    expect((await ch.goPageKhoiAgent(NG, { agentId: a.agentId, pageId: P(3), lyDo: LY_DO })).ok).toBe(true);
    expect(await db.aiLeadAgentPage.count({ where: { agentId: a.agentId } })).toBe(0);
  });

  // ── Cơ sở xuất bản + catalog ──────────────────────────────────────────────────────────────────────────────────────────
  async function thietLapCatalog() {
    const a = await taoAgentTest();
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(4) });
    expect((await ch.luuCoSoXuatBan(NG, { pageId: P(4), campusCenterId: coSo1.id, acceptingLeads: true, publicVisible: true, displayOrder: 1 })).ok).toBe(true);
    return a;
  }

  it("[AIK-DB-10] xuất bản cơ sở: chỉ nhận Page đã cấp; cơ sở ngừng hoạt động / không có mã hợp lệ bị từ chối", async () => {
    const a = await taoAgentTest();
    const chuaCap = await ch.luuCoSoXuatBan(NG, { pageId: P(5), campusCenterId: coSo1.id, acceptingLeads: true, publicVisible: true, displayOrder: 0 });
    expect(chuaCap.ok).toBe(false);
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(5) });
    await db.center.update({ where: { id: coSo2.id }, data: { isActive: false } });
    expect((await ch.luuCoSoXuatBan(NG, { pageId: P(5), campusCenterId: coSo2.id, acceptingLeads: true, publicVisible: true, displayOrder: 0 })).ok).toBe(false);
    await db.center.update({ where: { id: coSo2.id }, data: { isActive: true, code: "aik x" } });
    expect((await ch.luuCoSoXuatBan(NG, { pageId: P(5), campusCenterId: coSo2.id, acceptingLeads: true, publicVisible: true, displayOrder: 0 })).ok).toBe(false);
    await db.center.update({ where: { id: coSo2.id }, data: { code: "AIK2" } });
    expect(await db.aiLeadCampusPublication.count({ where: { pageId: P(5) } })).toBe(0);
  });

  it("[AIK-DB-11] xuất bản catalog: version+1, etag CÓ version, payload đúng cơ sở; nội dung giống bản hiện hành bị từ chối", async () => {
    await thietLapCatalog();
    const v1 = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const snap = await db.aiLeadCatalogSnapshot.findUniqueOrThrow({ where: { version: v1.version } });
    expect(snap.etag).toBe(v1.etag);
    expect(snap.etag.startsWith(`v${v1.version}-`)).toBe(true);
    expect(JSON.stringify(snap.payload)).toContain("AIK1");
    expect(JSON.stringify(snap.payload)).not.toContain("AIK2");
    expect(snap.publishedById).toBe(NG.userId);
    const lai = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    expect(lai.ok).toBe(false);
    if (!lai.ok) expect(lai.error).toMatch(/giống hệt/);
  });

  it("[AIK-DB-12] SNAPSHOT BẤT BIẾN: xuất bản bản mới không đổi một byte của bản cũ; rollback = version MỚI mang nội dung cũ, etag MỚI", async () => {
    await thietLapCatalog();
    const v1 = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    if (!v1.ok) throw new Error(v1.error);
    const truoc = await db.aiLeadCatalogSnapshot.findUniqueOrThrow({ where: { version: v1.version } });
    await ch.luuCoSoXuatBan(NG, { pageId: P(4), campusCenterId: coSo2.id, acceptingLeads: false, publicVisible: true, displayOrder: 2 });
    const v2 = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    if (!v2.ok) throw new Error(v2.error);
    expect(v2.version).toBe(v1.version + 1);
    const sau = await db.aiLeadCatalogSnapshot.findUniqueOrThrow({ where: { version: v1.version } });
    expect(JSON.stringify(sau)).toBe(JSON.stringify(truoc));
    const rb = await ch.xuatBanLai(NG, { version: v1.version, lyDo: LY_DO });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.version).toBe(v2.version + 1);
    expect(rb.etag).not.toBe(v1.etag); // cùng nội dung với v1 nhưng etag KHÁC (có version)
    const moi = await db.aiLeadCatalogSnapshot.findUniqueOrThrow({ where: { version: rb.version } });
    expect(JSON.stringify(moi.payload)).toBe(JSON.stringify(truoc.payload));
    expect(JSON.stringify(await db.aiLeadCatalogSnapshot.findUniqueOrThrow({ where: { version: v1.version } }))).toBe(JSON.stringify(truoc));
    expect((await ch.xuatBanLai(NG, { version: 999999, lyDo: LY_DO })).ok).toBe(false);
  });

  it("[AIK-DB-13] cơ sở hiện công khai mà đã ngừng hoạt động ⇒ từ chối CẢ bản xuất bản, không tạo snapshot", async () => {
    await thietLapCatalog();
    const dem0 = await db.aiLeadCatalogSnapshot.count();
    await db.center.update({ where: { id: coSo1.id }, data: { isActive: false } });
    const r = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("AIK Cơ sở 1");
    expect(await db.aiLeadCatalogSnapshot.count()).toBe(dem0);
  });

  it("[AIK-DB-14] hai người xuất bản cùng lúc: không có hai snapshot trùng version (unique) — nhiều nhất MỘT bản thắng cho cùng nội dung", async () => {
    await thietLapCatalog();
    const kq = await Promise.all([ch.xuatBanCatalog(NG, { lyDo: LY_DO }), ch.xuatBanCatalog(NG, { lyDo: LY_DO })]);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    const versions = (await db.aiLeadCatalogSnapshot.findMany({ where: { publishedById: NG.userId }, select: { version: true } })).map((s) => s.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("[AIK-DB-15] gỡ cơ sở khỏi xuất bản xoá hàng + nhật ký; Page không còn cơ sở hiện công khai ⇒ campuses rỗng trong payload", async () => {
    await thietLapCatalog();
    expect((await ch.goCoSoXuatBan(NG, { pageId: P(4), campusCenterId: coSo1.id })).ok).toBe(true);
    expect((await ch.goCoSoXuatBan(NG, { pageId: P(4), campusCenterId: coSo1.id })).ok).toBe(false);
    const r = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    if (!r.ok) throw new Error(r.error);
    const snap = await db.aiLeadCatalogSnapshot.findUniqueOrThrow({ where: { version: r.version } });
    const p = (snap.payload as { pages: { pageId: string; campuses: unknown[] }[] }).pages.find((x) => x.pageId === P(4));
    expect(p?.campuses).toEqual([]);
  });

  // ── Chính sách ───────────────────────────────────────────────────────────────────────────────────────────────────────
  it("[AIK-DB-16] đổi chính sách: cần isSuperAdmin; ghi SystemSetting + nhật ký ai-lead (cũ → mới, lý do)", async () => {
    const khongPhaiSA = { userId: NG.userId, isSuperAdmin: false } as unknown as import("@/lib/auth/actor").Actor;
    const bi = await ch.doiChinhSach(khongPhaiSA, NG, { key: "ai.prodEnabled", value: true, lyDo: LY_DO });
    expect(bi.ok).toBe(false);
    expect(await db.systemSetting.count({ where: { key: "ai.prodEnabled" } })).toBe(0);
    const sa = { userId: NG.userId, isSuperAdmin: true } as unknown as import("@/lib/auth/actor").Actor;
    const ok = await ch.doiChinhSach(sa, NG, { key: "ai.consentPolicyStatus", value: "APPROVED", lyDo: LY_DO });
    expect(ok.ok).toBe(true);
    const dong = await db.auditLog.findFirstOrThrow({ where: { actorId: NG.userId, module: "ai-lead", action: "AI_LEAD_CHINH_SACH_DOI" } });
    expect(dong.oldValues).toEqual({ value: "PENDING_LEGAL" });
    expect(dong.newValues).toEqual({ value: "APPROVED" });
    expect(dong.reason).toBe(LY_DO);
  });

  // ── Thăm dò + lần chạy + sự cố ───────────────────────────────────────────────────────────────────────────────────────
  it("[AIK-DB-17] thăm dò: sinh probeId/nonce đúng định dạng, TTL theo ai.probeTtlMinutes; đang có thăm dò chưa ack/hết hạn ⇒ không phát thêm", async () => {
    const a = await taoAgentTest();
    const luc = new Date("2026-11-08T03:00:00.000Z");
    const r = await kn.phatHanhThamDo(NG, { agentId: a.agentId }, luc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.probeId).toMatch(/^prb_[a-z0-9]{12,40}$/);
    expect(r.expiresAt.getTime() - luc.getTime()).toBe(10 * 60_000);
    const hang = await db.aiLeadProbe.findUniqueOrThrow({ where: { probeId: r.probeId } });
    expect(hang.nonce).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    const lai = await kn.phatHanhThamDo(NG, { agentId: a.agentId }, new Date(luc.getTime() + 60_000));
    expect(lai.ok).toBe(false);
    // Hết hạn ⇒ phát lại được.
    expect((await kn.phatHanhThamDo(NG, { agentId: a.agentId }, new Date(luc.getTime() + 11 * 60_000))).ok).toBe(true);
    // Agent tắt ⇒ không thăm dò.
    await ch.datHoatDongAgent(NG, { agentId: a.agentId, active: false, lyDo: LY_DO });
    expect((await kn.phatHanhThamDo(NG, { agentId: a.agentId }, new Date(luc.getTime() + 60 * 60_000))).ok).toBe(false);
  });

  it("[AIK-DB-18] ghi lần chạy: PASS L3 phải khớp build/hash/môi trường/Page của Agent; sai ⇒ từ chối (không ghi bằng chứng chết); MOCK_ONLY ghi được", async () => {
    const a = await taoAgentTest();
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(6) });
    await db.aiLeadAgent.update({ where: { id: a.agentId }, data: { lastBuildSha: "abc1234", lastContractHash: "b".repeat(64), lastHeartbeatAt: LUC_CO_DINH } });
    const base = {
      agentId: a.agentId,
      level: "L3" as const,
      status: "PASS" as const,
      kind: "E2E" as const,
      contractHash: "b".repeat(64),
      buildSha: "abc1234",
      correlationId: "11111111-2222-3333-4444-555555555555",
      bangChung: { environment: "TEST" as const, pageIds: [P(6)] },
      lyDo: LY_DO,
    };
    const luc = new Date("2026-11-08T03:00:00.000Z");
    expect((await kn.ghiLanChay(NG, { ...base, buildSha: "ffff999" }, luc)).ok).toBe(false);
    expect((await kn.ghiLanChay(NG, { ...base, contractHash: "c".repeat(64) }, luc)).ok).toBe(false);
    expect((await kn.ghiLanChay(NG, { ...base, bangChung: { environment: "PROD", pageIds: [P(6)] } }, luc)).ok).toBe(false);
    expect((await kn.ghiLanChay(NG, { ...base, bangChung: { environment: "TEST", pageIds: [] } }, luc)).ok).toBe(false);
    expect(await db.aiLeadVerificationRun.count({ where: { agentId: a.agentId } })).toBe(0);
    expect((await kn.ghiLanChay(NG, base, luc)).ok).toBe(true);
    expect((await kn.ghiLanChay(NG, { ...base, status: "MOCK_ONLY", correlationId: undefined, buildSha: undefined, contractHash: undefined }, luc)).ok).toBe(true);
    const runs = await db.aiLeadVerificationRun.findMany({ where: { agentId: a.agentId }, orderBy: { createdAt: "asc" } });
    expect(runs.map((r) => r.status).sort()).toEqual(["MOCK_ONLY", "PASS"]);
    expect(runs[0]!.createdAt.toISOString()).toBe(luc.toISOString()); // đồng hồ do chỗ gọi truyền, không đọc đồng hồ thật
  });

  it("[AIK-DB-19] L4 PASS bị từ chối khi cổng PROD đóng, kể cả đủ chữ ký", async () => {
    await moCongProd();
    const prod = await ch.taoAgent(NG, { name: "AIK_prod3", environment: "PROD" });
    if (!prod.ok) throw new Error(prod.error);
    await ch.themPageChoAgent(NG, { agentId: prod.agentId, pageId: P(7) });
    await db.aiLeadAgent.update({ where: { id: prod.agentId }, data: { lastBuildSha: "abc1234", lastContractHash: "b".repeat(64), lastHeartbeatAt: LUC_CO_DINH } });
    const input = {
      agentId: prod.agentId,
      level: "L4" as const,
      status: "PASS" as const,
      kind: "PILOT" as const,
      contractHash: "b".repeat(64),
      buildSha: "abc1234",
      correlationId: "11111111-2222-3333-4444-555555555555",
      bangChung: { environment: "PROD" as const, pageIds: [P(7)], signoffBy: "Hồ Đắc Phúc" },
      lyDo: LY_DO,
    };
    await db.systemSetting.deleteMany({ where: { key: "ai.prodEnabled" } });
    settings.clearSettingsCache();
    expect((await kn.ghiLanChay(NG, input, LUC_CO_DINH)).ok).toBe(false);
  });

  it("[AIK-DB-21] trung tâm kết nối đọc telemetry thật: CONNECTED chỉ sau L2 PASS; đổi build ⇒ không còn xanh", async () => {
    const a = await taoAgentTest();
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(9) });
    const luc = new Date("2026-11-08T03:00:00.000Z");
    const hash = (await import("./ket-noi-thuan")).HASH_HOP_DONG_HIEN_HANH;
    await db.aiLeadAgent.update({ where: { id: a.agentId }, data: { lastBuildSha: "abc1234", lastContractHash: hash, lastHeartbeatAt: new Date(luc.getTime() - 30_000), lastAgentVersion: "1.0.0" } });
    const actor = { userId: NG.userId, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as import("@/lib/auth/actor").Actor;
    const dau = await kn.docTrungTamKetNoi(actor, luc);
    const v0 = dau.agents.find((x) => x.agent.id === a.agentId)!;
    expect(v0.tongHop.nhan).toBe("UNVERIFIED"); // nhịp tươi MỘT MÌNH
    expect(v0.tongHop.xanh).toBe(false);
    // L2 PASS
    const p = await kn.phatHanhThamDo(NG, { agentId: a.agentId }, new Date(luc.getTime() - 120_000));
    if (!p.ok) throw new Error(p.error);
    await db.aiLeadProbe.update({ where: { probeId: p.probeId }, data: { ackedAt: new Date(luc.getTime() - 60_000) } });
    // Đúng hình dạng mà route heartbeat ghi khi Agent ack (lib/ai-lead/dich-vu/heartbeat.ts) — không còn đường ghi tay.
    await db.aiLeadVerificationRun.create({
      data: {
        agentId: a.agentId, level: "L2", kind: "PROBE", status: "PASS",
        evidence: { agentId: a.agentId, buildSha: "abc1234", contractHash: hash, probeId: p.probeId, environment: "TEST", pageIds: [P(9)] },
        contractHash: hash, buildSha: "abc1234", createdAt: new Date(luc.getTime() - 60_000),
      },
    });
    const v1 = (await kn.docTrungTamKetNoi(actor, luc)).agents.find((x) => x.agent.id === a.agentId)!;
    expect(v1.tongHop.nhan).toBe("CONNECTED");
    expect(v1.tongHop.xanh).toBe(true);
    expect(v1.pages[0]!.webhook.trangThai).toBe("CHUA_BIET"); // chưa có payload nhịp ⇒ không suy ra gì
    // Đổi build ⇒ hết xanh.
    await db.aiLeadAgent.update({ where: { id: a.agentId }, data: { lastBuildSha: "def5678" } });
    const v2 = (await kn.docTrungTamKetNoi(actor, luc)).agents.find((x) => x.agent.id === a.agentId)!;
    expect(v2.tongHop.xanh).toBe(false);
    expect(v2.tongHop.tang.L2.muc).toBe("HET_HAN");
    // Nhịp cũ ⇒ STALE.
    await db.aiLeadAgent.update({ where: { id: a.agentId }, data: { lastBuildSha: "abc1234", lastHeartbeatAt: new Date(luc.getTime() - 10 * 60_000) } });
    expect((await kn.docTrungTamKetNoi(actor, luc)).agents.find((x) => x.agent.id === a.agentId)!.tongHop.nhan).toBe("STALE");
  });

  it("[AIK-DB-22] sự cố: nhận → giao → đóng → mở lại; đổi CÓ ĐIỀU KIỆN trạng thái (hành động trên trạng thái cũ bị từ chối); giao cho người không hợp lệ bị từ chối", async () => {
    const a = await taoAgentTest();
    const s = await db.aiLeadIncident.create({
      data: { agentId: a.agentId, pageId: "", category: "OTHER", detailCode: "OTHER_UNSPECIFIED", day: new Date("2026-11-08"), severity: "HIGH" },
    });
    // Người xử lý = người THẬT SỰ có quyền xem Trung tâm kết nối qua vai còn hiệu lực (HO_MARKETING có ai-integration:view), KHÔNG phải «cột vai cũ = MARKETING».
    const nguoiXuLy = await db.user.create({ data: { email: "aik-xuly@example.test", name: "AIK Xử lý", role: "MARKETING", isActive: true } });
    const nguoiKhac = await db.user.create({ data: { email: "aik-khac@example.test", name: "AIK Khác", role: "TEACHER", isActive: true } });
    const nguoiCotCu = await db.user.create({ data: { email: "aik-cotcu@example.test", name: "AIK Cột cũ", role: "MARKETING", isActive: true } }); // cột vai cũ MARKETING nhưng KHÔNG có vai nào ⇒ không xem được màn
    const quanTri = await db.user.create({ data: { email: "aik-qt@example.test", name: "AIK Quản trị", role: "SUPER_ADMIN", isActive: true } }); // Quản trị tối cao không cần dòng vai (can() cho qua bằng nhánh riêng)
    const donVi = await db.orgUnit.findFirstOrThrow({ where: { code: "AIK_OU1" } }); // OrgUnit của cơ sở thử, dựng ở beforeAll
    const vaiMkt = await db.roleDef.findUniqueOrThrow({ where: { code: "HO_MARKETING" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: nguoiXuLy.id, orgUnitId: donVi.id, roleId: vaiMkt.id, grantedById: nguoiXuLy.id, effectiveFrom: new Date(Date.now() - 60_000) } });
    try {
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "ACK" }, new Date())).ok).toBe(true);
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "ACK" }, new Date())).ok).toBe(false); // đã ACKED
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "GIAO", assigneeId: nguoiKhac.id }, new Date())).ok).toBe(false);
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "GIAO", assigneeId: nguoiCotCu.id }, new Date())).ok, "cột vai cũ không đủ").toBe(false);
      const chon = (await kn.docNguoiXuLy(new Date())).map((u) => u.id);
      expect(chon).toContain(nguoiXuLy.id);
      expect(chon).not.toContain(nguoiCotCu.id);
      expect(chon).not.toContain(nguoiKhac.id);
      expect(chon, "Quản trị tối cao luôn giao được").toContain(quanTri.id);
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "GIAO", assigneeId: quanTri.id }, new Date())).ok).toBe(true);
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "GIAO", assigneeId: nguoiXuLy.id }, new Date())).ok).toBe(true);
      expect((await db.aiLeadIncident.findUniqueOrThrow({ where: { id: s.id } })).assigneeId).toBe(nguoiXuLy.id);
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "DONG" }, new Date())).ok).toBe(false); // thiếu lý do
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "DONG", lyDo: LY_DO }, new Date())).ok).toBe(true);
      expect((await db.aiLeadIncident.findUniqueOrThrow({ where: { id: s.id } })).state).toBe("RESOLVED");
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "GIAO", assigneeId: nguoiXuLy.id }, new Date())).ok).toBe(false); // đã đóng
      expect((await kn.chuyenTrangThaiSuCo(NG, { id: s.id, hanhDong: "MO_LAI", lyDo: LY_DO }, new Date())).ok).toBe(true);
      expect((await db.aiLeadIncident.findUniqueOrThrow({ where: { id: s.id } })).state).toBe("OPEN");
      const ds = await kn.docSuCo({ state: "OPEN", agentId: a.agentId });
      expect(ds.rows.map((r) => r.id)).toContain(s.id);
      expect(ds.rows[0]!.assigneeName).toBe("AIK Xử lý");
    } finally {
      await db.userOrgRole.deleteMany({ where: { orgUnitId: donVi.id } });
      await db.user.deleteMany({ where: { email: { in: ["aik-xuly@example.test", "aik-khac@example.test", "aik-cotcu@example.test", "aik-qt@example.test"] } } });
    }
  });

  it("[AIK-DB-28] docCauHinh trả nguồn sẵn sàng THEO PAGE bằng bộ quy nguồn thật: chưa cấu hình ⇒ san:false (có mã); lỗi đọc không làm sập trang", async () => {
    const a = await taoAgentTest();
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(30) });
    const v = (await ch.docCauHinh(new Date())).agents.find((x) => x.id === a.agentId)!;
    const p = v.pages.find((x) => x.pageId === P(30))!;
    // DB test chưa bật nguon.* / chưa có bảng nguồn theo Page ⇒ KHÔNG sẵn sàng, có mã nguyên nhân (không ném).
    expect(p.nguon).toMatchObject({ san: false });
    if (!p.nguon.san) expect(["NGUON_TAT_HOAC_LOI", "PAGE_CHUA_GAN_NGUON"]).toContain(p.nguon.ma);
  });

  it("[AIK-DB-27] đếm thông báo gửi LỖI 24h từ nhật ký audit: chỉ đúng module+hành động, chỉ trong 24 giờ theo đồng hồ truyền vào; không có ⇒ 0 (khác null = không đọc được)", async () => {
    const actor = { userId: NG.userId, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as import("@/lib/auth/actor").Actor;
    const luc = new Date("2026-11-08T03:00:00.000Z");
    const ghi = (action: string, moduleName: string, truoc: number) =>
      db.auditLog.create({ data: { actorId: NG.userId, actorName: "AIK", module: moduleName, entityType: "AiLeadThongBao", entityId: "draft", action, createdAt: new Date(luc.getTime() - truoc) } });
    expect((await kn.docTrungTamKetNoi(actor, luc)).thongBaoLoi24h).toBe(0);
    await ghi("AI_LEAD_THONG_BAO_LOI", "ai-lead", 60_000);
    await ghi("AI_LEAD_THONG_BAO_LOI", "ai-lead", 23 * 3_600_000);
    await ghi("AI_LEAD_THONG_BAO_LOI", "ai-lead", 25 * 3_600_000); // quá 24 giờ
    await ghi("AI_LEAD_KHAC", "ai-lead", 60_000); // sai hành động
    await ghi("AI_LEAD_THONG_BAO_LOI", "module-khac", 60_000); // sai module
    expect((await kn.docTrungTamKetNoi(actor, luc)).thongBaoLoi24h).toBe(2);
  });

  it("[AIK-DB-29] hai chỉ báo giám sát có cơ chế thật (đồng hồ ĐÓNG BĂNG — luật 19): hồ sơ ở hàng chờ NGƯỜI, chưa ai nhận, quá ai.queueMaxAgeHours ⇒ `quaTuoi`; cuộc trò chuyện mới của Page TRONG NGÀY VN vượt ai.rate.newConversationsPerDayPerPage ⇒ `luuLuongBatThuong` (chỉ cảnh báo)", async () => {
    const a = await taoAgentTest();
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(40) });
    await db.systemSetting.createMany({
      data: [
        { key: "ai.rate.newConversationsPerDayPerPage", valueJson: 2, updatedByName: "aik" },
        { key: "ai.queueMaxAgeHours", valueJson: 24, updatedByName: "aik" },
      ],
    });
    settings.clearSettingsCache();
    // 2026-11-08 05:00 UTC = 12:00 giờ VN; nửa đêm VN của ngày đó = 2026-11-07 17:00 UTC.
    const luc = new Date("2026-11-08T05:00:00.000Z");
    const nuaDemVn = new Date("2026-11-07T17:00:00.000Z");
    const truoc = (ms: number, moc: Date = luc) => new Date(moc.getTime() - ms);
    const gio = (h: number) => truoc(h * 3_600_000);
    // Biên nửa đêm: 1 phút SAU nửa đêm VN tính; 1 phút TRƯỚC nửa đêm VN (ngày hôm qua) KHÔNG tính; cuộc ở Page khác / cuộc cũ KHÔNG tính.
    for (const [psid, pageId, luc2] of [["sau-nua-dem", P(40), new Date(nuaDemVn.getTime() + 60_000)], ["truoc-nua-dem", P(40), new Date(nuaDemVn.getTime() - 60_000)], ["m1", P(40), gio(1)], ["m2", P(40), gio(2)], ["cu", P(40), gio(72)], ["khac", P(41), gio(1)]] as const) {
      await db.aiLeadConversation.create({ data: { agentId: a.agentId, pageId, psid, createdAt: luc2 } });
    }
    // Hồ sơ: mỗi cái một cuộc trò chuyện ở Page khác (không làm lệch số đếm của P(40)).
    const tao = async (psid: string, state: "WAITING_QLCS" | "READY_FOR_REVIEW" | "PENDING_INFO" | "ASSIGNMENT_PENDING" | "IN_PROGRESS", tuoiGio: number, daNhan = false) => {
      const c = await db.aiLeadConversation.create({ data: { agentId: a.agentId, pageId: P(41), psid, createdAt: gio(1) } });
      await db.aiLeadDraft.create({ data: { conversationId: c.id, intent: "CONSULTATION_REQUEST", state, createdAt: gio(tuoiGio), ...(daNhan ? { claimedAt: gio(1), claimedById: NG.userId } : {}) } });
    };
    await tao("h30-cho", "WAITING_QLCS", 30); // ✔ quá ngưỡng, chờ người, chưa nhận
    await tao("h31-duyet", "READY_FOR_REVIEW", 31); // ✔
    await tao("h2-cho", "WAITING_QLCS", 2); // ✘ chưa quá tuổi
    await tao("h40-nhan", "WAITING_QLCS", 40, true); // ✘ đã có người nhận
    await tao("h40-khach", "PENDING_INFO", 40); // ✘ chờ KHÁCH bổ sung, không phải hàng chờ người
    await tao("h40-chiasale", "ASSIGNMENT_PENDING", 40); // ✘ chờ chia sale
    await tao("h40-xl", "IN_PROGRESS", 40); // ✘ đang xử lý
    const actor = { userId: NG.userId, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as import("@/lib/auth/actor").Actor;
    const v = (await kn.docTrungTamKetNoi(actor, luc)).agents.find((x) => x.agent.id === a.agentId)!;
    expect(v.hoSo.quaTuoi).toBe(2);
    const p = v.pages.find((x) => x.pageId === P(40))!;
    expect(p.cuocMoiHomNay).toBe(3); // sau-nua-dem + m1 + m2 (không tính truoc-nua-dem, cu, và Page khác)
    expect(p.luuLuongBatThuong).toBe(true);
    // đối chứng ÂM: nâng ngưỡng lên 100 ⇒ hết bất thường; nâng tuổi lên 35 giờ ⇒ chỉ còn hồ sơ 36 giờ… (không có) ⇒ 0
    await db.systemSetting.update({ where: { key: "ai.rate.newConversationsPerDayPerPage" }, data: { valueJson: 100 } });
    await db.systemSetting.update({ where: { key: "ai.queueMaxAgeHours" }, data: { valueJson: 35 } });
    settings.clearSettingsCache();
    const v2 = (await kn.docTrungTamKetNoi(actor, luc)).agents.find((x) => x.agent.id === a.agentId)!;
    expect(v2.pages.find((x) => x.pageId === P(40))!.luuLuongBatThuong).toBe(false);
    expect(v2.hoSo.quaTuoi).toBe(0);
  });

  it("[AIK-DB-30] nguồn bằng chứng do MÁY CHỦ gắn: ghi tay L3 ⇒ evidence.nguon = THU_CONG (người dùng không khai được — schema strict); docLichSuChay trả nguon đúng; L2 do thăm dò ⇒ HE_THONG", async () => {
    const a = await taoAgentTest();
    await ch.themPageChoAgent(NG, { agentId: a.agentId, pageId: P(42) });
    await db.aiLeadAgent.update({ where: { id: a.agentId }, data: { lastBuildSha: "abc1234", lastContractHash: "b".repeat(64), lastHeartbeatAt: LUC_CO_DINH } });
    const luc = new Date("2026-11-08T03:00:00.000Z");
    const r = await kn.ghiLanChay(NG, {
      agentId: a.agentId, level: "L3", status: "PASS", kind: "E2E", contractHash: "b".repeat(64), buildSha: "abc1234", correlationId: "11111111-2222-3333-4444-555555555555",
      bangChung: { environment: "TEST", pageIds: [P(42)] }, lyDo: LY_DO,
    }, luc);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const hang = await db.aiLeadVerificationRun.findFirstOrThrow({ where: { agentId: a.agentId, level: "L3" } });
    expect((hang.evidence as { nguon?: string }).nguon).toBe("THU_CONG");
    await db.aiLeadVerificationRun.create({ data: { agentId: a.agentId, level: "L2", status: "PASS", kind: "PROBE", evidence: { nguon: "HE_THONG" }, createdAt: luc } });
    const ls = await kn.docLichSuChay(a.agentId, 10);
    expect(ls.find((x) => x.level === "L3")!.nguon).toBe("THU_CONG");
    expect(ls.find((x) => x.level === "L2")!.nguon).toBe("HE_THONG");
  });

  it("[AIK-DB-31] xuất bản lại KHI bản hiện hành không toàn vẹn (etag bị sửa tay, payload vẫn đúng) ⇒ ĐƯỢC PHÉP dù nội dung giống hệt (đường phục hồi); bản toàn vẹn thì vẫn từ chối «giống hệt»", async () => {
    await thietLapCatalog();
    const v1 = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    if (!v1.ok) throw new Error(v1.error);
    expect((await ch.xuatBanCatalog(NG, { lyDo: LY_DO })).ok, "bản toàn vẹn ⇒ từ chối giống hệt").toBe(false);
    await db.aiLeadCatalogSnapshot.update({ where: { version: v1.version }, data: { etag: `v${v1.version}-${"0".repeat(32)}` } });
    const phucHoi = await ch.xuatBanCatalog(NG, { lyDo: LY_DO });
    expect(phucHoi.ok, JSON.stringify(phucHoi)).toBe(true);
    if (phucHoi.ok) expect(phucHoi.version).toBe(v1.version + 1);
  });

  it("[AIK-DB-23] số hồ sơ chờ đi qua scopedDb: người cấp cơ sở CHỈ đếm hồ sơ cơ sở mình; Hội sở đếm đủ (kể cả hồ sơ chưa biết cơ sở); đếm quá hạn SLA theo đồng hồ truyền vào", async () => {
    const a = await taoAgentTest();
    const luc = new Date("2026-11-08T03:00:00.000Z");
    const tao = async (psid: string, centerId: string | null, slaClaimDueAt: Date | null) => {
      const c = await db.aiLeadConversation.create({ data: { agentId: a.agentId, pageId: P(10), psid } });
      await db.aiLeadDraft.create({ data: { conversationId: c.id, intent: "CONSULTATION_REQUEST", state: "WAITING_QLCS", centerId, slaClaimDueAt } });
    };
    await tao("psid-cs1-a", coSo1.id, new Date(luc.getTime() - 60_000)); // quá hạn nhận
    await tao("psid-cs2-a", coSo2.id, new Date(luc.getTime() + 60_000));
    await tao("psid-chua-biet", null, null);
    const actorHo = { userId: NG.userId, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as import("@/lib/auth/actor").Actor;
    const actorCs1 = {
      userId: NG.userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], visibleCenterIds: [coSo1.id], visibleOrgUnitIds: [],
      permissions: [{ action: "ai-leads:view", scopeType: "GLOBAL", centerScope: [coSo1.id] }], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as unknown as import("@/lib/auth/actor").Actor;
    const ho = (await kn.docTrungTamKetNoi(actorHo, luc)).agents.find((x) => x.agent.id === a.agentId)!;
    const cs1 = (await kn.docTrungTamKetNoi(actorCs1, luc)).agents.find((x) => x.agent.id === a.agentId)!;
    // `luc` ở tương lai xa so với createdAt thật của hồ sơ ⇒ cả ba đều «già» hơn ngưỡng tuổi (kiểm riêng ở [AIK-DB-29])
    expect(ho.hoSo).toEqual({ cho: 3, dangXuLy: 0, quaHan: 1, quaTuoi: 3 });
    expect(cs1.hoSo).toEqual({ cho: 1, dangXuLy: 0, quaHan: 1, quaTuoi: 1 });
  });
});
