// @vitest-environment node
/**
 * [DYN-GATE-*] [DYN-SET-*] [DYN-HOLD-*] — CỔNG GHI DANH MỤC NGUỒN + ĐƯỜNG THOÁT HOLD (Postgres THẬT). Củng cố sau rà soát đối kháng 09/10/2026 (res3 · res4).
 *
 *   [DYN-GATE-01] nguồn ĐÃ CÓ DÒNG SỔ: đổi cửa sổ / chủ / tham gia hoa hồng cần `coQuyenKichHoat`; đổi tên thì không; nguồn chưa dính tiền thì không
 *   [DYN-GATE-02] BẬT LẠI `commissionEnabled` khi chính sách riêng đang ACTIVE: chạy lại trần bằng guardrail kích hoạt — vượt trần ⇒ CHẶN, nguồn không đổi; nâng trần ⇒ qua
 *   [DYN-GATE-03] nguồn là ĐÍCH MẶC ĐỊNH của quy nguồn (đường vào · nhóm nhân sự mặc định): không ngừng · không tắt chọn · không đặt hạn; nguồn không phải đích thì được
 *   [DYN-SET-01]  setting `nguon.nhomNhanSuMacDinh` phải là nguồn có thật · chọn được · kiểu nhân sự — chặn Ở NƠI LƯU, giá trị cũ giữ nguyên
 *   [DYN-HOLD-01] hold THIEU_SALE_PHU_HUYNH có ĐƯỜNG THOÁT: bổ sung Sale bằng tay ⇒ cờ xem tay gỡ, lượt quét lại trả đúng Sale; first-claim (đã có Sale thì không đè); TU_CLAIM; người nghỉ; sai loại
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import type { Actor } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { doiTrangThaiNguon, suaNguon } from "../../lib/nguon/danh-muc-ghi";
import { boSungSalePhuHuynh, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { clearSettingsCache, getSetting, setGlobalSetting } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, lamNhanVien, themChinhSachNhom, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { datTranHoaHong, ghiNguonQuaDuongThat, lamSachChinhSach, NOW_GHI_NGUON } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DYN-GATE] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-dyn-cong";
const NOW = D("2027-02-20");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const LY_DO = "Chủ dự án chốt ngày 09/10/2026";
const cuaToi: KichBan[] = [];
let admin: { userId: string; ten: string };
let dem = 0;

async function kb(tien: string, rules = [{ vai: "SALE", rate: 0.04 }]) {
  const k = await dungKichBan(tien, { rules });
  cuaToi.push(k);
  return k;
}

async function taoNhom(hau: string, o: { req?: "NONE" | "PARENT" | "EMPLOYEE"; coHoaHong?: boolean; status?: "ACTIVE" | "INACTIVE" } = {}) {
  dem += 1;
  return db.leadSourceGroup.create({
    data: {
      code: `DYN_${hau}_${Date.now().toString(36)}${dem}`.toUpperCase(),
      name: `DYN ${hau}`,
      referrerRequirement: o.req ?? "NONE",
      sortOrder: 700 + dem,
      commissionEnabled: o.coHoaHong ?? false,
      status: o.status ?? "ACTIVE",
    },
    select: { id: true, code: true, updatedAt: true },
  });
}
const moi = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const chon = (groupId: string, them: Partial<{ parentUserId: string }> = {}) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null, ...them });
const actorCoSo = (userId: string, centerIds: string[]): Actor =>
  ({ userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: centerIds, visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor;
const quyen =
  (...cac: string[]): KiemQuyen =>
  async (action) =>
    cac.includes(action);

async function thu(k: KichBan, hau: string, ngay: Date) {
  const bc = await boiCanh(k, NOW);
  const khoan = await tienVe(k, await dungBe(k, hau, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  await quetKhoan(db, bc, khoan);
  return { khoan, tom: tomTat(await dongSoCuaKhoan(khoan)) };
}

describe.skipIf(!RUN_DB_TESTS)("[DYN-GATE] cổng ghi danh mục nguồn + đường thoát hold", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: { in: ["nguon.cuaSoGhiCongNgay", "nguon.nhomNhanSuMacDinh", "nguon.bangNguonTheoPage"] } } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "SUPER_ADMIN", name: `${NHAN}-admin`, phone: null });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
  }, 120_000);

  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });

  afterAll(async () => {
    await datTranHoaHong(null);
    await donKichBan(cuaToi);
    await db.systemSetting.deleteMany({ where: { key: { in: ["nguon.nhomNhanSuMacDinh"] } } });
    clearSettingsCache();
    const nhomDyn = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "DYN_" } }, select: { id: true } })).map((g) => g.id);
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhomDyn } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhomDyn } }, { originalGroupId: { in: nhomDyn } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DYN_" } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorName: { startsWith: NHAN } }, { entityType: "SystemSetting", actorName: { startsWith: NHAN } }] } });
    await db.leadSourceGroup.update({ where: { code: "PAID_ADS" }, data: { effectiveTo: null, selectable: true } });
    await datMocCutover(null);
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[DYN-GATE-01] nguồn ĐÃ CÓ DÒNG SỔ: đổi cửa sổ · chủ · tham gia hoa hồng đòi `coQuyenKichHoat`; đổi tên thì không; nguồn CHƯA dính tiền thì không (đối chứng)", async () => {
    // Cấy: bỏ vế `daCoDongSo` khỏi `canQuyenKichHoat` ⇒ ca nguồn có sổ lọt qua (đỏ).
    const k = await kb("g1");
    const g = await taoNhom("G1", { coHoaHong: true });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const co = await thu(k, "a", D("2026-11-20"));
    expect(co.tom[`SALE:${k.sale.id}`]).toBe(400_000); // tiền đề: nguồn g THẬT SỰ có dòng sổ (Sale chung)
    expect(await db.commissionTransaction.count({ where: { sourceGroupId: g.id } })).toBeGreaterThan(0);

    const doi = (vao: Record<string, unknown>, coQuyenKichHoat: boolean, id = g.id) => moi(id).then((updatedAtDaThay) => suaNguon({ nguoi: admin, id, updatedAtDaThay, vao, lyDo: LY_DO, coQuyenKichHoat, now: NOW_GHI_NGUON }));
    for (const vao of [{ attributionWindowDays: 45 }, { commissionEnabled: false }]) {
      expect(await doi(vao, false), JSON.stringify(vao)).toMatchObject({ ok: false, truong: "quyen" });
    }
    expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ attributionWindowDays: null, commissionEnabled: true });
    expect(await doi({ name: "Đổi tên thôi" }, false)).toMatchObject({ ok: true, doi: true }); // tên không đụng tiền
    expect(await doi({ attributionWindowDays: 45 }, true)).toMatchObject({ ok: true, doi: true });
    expect(await doi({ commissionEnabled: false }, true)).toMatchObject({ ok: true, doi: true });

    // đối chứng: nguồn CHƯA có lead / chính sách / sổ ⇒ không đòi quyền
    const trong = await taoNhom("G1T", { coHoaHong: true });
    expect(await doi({ attributionWindowDays: 45 }, false, trong.id)).toMatchObject({ ok: true, doi: true });
  });

  it("[DYN-GATE-02] BẬT LẠI commissionEnabled khi chính sách riêng đang ACTIVE: vượt trần ⇒ CHẶN (nguồn KHÔNG đổi); nâng trần ⇒ qua; nguồn không có chính sách riêng ⇒ qua", async () => {
    // Cấy: bỏ lời gọi `kiemChinhSachKhiBatHoaHongNguon` ⇒ lượt bật vượt trần lọt qua (đỏ).
    await lamSachChinhSach();
    const k = await kb("g2", [{ vai: "SALE", rate: 0.04 }, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }]);
    const g = await taoNhom("G2", { coHoaHong: false });
    await themChinhSachNhom(k, g.code, [{ vai: "MARKETING", rate: 0.02 }]); // chung 4+1+2 = 7% + riêng 2% = 9% > trần 8% (sàn của registry)
    await datTranHoaHong(0.08);
    const bat = () => moi(g.id).then((updatedAtDaThay) => suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay, vao: { commissionEnabled: true }, lyDo: LY_DO, coQuyenKichHoat: true, now: NOW_GHI_NGUON }));
    const chan = await bat();
    expect(chan).toMatchObject({ ok: false, truong: "commissionEnabled" });
    expect(chan.ok === false && chan.loi).toContain("Vượt trần");
    // cùng hướng xử lý với hàng rào kích hoạt (09/10/2026): trần HIỆN TẠI + việc cần làm — đọc từ guardrail thật, không câu riêng
    expect(chan.ok === false && chan.loi).toContain("trần hiện tại 8%");
    expect(chan.ok === false && chan.loi).toContain("Quản trị hệ thống");
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: g.id } })).commissionEnabled).toBe(false);

    await datTranHoaHong(0.09); // quyết định kinh doanh: nâng trần (9% ≤ 9%)
    expect(await bat()).toMatchObject({ ok: true, doi: true });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: g.id } })).commissionEnabled).toBe(true);

    // đối chứng: nguồn KHÔNG có chính sách riêng ⇒ bật luôn (không có gì để kiểm), kể cả khi trần ở mức sàn
    await datTranHoaHong(0.08);
    const trong = await taoNhom("G2T", { coHoaHong: false });
    expect(await suaNguon({ nguoi: admin, id: trong.id, updatedAtDaThay: await moi(trong.id), vao: { commissionEnabled: true }, lyDo: LY_DO, coQuyenKichHoat: true, now: NOW_GHI_NGUON })).toMatchObject({ ok: true, doi: true });
    await datTranHoaHong(null);
  });

  it("[DYN-GATE-03] nguồn là ĐÍCH MẶC ĐỊNH của quy nguồn: không ngừng · không tắt chọn · không đặt hạn (kể cả tương lai); nguồn KHÔNG phải đích thì được; trỏ cấu hình sang nguồn khác ⇒ nguồn cũ được thả", async () => {
    // Cấy: bỏ `hieuLucMoi` khỏi lời gọi ⇒ ca hạn (đỏ). Cấy: `dichMacDinh` chỉ lấy `nhomNhanSuMacDinh` (như bản cũ) ⇒ ca PAID_ADS (đỏ).
    const paid = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "PAID_ADS" } });
    const sua = (id: string, updatedAt: Date, vao: Record<string, unknown>) => suaNguon({ nguoi: admin, id, updatedAtDaThay: updatedAt, vao, lyDo: LY_DO, coQuyenKichHoat: true, now: NOW_GHI_NGUON });
    // PAID_ADS = đích của luật QUANG_CAO + đường vào facebook/zalo/web
    expect(await sua(paid.id, paid.updatedAt, { selectable: false })).toMatchObject({ ok: false, truong: "selectable" });
    expect(await sua(paid.id, await moi(paid.id), { effectiveTo: new Date("2027-12-31T00:00:00.000Z") })).toMatchObject({ ok: false, truong: "effectiveTo" });
    expect(await sua(paid.id, await moi(paid.id), { effectiveFrom: new Date("2026-12-31T00:00:00.000Z") })).toMatchObject({ ok: false, truong: "effectiveFrom" });
    expect(await doiTrangThaiNguon({ coQuyenKichHoat: true, nguoi: admin, id: paid.id, updatedAtDaThay: await moi(paid.id), den: "INACTIVE", lyDo: LY_DO, now: NOW_GHI_NGUON })).toMatchObject({ ok: false, truong: "trangThai" });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("ACTIVE");

    // nguồn do admin tạo, KHÔNG ai trỏ tới ⇒ làm gì cũng được (đối chứng dương)
    const tu = await taoNhom("G3A", { req: "EMPLOYEE" });
    expect(await sua(tu.id, await moi(tu.id), { effectiveTo: new Date("2027-12-31T00:00:00.000Z") })).toMatchObject({ ok: true, doi: true });
    expect(await doiTrangThaiNguon({ coQuyenKichHoat: true, nguoi: admin, id: tu.id, updatedAtDaThay: await moi(tu.id), den: "INACTIVE", lyDo: LY_DO, now: NOW_GHI_NGUON })).toMatchObject({ ok: true });
    await doiTrangThaiNguon({ coQuyenKichHoat: true, nguoi: admin, id: tu.id, updatedAtDaThay: await moi(tu.id), den: "ACTIVE", lyDo: LY_DO, now: NOW_GHI_NGUON });

    // trỏ cấu hình «nhóm nhân sự mặc định» vào nguồn tự tạo ⇒ nguồn ấy thành đích ⇒ bị khoá; thả ra khi trỏ lại
    const ra = await setGlobalSetting({ isSuperAdmin: true, userId: admin.userId } as unknown as Actor, { key: "nguon.nhomNhanSuMacDinh", value: tu.code, reason: LY_DO, actorName: admin.ten });
    expect(ra).toEqual({ ok: true });
    expect(await doiTrangThaiNguon({ coQuyenKichHoat: true, nguoi: admin, id: tu.id, updatedAtDaThay: await moi(tu.id), den: "INACTIVE", lyDo: LY_DO, now: NOW_GHI_NGUON })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(await sua(tu.id, await moi(tu.id), { effectiveTo: new Date("2028-12-31T00:00:00.000Z") })).toMatchObject({ ok: false, truong: "effectiveTo" });
    await setGlobalSetting({ isSuperAdmin: true, userId: admin.userId } as unknown as Actor, { key: "nguon.nhomNhanSuMacDinh", value: "EMPLOYEE_REFERRAL", reason: LY_DO, actorName: admin.ten });
    expect(await doiTrangThaiNguon({ coQuyenKichHoat: true, nguoi: admin, id: tu.id, updatedAtDaThay: await moi(tu.id), den: "INACTIVE", lyDo: LY_DO, now: NOW_GHI_NGUON })).toMatchObject({ ok: true });
  });

  it("[DYN-SET-01] setting `nguon.nhomNhanSuMacDinh`: mã không có · nguồn sai kiểu (không cần nhân sự) · nguồn đã ngừng ⇒ TỪ CHỐI, giá trị cũ giữ nguyên; nguồn kiểu nhân sự đang hoạt động ⇒ lưu", async () => {
    // Cấy: bỏ `kiemGiaTriTheoDb` khỏi `setGlobalSetting` ⇒ cả ba ca từ chối lọt (đỏ).
    const SA = { isSuperAdmin: true, userId: admin.userId } as unknown as Actor;
    const luu = (value: string) => setGlobalSetting(SA, { key: "nguon.nhomNhanSuMacDinh", value, reason: LY_DO, actorName: admin.ten });
    const ngung = await taoNhom("S1", { req: "EMPLOYEE", status: "INACTIVE" });
    const dung = await taoNhom("S2", { req: "EMPLOYEE" });
    await luu("EMPLOYEE_REFERRAL");
    for (const sai of ["KHONG_CO_NGUON_NAY_DAU", "PAID_ADS", "PARENT_REFERRAL", ngung.code]) {
      const r = await luu(sai);
      expect(r, sai).toMatchObject({ ok: false, error: { code: "VALIDATION", field: "nguon.nhomNhanSuMacDinh" } });
    }
    expect(await getSetting("nguon.nhomNhanSuMacDinh"), "giá trị cũ giữ nguyên").toBe("EMPLOYEE_REFERRAL");
    // thông điệp NÓI nguyên nhân
    const r1 = await luu("PAID_ADS");
    expect(r1.ok === false && r1.error.message).toContain("NHÂN SỰ");
    // đối chứng dương
    expect(await luu(dung.code)).toEqual({ ok: true });
    expect(await getSetting("nguon.nhomNhanSuMacDinh")).toBe(dung.code);
    await luu("EMPLOYEE_REFERRAL");
  });

  it("[DYN-HOLD-01] THIEU_SALE_PHU_HUYNH có ĐƯỜNG THOÁT: bổ sung Sale bằng tay ⇒ cờ THIEU_SALE_PH gỡ, quét lại trả đúng Sale, hold đóng; first-claim; TU_CLAIM; Sale đã nghỉ; sai loại người giới thiệu", async () => {
    // Cấy: bỏ nhánh `p.saleTay` ở `doiNguonLead` (vẫn tra tự động) ⇒ Sale vẫn null ⇒ ca đầu đỏ.
    const k = await kb("hold");
    const g = await taoNhom("HOLD", { req: "PARENT", coHoaHong: true });
    await themChinhSachNhom(k, g.code, [{ vai: "REFERRER_PARENT_SALE", rate: 0.02 }]);
    const ph = await seedUser({ email: `${k.ma}-ph@ci.test`, role: "PARENT", name: `${k.ma}-ph`, phone: null });
    const saleX = await seedUser({ email: `${k.ma}-salex@ci.test`, role: "SALES_CSM", name: `${k.ma}-salex`, phone: null });
    await lamNhanVien(saleX.id, "salex");
    const nguoiThao = await seedUser({ email: `${k.ma}-nguoithao@ci.test`, role: "SALES_CSM", name: `${k.ma}-nguoithao`, phone: null });
    await lamNhanVien(nguoiThao.id, "nguoithao");

    // PH giới thiệu nhưng KHÔNG tìm được Sale (PH chưa có học viên/lead gốc) ⇒ attribution null Sale + cờ xem tay + hold
    const a0 = await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id, { parentUserId: ph.id }) }, ATTRIBUTED);
    expect(a0.referrerSaleUserId).toBeNull();
    expect(a0.signals).toMatchObject({ coXemTay: true, xemTay: expect.arrayContaining(["THIEU_SALE_PH"]) });
    const truoc = await thu(k, "a", D("2026-11-20"));
    expect(truoc.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: truoc.khoan } })).detail).toMatchObject({ vai: "REFERRER_PARENT_SALE", lyDo: "THIEU_SALE_PHU_HUYNH" });

    const actor = actorCoSo(nguoiThao.id, [k.centerId]);
    const bo = (over: Partial<Parameters<typeof boSungSalePhuHuynh>[0]> = {}) =>
      boSungSalePhuHuynh({ actor, actorName: "Người thao tác", kiemQuyen: quyen("leads:overwrite", "sources:override-after-payment"), leadId: k.lead!.id, saleUserId: saleX.id, lyDo: "Bổ sung Sale phụ trách phụ huynh sau khi đối chiếu hồ sơ", bayGio: NOW_GHI_NGUON, ...over });

    // — các ca TỪ CHỐI trước (0 ghi): lý do ngắn · Sale chính là người thao tác (TU_CLAIM) · Sale đã nghỉ
    const ngan = await bo({ lyDo: "ngắn" });
    expect(ngan, JSON.stringify(ngan)).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await bo({ saleUserId: nguoiThao.id })).toMatchObject({ ok: false, truong: "thamChieu" });
    const nghi = await seedUser({ email: `${k.ma}-nghi@ci.test`, role: "SALES_CSM", name: `${k.ma}-nghi`, phone: null });
    const nghiEmp = await lamNhanVien(nghi.id, "nghi");
    await db.employee.update({ where: { id: nghiEmp }, data: { status: "RESIGNED" } });
    expect(await bo({ saleUserId: nghi.id })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect(await bo({ saleUserId: "khong-co-user-nay" })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } })).referrerSaleUserId).toBeNull();
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: k.lead!.id, module: "nguon-hoa-hong" } })).toBe(0);

    // — thiếu quyền ⇒ từ chối. Hold sinh ra TỪ một khoản thu nên lead ĐÃ CÓ thực thu ⇒ đổi người nhận tiền sau thu đòi quyền riêng `sources:override-after-payment`
    expect(await bo({ kiemQuyen: quyen() })).toMatchObject({ ok: false, truong: "quyen" });
    expect(await bo({ kiemQuyen: quyen("leads:overwrite") })).toMatchObject({ ok: false, truong: "quyen" });

    // — hợp lệ
    expect(await bo()).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    const sau = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } });
    expect(sau.referrerSaleUserId).toBe(saleX.id);
    expect(sau.referrerKind).toBe("PARENT"); // phụ huynh giới thiệu giữ nguyên
    expect(sau.signals).not.toMatchObject({ xemTay: expect.arrayContaining(["THIEU_SALE_PH"]) }); // cờ gỡ
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: k.lead!.id, module: "nguon-hoa-hong", action: "DOI_NGUON_SAU_THU" } })).toBe(1);

    // — QUÉT LẠI chính khoản đang bị hold: hold «thiếu Sale» ĐÓNG (RESOLVED). Sổ BẤT BIẾN và khoản này đã có dòng Sale nên phần Sale-PH 2% KHÔNG tự chèn vào sổ cũ: nó hiện thành MỘT hold INPUT_DRIFT
    // (đúng cơ chế «đầu vào đổi sau khi ô được tính» — chờ người duyệt áp hay giữ nguyên) mang đúng người + số tiền.
    const bc = await boiCanh(k, NOW);
    await quetKhoan(db, bc, truoc.khoan);
    const holds = await db.commissionHold.findMany({ where: { paymentId: truoc.khoan }, select: { code: true, status: true, detail: true } });
    expect(holds.find((h) => h.code === "UNRESOLVED_BENEFICIARY")?.status, "hold THIEU_SALE_PHU_HUYNH phải đóng").toBe("RESOLVED");
    const troi = holds.find((h) => h.code === "INPUT_DRIFT");
    expect(troi?.status).toBe("OPEN");
    expect(troi?.detail).toMatchObject({ chenh: [{ key: `REFERRER_PARENT_SALE|USER|${saleX.id}`, chenh: 200_000 }] });
    expect(tomTat(await dongSoCuaKhoan(truoc.khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 }); // sổ cũ KHÔNG bị chèn ngầm

    // — khoản thu MỚI của chính lead này: Sale-PH nhận 2% tự động (đối chứng dương: đường thoát thật sự thông)
    const moi2 = await thu(k, "b", D("2026-11-21"));
    expect(moi2.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT_SALE:${saleX.id}`]: 200_000 });

    // — first-claim: đã có Sale thì đường này KHÔNG đè (kể cả bằng Sale khác hợp lệ)
    const khac = await seedUser({ email: `${k.ma}-khac@ci.test`, role: "SALES_CSM", name: `${k.ma}-khac`, phone: null });
    await lamNhanVien(khac.id, "khac");
    expect(await bo({ saleUserId: khac.id })).toMatchObject({ ok: false, truong: "thamChieu" });
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } })).referrerSaleUserId).toBe(saleX.id);

    // — lead KHÔNG phải do PH giới thiệu ⇒ từ chối
    const k2 = await kb("hold2");
    await ghiNguonQuaDuongThat(k2, { nguonChon: chon((await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" } })).id) }, ATTRIBUTED);
    expect(await bo({ leadId: k2.lead!.id, actor: actorCoSo(nguoiThao.id, [k2.centerId]) })).toMatchObject({ ok: false, truong: "thamChieu" });

    // — lead của cơ sở KHÁC ⇒ y hệt «không tồn tại», không lộ gì
    expect(await bo({ actor: actorCoSo(nguoiThao.id, ["co-so-khac"]), leadId: k.lead!.id })).toEqual({ ok: false, loi: "Lead không tồn tại.", truong: "lead" });
  });
});
