// @vitest-environment node
/**
 * AI LEAD GATEWAY — QUY TẮC THEO PAGE (E2) trên Postgres THẬT: cờ tự tạo lead RIÊNG của từng Page.
 *
 * Đo những thứ test thuần không chứng minh được:
 *   · mặc định CỘT thật là TẮT (tạo dòng Page mà không khai `autoCreate`);
 *   · Page A bật + công tắc toàn hệ bật ⇒ `taoLeadTuHoSo(…, { tu: "AUTO" })` được gọi; Page B (tắt) cùng điều kiện ⇒ KHÔNG gọi, và hồ sơ vẫn báo nhân viên;
 *   · công tắc toàn hệ tắt ⇒ KHÔNG gọi dù Page bật;
 *   · cờ Page không lọt vào response của cả 5 endpoint;
 *   · dịch vụ `datTuTaoLeadChoPage`: ghi cột + nhật ký có lý do, từ chối Page lạ / không đổi, `docQuyTacTuTao` đọc đúng.
 *
 * Mã ca: [QTP-DB-*]. ⚠️ TỰ SKIP khi không có Postgres test (db-gate) — thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 * Chạy: DATABASE_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/ai-lead/quy-tac-page.spec.ts   (MỘT tệp một lần — cùng sửa hàng Page của AGENT_TEST với dong-thoi).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTenDbTest, RUN_DB_TESTS } from "../_helpers/db-gate";

const mk = vi.hoisted(() => ({
  auto: false,
  taoLead: vi.fn(),
  baoHoSo: vi.fn(),
  baoSla: vi.fn(),
  baoSuCo: vi.fn(),
}));
vi.mock("@/lib/rate-limit", async () => {
  const that = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...that, rateLimit: (a: { key: string; max: number; windowMs: number }) => that.rateLimit({ ...a, key: `${a.key}:${Math.random()}` }) };
});
vi.mock("@/lib/ai-lead/cai-dat", async (goc) => {
  const that = await goc<typeof import("@/lib/ai-lead/cai-dat")>();
  return { ...that, congProd: async () => ({ allowed: true, reason: "OK", thieu: [] }), docCaiDat: async () => ({ ...(await that.docCaiDat()), autoCreateEnabled: mk.auto }) };
});
vi.mock("@/lib/ai-lead/dich-vu/thong-bao", async (goc) => {
  const that = await goc<typeof import("@/lib/ai-lead/dich-vu/thong-bao")>();
  return { ...that, baoHoSoCanXuLy: mk.baoHoSo, baoQuaHanNhan: mk.baoSla, baoSuCoAgent: mk.baoSuCo };
});
vi.mock("@/lib/ai-lead/dich-vu/tao-lead", () => ({ taoLeadTuHoSo: mk.taoLead }));

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings/service";
import { docFixture } from "@/lib/ai-lead/ho-tro-test";
import { docPhanHoi } from "@/lib/ai-lead/ho-tro-yeu-cau-test";
import { doiViecNen } from "@/lib/ai-lead/dich-vu/nen";
import { datRangBuocTuTao, datTuTaoLeadChoPage, docQuyTacTuTao, luuSlaThongBao } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { MAC_DINH_CAI_DAT } from "@/lib/ai-lead/hop-dong";
import { AGENT_KHAC, AGENT_TEST, batMoiTruong, don, donHoiThoai, dung, goi, PAGE } from "./_nen";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const RUN = RUN_DB_TESTS;
if (!RUN) console.warn("[ai-lead-qtp] SKIP: DATABASE_URL không trỏ Postgres test cục bộ / thiếu ALLOW_DB_RESET.");

type Th = Record<string, unknown>;
const NG = { userId: "qtp-user", userName: "QTP Tester" };
const LY_DO = "Lý do kiểm thử đủ dài";
/** Phiên bản bộ quy tắc hiện hành (0 = chưa có) — mô phỏng «phiên bản người sửa đã thấy lúc mở màn». */
const BV = async (): Promise<number> => (await db.aiLeadRuleSet.aggregate({ _max: { version: true } }))._max.version ?? 0;
const sha40 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 40);
const khoa = (kind: string, seed: string, v = 1) => `${kind}:${sha40(seed)}:v${v}`;

function thanIntake(seed: string): Th {
  const b = JSON.parse(JSON.stringify(docFixture("10").request.body)) as Th;
  b.idempotencyKey = khoa(String(b.intent), seed);
  b.evidence = { phoneMessageMid: `m_phone_${seed}`, campusMessageMid: `m_campus_${seed}` };
  return b;
}
const goiDoc = async (...a: Parameters<typeof goi>) => {
  const p = await docPhanHoi(await goi(...a));
  await doiViecNen();
  return p;
};
const khungGio = async <T>(iso: string, f: () => Promise<T>): Promise<T> => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  try {
    return await f();
  } finally {
    vi.useRealTimers();
  }
};
/** Đặt cờ riêng của dòng (agent, PAGE). */
const datCo = (agentId: string, autoCreate: boolean) => db.aiLeadAgentPage.updateMany({ where: { agentId, pageId: PAGE }, data: { autoCreate } });

describe.skipIf(!RUN)("AI Lead Gateway — quy tắc theo Page: tự tạo lead (Postgres thật)", () => {
  let khoiPhuc: () => void;
  let coSo: Awaited<ReturnType<typeof dung>>["coSo"];
  beforeAll(async () => {
    assertTenDbTest();
    khoiPhuc = batMoiTruong();
    coSo = (await dung()).coSo;
  });
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { actorId: NG.userId } });
    await db.systemSetting.deleteMany({ where: { key: "ai.autoCreateEnabled" } });
    clearSettingsCache();
    await don();
    khoiPhuc();
    await db.$disconnect();
  });
  beforeEach(async () => {
    mk.auto = false;
    for (const f of [mk.taoLead, mk.baoHoSo, mk.baoSla, mk.baoSuCo]) f.mockReset();
    mk.taoLead.mockResolvedValue({ ok: true, leadId: "lead_x", duplicate: false });
    mk.baoHoSo.mockResolvedValue(undefined);
    mk.baoSla.mockResolvedValue(undefined);
    mk.baoSuCo.mockResolvedValue(undefined);
    await donHoiThoai();
    // Page B = cùng PAGE nhưng thuộc AGENT_KHAC (cờ nằm trên dòng (agent, page)). Tạo KHÔNG khai `autoCreate` ⇒ đo mặc định cột thật.
    await db.aiLeadAgentPage.deleteMany({ where: { agentId: AGENT_KHAC, pageId: PAGE } });
    await db.aiLeadAgentPage.create({ data: { agentId: AGENT_KHAC, pageId: PAGE } });
    await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST }, data: { autoCreate: false, state: "ENABLED" } });
    await db.auditLog.deleteMany({ where: { actorId: NG.userId } });
    await db.aiLeadRuleSet.deleteMany({});
    await db.systemSetting.deleteMany({ where: { key: "ai.autoCreateEnabled" } });
    clearSettingsCache();
  });

  describe("[QTP-DB-01] mặc định của cột", () => {
    it("dòng Page tạo KHÔNG khai autoCreate ⇒ false (cột NOT NULL DEFAULT false); dòng sẵn có cũng false", async () => {
      const b = await db.aiLeadAgentPage.findFirstOrThrow({ where: { agentId: AGENT_KHAC, pageId: PAGE } });
      expect(b.autoCreate).toBe(false);
      const [{ column_default, is_nullable }] = await db.$queryRaw<{ column_default: string; is_nullable: string }[]>`
        SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'AiLeadAgentPage' AND column_name = 'autoCreate'`;
      expect(column_default).toBe("false");
      expect(is_nullable).toBe("NO");
    });
    it("ca đo: công tắc toàn hệ BẬT + Page mới tạo không khai cờ ⇒ KHÔNG tạo lead (mặc định cột thật chặn)", async () => {
      mk.auto = true;
      const r = await goiDoc("leadIntakes", { than: thanIntake("qtp01"), agentId: AGENT_KHAC });
      expect(r.status).toBe(200);
      expect(mk.taoLead).not.toHaveBeenCalled();
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
    });
  });

  describe("[QTP-DB-02] Page A bật · Page B tắt · công tắc toàn hệ bật", () => {
    it("A (autoCreate=true) ⇒ taoLeadTuHoSo gọi MỘT lần với { tu: 'AUTO' }; không báo thêm", async () => {
      mk.auto = true;
      await datCo(AGENT_TEST, true);
      const r = await goiDoc("leadIntakes", { than: thanIntake("qtp02a") });
      expect(r.status).toBe(200);
      expect(mk.taoLead).toHaveBeenCalledTimes(1);
      expect(mk.taoLead.mock.calls[0]![1]).toEqual({ tu: "AUTO" });
      expect(mk.baoHoSo).not.toHaveBeenCalled();
    });
    it("B (autoCreate=false) cùng điều kiện ⇒ KHÔNG gọi taoLeadTuHoSo; hồ sơ READY_FOR_REVIEW và VẪN báo QLCS đúng một lần", async () => {
      mk.auto = true;
      await datCo(AGENT_TEST, true); // A bật — để chứng minh B không "ăn theo" A
      const r = await goiDoc("leadIntakes", { than: thanIntake("qtp02b"), agentId: AGENT_KHAC });
      expect(r.status).toBe(200);
      expect(mk.taoLead).not.toHaveBeenCalled();
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
      const h = await db.aiLeadDraft.findFirstOrThrow({ where: { conversation: { agentId: AGENT_KHAC } } });
      expect(h.state).toBe("READY_FOR_REVIEW");
    });
    it("phản hồi cho Agent của A và B GIỐNG NHAU (N1: cờ Page không lộ ra ngoài qua nội dung trả lời)", async () => {
      mk.auto = true;
      await datCo(AGENT_TEST, true);
      const a = await goiDoc("leadIntakes", { than: thanIntake("qtp02c") });
      const b = await goiDoc("leadIntakes", { than: thanIntake("qtp02c"), agentId: AGENT_KHAC });
      const bo = (p: { body: unknown }) => JSON.stringify({ ...((p.body as { data: Th }).data), receiptId: "R" });
      expect(bo(a)).toBe(bo(b));
    });
  });

  describe("[QTP-DB-03] công tắc toàn hệ TẮT thắng cờ Page", () => {
    it("Page bật + toàn hệ tắt ⇒ KHÔNG tạo; hồ sơ chờ duyệt và báo QLCS", async () => {
      mk.auto = false;
      await datCo(AGENT_TEST, true);
      await goiDoc("leadIntakes", { than: thanIntake("qtp03") });
      expect(mk.taoLead).not.toHaveBeenCalled();
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
    });
  });

  describe("[QTP-DB-04] cờ Page KHÔNG lọt vào response của cả 5 endpoint (autoCreate là cấu hình nội bộ Admin)", () => {
    it("catalog · lead-intakes · handoffs · incidents · heartbeats: thân trả về không chứa 'autoCreate' dù Page đang BẬT", async () => {
      mk.auto = true;
      await datCo(AGENT_TEST, true);
      const handoff = JSON.parse(JSON.stringify(docFixture("20").request.body)) as Th;
      handoff.idempotencyKey = khoa("HANDOFF", "qtp04");
      const incident = JSON.parse(JSON.stringify(docFixture("30").request.body)) as Th;
      incident.idempotencyKey = khoa("INCIDENT", "qtp04");
      incident.occurredAt = "2026-10-26T07:30:00.000Z"; // /incidents từ chối sự cố xảy ra quá xa giờ máy chủ ⇒ đóng băng đồng hồ quanh lượt gọi này (luật 19)
      const heartbeat = JSON.parse(JSON.stringify(docFixture("40").request.body)) as Th;
      const ds = [
        await goiDoc("catalog", {}),
        await goiDoc("leadIntakes", { than: thanIntake("qtp04") }),
        await goiDoc("handoffs", { than: handoff }),
        await khungGio("2026-10-26T08:00:00.000Z", () => goiDoc("incidents", { than: incident })),
        await goiDoc("heartbeats", { than: heartbeat }),
      ];
      expect(ds.map((p) => p.status)).toEqual([200, 200, 200, 200, 200]);
      for (const p of ds) {
        expect(p.thoRaw.length).toBeGreaterThan(10);
        expect(p.thoRaw).not.toMatch(/autoCreate/i);
        expect(JSON.stringify(p.header)).not.toMatch(/autoCreate/i);
      }
    });
  });

  describe("[QTP-DB-05] dịch vụ datTuTaoLeadChoPage + docQuyTacTuTao", () => {
    it("bật ⇒ ghi cột + MỘT dòng nhật ký module ai-lead kèm lý do và giá trị cũ/mới; tắt ⇒ ghi chiều ngược", async () => {
      const r1 = await datTuTaoLeadChoPage(NG, { agentId: AGENT_TEST, pageId: PAGE, bat: true, lyDo: LY_DO });
      expect(r1).toEqual({ ok: true });
      expect((await db.aiLeadAgentPage.findFirstOrThrow({ where: { agentId: AGENT_TEST, pageId: PAGE } })).autoCreate).toBe(true);
      const log = await db.auditLog.findMany({ where: { actorId: NG.userId, entityType: "AiLeadAgentPage" } });
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ module: "ai-lead", action: "AI_LEAD_PAGE_TU_TAO_BAT", entityId: `${AGENT_TEST}:${PAGE}`, reason: LY_DO });
      expect(log[0]!.oldValues).toEqual({ autoCreate: false });
      expect(log[0]!.newValues).toEqual({ autoCreate: true });
      const r2 = await datTuTaoLeadChoPage(NG, { agentId: AGENT_TEST, pageId: PAGE, bat: false, lyDo: LY_DO });
      expect(r2).toEqual({ ok: true });
      expect((await db.aiLeadAgentPage.findFirstOrThrow({ where: { agentId: AGENT_TEST, pageId: PAGE } })).autoCreate).toBe(false);
      expect((await db.auditLog.findMany({ where: { actorId: NG.userId, action: "AI_LEAD_PAGE_TU_TAO_TAT" } })).length).toBe(1);
    });
    it("Page lạ ⇒ từ chối, không ghi gì; đặt đúng giá trị đang có ⇒ từ chối, KHÔNG thêm dòng nhật ký", async () => {
      const lạ = await datTuTaoLeadChoPage(NG, { agentId: AGENT_TEST, pageId: "104599999999999", bat: true, lyDo: LY_DO });
      expect(lạ).toMatchObject({ ok: false, error: expect.stringMatching(/không có Page/) });
      const giong = await datTuTaoLeadChoPage(NG, { agentId: AGENT_TEST, pageId: PAGE, bat: false, lyDo: LY_DO });
      expect(giong).toMatchObject({ ok: false, error: expect.stringMatching(/đã ở trạng thái đó/) });
      expect(await db.auditLog.count({ where: { actorId: NG.userId } })).toBe(0);
    });
    it("bật cho MỘT Page không đụng Page của agent khác", async () => {
      await datTuTaoLeadChoPage(NG, { agentId: AGENT_TEST, pageId: PAGE, bat: true, lyDo: LY_DO });
      expect((await db.aiLeadAgentPage.findFirstOrThrow({ where: { agentId: AGENT_KHAC, pageId: PAGE } })).autoCreate).toBe(false);
    });
    it("docQuyTacTuTao: liệt kê đúng các Page đang bật; toanHe đọc từ ai.autoCreateEnabled (mặc định false)", async () => {
      expect(await docQuyTacTuTao()).toEqual({ toanHe: false, batTheo: [] });
      await datCo(AGENT_TEST, true);
      await db.systemSetting.create({ data: { key: "ai.autoCreateEnabled", valueJson: true, updatedByName: "qtp" } });
      clearSettingsCache();
      expect(await docQuyTacTuTao()).toEqual({ toanHe: true, batTheo: [`${AGENT_TEST}:${PAGE}`] });
    });
  });
  // ── Rule Builder: bộ quy tắc có version nối vào intake (SLA · thu hẹp tự tạo · truy vết phiên bản) ─────────────────────────────────────────────
  describe("[QTP-DB-RB] bộ quy tắc trên đường intake", () => {
    const bat = async (agentId = AGENT_TEST) => {
      mk.auto = true;
      expect((await datTuTaoLeadChoPage(NG, { agentId, pageId: PAGE, bat: true, lyDo: LY_DO })).ok).toBe(true);
    };
    const hoSoCuaAgent = (agentId: string) => db.aiLeadDraft.findFirstOrThrow({ where: { conversation: { agentId } } });

    it("[QTP-DB-RB-01] requireConsent: hồ sơ CHƯA có đồng ý liên hệ ⇒ KHÔNG tự tạo (vẫn READY_FOR_REVIEW và báo QLCS); bỏ ràng buộc ⇒ tự tạo", async () => {
      await bat();
      expect((await datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: AGENT_TEST, pageId: PAGE, requireConsent: true, campusCenterIds: [], lyDo: LY_DO })).ok).toBe(true);
      const r = await goiDoc("leadIntakes", { than: thanIntake("rb01") });
      expect(r.status).toBe(200);
      expect(mk.taoLead).not.toHaveBeenCalled();
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
      expect((await hoSoCuaAgent(AGENT_TEST)).state).toBe("READY_FOR_REVIEW");
      // đối chứng dương: gỡ ràng buộc, hồ sơ MỚI (hội thoại khác) ⇒ tự tạo
      await donHoiThoai();
      expect((await datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: AGENT_TEST, pageId: PAGE, requireConsent: false, campusCenterIds: [], lyDo: LY_DO })).ok).toBe(true);
      await goiDoc("leadIntakes", { than: thanIntake("rb01b") });
      expect(mk.taoLead).toHaveBeenCalledTimes(1);
    });

    it("[QTP-DB-RB-02] danh sách cơ sở: cơ sở của hồ sơ NGOÀI danh sách ⇒ không tự tạo; TRONG danh sách ⇒ tự tạo", async () => {
      await bat();
      expect((await datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: AGENT_TEST, pageId: PAGE, requireConsent: false, campusCenterIds: [coSo.CS2], lyDo: LY_DO })).ok).toBe(true);
      await goiDoc("leadIntakes", { than: thanIntake("rb02a") }); // fixture chọn CS1
      expect(mk.taoLead).not.toHaveBeenCalled();
      await donHoiThoai();
      expect((await datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: AGENT_TEST, pageId: PAGE, requireConsent: false, campusCenterIds: [coSo.CS1], lyDo: LY_DO })).ok).toBe(true);
      await goiDoc("leadIntakes", { than: thanIntake("rb02b") });
      expect(mk.taoLead).toHaveBeenCalledTimes(1);
    });

    it("[QTP-DB-RB-03] quy tắc KHÔNG nới được: công tắc toàn hệ TẮT ⇒ không tự tạo dù quy tắc Page bật và không thu hẹp gì", async () => {
      await bat();
      mk.auto = false;
      await goiDoc("leadIntakes", { than: thanIntake("rb03") });
      expect(mk.taoLead).not.toHaveBeenCalled();
    });

    it("[QTP-DB-RB-04] SLA theo quy tắc: hạn nhận/xử lý của hồ sơ MỚI lấy từ quy tắc PAGE; hồ sơ ghi ruleSetVersion = phiên bản đang áp dụng", async () => {
      await bat();
      const l = await luuSlaThongBao(NG, { baseVersion: await BV(), rules: [{ kind: "SLA", scope: { type: "PAGE", pageId: PAGE }, claimMinutes: 7, resolveMinutes: 70 }], lyDo: LY_DO });
      expect(l.ok).toBe(true);
      const hien = (await db.aiLeadRuleSet.findFirstOrThrow({ orderBy: { version: "desc" } })).version;
      mk.auto = false;
      await khungGio("2026-11-09T03:00:00.000Z", () => goiDoc("leadIntakes", { than: thanIntake("rb04") }));
      const h = await hoSoCuaAgent(AGENT_TEST);
      expect(h.slaClaimDueAt?.toISOString()).toBe("2026-11-09T03:07:00.000Z");
      expect(h.slaResolveDueAt?.toISOString()).toBe("2026-11-09T04:10:00.000Z");
      expect(h.ruleSetVersion).toBe(hien);
    });

    it("[QTP-DB-RB-05] CHƯA có bộ quy tắc ⇒ hành vi cũ: hạn theo tham số ai.* mặc định, ruleSetVersion = null", async () => {
      mk.auto = false;
      await khungGio("2026-11-09T03:00:00.000Z", () => goiDoc("leadIntakes", { than: thanIntake("rb05") }));
      const h = await hoSoCuaAgent(AGENT_TEST);
      expect(h.ruleSetVersion).toBeNull();
      expect(h.slaClaimDueAt?.getTime()).toBe(new Date("2026-11-09T03:00:00.000Z").getTime() + MAC_DINH_CAI_DAT.slaClaimMinutes * 60_000);
      expect(h.slaResolveDueAt?.getTime()).toBe(new Date("2026-11-09T03:00:00.000Z").getTime() + MAC_DINH_CAI_DAT.slaResolveMinutes * 60_000);
    });

    it("[QTP-DB-RB-06] N1: phản hồi cho Agent GIỐNG HỆT dù Page có quy tắc thu hẹp hay không (quy tắc không lộ ra phản hồi)", async () => {
      await bat();
      await datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: AGENT_TEST, pageId: PAGE, requireConsent: true, campusCenterIds: [coSo.CS2], lyDo: LY_DO });
      const a = await goiDoc("leadIntakes", { than: thanIntake("rb06") });
      const b = await goiDoc("leadIntakes", { than: thanIntake("rb06"), agentId: AGENT_KHAC });
      const bo = (p: { body: unknown }) => JSON.stringify({ ...((p.body as { data: Th }).data), receiptId: "R" });
      expect(bo(a)).toBe(bo(b));
    });

    it("[QTP-DB-RB-07] FAIL-SAFE: phiên bản mới nhất HỎNG ⇒ intake vẫn 200, rơi về tham số ai.* (ruleSetVersion null), không ném", async () => {
      await db.aiLeadRuleSet.create({ data: { version: 1, reason: "hỏng có chủ đích", payload: { rules: [{ kind: "LA" }] }, hash: "x", publishedById: NG.userId } });
      mk.auto = false;
      const r = await goiDoc("leadIntakes", { than: thanIntake("rb07") });
      expect(r.status).toBe(200);
      expect((await hoSoCuaAgent(AGENT_TEST)).ruleSetVersion).toBeNull();
    });

    it("[QTP-DB-RB-08] THU HẸP KHÔNG FAIL-OPEN: Page đang BẬT tự tạo + phiên bản mới nhất HỎNG (không biết ràng buộc) ⇒ KHÔNG tự tạo lead, hồ sơ chờ nhân viên và báo QLCS; intake vẫn 200", async () => {
      await bat(); // v1 hợp lệ (autoCreate bật)
      await db.aiLeadRuleSet.create({ data: { version: 99, reason: "hỏng có chủ đích", payload: { rules: [{ kind: "LA" }] }, hash: "x", publishedById: NG.userId } });
      const r = await goiDoc("leadIntakes", { than: thanIntake("rb08") });
      expect(r.status).toBe(200);
      expect(mk.taoLead).not.toHaveBeenCalled();
      expect((await hoSoCuaAgent(AGENT_TEST)).state).toBe("READY_FOR_REVIEW");
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
      // đối chứng dương: gỡ bản hỏng ⇒ hồ sơ MỚI tự tạo lead như thường
      await db.aiLeadRuleSet.deleteMany({ where: { version: 99 } });
      await donHoiThoai();
      await goiDoc("leadIntakes", { than: thanIntake("rb08b") });
      expect(mk.taoLead).toHaveBeenCalledTimes(1);
    });
  });
});
