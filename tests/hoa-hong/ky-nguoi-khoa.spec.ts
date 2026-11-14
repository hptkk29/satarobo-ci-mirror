// @vitest-environment node
/**
 * [NHH-KY-NK-*] — CỘT "ĐÃ KHOÁ · NGƯỜI KHOÁ" của bảng kỳ (`docDanhSachKy.khoaBoi`), trên Postgres THẬT.
 *
 * `lockedById` là chuỗi trần (không quan hệ tới User) nên tên phải tra thêm — bộ này canh ba thứ mà test thuần không thấy:
 *   · người khoá thật được ghi lúc KHOÁ (đường thật `khoaHanhDong`) và đọc ra đúng tên, kể cả khi người xem là QLCS cơ sở KHÁC người khoá (User miễn scope);
 *   · kỳ chưa khoá ⇒ null; kỳ khoá mà không có người (`lockedById` NULL) hoặc người không còn ⇒ null (màn in `—`), KHÔNG ném;
 *   · MỘT lượt tra cho cả trang (không tra theo từng dòng).
 *
 * Mỗi kịch bản dựng cơ sở riêng (luật 18) nên mỗi ca chạy ĐƯỢC MỘT MÌNH. Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { chuyenRaSoatHanhDong, khoaHanhDong, tinhKyHanhDong, type PhuThuoc } from "../../lib/hoa-hong/ky-hanh-dong";
import { chupSoLieuKy, docDanhSachKy } from "../../lib/hoa-hong/ky-doc";
import { boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, nguoiKyHo, nguoiKyQlcs, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-KY-NK] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const THANG = "2026-10";
const cuaToi: KichBan[] = [];
async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  return k;
}
const kyCua = (k: KichBan) => db.commissionPeriod.findFirstOrThrow({ where: { period: THANG, centerId: k.centerId } });

function phuThuoc(k: KichBan): PhuThuoc {
  return {
    engineBat: async () => true,
    xuatLuongBat: async () => true,
    dungBoiCanh: async (now) => ({ loai: "BAT", bc: await boiCanh(k, now) }),
    soThangDoiSoat: async () => 0,
  };
}

/** Tính → rà soát → KHOÁ bằng đường thật của lớp mỏng, do `nguoi` thao tác. */
async function khoaBoi(k: KichBan, nguoi: Awaited<ReturnType<typeof nguoiKyHo>>) {
  const pt = phuThuoc(k);
  await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
  const t = await tinhKyHanhDong(pt, { nguoi, now: NOW, thang: THANG, centerId: k.centerId });
  expect(t.ok, JSON.stringify(t)).toBe(true);
  const ky = await kyCua(k);
  const c = await chuyenRaSoatHanhDong(pt, { nguoi, now: NOW, periodId: ky.id });
  expect(c.ok, JSON.stringify(c)).toBe(true);
  const r = await khoaHanhDong(pt, { nguoi, now: NOW, periodId: ky.id, lyDo: "khoá kỳ 10 để chi lương", daThay: (await chupSoLieuKy(ky.id))! });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return ky;
}
const dongCua = async (actor: Parameters<typeof docDanhSachKy>[0], id: string) => (await docDanhSachKy(actor, { trangThai: null, trang: 1 })).dong.find((d) => d.id === id);

describe.skipIf(!RUN_DB_TESTS)("[NHH-KY-NK] cột người khoá", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-KY-NK-01] Kế toán HO khoá kỳ cơ sở ⇒ QLCS cơ sở ấy đọc được TÊN người khoá (User miễn scope); đối chứng: kỳ CHƯA khoá ⇒ null", async () => {
    const k = await kb("nk01a");
    const k2 = await kb("nk01b");
    const ho = await nguoiKyHo();
    const ky = await khoaBoi(k, ho);
    // kỳ thứ hai của cơ sở khác: mới Tính, chưa khoá
    await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const t = await tinhKyHanhDong(phuThuoc(k2), { nguoi: ho, now: NOW, thang: THANG, centerId: k2.centerId });
    expect(t.ok, JSON.stringify(t)).toBe(true);

    const goc = await db.commissionPeriod.findUniqueOrThrow({ where: { id: ky.id } });
    expect(goc.status).toBe("LOCKED");
    expect(goc.lockedById).toBe(ho.userId); // đường thật đã ghi người khoá

    const ql = await nguoiKyQlcs(k);
    const dong = await dongCua(ql.quyen, ky.id);
    expect(dong?.khoaBoi).toBe("Kế toán HO fixture"); // người khoá KHÁC người xem, vẫn có tên
    expect(dong?.lockedAt).not.toBeNull();
    expect((await dongCua(ho.quyen, ky.id))?.khoaBoi).toBe("Kế toán HO fixture");

    const chuaKhoa = await dongCua(ho.quyen, (await kyCua(k2)).id);
    expect(chuaKhoa).toMatchObject({ lockedAt: null, khoaBoi: null });
  });

  it("[NHH-KY-NK-02] kỳ khoá mà KHÔNG biết người (lockedById NULL · id không còn · tên trống) ⇒ khoaBoi null, không ném; đối chứng: có người thật ⇒ có tên", async () => {
    const k = await kb("nk02");
    const ho = await nguoiKyHo();
    const ky = await khoaBoi(k, ho);
    expect((await dongCua(ho.quyen, ky.id))?.khoaBoi).toBe("Kế toán HO fixture"); // đối chứng dương

    await db.commissionPeriod.update({ where: { id: ky.id }, data: { lockedById: null } });
    expect(await dongCua(ho.quyen, ky.id)).toMatchObject({ khoaBoi: null }); // kỳ cũ trước khi cột có giá trị
    expect((await dongCua(ho.quyen, ky.id))?.lockedAt).not.toBeNull();

    await db.commissionPeriod.update({ where: { id: ky.id }, data: { lockedById: "khong-ton-tai-nk02" } });
    expect(await dongCua(ho.quyen, ky.id)).toMatchObject({ khoaBoi: null }); // tài khoản không còn

    await db.commissionPeriod.update({ where: { id: ky.id }, data: { lockedById: k.qlcs.id } });
    await db.user.update({ where: { id: k.qlcs.id }, data: { name: "   " } });
    expect(await dongCua(ho.quyen, ky.id)).toMatchObject({ khoaBoi: null }); // tên trắng không in thành khoảng trống
  });
});
