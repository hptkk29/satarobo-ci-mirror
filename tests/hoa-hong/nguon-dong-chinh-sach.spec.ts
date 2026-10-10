// @vitest-environment node
/**
 * [DYN-*] — CA NGHIỆM THU «NGUỒN ĐỘNG» phía CHÍNH SÁCH + SỔ (Postgres THẬT; service/engine THẬT, không giả lập lõi). Yêu cầu #53–#62 của chủ dự án 09/10/2026.
 * Mọi nguồn do test TẠO bằng `taoNguon` (mã `DYN_*`) — KHÔNG migration, KHÔNG sửa mã: đó chính là điều cần chứng minh.
 *
 *   [DYN-01] #53 admin tạo nguồn X → ACTIVE → chọn được → chính sách phạm vi X (tạo + KÍCH HOẠT qua guardrail thật) → thanh toán NEW → quét → sổ đúng người/tỉ lệ + «Vì sao»
 *   [DYN-02] #54 nguồn commissionEnabled=false: lead gán được, báo cáo đọc được; KHÔNG dòng thu hút; Sale/QLCS/GV Trial theo chính sách chung VẪN chạy; kích hoạt chính sách riêng bị CHẶN
 *   [DYN-03] #55 nguồn có người phụ trách là nhân sự cụ thể (vai SOURCE_OWNER) 1,5% NEW ⇒ dòng sổ về đúng nhân sự
 *   [DYN-03b] bỏ trống người phụ trách của nguồn đang có rule SOURCE_OWNER chạy ⇒ CHẶN (tránh hold vĩnh viễn); đổi người / nguồn không có rule ⇒ qua
 *   [DYN-03c] rule SOURCE_OWNER ở phạm vi CHUNG khi có nguồn đang hoạt động chưa khai chủ ⇒ kích hoạt bị CHẶN; khai đủ chủ ⇒ qua; REFERRER_PARENT_SALE ở phạm vi chung ⇒ không chặn
 *   [DYN-04] #56 chung Sale NEW 3% + nguồn tuỳ chỉnh Marketing 1,5% ⇒ Sale 3% VÀ Marketing 1,5% (rule nguồn không xoá rule Sale)
 *   [DYN-05] #57 chính sách nguồn cộng với chung > trần 9% ⇒ BLOCK `VUOT_TRAN`, bản nháp còn DRAFT, không cắt
 *   [DYN-09] #61 PAID_ADS NEW ⇒ 1% về CHỦ NGUỒN (Marketing chỉ cho nguồn quảng cáo, thay cho Marketing cơ sở) — rule lấy từ KẾ HOẠCH SEED thật (không gõ tay 1%)
 *   [DYN-10] #62 nhân sự seeding công ty (CENTER_ORGANIC) ⇒ KHÔNG 2%; nhân sự giới thiệu cá nhân (EMPLOYEE_REFERRAL) ⇒ CÓ 2% (policy kích hoạt, trần nâng trong fixture)
 *   [DYN-13] thử tính (mô phỏng) với nguồn tuỳ chỉnh + chính sách DRAFT chạy trước kích hoạt; vượt trần 9% hiện thành vi phạm
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng; tiền điều kiện của ca kích hoạt thật nằm ở `lamSachChinhSach()` + `baoDamNguoiPhuTrach()` (xem `_nguon-dong.ts`).
 * LUẬT 19: ngày tuyệt đối. Tệp chạy được MỘT MÌNH trên DB trống đã migrate + seed vai.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docViSaoDayDu } from "../../lib/hoa-hong/vi-sao-doc";
import { lapKeHoachSeedV1 } from "../../lib/hoa-hong/ke-hoach-seed-v1";
import { thuTinhPhienBan } from "../../lib/hoa-hong/mo-phong-hanh-dong";
import { docDaDung } from "../../lib/nguon/danh-muc-ghi";
import { doiTrangThaiNguon, suaNguon, taoNguon } from "./_nguon-dong";
import { locNhomChon } from "../../lib/nguon/chon-nguon";
import { thuThapTinHieuTheoLo } from "../../lib/nguon/thu-thap-tin-hieu";
import { layBangNguonTheoPage, layNhomNhanSuMacDinh } from "../../lib/nguon/feature";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import {
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
  themGvTrial,
  themChinhSachNhom,
  tienVe,
  tomTat,
  type KichBan,
} from "./_kich-ban";
import {
  baoDamNguoiPhuTrach,
  chinhSachNguonQuaService,
  datTranHoaHong,
  dongNhap,
  donNguoiPhuTrach,
  ghiNguonQuaDuongThat,
  lamSachChinhSach,
  rule,
  themLead,
  thuKichHoat,
  chiTietChanKichHoat,
  trangThaiPhienBan,
} from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DYN] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-dyn-cs";
const NOW = D("2027-02-20");
const NGAY_THU = D("2026-11-20");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
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

/** TẠO NGUỒN bằng writer thật — đây là toàn bộ «cấu hình» mà admin làm: không migration, không sửa mã. */
async function taoNguonDyn(hau: string, ghi: Record<string, unknown> = {}) {
  stamp += 1;
  const code = `DYN_${hau}_${Date.now().toString(36).toUpperCase()}${stamp}`;
  const r = await taoNguon({ nguoi: admin, vao: { ...MAU, code, name: `DYN ${hau}`, ...ghi } });
  if (!r.ok) throw new Error(`taoNguon(${hau}): ${r.truong}: ${r.loi}`);
  return { id: r.id, code: r.code, updatedAt: new Date(r.updatedAt) };
}

/** Người + nhân sự có tài khoản (điều kiện để dòng sổ của họ nhận được). */
async function nhanSuCoTaiKhoan(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  const employeeId = await lamNhanVien(u.id, `${k.ma}-${hau}`);
  return { userId: u.id, employeeId };
}

/** Một khoản NEW 10.000.000 đ đã xác nhận → quét bằng engine thật → trả `{ khoan, dong, tom }`. */
async function thuVaQuet(k: KichBan, ten: string, ngay: Date = NGAY_THU, leadChildId: string | null = null) {
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, ten, { tongTien: 10_000_000, leadChildId });
  const khoan = await tienVe(k, be, { soTien: 10_000_000, ngay });
  await quetKhoan(db, bc, khoan);
  const dong = await dongSoCuaKhoan(khoan);
  return { khoan, dong, tom: tomTat(dong) };
}

describe.skipIf(!RUN_DB_TESTS)("[DYN] nghiệm thu nguồn động — chính sách + sổ", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db); // cần UNKNOWN + 8 nguồn mặc định (luật 18: không mượn danh mục do bộ trước để lại)
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
    await datTranHoaHong(null);
    await donKichBan(cuaToi);
    await donNguoiPhuTrach(NHAN);
    // lead PHỤ do `themLead` dựng không nằm trong `cuaToi` ⇒ dọn quy nguồn của chúng theo nhóm DYN_ (FK Restrict sang LeadSourceGroup)
    const nhomDyn = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "DYN_" } }, select: { id: true } })).map((g) => g.id);
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhomDyn } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhomDyn } }, { originalGroupId: { in: nhomDyn } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DYN_" } } });
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: NHAN } } });
    await datMocCutover(null);
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[DYN-01] #53 admin TẠO nguồn X bằng dữ liệu → chọn được → chính sách phạm vi X (tạo + KÍCH HOẠT qua guardrail thật) → tiền NEW → sổ có đúng người/tỉ lệ + «Vì sao» giải thích được", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d01", { rules: [{ vai: "SALE", rate: 0.04 }] });

    // 1. TẠO — không migration, không sửa mã. Trước khi tạo, bảng chưa có dòng nào mang mã này.
    expect(await db.leadSourceGroup.count({ where: { code: { startsWith: "DYN_X_" } } })).toBe(0);
    const x = await taoNguonDyn("X", { commissionEnabled: true });
    expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ status: "ACTIVE", isSystem: false, documentNo: null, commissionEnabled: true });

    // 2. CHỌN ĐƯỢC: ở ô chọn (danh mục lọc) và ở tầng thu thập tín hiệu của đường nhập (không `loi`).
    const rows = await db.leadSourceGroup.findMany({ select: { id: true, code: true, name: true, description: true, referrerRequirement: true, requiresNote: true, selectable: true, status: true, sortOrder: true, effectiveFrom: true, effectiveTo: true } });
    expect(locNhomChon(rows, NOW).map((n) => n.code)).toContain(x.code);
    const thu = await thuThapTinHieuTheoLo(db, [dongNhap(k, { nguonChon: { groupId: x.id, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } })]);
    expect(thu.tin[0]!.nguonChon).toMatchObject({ groupCode: x.code, loi: null });
    // …và GHI được attribution bằng chính đường nhập (nguồn thứ 10 mà lõi chưa từng nghe tên)
    const a = await ghiNguonQuaDuongThat(k, { nguonChon: { groupId: x.id, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED);
    expect(a.group.code).toBe(x.code);
    expect(a.matchedRule).toBe("CHON_NGUON");

    // 3. CHÍNH SÁCH phạm vi X: tạo + kích hoạt bằng service THẬT (guardrail đọc toàn tập ACTIVE + mọi cơ sở).
    const cs = await chinhSachNguonQuaService(k, { hau: "x", sourceGroupId: x.id, rules: [rule("MARKETING", 0.015)] });
    expect(await trangThaiPhienBan(cs.versionId)).toBe("DRAFT");
    expect(await thuKichHoat(cs.versionId)).toEqual([]);
    expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");

    // 4. TIỀN → QUÉT → SỔ.
    const { dong, tom } = await thuVaQuet(k, "a");
    expect(tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`MARKETING:${k.qc.id}`]: 150_000 });
    const mkt = dong.find((d) => d.roleCode === "MARKETING")!;
    expect(mkt).toMatchObject({ sourceGroupCode: x.code, amount: 150_000, entryKind: "ORIGINAL" });
    expect(Number(mkt.rate)).toBeCloseTo(0.015, 6);
    expect(mkt.documentNumber).toBe(cs.documentCode); // dòng sổ chụp VĂN BẢN của chính sách nguồn, không phải của chính sách chung

    // 5. «Vì sao con số này» — HO đọc được, nói đúng người/số tiền/nguồn.
    const visao = await docViSaoDayDu((await nguoiKyHo()).quyen, mkt.id);
    expect(visao).not.toBeNull();
    expect(visao!.tomTat).toMatchObject({ soTien: 150_000 });
    const chuoi = JSON.stringify(visao!.muc);
    expect(chuoi).toContain("DYN X"); // tên nguồn do admin đặt
    expect(chuoi).toContain(cs.documentCode);

    // 6. Sổ đã tham chiếu nguồn ⇒ nguồn thành «đã dùng»: mã không đổi được nữa (đo cả đường ĐỌC lẫn đường GHI).
    const dung = await docDaDung(db, x, { bangPage: await layBangNguonTheoPage(), nhomMacDinh: await layNhomNhanSuMacDinh() });
    expect(dung).toMatchObject({ so: true, attribution: true, phienBanChinhSach: true, daDung: true });
    expect(await suaNguon({ nguoi: admin, id: x.id, updatedAtDaThay: (await db.leadSourceGroup.findUniqueOrThrow({ where: { id: x.id } })).updatedAt, vao: { code: `${x.code}_2` }, lyDo: "đổi mã thử sau khi đã có sổ" })).toMatchObject({ ok: false, truong: "code" });
  });

  it("[DYN-02] #54 nguồn commissionEnabled=false: gán được lead + đọc được; KHÔNG dòng thu hút; Sale/QLCS/GV Trial theo chính sách chung VẪN chạy; chính sách riêng bị CHẶN khi kích hoạt và BẤT HOẠT khi tồn tại", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d02"); // chính sách chung SEED_V1: Sale 4 · Sale Admin 1 · QLCS 2 · Marketing 1 · GV Trial 1 = 9%
    const y = await taoNguonDyn("Y", { commissionEnabled: false });
    const gv = await seedUser({ email: `${k.ma}-gv@ci.test`, role: "TEACHER", name: `${k.ma}-gv`, phone: null });
    const leadChildId = await themGvTrial(k, gv.id);

    // lead gán được vào nguồn Y bằng đường nhập thật
    const a = await ghiNguonQuaDuongThat(k, { nguonChon: { groupId: y.id, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED);
    expect(a.group.code).toBe(y.code);

    // chính sách riêng của Y: KHÔNG kích hoạt được (guardrail nói đúng lý do), bản nháp còn DRAFT
    const cs = await chinhSachNguonQuaService(k, { hau: "y", sourceGroupId: y.id, rules: [rule("MARKETING", 0.02)] });
    expect(await thuKichHoat(cs.versionId)).toContain("NGUON_KHONG_THAM_GIA_HOA_HONG");
    expect(await trangThaiPhienBan(cs.versionId)).toBe("DRAFT");

    // dù lách bằng cách chèn thẳng một phiên bản ACTIVE (dữ liệu cũ / tay): engine BỎ QUA rule nguồn Y ⇒ Marketing vẫn 1% của chính sách chung, không 0,5% của rule nguồn
    await themChinhSachNhom(k, y.code, [{ vai: "MARKETING", rate: 0.005 }]);
    const { tom } = await thuVaQuet(k, "a", NGAY_THU, leadChildId);
    expect(tom).toEqual({
      [`SALE:${k.sale.id}`]: 400_000,
      [`SALE_ADMIN:${k.saleAdmin.id}`]: 100_000,
      [`CENTER_MANAGER:${k.qlcs.id}`]: 200_000,
      [`MARKETING:${k.qc.id}`]: 100_000,
      [`TRIAL_TEACHER:${gv.id}`]: 100_000,
    });
    expect(Object.keys(tom).some((x) => x.startsWith("REFERRER_") || x.startsWith("SOURCE_OWNER"))).toBe(false);

    // ĐỌC được: danh mục + thống kê vẫn đếm lead của nguồn Y (nguồn không tham gia hoa hồng ≠ nguồn bị giấu)
    const lead = await db.lead.findUniqueOrThrow({ where: { id: k.lead!.id }, select: { attribution: { select: { group: { select: { code: true, name: true } } } } } });
    expect(lead.attribution?.group).toMatchObject({ code: y.code, name: "DYN Y" });
    // đối chứng dương: bật cờ cho Y ⇒ rule nguồn chạy (Marketing 0,5% của rule nguồn thắng 1% chung)
    await suaNguon({ nguoi: admin, id: y.id, updatedAtDaThay: (await db.leadSourceGroup.findUniqueOrThrow({ where: { id: y.id } })).updatedAt, vao: { commissionEnabled: true }, lyDo: "bật hoa hồng theo nguồn cho Y" });
    const sau = await thuVaQuet(k, "b", D("2026-11-21"), leadChildId);
    expect(sau.tom[`MARKETING:${k.qc.id}`]).toBe(50_000);
  });

  it("[DYN-03] #55 nguồn Z có NHÂN SỰ phụ trách cụ thể (SOURCE_OWNER) 1,5% NEW ⇒ dòng sổ về đúng nhân sự đó", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d03", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const chu = await nhanSuCoTaiKhoan(k, "chu");
    const nguoiKhac = await nhanSuCoTaiKhoan(k, "khac");
    const z = await taoNguonDyn("Z", { commissionEnabled: true, ownerEmployeeId: chu.employeeId });
    await ghiNguonQuaDuongThat(k, { nguonChon: { groupId: z.id, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED);
    const cs = await chinhSachNguonQuaService(k, { hau: "z", sourceGroupId: z.id, rules: [rule("SOURCE_OWNER", 0.015)] });
    expect(await thuKichHoat(cs.versionId)).toEqual([]);

    const { dong, tom } = await thuVaQuet(k, "a");
    expect(tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${chu.userId}`]: 150_000 });
    expect(dong.find((d) => d.roleCode === "SOURCE_OWNER")).toMatchObject({ beneficiaryUserId: chu.userId, sourceGroupCode: z.code });
    expect(Object.keys(tom).some((x) => x.includes(nguoiKhac.userId))).toBe(false);

    // đổi người phụ trách (writer có audit): lead ĐÃ ghi nguồn GIỮ chủ lúc ghi nhận (bản chụp `signals.nguon` — res4-1), lead ghi SAU đó theo chủ mới; khoản cũ không đổi
    const dongCu = dong.map((d) => d.id).sort();
    const ok = await suaNguon({ nguoi: admin, id: z.id, updatedAtDaThay: (await db.leadSourceGroup.findUniqueOrThrow({ where: { id: z.id } })).updatedAt, vao: { ownerEmployeeId: nguoiKhac.employeeId }, lyDo: "chuyển phụ trách sang đội khác" });
    expect(ok).toMatchObject({ ok: true, doi: true });
    const cuaLeadCu = await thuVaQuet(k, "b", D("2026-11-21"));
    expect(cuaLeadCu.tom[`SOURCE_OWNER:${chu.userId}`]).toBe(150_000); // lead đã ghi nguồn: vẫn chủ cũ
    expect(cuaLeadCu.tom[`SOURCE_OWNER:${nguoiKhac.userId}`]).toBeUndefined();
    const k2 = await themLead(k, "moi");
    await ghiNguonQuaDuongThat(k2, { nguonChon: { groupId: z.id, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED, k2.lead!.id);
    const moi = await thuVaQuet(k2, "c", D("2026-11-22"));
    expect(moi.tom[`SOURCE_OWNER:${nguoiKhac.userId}`]).toBe(150_000); // lead ghi SAU khi đổi: chủ mới
    expect(moi.tom[`SOURCE_OWNER:${chu.userId}`]).toBeUndefined();
    expect((await dongSoCuaKhoan(dong[0]!.paymentId!)).map((d) => d.id).sort()).toEqual(dongCu);
  });

  it("[DYN-03b] nguồn có chính sách SOURCE_OWNER ĐANG CHẠY: bỏ trống người phụ trách ⇒ CHẶN dù có quyền kích hoạt (hold vĩnh viễn); đổi sang người khác ⇒ qua; nguồn KHÔNG có rule ⇒ bỏ trống được", async () => {
    // Cấy: bỏ lời gọi `chanBoChuNguon` ở `suaNguon` ⇒ lượt bỏ trống lọt qua (đỏ). Cấy: bỏ vế `scopeSourceGroupId` khỏi truy vấn ⇒ nguồn có rule riêng không bị chặn (đỏ).
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d03b", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const chu = await nhanSuCoTaiKhoan(k, "chu");
    const khac = await nhanSuCoTaiKhoan(k, "khac");
    const z = await taoNguonDyn("ZB", { commissionEnabled: true, ownerEmployeeId: chu.employeeId });
    const cs = await chinhSachNguonQuaService(k, { hau: "zb", sourceGroupId: z.id, rules: [rule("SOURCE_OWNER", 0.015)] });
    expect(await thuKichHoat(cs.versionId)).toEqual([]);
    const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
    const owner = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).ownerEmployeeId;

    const bo = await suaNguon({ nguoi: admin, id: z.id, updatedAtDaThay: await moiNhat(z.id), vao: { ownerEmployeeId: null }, lyDo: "bỏ trống người phụ trách", coQuyenKichHoat: true });
    expect(bo).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    expect(bo.ok === false && bo.loi).toContain("hàng chờ");
    expect(await owner(z.id), "chủ giữ nguyên").toBe(chu.employeeId);
    // đối chứng dương 1: đổi sang NGƯỜI KHÁC vẫn được
    expect(await suaNguon({ nguoi: admin, id: z.id, updatedAtDaThay: await moiNhat(z.id), vao: { ownerEmployeeId: khac.employeeId }, lyDo: "chuyển phụ trách", coQuyenKichHoat: true })).toMatchObject({ ok: true, doi: true });
    expect(await owner(z.id)).toBe(khac.employeeId);
    // đối chứng dương 2: nguồn KHÁC không có rule SOURCE_OWNER của riêng nó (rule của Z không liên quan) ⇒ bỏ trống được
    const zc = await taoNguonDyn("ZC", { commissionEnabled: true, ownerEmployeeId: chu.employeeId });
    const rZc = await suaNguon({ nguoi: admin, id: zc.id, updatedAtDaThay: await moiNhat(zc.id), vao: { ownerEmployeeId: null }, lyDo: "bỏ trống người phụ trách", coQuyenKichHoat: true });
    expect(rZc, JSON.stringify(rZc)).toMatchObject({ ok: true, doi: true });
    expect(await owner(zc.id)).toBeNull();
  });

  it("[DYN-03c] rule SOURCE_OWNER ở phạm vi CHUNG: còn nguồn đang hoạt động chưa khai chủ ⇒ KÍCH HOẠT BỊ CHẶN (NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH), nháp còn DRAFT; khai đủ chủ ⇒ qua; REFERRER_PARENT_SALE ở phạm vi chung ⇒ không chặn", async () => {
    // Cấy: bỏ nhánh `else if (q.scopeType !== "SOURCE_GROUP" && …SOURCE_OWNER)` ở guardrail ⇒ ca đầu lọt (đỏ).
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const chuaChu = await db.leadSourceGroup.findMany({ where: { status: "ACTIVE", ownerEmployeeId: null }, select: { id: true } });
    const k = await kb("d03c", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const chu = await nhanSuCoTaiKhoan(k, "chu");
    expect(chuaChu.length, "tiền đề: có nguồn ACTIVE chưa khai chủ (PAID_ADS…)").toBeGreaterThan(0);
    const cs = await chinhSachNguonQuaService(k, { hau: "g1", sourceGroupId: null, rules: [rule("SOURCE_OWNER", 0.01)] });
    const chan = await thuKichHoat(cs.versionId);
    expect(chan).toContain("NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH");
    expect(await trangThaiPhienBan(cs.versionId)).toBe("DRAFT");

    // REFERRER_PARENT_SALE ở phạm vi chung: không bị luật này (nguồn không phải PARENT chỉ treo im lặng) — cùng tập nguồn
    const rps = await chinhSachNguonQuaService(k, { hau: "g2", sourceGroupId: null, rules: [rule("REFERRER_PARENT_SALE", 0.01)] });
    expect(await thuKichHoat(rps.versionId)).toEqual([]);
    expect(await trangThaiPhienBan(rps.versionId)).toBe("ACTIVE");

    // đối chứng dương: khai chủ cho MỌI nguồn đang hoạt động ⇒ rule chung kích hoạt được (rồi khôi phục chủ cũ — danh mục dùng chung)
    try {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: chu.employeeId } });
      await db.commissionPolicyVersion.update({ where: { id: rps.versionId }, data: { status: "CANCELLED" } });
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");
      // rule SOURCE_OWNER CHUNG đã chạy ⇒ nguồn nào cũng không bỏ trống chủ được (nhánh «rule không gắn nguồn» của truy vấn ở `suaNguon`)
      const dich = chuaChu[0]!.id;
      const updatedAtDaThay = (await db.leadSourceGroup.findUniqueOrThrow({ where: { id: dich } })).updatedAt;
      expect(await suaNguon({ nguoi: admin, id: dich, updatedAtDaThay, vao: { ownerEmployeeId: null }, lyDo: "bỏ trống người phụ trách", coQuyenKichHoat: true })).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    } finally {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: null } });
    }
  });

  it("[DYN-03d] rule SOURCE_OWNER ở phạm vi CHUNG đang chạy: TẠO nguồn Hoạt động không người phụ trách ⇒ CHẶN; có người ⇒ qua; tạo ở Nháp ⇒ qua; KÍCH HOẠT nguồn nháp chưa có người ⇒ CHẶN, khai người rồi ⇒ qua", async () => {
    // Cấy: bỏ lời gọi `chanNguonHoatDongKhongChu` ở `taoNguon` (hoặc ở `doiTrangThaiNguon`) ⇒ lượt tương ứng lọt qua (đỏ) và để lại nguồn tạo hold vĩnh viễn.
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const chuaChu = await db.leadSourceGroup.findMany({ where: { status: "ACTIVE", ownerEmployeeId: null }, select: { id: true } });
    const k = await kb("d03d", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const chu = await nhanSuCoTaiKhoan(k, "chu");
    const cs = await chinhSachNguonQuaService(k, { hau: "g4", sourceGroupId: null, rules: [rule("SOURCE_OWNER", 0.01)] });
    try {
      // dọn đường để rule chung kích hoạt được (guardrail đòi mọi nguồn đang hoạt động có chủ), rồi khôi phục ở finally
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: chu.employeeId } });
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");

      const code = (hau: string) => `DYN_${hau}_${Date.now().toString(36).toUpperCase()}${(stamp += 1)}`;
      // TẠO Hoạt động, không người ⇒ chặn, và KHÔNG có dòng nào được tạo
      const truoc = await db.leadSourceGroup.count();
      const chan = await taoNguon({ nguoi: admin, vao: { ...MAU, code: code("ZD1"), name: "DYN ZD1", ownerEmployeeId: null } });
      expect(chan).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
      expect(await db.leadSourceGroup.count(), "chặn thì không tạo dòng").toBe(truoc);
      // đối chứng dương: có người ⇒ qua; Nháp không người ⇒ qua
      expect((await taoNguon({ nguoi: admin, vao: { ...MAU, code: code("ZD2"), name: "DYN ZD2", ownerEmployeeId: chu.employeeId } })).ok).toBe(true);
      const nhap = await taoNguon({ nguoi: admin, vao: { ...MAU, code: code("ZD3"), name: "DYN ZD3", trangThai: "DRAFT", ownerEmployeeId: null } });
      expect(nhap.ok).toBe(true);
      if (!nhap.ok) return;
      // KÍCH HOẠT nguồn nháp chưa có người ⇒ chặn (vẫn DRAFT); khai người rồi kích hoạt ⇒ qua
      const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
      const bat = async () => doiTrangThaiNguon({ nguoi: admin, id: nhap.id, updatedAtDaThay: await moiNhat(nhap.id), den: "ACTIVE", lyDo: "kích hoạt nguồn thử" });
      expect(await bat()).toMatchObject({ ok: false, truong: "trangThai" });
      expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nhap.id } })).status).toBe("DRAFT");
      expect(await suaNguon({ nguoi: admin, id: nhap.id, updatedAtDaThay: await moiNhat(nhap.id), vao: { ownerEmployeeId: chu.employeeId }, lyDo: "khai người phụ trách" })).toMatchObject({ ok: true });
      expect(await bat()).toMatchObject({ ok: true });
    } finally {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: null } });
    }
  });

  it("[DYN-04] #56 chung Sale NEW 3% + nguồn tuỳ chỉnh Marketing 1,5% ⇒ Sale 3% VÀ Marketing 1,5% (rule nguồn KHÔNG xoá rule Sale)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d04", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const w = await taoNguonDyn("W", { commissionEnabled: true });
    await ghiNguonQuaDuongThat(k, { nguonChon: { groupId: w.id, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED);
    const cs = await chinhSachNguonQuaService(k, { hau: "w", sourceGroupId: w.id, rules: [rule("MARKETING", 0.015)] });
    expect(await thuKichHoat(cs.versionId)).toEqual([]);
    const { tom } = await thuVaQuet(k, "a");
    expect(tom).toEqual({ [`SALE:${k.sale.id}`]: 300_000, [`MARKETING:${k.qc.id}`]: 150_000 });
  });

  it("[DYN-05] #57 chính sách nguồn cộng với chính sách chung > trần 9% ⇒ BLOCK VUOT_TRAN (không tự cắt): nháp còn DRAFT, sổ không có dòng; nâng trần ở cấu hình ⇒ kích hoạt được", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d05"); // chung 9% đúng bằng trần
    const nv = await nhanSuCoTaiKhoan(k, "gt");
    const v = await taoNguonDyn("V", { commissionEnabled: true, referrerRequirement: "EMPLOYEE" });
    const cs = await chinhSachNguonQuaService(k, { hau: "v", sourceGroupId: v.id, rules: [rule("REFERRER_EMPLOYEE", 0.02)] });
    expect(await thuKichHoat(cs.versionId)).toContain("VUOT_TRAN");
    expect(await trangThaiPhienBan(cs.versionId)).toBe("DRAFT");
    // CHỈ ĐƯỜNG (chủ dự án 09/10/2026: nâng trần là thao tác của admin): lỗi mang tổng · trần hiện tại · chênh lệch · liên kết tới Cấu hình vận hành
    const vt = (await chiTietChanKichHoat(cs.versionId)).find((x) => x.ma === "VUOT_TRAN");
    expect(vt?.huongXuLy).toMatchObject({ tongPhanTram: "11", tranPhanTram: "9", chenhLechPhanTram: "2", coTheNangTran: true, duongDan: { href: "/cau-hinh-van-hanh?tab=khach-hang" } });
    expect(vt?.thongBao).toContain("trần hiện tại 9%");
    expect(vt?.thongBao).toContain("Quản trị hệ thống");
    // không cắt: không có dòng nào của vai thu hút, kể cả khi lead thật sự thuộc nguồn V
    await ghiNguonQuaDuongThat(k, { nguonChon: { groupId: v.id, employeeId: nv.employeeId, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED);
    const { tom } = await thuVaQuet(k, "a");
    expect(Object.keys(tom).some((x) => x.startsWith("REFERRER_EMPLOYEE:"))).toBe(false);
    expect(tom[`SALE:${k.sale.id}`]).toBe(400_000); // chính sách chung nguyên vẹn, không bị «cắt cho vừa»

    // đối chứng dương: nâng trần lên 11% bằng CẤU HÌNH ⇒ cùng bản nháp kích hoạt được
    try {
      await datTranHoaHong(0.11);
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");
    } finally {
      await datTranHoaHong(null);
    }
  });

  it("[DYN-09] #61 PAID_ADS NEW ⇒ 1% về CHỦ NGUỒN (SOURCE_OWNER), không còn Marketing theo cơ sở: rule lấy từ KẾ HOẠCH SEED thật (không gõ tay), chạy bằng nguồn gốc PAID_ADS", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d09", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const chu = await nhanSuCoTaiKhoan(k, "chu");
    const muc = lapKeHoachSeedV1().chinhSach.find((c) => c.maNhom === "PAID_ADS")!;
    expect(muc.kichHoat).toBe(false); // tám chính sách theo nguồn đều NHÁP: kích hoạt là việc của người có thẩm quyền
    expect(muc.rules.map((r) => [r.roleCode, r.calcKind, r.rate])).toEqual([["SOURCE_OWNER", "PERCENT", 0.01], ["MARKETING", "EXCLUDE", null]]);
    const nhom = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "PAID_ADS" }, select: { id: true, commissionEnabled: true, updatedAt: true } });
    expect(nhom.commissionEnabled).toBe(true);
    try {
      const khai = await suaNguon({ nguoi: admin, id: nhom.id, updatedAtDaThay: nhom.updatedAt, vao: { ownerEmployeeId: chu.employeeId }, lyDo: "khai chủ nguồn quảng cáo cho ca nghiệm thu" });
      expect(khai, JSON.stringify(khai)).toMatchObject({ ok: true });
      const cs = await chinhSachNguonQuaService(k, { hau: "ads", sourceGroupId: nhom.id, rules: muc.rules });
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      await ghiNguonQuaDuongThat(k, { duongVao: "facebook", conversionEntry: "facebook", quangCao: { adId: "ad-1", campaignId: "cp-1", adsetId: null, campaignName: "Camp", formId: null, fbclid: null, gclid: null } }, ATTRIBUTED);
      const a = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id }, include: { group: { select: { code: true } } } });
      expect(a.group.code).toBe("PAID_ADS");
      const { dong, tom } = await thuVaQuet(k, "a");
      expect(tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${chu.userId}`]: 100_000 });
      expect(Object.keys(tom).some((x) => x.startsWith("MARKETING:"))).toBe(false); // người phụ trách Marketing của cơ sở không được trả ở nguồn quảng cáo
      expect(dong.find((d) => d.roleCode === "SOURCE_OWNER")).toMatchObject({ sourceGroupCode: "PAID_ADS", documentNumber: cs.documentCode });
    } finally {
      await lamSachChinhSach();
      await db.leadSourceGroup.update({ where: { id: nhom.id }, data: { ownerEmployeeId: null } });
    }
  });

  it("[DYN-10] #62 nhân sự làm seeding công ty (CENTER_ORGANIC) ⇒ KHÔNG 2%; nhân sự giới thiệu cá nhân (EMPLOYEE_REFERRAL) ⇒ CÓ 2% — policy kích hoạt ở fixture, trần nâng đủ cho tổng đo được (Marketing loại ở nguồn này)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d10"); // chung 9%
    const e = await nhanSuCoTaiKhoan(k, "e");
    await ganVai(e.userId, k.ouId, "CENTER_SALES_CSM");
    const muc = lapKeHoachSeedV1().chinhSach.find((c) => c.maNhom === "EMPLOYEE_REFERRAL")!;
    expect(muc.kichHoat).toBe(false); // mặc định DRAFT vì cộng chung vượt trần — ca này nâng trần có chủ đích
    const nhomNv = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "EMPLOYEE_REFERRAL" }, select: { id: true } });
    const cs = await chinhSachNguonQuaService(k, { hau: "nv", sourceGroupId: nhomNv.id, rules: muc.rules });
    try {
      expect(await thuKichHoat(cs.versionId), "ở trần mặc định 9% thì chặn").toContain("VUOT_TRAN");
      await datTranHoaHong(0.1); // tổng cao nhất của nguồn này: 9% chung − 1% Marketing (bị loại) + 2% = 10%
      expect(await thuKichHoat(cs.versionId)).toEqual([]);

      // (a) nhân sự seeding cho công ty: nhóm CENTER_ORGANIC (không kiểu nhân sự, không rule thu hút) ⇒ không 2%
      const organic = await ghiNguonQuaDuongThat(k, { nhanKhai: "seeding", nguonChon: { groupId: (await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "CENTER_ORGANIC" }, select: { id: true } })).id, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED);
      expect(organic.group.code).toBe("CENTER_ORGANIC");
      const a = await thuVaQuet(k, "a");
      expect(Object.keys(a.tom).some((x) => x.startsWith("REFERRER_EMPLOYEE:"))).toBe(false);
      expect(a.tom[`SALE:${k.sale.id}`]).toBe(400_000);

      // (b) nhân sự giới thiệu CÁ NHÂN (cùng nhân sự E): nhóm EMPLOYEE_REFERRAL ⇒ E nhận 2% = 200.000
      const k2 = await themLead(k, "gt");
      cuaToi.push(k2);
      const canhan = await ghiNguonQuaDuongThat(k2, { nhanSuGioiThieuEmployeeId: e.employeeId }, ATTRIBUTED, k2.lead!.id);
      expect(canhan.group.code).toBe("EMPLOYEE_REFERRAL");
      expect(canhan.referrerRoleCode).toBe("SALE"); // ảnh chụp vai do đường nhập tính ra, không do ca gõ tay
      const b = await thuVaQuet(k2, "b", D("2026-11-21"));
      expect(b.tom[`REFERRER_EMPLOYEE:${e.userId}`]).toBe(200_000);
      expect(b.tom[`SALE:${k.sale.id}`]).toBe(400_000);
    } finally {
      await datTranHoaHong(null);
    }
  });

  it("[DYN-13] thử tính (mô phỏng) với nguồn tuỳ chỉnh + chính sách DRAFT chạy ĐƯỢC trước khi kích hoạt, và vượt trần 9% hiện thành vi phạm (hiện hành: 0; đề xuất: ≥ 1)", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await kb("d13"); // chung 9%
    const nv = await nhanSuCoTaiKhoan(k, "gt");
    await ganVai(nv.userId, k.ouId, "CENTER_SALES_CSM");
    const t = await taoNguonDyn("T", { commissionEnabled: true, referrerRequirement: "EMPLOYEE" });
    await ghiNguonQuaDuongThat(k, { nguonChon: { groupId: t.id, employeeId: nv.employeeId, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } }, ATTRIBUTED);
    const cs = await chinhSachNguonQuaService(k, { hau: "t", sourceGroupId: t.id, rules: [rule("REFERRER_EMPLOYEE", 0.02)] });
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-11-10") });
    expect(await trangThaiPhienBan(cs.versionId)).toBe("DRAFT"); // chưa kích hoạt

    const nguoi = await nguoiKyHo();
    const r = await thuTinhPhienBan({ actor: nguoi.quyen, now: D("2026-11-30"), versionId: cs.versionId, tuNgay: "2026-11-01", denNgay: "2026-11-30", orgUnitId: k.ouId });
    expect(r.ok, r.ok ? "" : r.chung).toBe(true);
    if (!r.ok) return;
    expect(r.ketQua.soKhoanTinhDuoc).toBeGreaterThanOrEqual(1);
    expect(r.ketQua.hoaHong.hienTai).toBe(800_000); // Sale 4 + Admin 1 + QLCS 2 + Marketing 1 = 8% của 10 triệu (ca không có GV Trial nên chưa đủ 9%)
    // Trần so theo TỈ LỆ CẤU HÌNH của bộ rule (chung 9% kể cả GV Trial) + 2% = 11% > trần 9% ⇒ vi phạm HIỆN RA ngay ở thử tính (hiện hành 0, đề xuất ≥ 1)
    // và khoản bị CHẶN NGUYÊN, không tự cắt cho vừa: đề xuất = 0 đồng.
    expect(r.ketQua.tran.hienTai.soKhoan).toBe(0);
    expect(r.ketQua.tran.deXuat.soKhoan).toBeGreaterThanOrEqual(1);
    expect(r.ketQua.hoaHong.deXuat).toBe(0);
    expect(r.ketQua.phanRa.nguon.some((n) => n.khoa !== "UNKNOWN")).toBe(true);

    // đối chứng dương: nâng trần lên 9,5% bằng cấu hình + đề xuất 0,5% ⇒ KHÔNG vi phạm, chênh đúng +0,5% của 10 triệu = 50.000
    try {
      await datTranHoaHong(0.095);
      const nho = await chinhSachNguonQuaService(k, { hau: "t2", sourceGroupId: t.id, rules: [rule("REFERRER_EMPLOYEE", 0.005)] });
      const r2 = await thuTinhPhienBan({ actor: nguoi.quyen, now: D("2026-11-30"), versionId: nho.versionId, tuNgay: "2026-11-01", denNgay: "2026-11-30", orgUnitId: k.ouId });
      expect(r2.ok, r2.ok ? "" : r2.chung).toBe(true);
      if (r2.ok) {
        expect(r2.ketQua.tran.deXuat.soKhoan).toBe(0);
        expect(r2.ketQua.hoaHong.chenh).toBe(50_000);
      }
    } finally {
      await datTranHoaHong(null);
    }
    expect(await trangThaiPhienBan(cs.versionId)).toBe("DRAFT"); // thử tính KHÔNG kích hoạt, không ghi sổ
    expect(await db.commissionTransaction.count({ where: { sourceGroupCode: t.code } })).toBe(0);
  });
});
