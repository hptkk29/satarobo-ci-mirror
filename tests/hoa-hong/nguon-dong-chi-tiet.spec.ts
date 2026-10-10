// @vitest-environment node
/**
 * [DCT-DB-*] — ĐỌC cho chi tiết MỘT nguồn (`lib/nguon/doc-chi-tiet-nguon.ts`; SPEC nguồn động §4 mục 3/7) trên Postgres THẬT.
 *
 *   [DCT-DB-01] «Chính sách áp dụng thật» = câu trả lời của chính engine: rule nguồn thắng rule chung; `commissionEnabled=false` ⇒ rule nguồn BIẾN MẤT khỏi bảng và phiên bản
 *               được liệt kê kèm lý do bị bỏ qua; người hưởng SOURCE_OWNER nêu đúng nhân sự (hoặc cảnh báo thiếu)
 *   [DCT-DB-02] hoa hồng NGUỒN (vai thu hút) tách khỏi hoa hồng giao dịch KHÁC — cả ở bảng rule lẫn ở tiền đã ghi sổ
 *   [DCT-DB-03] CÁCH LY: Hội sở thấy hai cơ sở; QLCS CS1 chỉ thấy CS1; Sale (chỉ view-self) chỉ thấy dòng CỦA MÌNH; vai không có quyền xem hoa hồng ⇒ null (không phải 0)
 *   [DCT-DB-04] lịch sử: ghi danh mục + gán/gỡ Page của đúng nguồn này, mới nhất trước, mang lý do và trường đổi; không lẫn nguồn khác
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng. LUẬT 19: ngày tuyệt đối. Tệp chạy được MỘT MÌNH trên DB trống đã migrate + seed vai.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { PermissionError } from "../../lib/auth/can";
import { doiTrangThaiNguon, suaNguon, taoNguon, luuNguonCuaPage } from "./_nguon-dong";
import { docChinhSachApDungCuaNguon, docHoaHongCuaNguon, docLichSuNguon, docNguonDeSua } from "../../lib/nguon/doc-chi-tiet-nguon";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import {
  actorCua,
  boiCanh,
  D,
  datMocCutover,
  dongSoCuaKhoan,
  donKichBan,
  dungBe,
  dungKichBan,
  ganVai,
  lamNhanVien,
  nguoiKyHo,
  nguoiKyQlcs,
  themChinhSachNhom,
  tienVe,
  type KichBan,
} from "./_kich-ban";
import { datTranHoaHong, ghiNguonQuaDuongThat, lamSachChinhSach } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DCT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-dct";
const NOW = D("2027-02-20");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const LY_DO = "Chủ dự án chốt ngày 09/10/2026";
const cuaToi: KichBan[] = [];
let admin: { userId: string; ten: string };
let stamp = 0;

async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

const MAU = {
  name: "Nguồn thử",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  sortOrder: 400,
  trangThai: "ACTIVE",
  attributionWindowDays: null,
  commissionEnabled: true,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
} as const;

async function taoNguonDct(hau: string, ghi: Record<string, unknown> = {}) {
  stamp += 1;
  const code = `DCT_${hau}_${Date.now().toString(36).toUpperCase()}${stamp}`;
  const r = await taoNguon({ nguoi: admin, vao: { ...MAU, code, name: `DCT ${hau}`, ...ghi } });
  if (!r.ok) throw new Error(`taoNguon(${hau}): ${r.truong}: ${r.loi}`);
  return { id: r.id, code: r.code };
}
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const chon = (groupId: string, employeeId: string | null = null) => ({ groupId, employeeId, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });

async function thu(k: KichBan, ten: string, ngay: Date) {
  const bc = await boiCanh(k, NOW);
  const khoan = await tienVe(k, await dungBe(k, ten, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  await quetKhoan(db, bc, khoan);
  return dongSoCuaKhoan(khoan);
}

describe.skipIf(!RUN_DB_TESTS)("[DCT-DB] chi tiết nguồn — chính sách áp dụng, tiền, lịch sử", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM", "TEACHER"] });
    await damBaoDanhMucGoc(db);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "MARKETING", name: `${NHAN}-admin`, phone: null });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
  }, 120_000);
  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });
  afterAll(async () => {
    await donKichBan(cuaToi);
    await db.facebookPageMapping.deleteMany({ where: { pageId: { startsWith: NHAN } } });
    await db.systemSetting.deleteMany({ where: { key: "nguon.bangNguonTheoPage" } });
    clearSettingsCache();
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DCT_" } } });
    await db.auditLog.deleteMany({ where: { entityType: { in: ["LeadSourceGroup", "SystemSetting"] }, actorName: { startsWith: NHAN } } });
    await datMocCutover(null);
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[DCT-DB-01] «áp dụng thật»: rule nguồn thắng rule chung; commissionEnabled=false ⇒ rule nguồn BIẾN MẤT + phiên bản kèm lý do bỏ qua; SOURCE_OWNER nêu đúng nhân sự / cảnh báo thiếu", async () => {
    await lamSachChinhSach(); // bảng «áp dụng thật» đọc TOÀN tập ACTIVE: ca không được thừa hưởng chính sách chung của ca trước
    await datTranHoaHong(null); // trần về mặc định 9%: ca này đo cả vế vượt trần, không được thừa hưởng trần nâng của lượt chạy hỏng trước
    const k = await kb("c01"); // chung SEED_V1: Sale 4 · Admin 1 · QLCS 2 · Marketing 1 · GV Trial 1
    const ho = (await nguoiKyHo()).quyen;
    const chuU = await seedUser({ email: `${k.ma}-chu@ci.test`, role: "SALES_CSM", name: "Trần Thị Chủ", phone: null });
    const chuE = await lamNhanVien(chuU.id, "chu");
    const n = await taoNguonDct("N", { commissionEnabled: true, ownerEmployeeId: chuE });
    await themChinhSachNhom(k, n.code, [{ vai: "MARKETING", rate: 0.005 }, { vai: "SOURCE_OWNER", rate: 0.01 }]);

    const bang = async () => {
      const r = (await docChinhSachApDungCuaNguon(ho, n.code, NOW))!;
      const new_ = r.theoLoai.find((x) => x.loai === "NEW")!;
      const dong = [...new_.nguon.dong, ...new_.khac.dong];
      return { r, new_, o: (vai: string) => dong.find((d) => d.vai.code === vai)! };
    };
    // BẬT: Marketing 0,5% (rule nguồn thắng 1% chung); SOURCE_OWNER 1% về nhân sự đã khai; Sale 4% từ chính sách chung
    const bat = await bang();
    expect(bat.o("MARKETING").o).toMatchObject({ kieu: "PERCENT", phanTram: "0,5", phamVi: "SOURCE_GROUP" });
    expect(bat.o("SALE").o).toMatchObject({ kieu: "PERCENT", phanTram: "4", phamVi: "GLOBAL" });
    expect(bat.o("SOURCE_OWNER").o).toMatchObject({ kieu: "PERCENT", phanTram: "1" });
    expect(bat.o("SOURCE_OWNER").nguoiHuong).toMatchObject({ thieu: false });
    expect(bat.o("SOURCE_OWNER").nguoiHuong.nhan).toContain("NV chu"); // tên nhân sự phụ trách (Employee.fullName)
    expect(bat.o("REFERRER_EMPLOYEE").o.kieu).toBe("KHONG_CO"); // vai không được gì từ nguồn này vẫn nằm trong bảng
    expect(bat.r.phienBanRieng).toHaveLength(1);
    expect(bat.r.phienBanRieng[0]).toMatchObject({ status: "ACTIVE", biBoQua: false, lyDoBoQua: null, soRule: 2 });
    // Sale 4 + Admin 1 + QLCS 2 + Marketing 0,5 (rule nguồn thay 1% chung) + GV Trial 1 + SOURCE_OWNER 1 = 9,5% > trần 9% — bảng NÓI RA vi phạm, không giấu
    expect(bat.new_.tongPhanTram).toBe("9,5");
    expect(bat.new_.vuotTran).toBe(true);
    // TẮT: rule nguồn biến mất khỏi bảng (engine bỏ qua), phiên bản còn đó kèm lý do
    // W2 (R1-M1): tắt cờ qua writer nay BỊ CHẶN khi chính sách riêng có dòng thu hút (1% Marketing biến mất im lặng). Bảng «áp dụng thật» vẫn phải đọc đúng nguồn «ngủ» do DỮ LIỆU CŨ / sửa tay — nên ghi thẳng DB để đo cách bảng hiển thị.
    expect(await suaNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { commissionEnabled: false }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "commissionEnabled" });
    await db.leadSourceGroup.update({ where: { id: n.id }, data: { commissionEnabled: false } });
    const tat = await bang();
    expect(tat.o("MARKETING").o).toMatchObject({ kieu: "PERCENT", phanTram: "1", phamVi: "GLOBAL" });
    expect(tat.o("SOURCE_OWNER").o.kieu).toBe("KHONG_CO");
    expect(tat.r.phienBanRieng[0]).toMatchObject({ biBoQua: true });
    expect(tat.r.phienBanRieng[0]!.lyDoBoQua).toContain("chính sách chung vẫn chạy");
    // BẬT LẠI cờ khi chính sách riêng đang ACTIVE sẽ đẩy ô NEW lên 9,5% > trần 9% ⇒ BỊ CHẶN bằng chính guardrail kích hoạt (res3 MEDIUM-4), nguồn KHÔNG đổi
    const chan = await suaNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { commissionEnabled: true }, lyDo: LY_DO });
    expect(chan).toMatchObject({ ok: false, truong: "commissionEnabled" });
    expect(chan.ok === false && chan.loi).toContain("Vượt trần");
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).commissionEnabled).toBe(false);
    await datTranHoaHong(0.2); // nâng trần (quyết định kinh doanh) ⇒ bật lại được
    await suaNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { commissionEnabled: true }, lyDo: LY_DO });
    // BỎ TRỐNG chủ nguồn khi rule SOURCE_OWNER đang chạy ⇒ BỊ CHẶN (sẽ thành hold vĩnh viễn — chủ dự án 09/10, [DMV-09]); nguồn KHÔNG đổi
    const choTrong = await suaNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { ownerEmployeeId: null }, lyDo: LY_DO });
    expect(choTrong).toMatchObject({ ok: false });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).ownerEmployeeId).toBe(chuE);
    // Bảng vẫn phải NÓI THẬT về dữ liệu CŨ đã thiếu chủ (có trước khi cổng chặn): dựng bằng ghi thẳng, không qua dịch vụ
    await db.leadSourceGroup.update({ where: { id: n.id }, data: { ownerEmployeeId: null } });
    const khong = await bang();
    expect(khong.o("SOURCE_OWNER").nguoiHuong).toMatchObject({ thieu: true });
    expect(khong.r.chu).toBeNull();
    await datTranHoaHong(null);
  });

  it("[DCT-DB-01b] nguồn cờ TẮT mang dòng LOẠI TRỪ (chính sách mặc định «không trả Marketing»): bảng NÓI THẬT — dòng EXCLUDE vẫn chạy (Marketing = loại trừ), phiên bản KHÔNG bị gắn «không chạy»; thêm một dòng thu hút thì phiên bản ấy bị gắn «không chạy»", async () => {
    await lamSachChinhSach();
    await datTranHoaHong(null);
    const k = await kb("c01b");
    const ho = (await nguoiKyHo()).quyen;
    const n = await taoNguonDct("NB", { commissionEnabled: false });
    await themChinhSachNhom(k, n.code, [{ vai: "MARKETING", kieu: "EXCLUDE" }]);
    const bang = async () => {
      const r = (await docChinhSachApDungCuaNguon(ho, n.code, NOW))!;
      const new_ = r.theoLoai.find((x) => x.loai === "NEW")!;
      const dong = [...new_.nguon.dong, ...new_.khac.dong];
      return { r, o: (vai: string) => dong.find((d) => d.vai.code === vai)! };
    };
    const b = await bang();
    expect(b.o("MARKETING").o).toMatchObject({ kieu: "EXCLUDE", phamVi: "SOURCE_GROUP" }); // dòng loại trừ CHẠY dù nguồn không tham gia hoa hồng
    expect(b.o("SALE").o).toMatchObject({ kieu: "PERCENT", phamVi: "GLOBAL" }); // vai khác nguyên vẹn
    expect(b.r.phienBanRieng).toHaveLength(1);
    expect(b.r.phienBanRieng[0]).toMatchObject({ status: "ACTIVE", biBoQua: false, lyDoBoQua: null });
    // đối chứng dương: cùng nguồn, thêm một chính sách có dòng THU HÚT ⇒ nó bị bỏ qua (cờ tắt) và bảng nói đúng điều đó; dòng loại trừ vẫn chạy
    await themChinhSachNhom(await kb("c01c"), n.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const c = await bang();
    expect(c.r.phienBanRieng.filter((v) => v.biBoQua)).toHaveLength(1);
    expect(c.r.phienBanRieng.find((v) => v.biBoQua)!.lyDoBoQua).toContain("dòng «loại trừ»");
    expect(c.o("SOURCE_OWNER").o.kieu).toBe("KHONG_CO");
    expect(c.o("MARKETING").o.kieu).toBe("EXCLUDE");
  });

  it("[DCT-DB-02] hoa hồng NGUỒN (vai thu hút) tách khỏi giao dịch KHÁC — bảng rule và tiền đã ghi sổ", async () => {
    await lamSachChinhSach();
    const k = await kb("c02", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    const ho = (await nguoiKyHo()).quyen;
    const e = await seedUser({ email: `${k.ma}-e@ci.test`, role: "SALES_CSM", name: `${k.ma}-e`, phone: null });
    const eId = await lamNhanVien(e.id, "e");
    await ganVai(e.id, k.ouId, "CENTER_SALES_CSM");
    const n = await taoNguonDct("G", { commissionEnabled: true, referrerRequirement: "EMPLOYEE" });
    await themChinhSachNhom(k, n.code, [{ vai: "REFERRER_EMPLOYEE", rate: 0.02 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(n.id, eId) }, ATTRIBUTED);
    await thu(k, "a", D("2026-11-20"));

    const r = (await docChinhSachApDungCuaNguon(ho, n.code, NOW))!;
    const neu = r.theoLoai.find((x) => x.loai === "NEW")!;
    expect(neu.nguon.dong.every((d) => d.vai.laThuHut)).toBe(true);
    expect(neu.khac.dong.some((d) => d.vai.laThuHut)).toBe(false);
    expect(neu.nguon.dong.find((d) => d.vai.code === "REFERRER_EMPLOYEE")!.o).toMatchObject({ kieu: "PERCENT", phanTram: "2" });
    expect(neu.nguon.tongPhanTram).toBe("2");
    expect(neu.khac.tongPhanTram).toBe("6"); // Sale 4 + QLCS 2 (chính sách chung của ca)

    const tien = (await docHoaHongCuaNguon(ho, n.code))!;
    expect(tien.nguon).toEqual({ soDong: 1, tong: 200_000 });
    expect(tien.khac).toEqual({ soDong: 2, tong: 600_000 });
    expect(tien.tong).toEqual({ soDong: 3, tong: 800_000 });
    expect(tien.phamVi).toBe("TAT_CA");
  });

  it("[DCT-DB-03] CÁCH LY: Hội sở thấy hai cơ sở; QLCS CS1 chỉ thấy CS1; Sale (view-self) chỉ thấy dòng CỦA MÌNH; vai không có quyền xem hoa hồng ⇒ null (≠ 0)", async () => {
    const k1 = await kb("c03a", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    const k2 = await kb("c03b", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    const n = await taoNguonDct("CL", { commissionEnabled: true });
    for (const k of [k1, k2]) {
      await ghiNguonQuaDuongThat(k, { nguonChon: chon(n.id) }, ATTRIBUTED);
      await thu(k, "a", D("2026-11-20"));
      await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    }
    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(k1)).quyen;
    const sale1 = await actorCua(k1.sale.id);
    const gv = await seedUser({ email: `${k1.ma}-gv@ci.test`, role: "TEACHER", name: `${k1.ma}-gv`, phone: null });
    await ganVai(gv.id, k1.ouId, "TEACHER");

    const hoTien = (await docHoaHongCuaNguon(ho, n.code))!;
    expect(hoTien.tong).toEqual({ soDong: 4, tong: 1_200_000 }); // hai cơ sở × (Sale 400k + QLCS 200k)
    expect(hoTien.phamVi).toBe("TAT_CA");

    const qlTien = (await docHoaHongCuaNguon(ql1, n.code))!;
    expect(qlTien.tong).toEqual({ soDong: 2, tong: 600_000 }); // CHỈ CS1
    expect(qlTien.phamVi).toBe("CO_SO_VA_CUA_TOI");

    const saleTien = (await docHoaHongCuaNguon(sale1, n.code))!;
    expect(saleTien.tong).toEqual({ soDong: 1, tong: 400_000 }); // CHỈ dòng Sale của chính mình (không thấy QLCS cùng khoản, không thấy CS2)
    expect(saleTien.phamVi).toBe("CHI_CUA_TOI");

    expect(await docHoaHongCuaNguon(await actorCua(gv.id), n.code)).toBeNull(); // GV không có quyền xem hoa hồng ⇒ null, không phải 0
    expect(await docHoaHongCuaNguon(ho, "KHONG_CO_NGUON_NAY")).toBeNull();
  });

  it("[DCT-DB-04] lịch sử của ĐÚNG nguồn này: tạo · sửa · ngừng · gán Page — mới nhất trước, có lý do và trường đổi; không lẫn nguồn khác", async () => {
    const a = await taoNguonDct("LS");
    const b = await taoNguonDct("KHAC");
    await suaNguon({ nguoi: admin, id: a.id, updatedAtDaThay: await moiNhat(a.id), vao: { attributionWindowDays: 45 }, lyDo: LY_DO });
    await suaNguon({ nguoi: admin, id: b.id, updatedAtDaThay: await moiNhat(b.id), vao: { name: "Tên khác" }, lyDo: null });
    const pageId = `${NHAN}-page`;
    await db.facebookPageMapping.create({ data: { pageId, pageName: `${NHAN} Page`, scopeType: "HO", centerId: null, isActive: true } });
    const ho = (await nguoiKyHo()).quyen;
    expect(await luuNguonCuaPage({ actor: ho, actorName: NHAN, pageId, groupCode: a.code, campaignCode: null, now: NOW })).toMatchObject({ ok: true });
    // Page đang trỏ vào `a` ⇒ `a` là ĐÍCH MẶC ĐỊNH của quy nguồn: KHÔNG ngừng được (res3 MEDIUM-5) — Page chuyển sang nguồn KHÁC trước, rồi mới ngừng
    expect(await doiTrangThaiNguon({ nguoi: admin, id: a.id, updatedAtDaThay: await moiNhat(a.id), den: "INACTIVE", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(await luuNguonCuaPage({ actor: ho, actorName: NHAN, pageId, groupCode: b.code, campaignCode: null, now: NOW })).toMatchObject({ ok: true }); // Page chuyển sang nguồn KHÁC
    await doiTrangThaiNguon({ nguoi: admin, id: a.id, updatedAtDaThay: await moiNhat(a.id), den: "INACTIVE", lyDo: LY_DO });

    const ls = (await docLichSuNguon(ho, a.code))!;
    expect(ls.map((x) => x.hanhDong)).toEqual(["NGUON_NGUNG", "PAGE_MAPPING", "PAGE_MAPPING", "NGUON_DOI_CUA_SO", "NGUON_TAO"]); // mới nhất trước; Page rời khỏi a cũng là sự kiện của a
    expect(ls[3]).toMatchObject({ lyDo: LY_DO, truongDoi: ["attributionWindowDays"], cu: { attributionWindowDays: null }, moi: { attributionWindowDays: 45 } });
    expect(ls[0]).toMatchObject({ nguoi: admin.ten, cu: { status: "ACTIVE" }, moi: { status: "INACTIVE" } });
    expect(ls.some((x) => JSON.stringify(x.moi ?? {}).includes(b.code) && x.hanhDong !== "PAGE_MAPPING")).toBe(false);
    const lsB = (await docLichSuNguon(ho, b.code))!;
    expect(lsB.map((x) => x.hanhDong)).toEqual(["PAGE_MAPPING", "NGUON_SUA", "NGUON_TAO"]);
    expect(await docLichSuNguon(ho, "KHONG_CO_NGUON_NAY")).toBeNull();
    expect((await docLichSuNguon(ho, a.code, 2))!).toHaveLength(2); // trần số dòng
  });

  it("[DCT-DB-06] ba hàm đọc chi tiết nguồn TỰ gác `sources:view` (không để quyền ở nơi gọi chưa tồn tại): GV ném PermissionError ở cả ba; HO có quyền đọc được (đối chứng dương)", async () => {
    // Cấy: bỏ `batQuyenXemNguon(actor)` khỏi `docLichSuNguon` ⇒ GV đọc được nhật ký (tên người, lý do) của nguồn (đỏ).
    const n = await taoNguonDct("QX");
    const ho = (await nguoiKyHo()).quyen;
    const gvUser = await seedUser({ email: `${NHAN}-gvqx@ci.test`, role: "TEACHER", name: `${NHAN}-gvqx`, phone: null });
    const gv = await actorCua(gvUser.id);
    expect(gv.permissions.some((p) => p.action === "sources:view")).toBe(false); // tiền đề: GV thật sự không có quyền
    await expect(docLichSuNguon(gv, n.code)).rejects.toThrow(PermissionError);
    await expect(docNguonDeSua(gv, n.code)).rejects.toThrow(PermissionError);
    await expect(docChinhSachApDungCuaNguon(gv, n.code, NOW)).rejects.toThrow(PermissionError);
    expect(await docLichSuNguon(ho, n.code)).not.toBeNull();
    expect(await docNguonDeSua(ho, n.code)).not.toBeNull();
    expect(await docChinhSachApDungCuaNguon(ho, n.code, NOW)).not.toBeNull();
  });

  it("[DCT-DB-05] dữ liệu biểu mẫu sửa: ô khoá + lý do + nút chuyển trạng thái vẽ từ CHÍNH cổng ghi; `capNhatLuc` đi vòng ISO rồi quay lại làm `updatedAtDaThay` (kể cả dòng hệ thống micro-giây)", async () => {
    const k = await kb("c05");
    const ho = (await nguoiKyHo()).quyen;
    const n = await taoNguonDct("DE");
    const truoc = (await docNguonDeSua(ho, n.code))!;
    expect(truoc).toMatchObject({ code: n.code, status: "ACTIVE", isSystem: false, khoa: [], chuyenDuoc: expect.arrayContaining(["INACTIVE", "ARCHIVED"]) });
    expect(truoc.daDung.daDung).toBe(false);

    // dùng nguồn (attribution) ⇒ khoá mã + yêu cầu người giới thiệu + bắt buộc giải trình, và nói VÌ SAO
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(n.id) }, ATTRIBUTED);
    const sau = (await docNguonDeSua(ho, n.code))!;
    expect(sau.daDung).toMatchObject({ attribution: true, daDung: true });
    expect(sau.khoa.map((x) => x.truong).sort()).toEqual(["code", "referrerRequirement", "requiresNote"]);
    expect(sau.khoa.every((x) => x.lyDo.length > 10)).toBe(true);

    // vòng ISO: chuỗi gửi lên từ trình duyệt → Date → cổng ghi khớp
    const r = await suaNguon({ nguoi: admin, id: sau.id, updatedAtDaThay: new Date(sau.capNhatLuc), vao: { name: "Tên mới sau vòng ISO" }, lyDo: null });
    expect(r).toMatchObject({ ok: true, doi: true });
    // …và lệnh sửa dùng bản đã cũ bị từ chối (cùng chuỗi ISO)
    expect(await suaNguon({ nguoi: admin, id: sau.id, updatedAtDaThay: new Date(sau.capNhatLuc), vao: { name: "Bản cũ" }, lyDo: null })).toMatchObject({ ok: false, truong: "vuaDoi" });

    // dòng hệ thống: updatedAt micro-giây (do migration chèn) vẫn đi vòng ISO được
    const sys = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" } });
    await db.$executeRaw`UPDATE "LeadSourceGroup" SET "updatedAt" = '2026-10-01 03:00:00.123456+00' WHERE "id" = ${sys.id}`;
    const he = (await docNguonDeSua(ho, "WALK_IN"))!;
    expect(he.isSystem).toBe(true);
    expect(he.khoa.map((x) => x.truong)).toEqual(expect.arrayContaining(["code", "sourceType", "referrerRequirement", "requiresNote", "selectable"]));
    expect(he.chuyenDuoc).toEqual(["INACTIVE"]);
    expect(await suaNguon({ nguoi: admin, id: he.id, updatedAtDaThay: new Date(he.capNhatLuc), vao: { description: "Khách tự đến trung tâm" }, lyDo: null })).toMatchObject({ ok: true, doi: true });
    const unk = (await docNguonDeSua(ho, "UNKNOWN"))!;
    expect(unk.chuyenDuoc).toEqual([]);
    expect(unk.khoa.map((x) => x.truong)).toContain("commissionEnabled");
    expect(await docNguonDeSua(ho, "KHONG_CO_NGUON_NAY")).toBeNull();
  });
});
