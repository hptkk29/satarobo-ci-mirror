// @vitest-environment node
/**
 * [ADT-*] — ĐO THỜI GIAN thật của lõi `POST /api/public/affiliate/v1/intake` trên Postgres THẬT (R10 · lane A, pre-Wave-3).
 *
 * Câu hỏi: lớp thời gian chung của `intake-cong-khai.ts` (`DO_TRE_TOI_THIEU_MS` + nhiễu) có CAO HƠN phần việc thật của MỌI nhánh không? Nếu một nhánh (thường là «lead mới»: tạo lead + con +
 * chia chủ) chạy lâu hơn ngưỡng thì lượt đó KHÔNG được kéo lên ngưỡng — nó trả lời chậm hơn các nhánh còn lại và người dò đọc được «SĐT này CHƯA có trong CRM». Ngưỡng phải đặt trên p99 ĐO ĐƯỢC.
 *
 * Hai chế độ:
 *   · CI (mặc định): N nhỏ, KHÔNG khẳng định số tuyệt đối (runner chậm không làm đỏ oan — luật 19). Chỉ khẳng định thứ bất biến: nhánh nào cũng ra cùng status + thân; và p50 của MỌI nhánh dưới ngưỡng.
 *   · ĐO THẬT: `DO_TRE_N=300 DO_TRE_CONC=1|8 DO_TRE_OUT=<file.json>` ⇒ bảng p50/p90/p95/p99/max theo nhánh + so sánh cặp (new vs existing …), ghi JSON.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `ADT`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.8" }) }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { DO_TRE_NHIEU_TOI_DA_MS, DO_TRE_TOI_THIEU_MS, xuLyIntakeGioiThieu, xuLyIntakeKhiTatTheoDoi, type KetQuaIntake, type PhuThuocIntake } from "../../lib/affiliate/intake-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "ADT";
const HOST = "adt-doi-tac.example.test";
const ORIGIN = `https://${HOST}`;
const SDT_CO_SAN = "0908000001";

const N = Math.max(5, Number(process.env.DO_TRE_N ?? 12));
const CONC = Math.max(1, Number(process.env.DO_TRE_CONC ?? 1));
const CASE = Math.max(300_000, Math.ceil((N * 5 * 1_100) / CONC) + 120_000); // chờ thật ≈ 0,8 s/lượt
/** DO_TRE_THAT=1: chờ THẬT + nhiễu thật — đo cái người dò nhìn thấy (tổng thời gian trả lời), không phải phần việc. */
const CHO_THAT = process.env.DO_TRE_THAT === "1";

let seq = 0;
const ma = (t: string) => `${P}_${t}${(seq += 1)}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await db.affiliateReferral.deleteMany({ where: { OR: [{ party: { code: { startsWith: P } } }, { leadId: { in: ids } }] } });
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$executeRaw`ALTER TABLE "ReferralClick" DISABLE TRIGGER "ReferralClick_chi_them"`;
  try {
    await db.referralClick.deleteMany({ where: { asset: { party: { code: { startsWith: P } } } } });
  } finally {
    await db.$executeRaw`ALTER TABLE "ReferralClick" ENABLE TRIGGER "ReferralClick_chi_them"`;
  }
  await db.affiliateTrackingAsset.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliateMembership.deleteMany({ where: { party: { code: { startsWith: P } } } });
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliatePartyTag.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliatePartyUser.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
}

async function dungHienTruong() {
  const nhom = await db.leadSourceGroup.create({
    data: { code: ma("S"), name: "Nguồn KOL fixture", sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true },
  });
  const site = await db.affiliateSite.create({
    data: { code: ma("W"), name: "Web fixture", baseUrl: ORIGIN, allowedDomains: [HOST], status: "ACTIVE", trackingEnabled: true, landingPages: { create: { pathPattern: "/khoa-robot" } } },
  });
  const campaign = await db.affiliateCampaign.create({
    data: { code: ma("C"), name: "Campaign fixture", status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, allowSelfReferral: false, defaultSourceGroupId: nhom.id, sites: { create: { siteId: site.id } } },
  });
  const loai = await db.affiliateType.create({ data: { code: ma("T"), name: "Loại fixture" } });
  const doiTac = await db.affiliate.create({ data: { code: ma("D"), name: "Đối tác fixture", status: "ACTIVE", isActive: true, typeId: loai.id } });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { token };
}

type Nhanh = "NEW" | "EXISTING" | "INVALID_TOKEN" | "MANUAL_REVIEW" | "DISABLED";
const NHANH: readonly Nhanh[] = ["NEW", "EXISTING", "INVALID_TOKEN", "MANUAL_REVIEW", "DISABLED"];

let keySeq = 0;
let phoneSeq = 0;
const sdtMoi = () => `0907${String(100_000 + (phoneSeq += 1)).slice(-6)}`;

/** Gọi LÕI với đồng hồ THẬT, hàm chờ ghi nhận (không chờ) — đo phần việc thật của nhánh, không đo lớp chờ. */
async function chay(nhanh: Nhanh, token: string): Promise<{ ms: number; kq: KetQuaIntake; choGoi: number[] }> {
  const choGoi: number[] = [];
  const pt: PhuThuocIntake = CHO_THAT
    ? { now: () => new Date(), choPhepTanSuat: async () => true, cho: (ms) => new Promise((xong) => (choGoi.push(ms), setTimeout(xong, ms))), nhieuMs: () => Math.floor(Math.random() * (DO_TRE_NHIEU_TOI_DA_MS + 1)) }
    : { now: () => new Date(), choPhepTanSuat: async () => true, cho: async (ms) => void choGoi.push(ms), nhieuMs: () => 0 };
  const thanh = (over: Record<string, unknown>) =>
    JSON.stringify({ v: 1, token, idempotencyKey: `adt-${(keySeq += 1)}-${Math.random().toString(36).slice(2, 8)}`, parentName: `${P} Phụ huynh`, phone: sdtMoi(), children: [{ fullName: `${P} Bé An` }], consentMarketing: true, ...over });
  let tho: string;
  let origin: string | null = ORIGIN;
  let ham = xuLyIntakeGioiThieu;
  switch (nhanh) {
    case "NEW":
      tho = thanh({});
      break;
    case "EXISTING":
      tho = thanh({ phone: SDT_CO_SAN });
      break;
    case "INVALID_TOKEN":
      tho = thanh({ token: sinhToken() });
      break;
    case "MANUAL_REVIEW":
      tho = thanh({});
      origin = null;
      break;
    case "DISABLED":
      tho = thanh({});
      ham = xuLyIntakeKhiTatTheoDoi;
      break;
  }
  const t0 = performance.now();
  const kq = await ham({ thanTho: tho, origin, ip: "10.88.0.1", userAgent: null }, pt);
  return { ms: performance.now() - t0, kq, choGoi };
}

const pct = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)] ?? 0;
};
/** Độ chính xác tốt nhất của MỘT ngưỡng đơn giản phân biệt hai mẫu (0.5 = không phân biệt được; 1 = tách hoàn toàn). Đây là kẻ dò rẻ nhất. */
const doChinhXacDo = (a: number[], b: number[]): number => {
  let tot = 0.5;
  for (const t of [...a, ...b]) {
    const fa = a.filter((x) => x > t).length / a.length;
    const fb = b.filter((x) => x > t).length / b.length;
    tot = Math.max(tot, (fa + (1 - fb)) / 2, (fb + (1 - fa)) / 2);
  }
  return tot;
};
const tomTat = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 50), p90: pct(xs, 90), p95: pct(xs, 95), p99: pct(xs, 99), max: Math.max(...xs) });

describe.skipIf(!RUN)("đo thời gian lõi intake Affiliate (R10 · lane A)", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 120_000);
  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: "affiliate.enabled", valueJson: true } });
    clearSettingsCache();
  }, CASE);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  it(`[ADT-01] mọi nhánh: CÙNG status + thân; mọi nhánh chạm khách xin chờ ĐÚNG MỘT lần (phần việc thật < ngưỡng); p50 từng nhánh dưới ngưỡng (N=${N}, CONC=${CONC})`, async () => {
    const h = await dungHienTruong();
    // hồ sơ CÓ SẴN cho nhánh EXISTING
    expect((await chay("NEW", h.token)).kq.status).toBe(200);
    await db.lead.updateMany({ where: { parentName: { startsWith: P } }, data: { phone: SDT_CO_SAN } });
    // khởi động: JIT + pool kết nối nóng, không tính vào mẫu
    for (const nh of NHANH) await chay(nh, h.token);

    const mau: Record<Nhanh, number[]> = { NEW: [], EXISTING: [], INVALID_TOKEN: [], MANUAL_REVIEW: [], DISABLED: [] };
    const quaNguong: Record<Nhanh, number> = { NEW: 0, EXISTING: 0, INVALID_TOKEN: 0, MANUAL_REVIEW: 0, DISABLED: 0 };
    let dau: { status: number; body: unknown } | null = null;
    const viec: Nhanh[] = [];
    for (let i = 0; i < N; i += 1) for (const nh of NHANH) viec.push(nh);
    for (let i = 0; i < viec.length; i += CONC) {
      const lo = await Promise.all(viec.slice(i, i + CONC).map(async (nh) => ({ nh, r: await chay(nh, h.token) })));
      for (const { nh, r } of lo) {
        mau[nh].push(r.ms);
        if (r.choGoi.length !== 1) quaNguong[nh] += 1; // 0 lần xin chờ = phần việc đã vượt ngưỡng = LỖ
        const hienRa = { status: r.kq.status, body: r.kq.body };
        dau ??= hienRa;
        expect(hienRa, nh).toEqual(dau);
      }
    }
    const bang = Object.fromEntries(NHANH.map((nh) => [nh, { ...tomTat(mau[nh]), mean: mau[nh].reduce((x, y) => x + y, 0) / mau[nh].length }]));
    const doDuoc = Object.fromEntries(NHANH.filter((nh) => nh !== "NEW").map((nh) => [`NEW_vs_${nh}`, doChinhXacDo(mau.NEW, mau[nh])]));
    console.log(`[ADT] N=${N} CONC=${CONC} ngưỡng=${DO_TRE_TOI_THIEU_MS}ms+0..${DO_TRE_NHIEU_TOI_DA_MS}ms\n${JSON.stringify(bang, null, 1)}\nvượt ngưỡng: ${JSON.stringify(quaNguong)}`);
    if (process.env.DO_TRE_OUT) writeFileSync(process.env.DO_TRE_OUT, JSON.stringify({ n: N, conc: CONC, nguong: DO_TRE_TOI_THIEU_MS, nhieu: DO_TRE_NHIEU_TOI_DA_MS, choThat: CHO_THAT, bang, quaNguong, doDuoc }, null, 1));

    for (const nh of NHANH) {
      // Chế độ ĐO (có DO_TRE_N) đòi 0 lượt vượt ngưỡng; chế độ CI chỉ đòi p50 (runner chậm không được làm đỏ oan — luật 19).
      if (process.env.DO_TRE_N) expect(quaNguong[nh], `${nh}: có lượt phần việc thật VƯỢT ngưỡng ⇒ không được chờ bù`).toBe(0);
      if (!CHO_THAT) expect(bang[nh]!.p50, `${nh} p50`).toBeLessThan(DO_TRE_TOI_THIEU_MS);
    }
  }, CASE);
});
