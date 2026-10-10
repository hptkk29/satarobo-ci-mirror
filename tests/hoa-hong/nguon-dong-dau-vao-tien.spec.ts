// @vitest-environment node
/**
 * [DVT-*] — ĐỔI «THAM GIA HOA HỒNG» CỦA NGUỒN PHẢI LÀM KỲ ĐÃ TÍNH THẤY ĐẦU VÀO ĐÃ TRÔI (Postgres THẬT, đi đường ghi THẬT `suaNguon`).
 *
 * Vì sao có tệp này (Q2 · 09/10/2026): chủ và cửa sổ ghi công của nguồn đã được CHỤP vào `LeadAttribution.signals.nguon` lúc ghi nhận nên đổi chúng không làm đợt sau của đơn
 * trả góp đổi người; nhưng `commissionEnabled` thì engine đọc SỐNG từ dòng nguồn (`docNguonChoHoaHong`). Tập quét Q4 và cổng khoá kỳ lại chỉ nhìn `LeadAttribution.updatedAt`
 * ⇒ tắt cờ KHÔNG làm kỳ đã tính biết gì, kỳ khoá trên số cũ. Bản của nhánh kia vá bằng `UPDATE` mọi attribution của nguồn trong MỘT transaction (nguồn lớn ⇒ P2028 ở trần 5 giây).
 * Bản này: hai hàm đọc mốc nguồn (`nguonCapNhatTheoLead` · `nguonCapNhatMoiNhat`) lấy THÊM `LeadSourceGroup.updatedAt` — ghi O(1), không đụng attribution nào.
 *
 *   [DVT-01] tắt cờ rồi bật lại bằng `suaNguon` thật: cổng khoá + Q4 thấy; quét lại ⇒ TROI/INPUT_DRIFT (sổ KHÔNG bị chèn ngầm); bật lại ⇒ quét lại tự giải hold
 *   [DVT-02] phí tổn đã biết: đổi TÊN nguồn cũng vào tập quét — nhưng lượt quét lại KHÔNG đẻ dòng sổ / hold nào, và sau đó khoản RA khỏi tập (không quét lặp mãi)
 *   [DVT-03] nguồn lớn (400 lead): đổi cờ không chạm updatedAt của attribution nào; hai hàm đọc mốc trả đủ 400 lead trong thời gian ngắn; mốc ≥ updatedAt của nguồn
 *
 * ĐỒNG HỒ: Q4 so `updatedAt` (đồng hồ Node của Prisma) với `lastCheckedAt` (= `bc.now`), nên ca BẮT BUỘC truyền `new Date()` thật cho `boiCanh` — cùng lý do và cùng khuôn với
 * `so-dau-vao-doi.spec.ts`; mốc T đo từ đồng hồ DB, có `nghi()` hai bên để không dính độ phân giải. Luật 18: mỗi ca tự dựng thứ nó cần, chạy MỘT MÌNH là xanh.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { dauVaoMoiNhat } from "../../lib/hoa-hong/ky-service";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docTapQuet } from "../../lib/hoa-hong/quet-ky";
import { nguonCapNhatMoiNhat, nguonCapNhatTheoLead } from "../../lib/nguon/doc-nguon-hoa-hong";
import { damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, ganNguon, themChinhSachNhom, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { suaNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DVT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const LY_DO = "Chủ dự án chốt ngày 09/10/2026";
const P = "FXDVT";
const cuaToi: KichBan[] = [];
const nghi = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dongHoDb = async (): Promise<Date> => (await db.$queryRaw<{ t: Date }[]>`SELECT clock_timestamp() AS t`)[0]!.t;
let dem = 0;
let nguoi: { userId: string; ten: string };

async function taoNhom(hau: string) {
  dem += 1;
  return db.leadSourceGroup.create({
    data: { code: `DVT_${hau}_${Date.now().toString(36)}${dem}`.toUpperCase(), name: `DVT ${hau}`, referrerRequirement: "PARENT", sortOrder: 400 + dem, commissionEnabled: true },
    select: { id: true, code: true, updatedAt: true },
  });
}
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;

/** Kỳ 2026-10 đã TÍNH xong một khoản có phần REFERRER_PARENT 2% theo chính sách phạm vi nguồn `g`. */
async function dungKyDaTinh(hau: string) {
  const k = await dungKichBan(`dvt${hau}`, { rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  const g = await taoNhom(hau);
  const ph = await seedUser({ email: `${k.ma}-ph@ci.test`, role: "PARENT", name: `${k.ma}-ph`, phone: null });
  await themChinhSachNhom(k, g.code, [{ vai: "REFERRER_PARENT", rate: 0.02 }]);
  await ganNguon(k, g.code, { phHuynhUserId: ph.id, attributedAt: new Date("2026-10-01T03:00:00.000Z") });
  const be = await dungBe(k, "a", { tongTien: 10_000_000 });
  const paymentId = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-05") });
  const bc = await boiCanh(k, new Date());
  expect((await quetKhoan(db, bc, paymentId)).loai).toBe("DA_GHI");
  expect(tomTat(await dongSoCuaKhoan(paymentId))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT:${ph.id}`]: 200_000 });
  const ky = await db.commissionPeriod.findFirstOrThrow({ where: { period: "2026-10", centerId: k.centerId } });
  return { k, g, ph, paymentId, ky };
}
const tap = (k: KichBan) => async () => docTapQuet(db, await boiCanh(k, new Date()), { thang: "2026-12", centerId: k.centerId, soThangDoiSoat: 0 });

describe.skipIf(!RUN_DB_TESTS)("[DVT] đầu vào tiền của nguồn đổi ⇒ kỳ đã tính thấy", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await damBaoDanhMucGoc(db);
    await datMocCutover("2026-10");
    const u = await seedUser({ email: `${P.toLowerCase()}-admin@ci.test`, role: "MARKETING", name: `${P}-admin`, phone: null });
    nguoi = { userId: u.id, ten: `${P}-admin` };
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
    await db.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } }); // Cascade kéo quy nguồn
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DVT_" } } });
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: P } } });
    await datMocCutover(null);
  }, 120_000);

  it("[DVT-01] tắt cờ «tham gia hoa hồng» bằng suaNguon thật: cổng khoá + Q4 THẤY, quét lại ⇒ TROI (INPUT_DRIFT), sổ không bị chèn ngầm; bật lại ⇒ quét lại tự giải", async () => {
    const c = await dungKyDaTinh("t1");
    const tapCuaToi = tap(c.k);
    await nghi(25);
    const T = await dongHoDb();
    await nghi(25);
    // trước khi đổi: cổng khoá và tập quét đều KHÔNG thấy gì (đối chứng âm — nếu không, ca dưới đạt vì lý do sai)
    expect((await dauVaoMoiNhat(db, c.ky))!.getTime(), "trước khi đổi").toBeLessThanOrEqual(T.getTime());
    expect(await tapCuaToi(), "trước khi đổi").not.toContain(c.paymentId);

    // W2 (10/10): `suaNguon` NAY TỪ CHỐI tắt cờ khi nguồn có chính sách RIÊNG với dòng thu hút (fixture này: REFERRER_PARENT 2%) — đúng luật mới, ghim ở đây bằng đúng fixture.
    // Cờ vẫn có thể tắt bằng đường KHÔNG qua `suaNguon` (SQL tay, script, dữ liệu cũ), và drift phải bị thấy ở đó — nên đo drift bằng ghi thẳng cột (`updatedAt` tự tăng).
    const biChan = await suaNguon({ nguoi, id: c.g.id, updatedAtDaThay: await moiNhat(c.g.id), vao: { commissionEnabled: false }, lyDo: LY_DO });
    expect(biChan, "suaNguon từ chối tắt cờ khi còn chính sách riêng có dòng thu hút").toMatchObject({ ok: false });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: c.g.id } })).commissionEnabled, "bị từ chối ⇒ cờ KHÔNG đổi").toBe(true);
    await db.leadSourceGroup.update({ where: { id: c.g.id }, data: { commissionEnabled: false } });

    expect((await dauVaoMoiNhat(db, c.ky))!.getTime(), "cổng khoá (b) sau khi tắt cờ").toBeGreaterThan(T.getTime());
    expect(await tapCuaToi(), "tập quét Q4 sau khi tắt cờ").toContain(c.paymentId);

    const quet = await quetKhoan(db, await boiCanh(c.k, new Date()), c.paymentId);
    expect(quet).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    const troi = await db.commissionHold.findFirstOrThrow({ where: { paymentId: c.paymentId, code: "INPUT_DRIFT", status: "OPEN" } });
    expect(troi.detail).toMatchObject({ chenh: [{ key: `REFERRER_PARENT|USER|${c.ph.id}`, chenh: -200_000 }] });
    // sổ BẤT BIẾN: lượt quét chỉ PHÁT HIỆN, không tự rút phần 2% đã trả
    expect(tomTat(await dongSoCuaKhoan(c.paymentId))).toEqual({ [`SALE:${c.k.sale.id}`]: 400_000, [`REFERRER_PARENT:${c.ph.id}`]: 200_000 });

    // bật lại: kỳ vọng quay về đúng số đã ghi ⇒ hold tự giải, không đẻ thêm
    await nghi(25);
    const bat = await suaNguon({ nguoi, id: c.g.id, updatedAtDaThay: await moiNhat(c.g.id), vao: { commissionEnabled: true }, lyDo: LY_DO });
    expect(bat, "bật lại phải qua guardrail trần/chồng lấn").toMatchObject({ ok: true, doi: true });
    await quetKhoan(db, await boiCanh(c.k, new Date()), c.paymentId);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: troi.id } })).status).toBe("RESOLVED");
    expect(await db.commissionHold.count({ where: { paymentId: c.paymentId, code: "INPUT_DRIFT", status: "OPEN" } })).toBe(0);
  });

  it("[DVT-02] phí tổn đã biết: đổi TÊN nguồn cũng vào tập quét, nhưng quét lại KHÔNG đẻ dòng sổ / hold nào và khoản RA khỏi tập sau đó (không quét lặp mãi)", async () => {
    const c = await dungKyDaTinh("t2");
    const tapCuaToi = tap(c.k);
    const soDongTruoc = (await dongSoCuaKhoan(c.paymentId)).length;
    const soHoldTruoc = await db.commissionHold.count({ where: { paymentId: c.paymentId } });
    await nghi(25);
    expect(await tapCuaToi(), "trước khi đổi").not.toContain(c.paymentId);

    expect(await suaNguon({ nguoi, id: c.g.id, updatedAtDaThay: await moiNhat(c.g.id), vao: { name: "DVT đổi tên" }, lyDo: null })).toMatchObject({ ok: true, doi: true });
    expect(await tapCuaToi(), "đổi tên vào tập quét (fail-closed — phí tổn được ghi ở docs/source-commission/08)").toContain(c.paymentId);

    const quet = await quetKhoan(db, await boiCanh(c.k, new Date()), c.paymentId);
    expect(quet.loai).toBe("KHONG_DOI");
    expect((await dongSoCuaKhoan(c.paymentId)).length).toBe(soDongTruoc);
    expect(await db.commissionHold.count({ where: { paymentId: c.paymentId } })).toBe(soHoldTruoc);
    await nghi(25);
    expect(await tapCuaToi(), "sau lượt quét đã so lại: ra khỏi tập").not.toContain(c.paymentId);
  });

  it("[DVT-03] nguồn lớn (400 lead): đổi cờ KHÔNG chạm attribution nào (O(1), không P2028); hai hàm đọc mốc trả đủ 400 lead và mốc ≥ updatedAt của nguồn", async () => {
    const g = await taoNhom("big");
    const SO = 400;
    await db.lead.createMany({ data: Array.from({ length: SO }, (_, i) => ({ parentName: `${P}-big-${i}`, phone: `0988${String(100000 + i)}`, status: "MOI" as const })) });
    const leads = await db.lead.findMany({ where: { parentName: { startsWith: `${P}-big-` } }, select: { id: true } });
    expect(leads).toHaveLength(SO);
    await db.leadAttribution.createMany({
      data: leads.map((l) => ({ leadId: l.id, groupId: g.id, originalGroupId: g.id, identificationMethod: "MANUAL" as const, matchedRule: "KHAI_TAY", reasonText: "fixture dvt" })),
    });
    await nghi(25);
    const T = await dongHoDb();
    await nghi(25);

    const t0 = performance.now();
    const r = await suaNguon({ nguoi, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { commissionEnabled: false }, lyDo: LY_DO });
    const msGhi = performance.now() - t0;
    expect(r).toMatchObject({ ok: true, doi: true });
    // KHÔNG attribution nào bị chạm: đây là điều khác bản `UPDATE mọi attribution của nguồn`
    expect(await db.leadAttribution.count({ where: { groupId: g.id, updatedAt: { gt: T } } })).toBe(0);
    expect(msGhi, `suaNguon trên nguồn ${SO} attribution mất ${Math.round(msGhi)}ms (trần transaction tương tác của Prisma = 5000ms)`).toBeLessThan(3000);

    const ids = leads.map((l) => l.id);
    const t1 = performance.now();
    const theoLead = await nguonCapNhatTheoLead(db, ids);
    const moiNhatNguon = await nguonCapNhatMoiNhat(db, ids);
    const msDoc = performance.now() - t1;
    console.info(`[DVT-03] ${SO} attribution: suaNguon ${Math.round(msGhi)}ms · đọc mốc (hai hàm) ${Math.round(msDoc)}ms`);
    expect(theoLead.size).toBe(SO);
    const gMoi = await moiNhat(g.id);
    for (const [leadId, t] of theoLead) expect(t.getTime(), leadId).toBeGreaterThanOrEqual(gMoi.getTime());
    expect(moiNhatNguon!.getTime()).toBeGreaterThanOrEqual(gMoi.getTime());
    expect(msDoc).toBeLessThan(3000);
  });
});
