// @vitest-environment node
/**
 * Phía SERVER của "ref first-claim" (cookie `sr_attr` 90 ngày + first-touch, 09/10/2026): cookie chỉ giải quyết "thắng trong MỘT trình duyệt";
 * thắng giữa các lần nhập là việc của `LeadAttribution`. Ca này khoá đúng hợp đồng đó bằng handler THẬT `POST /api/leads` trên Postgres LOCAL:
 *
 *   [REF-FC-01] lead gốc đến từ ref A (đối tác hợp lệ); phiếu thứ hai CÙNG SĐT mang ref B ⇒ attribution KHÔNG đổi (nhóm, ref trong signals,
 *               attributedAt), ref B chỉ thành touchpoint REF_SAU
 *   [REF-FC-02] đối chứng: phiếu thứ hai KHÔNG mang ref ⇒ attribution vẫn nguyên và KHÔNG có REF_SAU
 *
 * Bổ sung cho `[NHH-SRC-09b]` (nguon-noi-day-duong.spec.ts) — ca đó dùng lead gốc KHÔNG có ref; ở đây lead gốc ĐÃ có ref hợp lệ, tức đúng tình huống
 * "ref A đã claim rồi ref B tới sau". Nguyên tắc 'ref đến sau không chiếm nguồn' phụ thuộc đường ghi nên cần ca riêng cho nhánh có ref gốc.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `RFC_`. LUẬT 18: mỗi ca tự dựng hiện trường.
 * Phần TRÌNH DUYỆT (cookie bị Safari ITP rút hạn) KHÔNG đo được trong repo này — ghi ở docs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.7" }),
}));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));

import { NextRequest } from "next/server";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { POST as leadsPost } from "../../app/api/leads/route";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "RFC_";
const CASE = 90_000;
const SDT = "0906000001";
const bienThe = (s: string) => [s, `84${s.slice(1)}`];
const RATE_LIMIT_KEY = "public.leadRateLimitMax";

const jsonReq = (body: unknown) =>
  new NextRequest("http://localhost/api/leads", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const body = (over: Record<string, unknown> = {}) => ({
  parentName: `${P}Khách web`,
  phone: SDT,
  source: "lien-he",
  eventId: `evt-${Math.random().toString(36).slice(2, 12)}`,
  dongYChinhSachBaoMat: true,
  consentMarketing: false,
  timeOnPage: 30,
  ...over,
});

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: bienThe(SDT) } }] }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo quy nguồn + touchpoint
  }
  await db.affiliate.deleteMany({ where: { code: { startsWith: "RFCAFF" } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  await db.systemSetting.deleteMany({ where: { key: RATE_LIMIT_KEY } });
}

describe.skipIf(!RUN)("ref first-claim phía server (POST /api/leads)", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 120_000);

  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: RATE_LIMIT_KEY, valueJson: 100 } });
    clearSettingsCache();
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  const doc = async () => {
    const l = await db.lead.findFirstOrThrow({ where: { phone: { in: bienThe(SDT) }, deletedAt: null }, select: { id: true } });
    return db.lead.findUniqueOrThrow({
      where: { id: l.id },
      select: { id: true, affiliateId: true, attribution: { include: { group: { select: { code: true } } } }, touchpoints: { orderBy: { occurredAt: "asc" } } },
    });
  };

  it("[REF-FC-01] lead gốc đã claim bởi ref A; phiếu thứ hai CÙNG SĐT mang ref B ⇒ attribution KHÔNG đổi, ref B chỉ thành REF_SAU", async () => {
    const a = await db.affiliate.create({ data: { code: "RFCAFFA", name: `${P}A`, isActive: true }, select: { id: true } });
    await db.affiliate.create({ data: { code: "RFCAFFB", name: `${P}B`, isActive: true } });

    const r1 = await leadsPost(jsonReq(body({ ref: "rfcaffa" })));
    expect(r1.status).toBe(200);
    const truoc = await doc();
    expect((truoc.attribution!.signals as { ref: { code: string; affiliateId: string } }).ref).toMatchObject({ code: "RFCAFFA", affiliateId: a.id });

    const r2 = await leadsPost(jsonReq(body({ ref: "rfcaffb" })));
    expect(((await r2.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    const sau = await doc();

    expect(sau.id).toBe(truoc.id);
    expect(sau.attribution!.groupId).toBe(truoc.attribution!.groupId);
    expect(sau.attribution!.matchedRule).toBe(truoc.attribution!.matchedRule);
    expect(sau.attribution!.attributedAt).toEqual(truoc.attribution!.attributedAt);
    expect(sau.attribution!.updatedAt).toEqual(truoc.attribution!.updatedAt);
    expect((sau.attribution!.signals as { ref: { code: string } }).ref.code).toBe("RFCAFFA"); // KHÔNG bị B đè
    expect(sau.affiliateId).toBe(a.id); // đường cũ (Lead.affiliateId) cũng giữ ref gốc

    const refSau = sau.touchpoints.filter((t) => t.kind === "REF_SAU");
    expect(refSau).toHaveLength(1);
    expect((refSau[0]!.signals as { ref: string }).ref).toBe("RFCAFFB");
  }, CASE);

  it("[REF-FC-02] đối chứng: phiếu thứ hai KHÔNG mang ref ⇒ attribution nguyên và KHÔNG có REF_SAU nào", async () => {
    await db.affiliate.create({ data: { code: "RFCAFFA", name: `${P}A`, isActive: true } });
    await leadsPost(jsonReq(body({ ref: "rfcaffa" })));
    const truoc = await doc();
    await leadsPost(jsonReq(body()));
    const sau = await doc();
    expect(sau.attribution!.attributedAt).toEqual(truoc.attribution!.attributedAt);
    expect(sau.touchpoints.filter((t) => t.kind === "REF_SAU")).toHaveLength(0);
  }, CASE);
});
