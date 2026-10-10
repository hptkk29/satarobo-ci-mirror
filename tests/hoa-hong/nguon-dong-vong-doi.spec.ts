// @vitest-environment node
/**
 * [DYN-*] — CA NGHIỆM THU «NGUỒN ĐỘNG» phía VÒNG ĐỜI danh mục (Postgres THẬT; writer + đường nhập + engine THẬT). Yêu cầu #58–#59 và các ca phát sinh.
 *
 *   [DYN-06]  #58 nguồn ĐÃ DÙNG → ngừng: lead cũ + lịch sử đọc đúng, hoa hồng của lead cũ vẫn tính; lead MỚI không chọn được (ô chọn · thu thập tín hiệu · đường nhập ·
 *             đổi nguồn); mã không đổi được; mở lại ⇒ chọn được lại
 *   [DYN-WIN] hiệu lực (effectiveFrom/To): ngoài khoảng ⇒ không chọn được cho lead MỚI ở CẢ 5 nơi (ô chọn · form nhập · thu thập tín hiệu · đổi nguồn · gán Page); trong khoảng ⇒ chọn được
 *   [DYN-11]  UNKNOWN: hệ thống — không ARCHIVE / đổi mã / xoá; MANUAL_REVIEW KHÔNG là dòng master (đếm 0, tạo bị từ chối); lead không rõ nguồn mang UNKNOWN + cờ xem tay
 *   [DYN-12]  tạo nguồn trùng mã / khác hoa-thường / khoảng trắng / MANUAL* / trùng nguồn hệ thống ⇒ từ chối, DB không đổi
 *   [DYN-14]  nguồn mới xuất hiện ở ô chọn (form nhập + Sheet), bộ lọc sổ, policy builder, ma trận, danh mục báo cáo — KHÔNG sửa mã; nguồn ngừng biến khỏi nơi CHỌN nhưng còn ở nơi ĐỌC
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng; chạy ĐƯỢC MỘT MÌNH trên DB trống đã migrate + seed vai. LUẬT 19: ngày tuyệt đối.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import type { Actor } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docDuLieuSoan, docDuLieuMaTran } from "../../lib/hoa-hong/chinh-sach-doc";
import { docLuaChonBoLocSo } from "../../lib/hoa-hong/doc-so-giao-dien";
import { docBangPageMapping } from "../../lib/nguon/bang-nguon-theo-page";
import { locNhomChon } from "../../lib/nguon/chon-nguon";
import { DANH_MUC_GOC } from "../../lib/nguon/danh-muc-goc";
import { docDaDung } from "../../lib/nguon/danh-muc-ghi";
import { docChiTietNguon, docDanhMucNguon } from "../../lib/nguon/doc-danh-muc";
import { docChoGanNguon } from "../../lib/nguon/doc-gan-nguon";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { layBangNguonTheoPage, layNhomNhanSuMacDinh } from "../../lib/nguon/feature";
import { loadNguonChoFormNhap } from "../../lib/nguon/nguon-cho-form-nhap";
import { thuThapTinHieuTheoLo } from "../../lib/nguon/thu-thap-tin-hieu";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, nguoiKyHo, themChinhSachNhom, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { dongNhap, doiTrangThaiNguon, ghiNguonQuaDuongThat, suaNguon, themLead, taoNguon, luuNguonCuaPage } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DYN-VD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-dyn-vd";
const NOW = D("2027-02-20");
const NGAY_THU = D("2026-11-20");
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

async function taoNguonDyn(hau: string, ghi: Record<string, unknown> = {}) {
  stamp += 1;
  const code = `DYN_${hau}_${Date.now().toString(36).toUpperCase()}${stamp}`;
  const r = await taoNguon({ nguoi: admin, vao: { ...MAU, code, name: `DYN ${hau}`, ...ghi } });
  if (!r.ok) throw new Error(`taoNguon(${hau}): ${r.truong}: ${r.loi}`);
  return { id: r.id, code: r.code };
}
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const chon = (groupId: string) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });

const COT_CHON = { id: true, code: true, name: true, description: true, referrerRequirement: true, requiresNote: true, selectable: true, status: true, sortOrder: true, effectiveFrom: true, effectiveTo: true } as const;
const quyen =
  (...cac: string[]): KiemQuyen =>
  async (action) =>
    cac.includes(action);
const actorCoSo = (userId: string, centerIds: string[]): Actor =>
  ({ userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: centerIds, visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor;

describe.skipIf(!RUN_DB_TESTS)("[DYN] nghiệm thu nguồn động — vòng đời danh mục", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    // Dòng MANUAL* chỉ có thể do một lần chạy HỎNG để lại (writer đang chặn tạo nó): dọn để lần chạy lành không thừa hưởng rác (luật 18).
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "MANUAL" } } });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "MARKETING", name: `${NHAN}-admin`, phone: null });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
  }, 120_000);

  // Cờ `nguon.*` là trạng thái TOÀN HỆ: ca nào bật thêm (vd ép chọn nguồn) thì ca sau không được thừa hưởng (luật 18).
  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });

  afterAll(async () => {
    await donKichBan(cuaToi);
    await db.facebookPageMapping.deleteMany({ where: { pageId: { startsWith: NHAN } } });
    await db.systemSetting.deleteMany({ where: { key: { in: ["nguon.bangNguonTheoPage", "nguon.epChonNguon"] } } });
    clearSettingsCache();
    await db.leadSourceGroup.deleteMany({ where: { OR: [{ code: { startsWith: "DYN_" } }, { code: { startsWith: "MANUAL" } }] } });
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: NHAN } } });
    await datMocCutover(null);
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[DYN-06] #58 nguồn ĐÃ DÙNG → ngừng: lead cũ + lịch sử đọc đúng và hoa hồng vẫn tính; lead MỚI không chọn được (4 đường); mã không đổi; mở lại ⇒ chọn được lại", async () => {
    const k = await kb("d06", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const n = await taoNguonDyn("N", { commissionEnabled: true });
    await themChinhSachNhom(k, n.code, [{ vai: "MARKETING", rate: 0.015 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(n.id) }, ATTRIBUTED);
    const dau = await (async () => {
      const bc = await boiCanh(k, NOW);
      const khoan = await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: NGAY_THU });
      await quetKhoan(db, bc, khoan);
      return tomTat(await dongSoCuaKhoan(khoan));
    })();
    expect(dau[`MARKETING:${k.qc.id}`]).toBe(150_000);

    // NGỪNG (cần lý do)
    expect(await doiTrangThaiNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), den: "INACTIVE", lyDo: null })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await doiTrangThaiNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), den: "INACTIVE", lyDo: LY_DO })).toMatchObject({ ok: true, den: "INACTIVE" });

    // ── LEAD CŨ + LỊCH SỬ đọc đúng ──
    const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id }, include: { group: { select: { code: true, status: true } } } });
    expect(a.group).toEqual({ code: n.code, status: "INACTIVE" });
    const ho = (await nguoiKyHo()).quyen;
    const dm = await docDanhMucNguon(ho, { now: NOW, trangThai: "INACTIVE", coSoId: null });
    expect(dm.dong.find((d) => d.code === n.code)).toMatchObject({ status: "INACTIVE", soLeadTong: 1, isSystem: false });
    expect((await docChiTietNguon(ho, n.code, NOW))!.thongKe.tong).toBe(1);
    // …và khoản thu TIẾP THEO của lead cũ vẫn ra hoa hồng thu hút theo nguồn đã ngừng (ngừng = ngừng cho lead MỚI, không rút tiền lead cũ)
    const bc = await boiCanh(k, NOW);
    const khoan2 = await tienVe(k, await dungBe(k, "b", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-11-21") });
    await quetKhoan(db, bc, khoan2);
    expect(tomTat(await dongSoCuaKhoan(khoan2))[`MARKETING:${k.qc.id}`]).toBe(150_000);

    // ── LEAD MỚI không chọn được: (1) ô chọn ──
    const rows = await db.leadSourceGroup.findMany({ select: COT_CHON });
    expect(locNhomChon(rows, NOW).map((x) => x.code)).not.toContain(n.code);
    // (2) thu thập tín hiệu: người nhập bấm đúng nguồn đã ngừng ⇒ có `loi`
    const thu = await thuThapTinHieuTheoLo(db, [dongNhap(k, { nguonChon: chon(n.id) })]);
    expect(thu.tin[0]!.nguonChon?.loi).toMatch(/không còn dùng được/);
    // (3) đường nhập thật chặn
    const k2 = await themLead(k, "moi");
    cuaToi.push(k2);
    await expect(ghiNguonQuaDuongThat(k2, { nguonChon: chon(n.id) }, ATTRIBUTED, k2.lead!.id)).rejects.toThrow(/đường nhập chặn/);
    expect(await db.leadAttribution.count({ where: { leadId: k2.lead!.id } })).toBe(0);
    // (4) đổi nguồn của một lead hiện có sang nguồn đã ngừng
    await ghiNguonQuaDuongThat(k2, { nguonChon: chon((await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" }, select: { id: true } })).id) }, ATTRIBUTED, k2.lead!.id);
    const doi = (groupId: string) =>
      doiNguonLead({ actor: actorCoSo("u-dyn", [k.centerId]), actorName: "Người đổi", kiemQuyen: quyen("leads:overwrite"), leadId: k2.lead!.id, groupId, thamChieu: null, giaiTrinh: null, lyDo: "Khách xác nhận nguồn khác", bayGio: NOW });
    expect(await doi(n.id)).toMatchObject({ ok: false, truong: "nguon" });
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k2.lead!.id }, include: { group: { select: { code: true } } } })).group.code).toBe("WALK_IN");

    // ── MÃ KHÔNG ĐỔI ──
    const dung = await docDaDung(db, n, { bangPage: await layBangNguonTheoPage(), nhomMacDinh: await layNhomNhanSuMacDinh() });
    expect(dung.daDung).toBe(true);
    expect(await suaNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { code: `${n.code}_2` }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "code" });

    // ── MỞ LẠI ⇒ chọn được lại ở cả bốn đường (đối chứng dương: các từ chối trên là do trạng thái, không do lời gọi hỏng) ──
    expect((await doiTrangThaiNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), den: "ACTIVE", lyDo: LY_DO })).ok).toBe(true);
    expect(locNhomChon(await db.leadSourceGroup.findMany({ select: COT_CHON }), NOW).map((x) => x.code)).toContain(n.code);
    expect((await thuThapTinHieuTheoLo(db, [dongNhap(k, { nguonChon: chon(n.id) })])).tin[0]!.nguonChon?.loi).toBeNull();
    expect(await doi(n.id)).toMatchObject({ ok: true });
  });

  it("[DYN-WIN] hiệu lực: ngoài khoảng ⇒ KHÔNG chọn được cho lead mới ở ô chọn · form nhập · thu thập tín hiệu · đổi nguồn · gán Page; trong khoảng ⇒ chọn được; biên bắt đầu ĐÓNG / kết thúc MỞ", async () => {
    const k = await kb("win", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const nay = D("2026-11-20");
    const hetHan = await taoNguonDyn("HET", { effectiveFrom: new Date("2026-10-01T00:00:00Z"), effectiveTo: new Date("2026-11-01T00:00:00Z") });
    const chuaToi = await taoNguonDyn("CHUA", { effectiveFrom: new Date("2026-12-01T00:00:00Z"), effectiveTo: null });
    const dangCo = await taoNguonDyn("CO", { effectiveFrom: new Date("2026-11-01T00:00:00Z"), effectiveTo: new Date("2026-12-01T00:00:00Z") });
    const bienKetThuc = await taoNguonDyn("BIEN", { effectiveFrom: null, effectiveTo: nay }); // hết đúng lúc `nay` ⇒ KHÔNG chọn được (kết thúc MỞ)
    const bienBatDau = await taoNguonDyn("BD", { effectiveFrom: nay, effectiveTo: null }); // bắt đầu đúng lúc `nay` ⇒ chọn được (bắt đầu ĐÓNG)
    const ds = (c: { code: string }[]) => c.map((x) => x.code);

    // (1) ô chọn
    const rows = await db.leadSourceGroup.findMany({ select: COT_CHON });
    const thay = ds(locNhomChon(rows, nay));
    expect(thay).toEqual(expect.arrayContaining([dangCo.code, bienBatDau.code]));
    for (const x of [hetHan, chuaToi, bienKetThuc]) expect(thay, x.code).not.toContain(x.code);

    // (2) form nhập (cờ ép chọn toàn hệ bật để form có ô chọn)
    await datCoNguon(CO_NGUON_DAY_DU, { "nguon.epChonNguon": true });
    const form = await loadNguonChoFormNhap([], nay);
    expect(ds(form!.danhMuc)).toEqual(expect.arrayContaining([dangCo.code]));
    for (const x of [hetHan, chuaToi, bienKetThuc]) expect(ds(form!.danhMuc), x.code).not.toContain(x.code);

    // (3) thu thập tín hiệu của đường nhập
    const thu = await thuThapTinHieuTheoLo(db, [hetHan, chuaToi, dangCo, bienKetThuc, bienBatDau].map((x) => dongNhap(k, { bayGio: nay, nguonChon: chon(x.id) })));
    expect(thu.tin.map((t) => (t.nguonChon?.loi ?? null) === null)).toEqual([false, false, true, false, true]);

    // (4) đổi nguồn
    await ghiNguonQuaDuongThat(k, { bayGio: nay, nguonChon: chon((await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" }, select: { id: true } })).id) }, ATTRIBUTED);
    const doi = (groupId: string) =>
      doiNguonLead({ actor: actorCoSo("u-dyn", [k.centerId]), actorName: "Người đổi", kiemQuyen: quyen("leads:overwrite"), leadId: k.lead!.id, groupId, thamChieu: null, giaiTrinh: null, lyDo: "Khách xác nhận nguồn khác", bayGio: nay });
    expect(await doi(hetHan.id)).toMatchObject({ ok: false, truong: "nguon" });
    expect(await doi(chuaToi.id)).toMatchObject({ ok: false, truong: "nguon" });
    expect(await doi(dangCo.id)).toMatchObject({ ok: true });

    // (5) gán Page: danh sách + cổng ghi
    const ho = (await nguoiKyHo()).quyen;
    const pageId = `${NHAN}-page`;
    await db.facebookPageMapping.create({ data: { pageId, pageName: `${NHAN} Page`, scopeType: "HO", centerId: null, isActive: true } });
    const bang = await docBangPageMapping(ho, nay);
    expect(bang.nhom.map((x) => x.code)).toEqual(expect.arrayContaining([dangCo.code]));
    for (const x of [hetHan, chuaToi, bienKetThuc]) expect(bang.nhom.map((y) => y.code), x.code).not.toContain(x.code);
    const gan = (groupCode: string) => luuNguonCuaPage({ actor: ho, actorName: NHAN, pageId, groupCode, campaignCode: null, now: nay });
    expect(await gan(hetHan.code)).toMatchObject({ ok: false, truong: "nguon" });
    expect(await gan(chuaToi.code)).toMatchObject({ ok: false, truong: "nguon" });
    expect(await gan(dangCo.code)).toMatchObject({ ok: true });

    // lead CŨ mang nguồn hết hạn: vẫn đọc được (không có gì bị xoá) VÀ vẫn ra hoa hồng theo rule riêng của nguồn — hiệu lực chỉ chặn việc CHỌN MỚI
    await themChinhSachNhom(k, hetHan.code, [{ vai: "MARKETING", rate: 0.005 }]);
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { groupId: hetHan.id, originalGroupId: hetHan.id } });
    const doc = await docChiTietNguon(ho, hetHan.code, nay);
    expect(doc!.thongKe.tong).toBe(1);
    const bc = await boiCanh(k, NOW);
    const khoan = await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: NGAY_THU });
    await quetKhoan(db, bc, khoan);
    expect(tomTat(await dongSoCuaKhoan(khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`MARKETING:${k.qc.id}`]: 50_000 }); // 50.000 = rule NGUỒN (0,5%) — nguồn hết hạn vẫn được tính cho lead cũ
  });

  it("[DYN-11] UNKNOWN là nguồn HỆ THỐNG (không ARCHIVE / đổi mã / xoá); MANUAL_REVIEW KHÔNG phải dòng master; lead không rõ nguồn mang UNKNOWN + cờ xem tay", async () => {
    const lay = () => db.leadSourceGroup.findUniqueOrThrow({ where: { code: "UNKNOWN" } });
    const truoc = await lay();
    expect(truoc).toMatchObject({ isSystem: true, selectable: false, status: "ACTIVE", sourceType: "SYSTEM", commissionEnabled: false });
    for (const den of ["ARCHIVED", "INACTIVE"] as const) {
      expect(await doiTrangThaiNguon({ nguoi: admin, id: truoc.id, updatedAtDaThay: truoc.updatedAt, den, lyDo: LY_DO }), den).toMatchObject({ ok: false, truong: "trangThai" });
    }
    for (const vao of [{ code: "UNKNOWN_2" }, { commissionEnabled: true }, { selectable: true }, { referrerRequirement: "PARENT" }, { sourceType: "OTHER" }]) {
      expect(await suaNguon({ nguoi: admin, id: truoc.id, updatedAtDaThay: truoc.updatedAt, vao, lyDo: LY_DO }), JSON.stringify(vao)).toMatchObject({ ok: false });
    }
    expect(await lay()).toEqual(truoc); // không một cột nào đổi

    // MANUAL_REVIEW: không có dòng master, không tạo được, không nằm trong danh mục gốc
    expect(await db.leadSourceGroup.count({ where: { code: { startsWith: "MANUAL" } } })).toBe(0);
    expect(DANH_MUC_GOC.some((d) => d.code.startsWith("MANUAL"))).toBe(false);
    expect(await taoNguon({ nguoi: admin, vao: { ...MAU, code: "MANUAL_REVIEW" } })).toMatchObject({ ok: false, truong: "code" });
    expect(await db.leadSourceGroup.count({ where: { code: { startsWith: "MANUAL" } } })).toBe(0);

    // lead không có tín hiệu nguồn nào ⇒ UNKNOWN (nguồn hệ thống gán). «Cần xem tay» là TRẠNG THÁI của dòng (cờ `coXemTay` + lý do), không phải một nguồn.
    const k = await kb("d11");
    const a = await ghiNguonQuaDuongThat(k, { duongVao: "khong-ro-duong-nay" }, ATTRIBUTED);
    expect(a.group.code).toBe("UNKNOWN");
    expect(a).toMatchObject({ identificationMethod: "UNKNOWN", matchedRule: "UNKNOWN" });
    const k2 = await themLead(k, "tay");
    cuaToi.push(k2);
    const b = await ghiNguonQuaDuongThat(k2, { nhanKhai: "Một nhãn nguồn không có trong danh mục" }, ATTRIBUTED, k2.lead!.id);
    expect(b.group.code).toBe("UNKNOWN");
    expect(b.signals).toMatchObject({ coXemTay: true });
    expect((b.signals as { xemTay?: string[] }).xemTay).toContain("NHAN_NGUON_LA");
    expect(await db.leadSourceGroup.count({ where: { code: { startsWith: "MANUAL" } } })).toBe(0);
  });

  it("[DYN-12] tạo nguồn trùng mã · khác hoa-thường · có khoảng trắng · MANUAL* · UNKNOWN · trùng nguồn hệ thống ⇒ từ chối, DB và audit KHÔNG đổi; mã hợp lệ khác vẫn tạo được", async () => {
    const co = await taoNguonDyn("DUP");
    const dem = async () => ({ nhom: await db.leadSourceGroup.count(), audit: await db.auditLog.count({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: NHAN } } }) });
    const truoc = await dem();
    for (const code of [co.code, co.code.toLowerCase(), `  ${co.code}  `, "paid_ads", " PAID_ADS", "Walk_In", "unknown", "MANUAL_REVIEW", "manual_x", "AB"]) {
      expect(await taoNguon({ nguoi: admin, vao: { ...MAU, code } }), code).toMatchObject({ ok: false, truong: "code" });
    }
    expect(await dem()).toEqual(truoc);
    expect((await taoNguonDyn("OK")).code).toMatch(/^DYN_OK_/);
    // đổi mã nguồn CHƯA dùng sang mã của nguồn khác (kể cả khác hoa-thường) cũng bị từ chối
    const b = await taoNguonDyn("DUP2");
    expect(await suaNguon({ nguoi: admin, id: b.id, updatedAtDaThay: await moiNhat(b.id), vao: { code: co.code.toLowerCase() }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "code" });
  });

  it("[DYN-14] nguồn mới xuất hiện ở ô chọn (form nhập + Sheet), bộ lọc sổ, policy builder, ma trận, danh mục báo cáo — KHÔNG sửa mã; nguồn đã ngừng biến khỏi nơi CHỌN nhưng còn ở nơi ĐỌC", async () => {
    const k = await kb("d14");
    const ho = (await nguoiKyHo()).quyen;
    const moi = await taoNguonDyn("MOI", { commissionEnabled: true });
    const ngung = await taoNguonDyn("NGUNG", { commissionEnabled: true });
    expect((await doiTrangThaiNguon({ nguoi: admin, id: ngung.id, updatedAtDaThay: await moiNhat(ngung.id), den: "INACTIVE", lyDo: LY_DO })).ok).toBe(true);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(moi.id) }, ATTRIBUTED);

    // nơi CHỌN
    await datCoNguon(CO_NGUON_DAY_DU, { "nguon.epChonNguon": true });
    const form = await loadNguonChoFormNhap([], NOW);
    expect(form!.danhMuc.map((x) => x.code)).toContain(moi.code);
    expect(form!.danhMuc.map((x) => x.code)).not.toContain(ngung.code);
    const sheet = await docChoGanNguon({ actor: ho, leadId: k.lead!.id, kiemQuyen: quyen("sources:view"), canViewPii: false, cuaSoNgay: 90, now: NOW });
    expect(sheet!.danhMuc.map((x) => x.code)).toContain(moi.code);
    expect(sheet!.danhMuc.map((x) => x.code)).not.toContain(ngung.code);
    expect(sheet!.nguon).toMatchObject({ groupCode: moi.code });
    const soan = await docDuLieuSoan(ho, NOW);
    expect(soan.nhomNguon.find((x) => x.code === moi.code)).toMatchObject({ coHoaHong: true, trangThai: "HOAT_DONG" });
    // policy builder (E2a 09/10): nguồn đã ngừng VẪN có trong danh sách để bản nháp mang nó mở ra đúng — nhưng mang trạng thái NGỪNG nên ô chọn không mời chọn (`nguonQuaCongHoatDong`)
    expect(soan.nhomNguon.find((x) => x.code === ngung.code)).toMatchObject({ trangThai: "NGUNG" });
    const maTran = await docDuLieuMaTran(ho, null);
    expect(maTran.nhomNguon.map((x) => x.code)).toContain(moi.code);
    expect(maTran.nhomNguon.map((x) => x.code)).not.toContain(ngung.code);

    // nơi ĐỌC: bộ lọc sổ giữ cả nguồn đã ngừng (lịch sử vẫn lọc được); danh mục báo cáo liệt kê cả hai
    const loc = await docLuaChonBoLocSo(ho);
    expect(loc.nhomNguon.map((x) => x.code)).toEqual(expect.arrayContaining([moi.code, ngung.code]));
    const dm = await docDanhMucNguon(ho, { now: NOW, trangThai: null, coSoId: null });
    expect(dm.dong.find((d) => d.code === moi.code)).toMatchObject({ status: "ACTIVE", soLeadTong: 1 });
    expect(dm.dong.find((d) => d.code === ngung.code)).toMatchObject({ status: "INACTIVE", soLeadTong: 0 });

  });
});
