// @vitest-environment node
/**
 * [NHH-KY-LOC-*] — BỘ LỌC `?ky=` của hàng chờ tab Sổ (`docHangChoSo` / `demHangChoSo`), trên Postgres THẬT.
 *
 * Vì sao có: link "Xem ở tab Sổ" của tab Kỳ nói về MỘT kỳ (tháng × cơ sở), còn tab Sổ vốn đếm MỌI hàng chờ mở. Hai con số cùng chữ "hàng chờ" mà khác phạm vi là lời nói dối.
 * Bộ lọc kỳ phải làm ĐÚNG hai việc: (1) danh sách khớp ĐÚNG cái cổng khoá kỳ đếm (`demHangChoChan`), (2) mọi con số đi kèm (`tongSo` · `canXuLy` · `demTheoLoai` · `dem`)
 * dùng CÙNG điều kiện — lọc mỗi danh sách mà để chip đếm tổng thì chip và bảng lệch nhau.
 *
 * Hiện trường CÓ MẶT NẠ (đối chứng): cùng cơ sở khác tháng · khác cơ sở cùng tháng · hàng chờ đã đóng · hàng chờ treo không chặn kỳ nào.
 * Mỗi kịch bản dựng cơ sở riêng (luật 18) ⇒ chạy ĐƯỢC MỘT MÌNH. Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { docHangChoSo, demHangChoSo } from "../../lib/hoa-hong/hang-cho-so-doc";
import { bamKy } from "../../lib/hoa-hong/ky-db";
import { demHangChoChan } from "../../lib/hoa-hong/ky-service";
import type { MaHold } from "../../lib/hoa-hong/hang-cho";
import { datMocCutover, donKichBan, dungKichBan, nguoiKyHo, nguoiKyQlcs, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-KY-LOC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const cuaToi: KichBan[] = [];
const holdIds: string[] = [];
async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  return k;
}
const ky = (k: KichBan, thang: string) => bamKy(db, { thang, centerId: k.centerId, orgUnitId: k.ouId, kyCutover: "2026-10" });
async function hold(k: KichBan, code: MaHold, p: { kyId: string | null; status?: "OPEN" | "RESOLVED" }) {
  const h = await db.commissionHold.create({
    data: {
      holdKey: `${k.ma}:${code}:${holdIds.length}`,
      code,
      severity: "HARD",
      status: p.status ?? "OPEN",
      blockingPeriodId: p.kyId,
      centerId: k.centerId,
      detail: { lyDo: "fixture" },
      ...(p.status === "RESOLVED" ? { resolvedAt: new Date("2026-11-02T03:00:00.000Z"), resolutionNote: "fixture" } : {}),
    },
  });
  holdIds.push(h.id);
  return h.id;
}
const tapId = (dong: { id: string }[]) => new Set(dong.map((d) => d.id));

describe.skipIf(!RUN_DB_TESTS)("[NHH-KY-LOC] lọc hàng chờ tab Sổ theo kỳ", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await db.commissionHold.deleteMany({ where: { id: { in: holdIds } } });
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-KY-LOC-01] ky + cơ sở ⇒ danh sách == hàng chờ mà CỔNG khoá kỳ đếm; mặt nạ (khác tháng · khác cơ sở · đã đóng · treo) bị loại; đối chứng: bỏ ky ⇒ thấy cả mặt nạ", async () => {
    const k1 = await kb("loc01a");
    const k2 = await kb("loc01b");
    const ho = await nguoiKyHo();
    const k1m10 = await ky(k1, "2026-10");
    const k1m11 = await ky(k1, "2026-11");
    const k2m10 = await ky(k2, "2026-10");
    const A = await hold(k1, "PENDING_REGULATION", { kyId: k1m10.id });
    const B = await hold(k1, "CAP_EXCEEDED", { kyId: k1m10.id });
    const C = await hold(k1, "MANUAL_REVIEW_REQUIRED", { kyId: k1m11.id }); // cùng cơ sở, tháng khác
    const D = await hold(k2, "PENDING_REGULATION", { kyId: k2m10.id }); //     cơ sở khác, cùng tháng
    const E = await hold(k1, "UNRESOLVED_BENEFICIARY", { kyId: null }); //     treo, không chặn kỳ nào
    await hold(k1, "POLICY_OVERLAP", { kyId: k1m10.id, status: "RESOLVED" }); // đã đóng

    const co = await docHangChoSo(db, ho.quyen, { ky: "2026-10", centerId: k1.centerId, coTrang: 200 });
    expect(tapId(co.dong)).toEqual(new Set([A, B]));
    expect(co.tongSo).toBe(await demHangChoChan(db, k1m10.id)); // CÙNG số với cổng khoá
    expect(co.tongSo).toBe(2);

    // mọi con số đi kèm dùng CÙNG điều kiện (không còn đếm toàn bộ khi danh sách đã lọc)
    expect(co.canXuLy).toBe(2);
    expect(Object.values(co.dem).reduce((s, n) => s + n, 0)).toBe(2);
    expect(Object.values(co.demTheoLoai).reduce((s, n) => s + n, 0)).toBe(2);
    expect(co.dem.CHUA_PHAN_GIAI_NGUOI_HUONG).toBe(0); // E không lọt vào chip "chưa phân giải"

    // ky không kèm cơ sở: cộng cả hai cơ sở của tháng 10 (A, B của k1 và D của k2)
    const cacCoSo = await docHangChoSo(db, ho.quyen, { ky: "2026-10", coTrang: 200 });
    expect(tapId(cacCoSo.dong).has(A) && tapId(cacCoSo.dong).has(B) && tapId(cacCoSo.dong).has(D)).toBe(true);
    expect(tapId(cacCoSo.dong).has(C) || tapId(cacCoSo.dong).has(E)).toBe(false);

    // ĐỐI CHỨNG DƯƠNG: bỏ bộ lọc kỳ ⇒ thấy cả hàng chờ khác tháng và hàng chờ treo của cơ sở đó
    const tatCa = await docHangChoSo(db, ho.quyen, { centerId: k1.centerId, coTrang: 200 });
    expect(tapId(tatCa.dong)).toEqual(new Set([A, B, C, E]));
    expect(tatCa.canXuLy).toBe(4);
  });

  it("[NHH-KY-LOC-02] ky không lọt tầm nhìn cơ sở: QLCS CS1 lọc kỳ của CS2 ⇒ 0 dòng, 0 ở mọi con số (không lộ); đối chứng: lọc kỳ của chính CS1 ⇒ thấy", async () => {
    const k1 = await kb("loc02a");
    const k2 = await kb("loc02b");
    const ql1 = await nguoiKyQlcs(k1);
    const k1m10 = await ky(k1, "2026-10");
    const k2m10 = await ky(k2, "2026-10");
    const cuaCs1 = await hold(k1, "PENDING_REGULATION", { kyId: k1m10.id });
    await hold(k2, "PENDING_REGULATION", { kyId: k2m10.id });

    const thayCs2 = await docHangChoSo(db, ql1.quyen, { ky: "2026-10", centerId: k2.centerId, coTrang: 200 });
    expect(thayCs2.tongSo).toBe(0);
    expect(thayCs2.canXuLy).toBe(0);
    const thayCs1 = await docHangChoSo(db, ql1.quyen, { ky: "2026-10", centerId: k1.centerId, coTrang: 200 });
    expect(tapId(thayCs1.dong)).toEqual(new Set([cuaCs1]));
    expect(thayCs1.canXuLy).toBe(1);
  });

  it("[NHH-KY-LOC-03] `demHangChoSo` (pill/chip không lọc dòng) KHÔNG đổi theo ky: nó đếm mọi hàng chờ mở trong tầm nhìn — nhãn của pill phải nói đúng điều đó", async () => {
    const k = await kb("loc03");
    const ho = await nguoiKyHo();
    const m10 = await ky(k, "2026-10");
    const m11 = await ky(k, "2026-11");
    await hold(k, "PENDING_REGULATION", { kyId: m10.id });
    await hold(k, "MANUAL_REVIEW_REQUIRED", { kyId: m11.id });
    await hold(k, "UNRESOLVED_BENEFICIARY", { kyId: null });
    const tong = await demHangChoSo(ho.quyen, k.centerId);
    expect(tong.canXuLy).toBe(3);
    const loc = await docHangChoSo(db, ho.quyen, { ky: "2026-10", centerId: k.centerId, coTrang: 200 });
    expect(loc.canXuLy).toBe(1); // hai phạm vi KHÁC nhau ⇒ giao diện phải gắn nhãn khác nhau (khung.test.tsx [NHH-FE-NAV-LB])
  });
});
