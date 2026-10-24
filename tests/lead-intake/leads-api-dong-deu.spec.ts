// @vitest-environment node
/**
 * [LDD-*] — `POST /api/leads` (biểu mẫu website, CÔNG KHAI) không được nói «SĐT này đã có trong CRM chưa» (R10 · D1, chủ dự án chốt 18/10/2026).
 *
 * Trước R10 đường này trả `{ ok: true, leadId: <id lead CŨ>, duplicate: true }` cho số đã có và `{ ok: true, leadId: <id mới> }` cho số mới — ai cũng dò được SĐT nào đang nằm trong CRM (kèm id lead)
 * bằng một POST không đăng nhập, không cần token. Nay: cùng status, cùng thân `{ ok: true }`, cùng lớp thời gian.
 *
 * Hai chế độ (như `affiliate-intake-do-tre.spec.ts`): CI = N nhỏ, khẳng định thứ BẤT BIẾN; đo thật = `DO_TRE_N=300 DO_TRE_CONC=1|8 DO_TRE_OUT=<file>` ⇒ phần việc thật p50…max của hai nhánh (đồng hồ thật, hàm chờ ghi nhận).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `LDD` (tên) và dải SĐT 0909xxxxxx của bộ này. LUẬT 18: mỗi ca tự dựng hiện trường.
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const REC = vi.hoisted(() => ({ cho: [] as number[], nhieu: 0, ip: 0, nem: false }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
// Mỗi lượt một IP riêng: trần rate-limit của `/api/leads` (tối đa 100/phút/IP) không được trộn vào phép đo.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": `10.66.${Math.floor((REC.ip += 1) / 250) % 250}.${(REC.ip % 250) + 1}` }) }));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));
// Ép lỗi ở bước kiểm trùng (sau khi đã chạm khách) để đo nhánh LỖI.
vi.mock("@/lib/lead/dedup", async (orig) => {
  const m = await orig<typeof import("@/lib/lead/dedup")>();
  return { ...m, findRecentDuplicate: (...a: Parameters<typeof m.findRecentDuplicate>) => (REC.nem ? Promise.reject(new Error("ép lỗi để đo")) : m.findRecentDuplicate(...a)) };
});
// Đồng hồ THẬT (đo phần việc thật), hàm chờ GHI NHẬN (không chờ), nhiễu cố định.
vi.mock("@/lib/security/dong-deu-thoi-gian", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/dong-deu-thoi-gian")>()),
  phuThuocThoiGianThat: () => ({ now: () => new Date(), cho: async (ms: number) => void REC.cho.push(ms), nhieuMs: () => REC.nhieu }),
}));

import { NextRequest } from "next/server";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { POST as leadsPost } from "../../app/api/leads/route";
import { POST as saleFormPost } from "../../app/api/public/lead-intake/sale-form/route";
import { DO_TRE_TOI_THIEU_MS } from "../../lib/security/dong-deu-thoi-gian";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "LDD";
const CASE = 300_000;
const N = Math.max(5, Number(process.env.DO_TRE_N ?? 10));
const CONC = Math.max(1, Number(process.env.DO_TRE_CONC ?? 1));
const SDT_CO_SAN = "0909000001";
const RATE_LIMIT_KEY = "public.leadRateLimitMax";

const bienThe = (s: string) => [s, `84${s.slice(1)}`];
let phoneSeq = 0;
const sdtMoi = () => `0909${String(100_000 + (phoneSeq += 1)).slice(-6)}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { OR: [{ parentName: { startsWith: P } }, { phone: { startsWith: "0909" } }] }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  await db.systemSetting.deleteMany({ where: { key: RATE_LIMIT_KEY } });
}

const body = (phone: string, over: Record<string, unknown> = {}) => ({
  parentName: `${P} Khách web`,
  phone,
  source: "lien-he",
  eventId: `evt-${phone}-${Math.random().toString(36).slice(2, 10)}`,
  dongYChinhSachBaoMat: true,
  consentMarketing: false,
  timeOnPage: 30,
  ...over,
});
const goi = (b: unknown) =>
  leadsPost(new NextRequest("http://localhost/api/leads", { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }));

const pct = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)] ?? 0;
};

describe.skipIf(!RUN)("POST /api/leads — không lộ «SĐT đã có trong CRM chưa» (R10 · D1)", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 120_000);
  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: RATE_LIMIT_KEY, valueJson: 100 } });
    clearSettingsCache();
    REC.cho = [];
    REC.nhieu = 0;
    REC.nem = false;
    delete process.env.LEAD_INTAKE_REQUIRE_AUTH;
  }, CASE);
  afterAll(async () => {
    delete process.env.LEAD_INTAKE_REQUIRE_AUTH;
    await don();
    await db.$disconnect();
  }, 180_000);

  it("[LDD-01] lead MỚI · lead TRÙNG · bot (website điền) · timeOnPage<3 cùng ra status 200 + thân CHÍNH XÁC `{ ok: true }` — không `leadId`, không `duplicate`; DB thì khác nhau (đối chứng dương)", async () => {
    const moi = await goi(body(SDT_CO_SAN));
    const trung = await goi(body(SDT_CO_SAN, { parentName: `${P} Người khác` }));
    const bot = await goi(body(sdtMoi(), { website: "http://spam" }));
    const nhanh = await goi(body(sdtMoi(), { timeOnPage: 1 }));
    for (const [ten, r] of [["moi", moi], ["trung", trung], ["bot", bot], ["nhanh", nhanh]] as const) {
      expect(r.status, ten).toBe(200);
      expect(await r.json(), ten).toEqual({ ok: true });
    }
    // đối chứng dương: hai nhánh «chạm khách» THẬT SỰ khác nhau trong DB (một lead; lần hai chỉ ghi dấu vết trùng)
    expect(await db.lead.count({ where: { phone: { in: bienThe(SDT_CO_SAN) }, deletedAt: null } })).toBe(1);
    expect(await db.lead.count({ where: { parentName: `${P} Người khác` } })).toBe(0);
    expect(await db.leadDuplicate.count({ where: { primaryLead: { phone: { in: bienThe(SDT_CO_SAN) } } } })).toBeGreaterThanOrEqual(1);
  }, CASE);

  it("[LDD-02] MỌI nhánh chạm khách (mới · trùng) xin chờ ĐÚNG MỘT lần và kết thúc ở CÙNG mốc (ngưỡng + nhiễu); nhánh KHÔNG chạm khách (bot · timeOnPage · 400) không chờ", async () => {
    REC.nhieu = 40;
    const quet: Record<string, number> = {};
    for (const [ten, b] of [
      ["moi", body(sdtMoi())],
      ["trung", body(SDT_CO_SAN)],
    ] as const) {
      if (ten === "trung") await goi(body(SDT_CO_SAN)); // tạo lead gốc trước, rồi mới đo nhánh trùng
      REC.cho = [];
      const t0 = performance.now();
      expect((await goi(b)).status).toBe(200);
      const troi = performance.now() - t0;
      expect(REC.cho, ten).toHaveLength(1);
      quet[ten] = REC.cho[0]!;
      expect(troi + REC.cho[0]!, `${ten}: tổng = trôi + chờ ≈ ngưỡng + nhiễu`).toBeGreaterThanOrEqual(DO_TRE_TOI_THIEU_MS + 40 - 5);
      expect(troi + REC.cho[0]!, `${ten}: không dư quá nhiều`).toBeLessThan(DO_TRE_TOI_THIEU_MS + 40 + 150);
    }
    for (const [ten, b] of [
      ["bot", body(sdtMoi(), { website: "x" })],
      ["timeOnPage", body(sdtMoi(), { timeOnPage: 1 })],
      ["400", { phone: "không phải số" }],
    ] as const) {
      REC.cho = [];
      await goi(b);
      expect(REC.cho, ten).toEqual([]);
    }
  }, CASE);

  it("[LDD-03] khoá lạ / ký tự lạ ở dữ liệu hợp lệ vẫn KHÔNG tách hai nhánh: SĐT biến thể `84…` của số đã có ⇒ cũng ra `{ ok: true }` (không phân biệt dạng gõ)", async () => {
    expect((await goi(body(SDT_CO_SAN))).status).toBe(200);
    const r = await goi(body(`84${SDT_CO_SAN.slice(1)}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await db.lead.count({ where: { phone: { in: bienThe(SDT_CO_SAN) }, deletedAt: null } })).toBe(1);
  }, CASE);

  it("[LDD-05] LỖI sau khi đã chạm khách (kiểm trùng ném) ⇒ vẫn đi hết lớp thời gian chung và ra câu 500 cố định; lỗi trước khi chạm khách (400) không chờ", async () => {
    REC.nhieu = 25;
    REC.nem = true;
    const t0 = performance.now();
    const r = await goi(body(sdtMoi()));
    const troi = performance.now() - t0;
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, error: "Lỗi hệ thống" });
    expect(REC.cho, "lỗi sau khi chạm khách phải chờ ĐÚNG MỘT lần").toHaveLength(1);
    expect(troi + REC.cho[0]!).toBeGreaterThanOrEqual(DO_TRE_TOI_THIEU_MS + 25 - 5);
    REC.cho = [];
    REC.nem = false;
    expect((await goi({ phone: "không phải số" })).status).toBe(400); // đối chứng: lỗi lược đồ (chưa chạm khách) không chờ
    expect(REC.cho).toEqual([]);
  }, CASE);

  it("[LDD-06] `sale-form` khi cờ bắt buộc đăng nhập TẮT (ẩn danh): số MỚI và số ĐÃ CÓ cùng redirect `ok=1` — KHÔNG `dup`, KHÔNG `child`; mỗi lượt chạm khách chờ đúng MỘT lần", async () => {
    process.env.LEAD_INTAKE_REQUIRE_AUTH = "false";
    const gui = (phone: string) =>
      saleFormPost(
        new NextRequest("http://localhost/api/public/lead-intake/sale-form", {
          method: "POST",
          body: new URLSearchParams({ CustomField15: phone, CustomField25: `${P} Phụ huynh`, LastName: `${P} Bé` }).toString(),
          headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.77.${(REC.ip += 1) % 250}.${(REC.ip % 200) + 1}` },
        }),
      );
    const moi = await gui(SDT_CO_SAN);
    expect(moi.status).toBe(303);
    expect(REC.cho).toHaveLength(1);
    const trung = await gui(SDT_CO_SAN);
    const lanBa = await gui(SDT_CO_SAN); // thêm con vào hồ sơ có sẵn
    expect(REC.cho).toHaveLength(3);
    for (const [ten, r] of [["moi", moi], ["trung", trung], ["lanBa", lanBa]] as const) {
      const url = new URL(r.headers.get("location")!);
      expect(r.status, ten).toBe(303);
      expect([...url.searchParams.keys()].sort(), `${ten}: chỉ có ok`).toEqual(["ok"]);
    }
    // đối chứng dương: DB có đúng MỘT lead cho số này (lượt hai/ba thật sự là «trùng»)
    expect(await db.lead.count({ where: { phone: { in: bienThe(SDT_CO_SAN) }, deletedAt: null } })).toBe(1);
  }, CASE);

  it(`[LDD-04] ĐO phần việc thật (N=${N}, CONC=${CONC}): nhánh «mới» và «trùng» đều DƯỚI ngưỡng ${DO_TRE_TOI_THIEU_MS} ms ở p50; không lượt nào vượt ngưỡng (vượt ⇒ không chờ bù ⇒ lộ)`, async () => {
    expect((await goi(body(SDT_CO_SAN))).status).toBe(200); // lead gốc cho nhánh trùng
    for (let i = 0; i < 4; i += 1) {
      await goi(body(sdtMoi()));
      await goi(body(SDT_CO_SAN));
    }
    const mau: Record<"MOI" | "TRUNG", number[]> = { MOI: [], TRUNG: [] };
    const viec: ("MOI" | "TRUNG")[] = [];
    for (let i = 0; i < N; i += 1) viec.push("MOI", "TRUNG");
    for (let i = 0; i < viec.length; i += CONC) {
      await Promise.all(
        viec.slice(i, i + CONC).map(async (nh) => {
          const b = nh === "MOI" ? body(sdtMoi()) : body(SDT_CO_SAN);
          const t0 = performance.now();
          const r = await goi(b);
          mau[nh].push(performance.now() - t0);
          expect(r.status).toBe(200);
          // `REC.cho` dùng chung giữa các lượt đồng thời ⇒ chỉ đếm TỔNG số lần xin chờ (mỗi lượt đúng một lần) ở cuối.
        }),
      );
    }
    const bang = Object.fromEntries((["MOI", "TRUNG"] as const).map((nh) => [nh, { n: mau[nh].length, p50: pct(mau[nh], 50), p90: pct(mau[nh], 90), p95: pct(mau[nh], 95), p99: pct(mau[nh], 99), max: Math.max(...mau[nh]) }]));
    console.log(`[LDD] N=${N} CONC=${CONC}\n${JSON.stringify(bang, null, 1)}`);
    if (process.env.DO_TRE_OUT) writeFileSync(process.env.DO_TRE_OUT, JSON.stringify({ n: N, conc: CONC, nguong: DO_TRE_TOI_THIEU_MS, bang }, null, 1));
    // mỗi lượt chạm khách xin chờ đúng MỘT lần ⇒ tổng số lần chờ ghi nhận ≥ số lượt đo (cộng khởi động); lượt vượt ngưỡng sẽ KHÔNG xin chờ nên làm tổng thiếu.
    const khoiDong = 1 + 4 * 2;
    // Chế độ ĐO (có DO_TRE_N) đòi MỌI lượt xin chờ đúng một lần; chế độ CI chỉ đòi p50 (runner chậm không được làm đỏ oan — luật 19).
    if (process.env.DO_TRE_N) expect(REC.cho.length, "có lượt vượt ngưỡng (không xin chờ bù ⇒ nhánh đó lộ bằng độ chậm)").toBe(khoiDong + viec.length);
    for (const nh of ["MOI", "TRUNG"] as const) expect(pct(mau[nh], 50), nh).toBeLessThan(DO_TRE_TOI_THIEU_MS);
  }, CASE);
});
