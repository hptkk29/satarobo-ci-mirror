// @vitest-environment node
/**
 * [NHH-CRON-*] — HAI cron của engine hoa hồng chạy qua route THẬT (`withCron` → `dungBoiCanhQuet` → `quetKy` / `doiSoatNen`) trên Postgres thật.
 *
 * Vì sao có tệp này — cấy lỗi 08/10, ĐỀU 0 ca đỏ trước đây: (1) bỏ cờ `hoaHong.engineBat` khỏi `dungBoiCanhQuet`; (2) coi "chưa có mốc cutover" là BẬT;
 * (3) cron hằng giờ bỏ tháng TRƯỚC; (4) cron hằng giờ bật cửa sổ đối soát Q5 (lẽ ra chỉ cron TUẦN làm). Các lưới có sẵn (`[NHH-W8]`) chỉ ghim CHỮ trong tệp route
 * ("có `b.loai === \"TAT\"`") — không ai gọi route và nhìn hậu quả.
 *
 * Đồng hồ: route đọc `new Date()` nên ca đóng băng ĐÚNG `Date` bằng fake timer (luật 19) — không đọc tờ lịch thật.
 */
import { NextRequest } from "next/server";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 180_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { GET as cronDoiSoat } from "../../app/api/cron/hoa-hong-doi-soat/route";
import { GET as cronQuet } from "../../app/api/cron/hoa-hong-quet/route";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { clearSettingsCache } from "../../lib/settings/service";
import { boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, huyChinhSach, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-CRON] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const BI_MAT = "nhh-cron-test-secret";
const KEY_BAT = "hoaHong.engineBat";
const cuaToi: KichBan[] = [];
const canHuy: string[] = [];
let engineCu: unknown;
let coCu = false;
let secretCu: string | undefined;

async function datEngine(bat: boolean) {
  await db.systemSetting.upsert({ where: { key: KEY_BAT }, create: { key: KEY_BAT, valueJson: bat, updatedByName: "fx-cron" }, update: { valueJson: bat, updatedByName: "fx-cron" } });
  clearSettingsCache();
}
const goi = (route: "quet" | "doi-soat", coAuth = true) => {
  const req = new NextRequest(`http://localhost/api/cron/hoa-hong-${route}`, { headers: coAuth ? { authorization: `Bearer ${BI_MAT}` } : {} });
  return (route === "quet" ? cronQuet : cronDoiSoat)(req);
};
/** Chạy `fn` với `Date` bị đóng băng ở `luc` (chỉ `Date`, không đụng timer của driver DB). */
async function luc<T>(luc: string, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(luc));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}
const lastChecked = async (paymentId: string) => (await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId }, select: { lastCheckedAt: true } })).lastCheckedAt.getTime();
const soO = (paymentId: string) => db.commissionCalcSlot.count({ where: { paymentId } });

describe.skipIf(!RUN_DB_TESTS)("[NHH-CRON] hai cron hoa hồng qua route thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    const cu = await db.systemSetting.findUnique({ where: { key: KEY_BAT } });
    coCu = !!cu;
    engineCu = cu?.valueJson;
    secretCu = process.env.CRON_SECRET;
    process.env.CRON_SECRET = BI_MAT;
  }, 120_000);
  // Cron nạp TOÀN BỘ chính sách trong DB: hai kịch bản đầu đều gắn chính sách GLOBAL nên để sống sẽ CHỒNG LẤN (CHONG_LAN) với kịch bản của CRON-03 — đúng hành vi
  // của engine, nhưng không phải thứ ca ấy muốn đo. Huỷ trong afterEach (chạy cả khi ca đỏ giữa chừng) để một ca đỏ không đầu độc ca sau (luật 18).
  afterEach(async () => {
    vi.useRealTimers();
    for (const ma of canHuy.splice(0)) await huyChinhSach(ma);
  });
  afterAll(async () => {
    if (coCu) await db.systemSetting.update({ where: { key: KEY_BAT }, data: { valueJson: engineCu as never } });
    else await db.systemSetting.deleteMany({ where: { key: KEY_BAT } });
    clearSettingsCache();
    if (secretCu === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secretCu;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-CRON-01] CỜ TẮT ⇒ cả hai cron là NO-OP tuyệt đối (boQua=ENGINE_TAT, 0 ô mới); thiếu/sai bí mật ⇒ 401", async () => {
    await datMocCutover("2026-10");
    await datEngine(false);
    const k = await dungKichBan("cron01", { rules: [{ vai: "SALE", rate: 0.03 }] });
    cuaToi.push(k);
    canHuy.push(k.chinhSach.policyCode);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 5_000_000, ngay: D("2026-11-05") });
    for (const route of ["quet", "doi-soat"] as const) {
      const r = await luc("2026-11-10T03:00:00.000Z", () => goi(route));
      expect(r.status, route).toBe(200);
      expect(await r.json(), route).toMatchObject({ ok: true, data: { boQua: "ENGINE_TAT" } });
    }
    expect(await soO(id)).toBe(0);
    expect((await goi("quet", false)).status).toBe(401);
  });

  it("[NHH-CRON-02] CHƯA có mốc cutover ⇒ no-op dù cờ BẬT (boQua=CHUA_CO_MOC_CUTOVER, 0 ô mới)", async () => {
    await datMocCutover(null);
    await datEngine(true);
    const k = await dungKichBan("cron02", { rules: [{ vai: "SALE", rate: 0.03 }] });
    cuaToi.push(k);
    canHuy.push(k.chinhSach.policyCode);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 5_000_000, ngay: D("2026-11-05") });
    const r = await luc("2026-11-10T03:00:00.000Z", () => goi("quet"));
    expect(await r.json()).toMatchObject({ ok: true, data: { boQua: "CHUA_CO_MOC_CUTOVER" } });
    expect(await soO(id)).toBe(0);
  });

  it("[NHH-CRON-03] BẬT + có mốc: cron GIỜ quét THÁNG NÀY và THÁNG TRƯỚC (không Q5); cron TUẦN mới có cửa sổ đối soát Q5 — quan sát qua `lastCheckedAt` của ô", async () => {
    await datMocCutover("2026-10");
    await datEngine(true);
    const k = await dungKichBan("cron03", { rules: [{ vai: "SALE", rate: 0.03 }] });
    cuaToi.push(k);
    // Hai khoản đã có ô (quét bằng đường thật, đồng hồ THẬT ⇒ lastCheckedAt là giờ DB hôm nay, rất xa các mốc giả bên dưới)
    const thang10 = await tienVe(k, await dungBe(k, "a"), { soTien: 5_000_000, ngay: D("2031-10-12") });
    const thang11 = await tienVe(k, await dungBe(k, "b"), { soTien: 5_000_000, ngay: D("2031-11-05") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, thang10);
    await quetKhoan(db, bc, thang11);
    const T1 = new Date("2031-11-10T03:00:00.000Z").getTime();
    const T2 = new Date("2031-12-10T03:00:00.000Z").getTime();

    // (đồng hồ giả ở NĂM 2031 — xa hơn mọi `updatedAt` thật, nên Q4 không bao giờ tự bật vì tờ lịch thật đi tới; luật 19)
    // 10/11: tháng NÀY = 11, tháng TRƯỚC = 10 ⇒ cả hai khoản được quét lại (Q1 của hai kỳ)
    await luc("2031-11-10T03:00:00.000Z", () => goi("quet"));
    expect(await lastChecked(thang10), "tháng TRƯỚC (10) phải được quét ở cron 10/11").toBe(T1);
    expect(await lastChecked(thang11)).toBe(T1);

    // 10/12: tháng nay = 12, tháng trước = 11 ⇒ khoản tháng 11 được quét lại, khoản tháng 10 thì KHÔNG (không có Q5 ở cron giờ)
    await luc("2031-12-10T03:00:00.000Z", () => goi("quet"));
    expect(await lastChecked(thang11), "tháng trước (11) được quét").toBe(T2);
    expect(await lastChecked(thang10), "khoản tháng 10 nằm NGOÀI hai tháng của cron giờ ⇒ không quét lại").toBe(T1);

    // cùng ngày 10/12, cron TUẦN (cửa sổ đối soát 3 tháng: 10, 11, 12) ⇒ khoản tháng 10 được quét lại
    const r = await luc("2031-12-10T03:00:00.000Z", () => goi("doi-soat"));
    expect((await r.json()).data).toMatchObject({ soThang: 3 });
    expect(await lastChecked(thang10), "cron tuần có Q5").toBe(T2);
  });
});
