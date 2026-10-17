// @vitest-environment node
/**
 * `platform` (fb / ig / …) của lead quảng cáo Meta đi hết đường: payload webhook ⇒ `extractNguonFields` ⇒ `ingestLead` ⇒ `LeadAttribution.signals`.
 * Postgres LOCAL thật.
 *
 *   [PLT-DB-01] payload CÓ platform ⇒ signals.quangCao.platform; luật vẫn QUANG_CAO (do ad_id), không phải do platform
 *   [PLT-DB-02] payload KHÔNG có platform ⇒ signals.quangCao không có khoá platform (dữ liệu cũ/mới cùng hình)
 *   [PLT-DB-03] payload CHỈ có platform ⇒ không phải tín hiệu quảng cáo: lead vẫn tạo, nguồn theo đường vào mặc định, signals không có quangCao
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `PLTF_`. LUẬT 18: mỗi ca tự dựng hiện trường.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { ingestLead } from "../../lib/lead/ingest";
import { extractNguonFields } from "../../lib/lead/webhook";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "PLTF_";
const CASE = 90_000;
const PHONE = { a: "0907000001", b: "0907000002", c: "0907000003" } as const;
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

async function don(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: Object.values(PHONE).flatMap(bienThe) } }] },
    select: { id: true },
  });
  if (leads.length > 0) await db.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } }); // FK Cascade kéo quy nguồn + touchpoint
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

describe.skipIf(!RUN)("platform của lead quảng cáo Meta — payload ⇒ signals", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 120_000);
  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
  }, CASE);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 120_000);

  const nhap = async (phone: string, payload: unknown, source = "facebook") => {
    const r = await ingestLead({ parentName: `${P}Phụ huynh`, phone, source, centerId: null, tinHieuNguon: extractNguonFields(payload) });
    expect(r.ok).toBe(true);
    return db.leadAttribution.findUniqueOrThrow({ where: { leadId: r.leadId! }, include: { group: { select: { code: true } } } });
  };

  it("[PLT-DB-01] payload CÓ platform ⇒ signals.quangCao.platform; luật vẫn QUANG_CAO nhờ ad_id", async () => {
    const a = await nhap(PHONE.a, { ad_id: "AD1", campaign_id: "CP1", platform: "ig" });
    expect(a.matchedRule).toBe("QUANG_CAO");
    expect(a.group.code).toBe("PAID_ADS");
    expect((a.signals as { quangCao: Record<string, string> }).quangCao).toEqual({ adId: "AD1", campaignId: "CP1", platform: "ig" });
  }, CASE);

  it("[PLT-DB-02] payload KHÔNG có platform ⇒ signals.quangCao không có khoá platform", async () => {
    const a = await nhap(PHONE.b, { ad_id: "AD1", campaign_id: "CP1" });
    expect((a.signals as { quangCao: Record<string, string> }).quangCao).toEqual({ adId: "AD1", campaignId: "CP1" });
  }, CASE);

  it("[PLT-DB-03] payload CHỈ có platform ⇒ không phải tín hiệu quảng cáo: nguồn theo đường vào mặc định, signals không có quangCao", async () => {
    const a = await nhap(PHONE.c, { platform: "fb" }, "web");
    expect(a.matchedRule).toBe("DUONG_VAO_MAC_DINH");
    expect((a.signals as Record<string, unknown>).quangCao).toBeUndefined();
  }, CASE);
});
