// @vitest-environment node
/**
 * [KV-*] NGƯỜI KIÊM HAI VAI — tầm nhìn đọc SỔ HOA HỒNG đo theo CHÍNH khoá, không theo tiền tố `commission:` (rà độc lập 20/10/2026, HIGH).
 *
 * Gốc lỗi: `PermEntry.centerScope` gắn cho MỌI quyền của một dòng vai; `getModelVisibleCenterIds("CommissionTransaction")` HỢP centerScope của mọi quyền bắt đầu bằng `commission:`
 * (cả `view-self`), còn `xemCoSo = can(view-center)` gọi trần (GLOBAL ⇒ đúng ở mọi cơ sở). ⇒ QLCS@CS1 kiêm Sale@CS2 đọc được sổ CS2 của NGƯỜI KHÁC; kiêm vai HO chỉ có view-self ⇒ mọi cơ sở.
 * Mọi ca cách ly sổ trước đây dựng actor MỘT vai nên không thấy. Mỗi ca dưới đây dựng người KIÊM, KÈM đối chứng dương (QLCS vẫn thấy CS mình · Kế toán HO thấy tất · Sale thấy dòng của CHÍNH mình ở CS kia).
 *
 * Chạy: `pnpm test:hoa-hong-db`. Mỗi ca tự dựng kịch bản (luật 18); ngày TUYỆT ĐỐI (luật 19).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { docSoHoaHong, gomSoTheoTrangThaiChi } from "../../lib/hoa-hong/doc-so";
import { docViSao } from "../../lib/hoa-hong/doc-so";
import { docHangChoSo } from "../../lib/hoa-hong/hang-cho-so-doc";
import { docDanhSachKy, docManHinhKy } from "../../lib/hoa-hong/ky-doc";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, donViHoiSo, dongSoCuaKhoan, dungBe, dungKichBan, ganVai, nguoiKyHo, nguoiKyQlcs, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[KV] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string) {
  const k = await dungKichBan(tien, { coLead: true });
  cuaToi.push(k);
  return k;
}

/** Một khoản thu 10tr đã quét ở cơ sở của `k` ⇒ các dòng sổ SALE / SALE_ADMIN / CENTER_MANAGER … của cơ sở đó. */
async function sanSo(k: KichBan, ngay = D("2026-11-05")): Promise<string> {
  const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay });
  await quetKhoan(db, await boiCanh(k, NOW), id);
  return id;
}

/** QLCS của `a` (CENTER_MANAGER@a) KIÊM `vai` ở đơn vị `ouId` — người dùng có NHIỀU dòng UserOrgRole. */
async function nguoiKiem(a: KichBan, ouId: string, vai: string) {
  const nguoi = await nguoiKyQlcs(a);
  await ganVai(a.qlcs.id, ouId, vai);
  return { userId: a.qlcs.id, quyen: await actorCua(a.qlcs.id), nguoi };
}

const centerCua = (rows: { centerId: string }[]) => [...new Set(rows.map((r) => r.centerId))].sort();

describe.skipIf(!RUN_DB_TESTS)("[KV] người kiêm hai vai — đọc sổ hoa hồng", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[KV-01] QLCS@A kiêm Sale@B: sổ chỉ có dòng cơ sở A; dòng của NGƯỜI KHÁC ở B vắng (kể cả lọc nguoiHuong, gomSoTheoTrangThaiChi, docViSao); ĐỐI CHỨNG DƯƠNG: thấy A, Kế toán HO thấy cả A lẫn B", async () => {
    const a = await kb("kv01a");
    const b = await kb("kv01b");
    const x = await nguoiKiem(a, b.ouId, "CENTER_SALES_CSM");
    await sanSo(a);
    const idB = await sanSo(b);
    const dongB = await dongSoCuaKhoan(idB);
    expect(dongB.length).toBeGreaterThan(0); // fixture CÓ sổ ở B — thiếu thì mọi khẳng định «không thấy» dưới đây xanh vì lý do sai

    const kq = await docSoHoaHong(db, x.quyen, {});
    expect(centerCua(kq.dong)).toEqual([a.centerId]); // CHỈ A
    expect(kq.tongSo).toBeGreaterThan(0); // dương: QLCS vẫn thấy cơ sở mình

    // lọc theo người của B không mở được gì
    const locNguoiB = await docSoHoaHong(db, x.quyen, { nguoiHuong: b.sale.id });
    expect(locNguoiB.dong).toEqual([]);
    const locCoSoB = await docSoHoaHong(db, x.quyen, { centerId: b.centerId });
    expect(locCoSoB.dong).toEqual([]);
    // khối «Hiệu quả» đi qua CÙNG where — tổng theo trạng thái chi của B = 0
    const gom = await gomSoTheoTrangThaiChi(db, x.quyen, { centerId: b.centerId });
    expect(Object.values(gom).reduce((t, v) => t + v.soDong, 0)).toBe(0);
    // ngăn «Vì sao» của dòng B ⇒ null
    const dongSaleB = dongB.find((d) => d.roleCode === "SALE")!;
    expect(await docViSao(db, x.quyen, dongSaleB.id)).toBeNull();

    // đối chứng dương: Kế toán HO thấy cả hai cơ sở
    const ho = await docSoHoaHong(db, (await nguoiKyHo()).quyen, { centerId: b.centerId });
    expect(ho.tongSo).toBeGreaterThan(0);
    expect(await docViSao(db, (await nguoiKyHo()).quyen, dongSaleB.id)).not.toBeNull();
  });

  it("[KV-02] Sale@B kiêm QLCS@A vẫn THẤY dòng CỦA CHÍNH MÌNH ở B (view-self, ngoài tầm nhìn cơ sở) nhưng KHÔNG thấy dòng người khác ở B", async () => {
    const a = await kb("kv02a");
    const b = await kb("kv02b");
    const x = await nguoiKiem(a, b.ouId, "CENTER_SALES_CSM");
    await db.lead.update({ where: { id: b.lead!.id }, data: { convertedById: x.userId } }); // ở B, X là người hưởng SALE
    const idB = await sanSo(b);
    const dongB = await dongSoCuaKhoan(idB);
    const cuaX = dongB.filter((d) => d.beneficiaryUserId === x.userId);
    const cuaNguoiKhac = dongB.filter((d) => d.beneficiaryUserId !== x.userId);
    expect(cuaX.length).toBeGreaterThan(0);
    expect(cuaNguoiKhac.length).toBeGreaterThan(0);

    const kq = await docSoHoaHong(db, x.quyen, {});
    const idThay = new Set(kq.dong.map((d) => d.id));
    for (const d of cuaX) expect(idThay.has(d.id), `dòng của X ${d.roleCode}`).toBe(true); // dương
    for (const d of cuaNguoiKhac) expect(idThay.has(d.id), `dòng người khác ${d.roleCode}`).toBe(false); // âm
  });

  it("[KV-03] QLCS@A kiêm vai HO chỉ có view-self (HO_MARKETING@HO) KHÔNG thấy sổ MỌI cơ sở; đối chứng: thấy A, HO_ACCOUNTANT thấy B", async () => {
    const a = await kb("kv03a");
    const b = await kb("kv03b");
    const x = await nguoiKiem(a, await donViHoiSo(), "HO_MARKETING");
    await sanSo(a);
    const idB = await sanSo(b);
    expect((await dongSoCuaKhoan(idB)).length).toBeGreaterThan(0);

    const kq = await docSoHoaHong(db, x.quyen, {});
    expect(centerCua(kq.dong)).toEqual([a.centerId]);
    expect((await docSoHoaHong(db, x.quyen, { centerId: b.centerId })).dong).toEqual([]);
    expect((await docSoHoaHong(db, (await nguoiKyHo()).quyen, { centerId: b.centerId })).tongSo).toBeGreaterThan(0);
  });

  it("[KV-04] hàng chờ sổ: QLCS@A kiêm Sale@B chỉ đếm hàng chờ của A; hàng chờ của B vắng; đối chứng dương: HO thấy cả hai", async () => {
    const a = await kb("kv04a");
    const b = await kb("kv04b");
    const x = await nguoiKiem(a, b.ouId, "CENTER_SALES_CSM");
    for (const k of [a, b]) {
      await db.commissionHold.create({ data: { holdKey: `${k.ma}:kv04`, code: "CAP_EXCEEDED", severity: "HARD", status: "OPEN", detail: {}, centerId: k.centerId, orgUnitId: null } });
    }
    const kq = await docHangChoSo(db, x.quyen, {});
    expect(kq.dong.map((d) => d.centerId)).toEqual([a.centerId]);
    expect((await docHangChoSo(db, x.quyen, { centerId: b.centerId })).dong).toEqual([]);
    const ho = await nguoiKyHo();
    expect((await docHangChoSo(db, ho.quyen, { centerId: b.centerId })).dong.length).toBe(1);
  });

  it("[KV-05] danh sách KỲ (scopedDb): QLCS@A kiêm Sale@B chỉ thấy kỳ của A; Kế toán HO thấy cả B", async () => {
    const a = await kb("kv05a");
    const b = await kb("kv05b");
    const x = await nguoiKiem(a, b.ouId, "CENTER_SALES_CSM");
    await sanSo(a);
    await sanSo(b);
    expect(await db.commissionPeriod.count({ where: { centerId: b.centerId } })).toBeGreaterThan(0);
    const kyX = await docDanhSachKy(x.quyen, { trangThai: null, trang: 1 });
    const coSo = new Set(kyX.dong.map((k) => k.centerId));
    expect(coSo.has(a.centerId)).toBe(true); // dương
    expect(coSo.has(b.centerId)).toBe(false); // âm
    const kyHo = await docDanhSachKy((await nguoiKyHo()).quyen, { trangThai: null, trang: 1 });
    expect(kyHo.dong.some((k) => k.centerId === b.centerId)).toBe(true);
  });

  it("[KV-06] màn hình MỘT KỲ (docManHinhKy): QLCS@A kiêm Sale@B mở kỳ của B ⇒ `ky: null` (không số liệu); kỳ của A có; Kế toán HO mở được kỳ của B", async () => {
    const a = await kb("kv06a");
    const b = await kb("kv06b");
    const x = await nguoiKiem(a, b.ouId, "CENTER_SALES_CSM");
    await sanSo(a);
    await sanSo(b);
    const mo = (quyen: typeof x.quyen, k: KichBan) => docManHinhKy(quyen, { thang: "2026-11", centerId: k.centerId, kyCutover: "2026-10" });
    expect((await mo(x.quyen, a)).ky).not.toBeNull(); // dương
    expect((await mo(x.quyen, b)).ky).toBeNull(); // âm
    expect((await mo((await nguoiKyHo()).quyen, b)).ky).not.toBeNull(); // dương: HO
  });
});
