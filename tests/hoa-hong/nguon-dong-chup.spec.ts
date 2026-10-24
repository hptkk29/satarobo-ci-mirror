// @vitest-environment node
/**
 * [DYN-SN-*] — BẢN CHỤP người phụ trách nguồn + cửa sổ ghi công (`LeadAttribution.signals.nguon`) trên ENGINE HOA HỒNG. Postgres THẬT; đường GHI nguồn là
 * đường nhập thật (`chuanBiQuyNguon` → `ghiQuyNguonLeadMoi`), dòng tiền dựng bằng hàm ghi thật. (res4-1 HIGH · res3-3 MEDIUM, 09/10/2026)
 *
 *   [DYN-SN-01] đổi `ownerEmployeeId` của nguồn GIỮA hai đợt thu: attribution cũ vẫn trả CÙNG người (A); lead MỚI ghi sau khi đổi trả B; hàng CHƯA có bản chụp (di trú) theo nguồn sống
 *   [DYN-SN-02] co `attributionWindowDays` SAU khi attribution đã ghi: đợt 2 không rơi NGOAI_CUA_SO; lead MỚI ghi sau khi co thì có (đối chứng dương)
 *   [DYN-SN-03] người NHẬP chính là chủ nguồn: việc BÌNH THƯỜNG (chốt 09/10/2026) — bản chụp GIỮ chủ, không TU_CLAIM, chủ nguồn NHẬN hoa hồng SOURCE_OWNER; người nhập khác ⇒ chủ cũng nhận (đối chứng dương)
 *   [DYN-SN-04] bản chụp HỎNG ⇒ fail-closed (HOLD), KHÔNG rơi về nguồn sống
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối. Cấy lỗi đo ở docs/source-commission/04.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, lamNhanVien, themChinhSachNhom, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { ghiNguonQuaDuongThat, themLead } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DYN-SN] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const cuaToi: KichBan[] = [];
let dem = 0;

async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  return k;
}

async function taoNhom(hau: string, o: { req?: "NONE" | "PARENT"; cuaSo?: number | null; chuEmployeeId?: string | null } = {}) {
  dem += 1;
  return db.leadSourceGroup.create({
    data: {
      code: `DYN_${hau}_${Date.now().toString(36)}${dem}`.toUpperCase(),
      name: `DYN ${hau}`,
      referrerRequirement: o.req ?? "NONE",
      sortOrder: 600 + dem,
      commissionEnabled: true,
      attributionWindowDays: o.cuaSo ?? null,
      ownerEmployeeId: o.chuEmployeeId ?? null,
    },
    select: { id: true, code: true },
  });
}

/** Nhân sự + tài khoản (để SOURCE_OWNER đổi `Employee.id` → `User.id`). */
async function nhanSu(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  const empId = await lamNhanVien(u.id, `${k.ma}-${hau}`);
  return { userId: u.id, empId };
}

const chon = (groupId: string, them: Partial<{ parentUserId: string }> = {}) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null, ...them });

async function thu(k: KichBan, hau: string, ngay: Date) {
  const bc = await boiCanh(k, NOW);
  const khoan = await tienVe(k, await dungBe(k, hau, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  await quetKhoan(db, bc, khoan);
  return { khoan, tom: tomTat(await dongSoCuaKhoan(khoan)) };
}

describe.skipIf(!RUN_DB_TESTS)("[DYN-SN] bản chụp nguồn trên engine hoa hồng", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
  }, 120_000);

  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });

  afterAll(async () => {
    await donKichBan(cuaToi);
    // lead PHỤ do `themLead` dựng không nằm trong `cuaToi` ⇒ dọn quy nguồn của chúng theo nhóm DYN_ (FK Restrict sang LeadSourceGroup)
    const nhomDyn = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "DYN_" } }, select: { id: true } })).map((g) => g.id);
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhomDyn } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhomDyn } }, { originalGroupId: { in: nhomDyn } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DYN_" } } });
    await datMocCutover(null);
  }, 60_000);

  it("[DYN-SN-01] đổi chủ nguồn A→B giữa đợt 1 và đợt 2: attribution cũ vẫn trả A ở CẢ HAI đợt; lead ghi SAU khi đổi trả B; hàng chưa có bản chụp theo nguồn SỐNG", async () => {
    // Cấy: engine đọc `a.group.ownerEmployeeId` thay cho bản chụp ⇒ đợt 2 trả B (đỏ).
    const k = await kb("sn1");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("SN1", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const a1 = await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    expect(a1.signals).toMatchObject({ nguon: { cuaSoNgay: 90, chuNhanVienId: A.empId } });

    const dot1 = await thu(k, "a", D("2026-11-20"));
    expect(dot1.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });

    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: B.empId } }); // người có sources:manage đổi chủ nguồn
    const dot2 = await thu(k, "b", D("2026-11-21"));
    expect(dot2.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 }); // vẫn A

    // đối chứng dương: lead MỚI ghi nguồn sau khi đổi ⇒ chụp B
    const k2 = await themLead(k, "moi");
    const a2 = await ghiNguonQuaDuongThat(k2, { nguonChon: chon(g.id) }, ATTRIBUTED, k2.lead!.id);
    expect(a2.signals).toMatchObject({ nguon: { chuNhanVienId: B.empId } });
    expect((await thu(k2, "m", D("2026-11-22"))).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${B.userId}`]: 100_000 });

    // hàng CHƯA có bản chụp (di trú): theo nguồn sống (hành vi cũ giữ nguyên cho dữ liệu cũ)
    const k3 = await themLead(k, "cu");
    await ghiNguonQuaDuongThat(k3, { nguonChon: chon(g.id) }, ATTRIBUTED, k3.lead!.id);
    await db.leadAttribution.update({ where: { leadId: k3.lead!.id }, data: { signals: { duongVao: "nhap-tay" } } });
    expect((await thu(k3, "c", D("2026-11-23"))).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${B.userId}`]: 100_000 });
  });

  it("[DYN-SN-02] co cửa sổ ghi công 90→30 SAU khi attribution đã ghi: đợt 2 (ngày 55) KHÔNG rơi ngoài cửa sổ; lead ghi SAU khi co thì rơi (đối chứng dương)", async () => {
    // Cấy: engine đọc `a.group.attributionWindowDays` thay cho bản chụp ⇒ đợt 2 mất REFERRER_PARENT (đỏ).
    const k = await kb("sn2");
    const ph = await seedUser({ email: `${k.ma}-ph@ci.test`, role: "PARENT", name: `${k.ma}-ph`, phone: null });
    const g = await taoNhom("SN2", { req: "PARENT", cuaSo: 90 });
    await themChinhSachNhom(k, g.code, [{ vai: "REFERRER_PARENT", rate: 0.02 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id, { parentUserId: ph.id }) }, ATTRIBUTED);

    const dot1 = await thu(k, "a", D("2026-11-20")); // ngày 50
    expect(dot1.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT:${ph.id}`]: 200_000 });

    await db.leadSourceGroup.update({ where: { id: g.id }, data: { attributionWindowDays: 30 } });
    const dot2 = await thu(k, "b", D("2026-11-25")); // ngày 55: trong 90, ngoài 30
    expect(dot2.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT:${ph.id}`]: 200_000 });
    expect(await db.commissionHold.count({ where: { paymentId: dot2.khoan } })).toBe(0);

    // đối chứng dương: lead ghi SAU khi co ⇒ chụp 30 ⇒ đợt ngày 55 ngoài cửa sổ
    const k2 = await themLead(k, "moi");
    const a2 = await ghiNguonQuaDuongThat(k2, { nguonChon: chon(g.id, { parentUserId: ph.id }) }, ATTRIBUTED, k2.lead!.id);
    expect(a2.signals).toMatchObject({ nguon: { cuaSoNgay: 30 } });
    expect((await thu(k2, "m", D("2026-11-25"))).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
  });

  it("[DYN-SN-03] người nhập CHÍNH LÀ chủ nguồn: bản chụp GIỮ chủ, không cờ TU_CLAIM, SOURCE_OWNER trả cho chính họ; người nhập khác ⇒ chủ cũng nhận", async () => {
    // Cấy: thêm lại vế `chuNguon` vào `phanTuNhan` của đường tạo ⇒ chủ nguồn tự nhập bị gỡ + hold (đỏ).
    const k = await kb("sn3");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("SN3", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const tu = await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id), nguoiNhapUserId: A.userId }, ATTRIBUTED);
    expect(tu.signals).toMatchObject({ nguon: { cuaSoNgay: 90, chuNhanVienId: A.empId } });
    expect(tu.canhBao).not.toContain("TU_CLAIM");
    const dot = await thu(k, "a", D("2026-11-20"));
    expect(dot.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    expect(await db.commissionHold.count({ where: { paymentId: dot.khoan } })).toBe(0);

    // đối chứng dương: người nhập KHÁC ⇒ chủ nguồn nhận
    const khac = await nhanSu(k, "khac");
    const k2 = await themLead(k, "khac");
    const ok = await ghiNguonQuaDuongThat(k2, { nguonChon: chon(g.id), nguoiNhapUserId: khac.userId }, ATTRIBUTED, k2.lead!.id);
    expect(ok.signals).toMatchObject({ nguon: { chuNhanVienId: A.empId } });
    expect(ok.canhBao).not.toContain("TU_CLAIM");
    expect((await thu(k2, "k", D("2026-11-21"))).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
  });

  it("[DYN-SN-04] bản chụp HỎNG ⇒ fail-closed: SOURCE_OWNER vào HOLD dù nguồn sống còn chủ; sửa lại bản chụp ⇒ trả", async () => {
    // Cấy: nhánh HONG rơi về nguồn sống ⇒ A nhận tiền (đỏ) — đó đúng là lỗ res4-1 mở lại bằng đường hỏng.
    const k = await kb("sn4");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("SN4", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: { nguon: { cuaSoNgay: "chín mươi" } } } });
    const hong = await thu(k, "a", D("2026-11-20"));
    expect(hong.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: hong.khoan } })).detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });

    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: { nguon: { cuaSoNgay: 90, chuNhanVienId: A.empId } } } });
    expect((await thu(k, "b", D("2026-11-21"))).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
  });
});
