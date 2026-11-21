// @vitest-environment node
/**
 * [DYN-*] — CA NGHIỆM THU «NGUỒN ĐỘNG» phía NGƯỜI GIỚI THIỆU (Postgres THẬT). Yêu cầu #59, #60. Ảnh chụp (vai nhân sự, Sale phụ trách PH) KHÔNG do ca gõ tay:
 * chúng do chính đường nhập (`chuanBiQuyNguon` → thu thập tín hiệu → `anh-chup-db`) tính ra, rồi engine đọc lại ở lúc quét sổ.
 *
 *   [DYN-07] #59 PH A thuộc Sale X giới thiệu khách; Sale Y chốt đơn; PH chuyển sang Sale Z SAU ghi nhận ⇒ hoa hồng thu hút về X (ảnh chụp), Sale NEW (người chốt) về Y, Z không nhận gì
 *   [DYN-08] #60 nhân sự E (tra theo MÃ NV) giới thiệu, NEW trong cửa sổ ⇒ E nhận tỉ lệ theo chính sách; NEW quá cửa sổ ⇒ GIỮ nguồn, không có dòng thu hút, không hàng chờ
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng. LUẬT 19: ngày tuyệt đối. Tệp chạy được MỘT MÌNH trên DB trống đã migrate + seed vai.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { lapKeHoachSeedV1 } from "../../lib/hoa-hong/ke-hoach-seed-v1";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docSaleCuaPhuHuynh } from "../../lib/nguon/anh-chup-db";
import { timNguoiGioiThieu } from "../../lib/nguon/tim-nguoi-gioi-thieu";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, ganVai, lamNhanVien, nguoiKyHo, themChinhSachNhom, tienVe, tomTat, type KichBan, type RuleFx } from "./_kich-ban";
import { BAY_GIO_NHAP, ghiNguonQuaDuongThat } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DYN-NGT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const cuaToi: KichBan[] = [];

async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

/** Rule của nguồn lấy từ KẾ HOẠCH SEED thật (tỉ lệ 2% sống ở policy seed, không phải hằng của ca) — kể cả dòng EXCLUDE (không mang tỉ lệ). */
const ruleSeedCuaNguon = (maNhom: string): RuleFx[] =>
  lapKeHoachSeedV1()
    .chinhSach.find((c) => c.maNhom === maNhom)!
    .rules.map((r) => (r.calcKind === "EXCLUDE" ? { vai: r.roleCode, kieu: "EXCLUDE" as const } : { vai: r.roleCode, rate: Number(r.rate) }));

async function thuVaQuet(k: KichBan, ten: string, ngay: Date) {
  const bc = await boiCanh(k, NOW);
  const khoan = await tienVe(k, await dungBe(k, ten, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  await quetKhoan(db, bc, khoan);
  return { khoan, tom: tomTat(await dongSoCuaKhoan(khoan)) };
}

describe.skipIf(!RUN_DB_TESTS)("[DYN] nghiệm thu nguồn động — người giới thiệu", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
  }, 120_000);
  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });
  afterAll(async () => {
    await donKichBan(cuaToi);
    await db.student.deleteMany({ where: { name: { startsWith: "fx-dyn-ngt" } } });
    await datMocCutover(null);
  }, 90_000);

  it("[DYN-07] #59 PH thuộc Sale X giới thiệu, Sale Y chốt, PH chuyển sang Sale Z SAU ghi nhận ⇒ thu hút về X (ảnh chụp), Sale NEW về Y, Z không nhận gì", async () => {
    const k = await kb("d07", { rules: [{ vai: "SALE", rate: 0.04 }] }); // Y = k.sale (người chốt đơn của lead khách)
    const nv = (ten: string) => seedUser({ email: `${k.ma}-${ten}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${ten}`, phone: null });
    const [saleX, saleZ, ph] = await Promise.all([nv("x"), nv("z"), seedUser({ email: `${k.ma}-ph@ci.test`, role: "PARENT", name: `${k.ma}-ph`, phone: null })]);
    const saleY = k.sale;
    expect(new Set([saleX.id, saleY.id, saleZ.id]).size).toBe(3);

    // PH là phụ huynh của một học viên cũ; lead gốc của học viên đó do Sale X chốt (ngày tuyệt đối TRƯỚC thời điểm ghi nhận)
    const leadGoc = await db.lead.create({
      data: { parentName: `${k.ma}-goc`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "DA_DANG_KY", convertedById: saleX.id, centerId: k.centerId, createdAt: D("2026-09-01") },
    });
    const hv = await db.student.create({ data: { id: `${k.ma}-hvph`, name: `fx-dyn-ngt Bé PH ${k.ma}`, centerId: k.centerId, parentUserId: ph.id, leadId: leadGoc.id } });
    await themChinhSachNhom(k, "PARENT_REFERRAL", ruleSeedCuaNguon("PARENT_REFERRAL"));

    // GHI NHẬN qua đường nhập thật — ca KHÔNG truyền Sale/vai: đường nhập tự chụp
    const a = await ghiNguonQuaDuongThat(k, { phuHuynhGioiThieu: { parentUserId: ph.id, studentId: hv.id } }, ATTRIBUTED);
    expect(a.group.code).toBe("PARENT_REFERRAL");
    expect(a.referrerParentUserId).toBe(ph.id);
    expect(a.referrerSaleUserId).toBe(saleX.id);

    const truocChuyen = await thuVaQuet(k, "a", D("2026-11-20"));
    expect(truocChuyen.tom).toEqual({ [`SALE:${saleY.id}`]: 400_000, [`REFERRER_PARENT_SALE:${saleX.id}`]: 200_000 });

    // PH chuyển sang Sale Z SAU ghi nhận
    await db.lead.update({ where: { id: leadGoc.id }, data: { convertedById: saleZ.id } });
    expect(await docSaleCuaPhuHuynh(db, { studentId: hv.id, parentUserId: ph.id }, D("2026-11-25"))).toBe(saleZ.id); // đối chứng dương: tra LẠI hôm nay ra Z
    const sauChuyen = await thuVaQuet(k, "b", D("2026-11-26"));
    expect(sauChuyen.tom).toEqual({ [`SALE:${saleY.id}`]: 400_000, [`REFERRER_PARENT_SALE:${saleX.id}`]: 200_000 });
    expect(Object.keys(sauChuyen.tom).some((x) => x.includes(saleZ.id))).toBe(false);
    // ảnh chụp trên attribution KHÔNG đổi
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } })).referrerSaleUserId).toBe(saleX.id);
  });

  it("[DYN-08] #60 nhân sự E (tìm theo MÃ NV) giới thiệu: NEW trong cửa sổ ⇒ E nhận 2% theo chính sách; NEW quá cửa sổ 90 ngày ⇒ GIỮ nguồn, không dòng thu hút, không hàng chờ", async () => {
    const k = await kb("d08", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const u = await seedUser({ email: `${k.ma}-e@ci.test`, role: "SALES_CSM", name: `${k.ma}-e`, phone: null });
    const employeeId = await lamNhanVien(u.id, `${k.ma}-e`);
    await ganVai(u.id, k.ouId, "CENTER_SALES_CSM");
    const maNv = (await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { employeeCode: true } })).employeeCode;
    await themChinhSachNhom(k, "EMPLOYEE_REFERRAL", ruleSeedCuaNguon("EMPLOYEE_REFERRAL"));

    // tra theo MÃ NV (ô chọn người giới thiệu) → id nhân sự; đường nhập tự chụp vai + dấu vết
    const tim = await timNguoiGioiThieu((await nguoiKyHo()).quyen, { loai: "NHAN_SU", q: maNv, gioiHan: 5, coTheTimTheoSdt: false, canViewPii: false, now: BAY_GIO_NHAP });
    expect(tim).toHaveLength(1);
    expect(tim[0]).toMatchObject({ loai: "NHAN_SU", employeeId, ma: maNv });
    const a = await ghiNguonQuaDuongThat(k, { nhanSuGioiThieuEmployeeId: employeeId }, ATTRIBUTED);
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.referrerEmployeeId).toBe(employeeId);
    expect(a.referrerRoleCode).toBe("SALE");
    expect(a.signals).toMatchObject({ nguoiGioiThieu: { employeeCode: maNv } });

    // trong cửa sổ (ngày thứ 50): E nhận 2%
    const trong = await thuVaQuet(k, "a", D("2026-11-20"));
    expect(trong.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_EMPLOYEE:${u.id}`]: 200_000 });

    // quá cửa sổ (ngày thứ 106 kể từ 01/10): Sale vẫn 4%; E không có dòng; nguồn VẪN là EMPLOYEE_REFERRAL; không để lại hàng chờ
    const ngoai = await thuVaQuet(k, "b", D("2027-01-15"));
    expect(ngoai.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect(await db.commissionHold.count({ where: { paymentId: ngoai.khoan } })).toBe(0);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id }, include: { group: { select: { code: true } } } })).group.code).toBe("EMPLOYEE_REFERRAL");
  });
});
