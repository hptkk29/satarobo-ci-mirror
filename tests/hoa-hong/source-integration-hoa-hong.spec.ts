// @vitest-environment node
/**
 * [SRC-INT-30..34] — TÍCH HỢP NGUỒN → HOA HỒNG (lane C2 · mục 6): chỉ CHỨNG MINH các mắt xích nối nhau, không thêm tính năng. Với mỗi nguồn — PAID_ADS · PARENT_REFERRAL · EMPLOYEE_REFERRAL · nguồn TUỲ BIẾN
 * do admin tạo bằng `taoNguon` + chính sách riêng — đi hết một đường: lead (đường nhập thật) → thu tiền (hàm ghi thật) → quét (engine thật) → dòng sổ. Mỗi ca đòi:
 *   · đúng vai · đúng người · đúng số tiền theo tỉ lệ của CHÍNH SÁCH (tỉ lệ 2%/1% lấy từ kế hoạch seed thật, không gõ tay trong lõi);
 *   · dòng sổ mang BẢN CHỤP nguồn lúc tính (`sourceGroupCode` · `attributionId` · `resolverBasis`) khớp attribution của lead;
 *   · sau khi cấu hình/người thay đổi (đổi chủ nguồn · PH chuyển Sale · nhân sự nghỉ) quét lại ⇒ dòng cũ byte-identical, 0 dòng mới, 0 INPUT_DRIFT;
 *   · SỔ BẤT BIẾN trên chính các dòng do engine ghi: UPDATE số tiền / nguồn · DELETE bị Postgres chặn (đối chứng dương: INSERT của engine đã thành công, và chuyển trạng thái chi trả TIẾN được).
 *
 * Phần đã có ca riêng (KHÔNG làm lại): `[DYN-07]` `[DYN-08]` (từng nguồn một, dòng mới sau khi đổi), `[DYN-SN-*]`, `[OWN-DB-*]`, `[NHH-SC-02]` (trigger sổ trên dòng DỰNG TAY), `uat-vi-du-so` (số trong checklist).
 * Phần chưa có: nối cả BỐN nguồn trong một bảng, kèm bản chụp + quét lại + bất biến trên dòng do ENGINE ghi.
 *
 *   [SRC-INT-30] PAID_ADS            — Sale 4% + SOURCE_OWNER 1% về chủ nguồn (lịch sử); đổi chủ SAU ⇒ dòng cũ nguyên
 *   [SRC-INT-31] PARENT_REFERRAL     — Sale 4% + REFERRER_PARENT_SALE 2% về Sale phụ trách PH LÚC ghi nhận (SRC-14: quy nguồn theo người giới thiệu); PH chuyển Sale SAU ⇒ dòng cũ nguyên
 *   [SRC-INT-32] EMPLOYEE_REFERRAL   — Sale 4% + REFERRER_EMPLOYEE 2% về nhân sự giới thiệu (SRC-13/SRC-14); nhân sự nghỉ SAU ⇒ dòng cũ nguyên
 *   [SRC-INT-33] NGUỒN TUỲ BIẾN      — admin tạo qua `taoNguon`, chủ qua `suaNguon`, chính sách riêng của nguồn; KHÔNG sửa mã nào; đổi chủ SAU ⇒ dòng cũ nguyên
 *   [SRC-INT-35] SRC-12 (D12) ĐẾN SỔ     — người nhập sale-form-app trước/sau mốc 01/10/2026 00:00 giờ VN: PAID_ADS + chủ nguồn ↔ EMPLOYEE_REFERRAL + người nhập nhận 2%
 *   [SRC-INT-34] CÁCH LY NGUỒN       — hai lead của cùng một cơ sở, hai nguồn khác nhau, cùng quét: mỗi nguồn nhận ĐÚNG chính sách của nó, không dòng nào lẫn sang nguồn kia
 *
 * LUẬT 18: mỗi ca tự dựng, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối. Chạy: `pnpm test:hoa-hong-db`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { lapKeHoachSeedV1 } from "../../lib/hoa-hong/ke-hoach-seed-v1";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { nhanKhaiCuaDuongVao } from "../../lib/nguon/noi-day";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, ganVai, lamNhanVien, themChinhSachNhom, tienVe, tomTat, type KichBan, type RuleFx } from "./_kich-ban";
import { datLaiChuNguon, ghiNguonQuaDuongThat, suaNguon, taoNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[SRC-INT-hoa-hong] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const P = "SRCINT_HH_";
const cuaToi: KichBan[] = [];
let admin = { userId: "", ten: "Quản trị fixture" };
let dem = 0;

async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  return k;
}

/** Rule của nguồn lấy từ KẾ HOẠCH SEED thật (tỉ lệ sống ở policy seed, không phải hằng của lõi) — kể cả dòng EXCLUDE (không mang tỉ lệ). */
const ruleSeedCuaNguon = (maNhom: string): RuleFx[] =>
  lapKeHoachSeedV1()
    .chinhSach.find((c) => c.maNhom === maNhom)!
    .rules.map((r) => (r.calcKind === "EXCLUDE" ? { vai: r.roleCode, kieu: "EXCLUDE" as const } : { vai: r.roleCode, rate: Number(r.rate) }));

async function nhanSu(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  const empId = await lamNhanVien(u.id, `${k.ma}-${hau}`);
  return { userId: u.id, empId };
}
const chon = (groupId: string) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const holdMo = (khoan: string, code: string) => db.commissionHold.findMany({ where: { paymentId: khoan, code: code as never, status: "OPEN" } });

async function thuVaQuet(k: KichBan, ten: string, ngay: Date, now = NOW) {
  const bc = await boiCanh(k, now);
  const khoan = await tienVe(k, await dungBe(k, ten, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  const kq = await quetKhoan(db, bc, khoan);
  return { khoan, kq, bc, tom: tomTat(await dongSoCuaKhoan(khoan)) };
}
const chupSo = async (khoan: string) =>
  (await dongSoCuaKhoan(khoan)).map((d) => ({ id: d.id, entryKind: d.entryKind, roleCode: d.roleCode, beneficiaryUserId: d.beneficiaryUserId, amount: d.amount, rate: d.rate?.toString() ?? null, sourceGroupCode: d.sourceGroupCode, attributionId: d.attributionId, inputHash: d.inputHash, createdAt: d.createdAt.toISOString(), resolverBasis: d.resolverBasis }));

/** Mọi dòng của khoản mang ĐÚNG bản chụp nguồn: mã nguồn · attribution của lead · lead của dòng. */
async function kiemBanChup(khoan: string, p: { maNguon: string; attributionId: string; leadId: string }) {
  const dong = await dongSoCuaKhoan(khoan);
  expect(dong.length).toBeGreaterThan(0);
  for (const d of dong) {
    expect(d, `${d.roleCode}`).toMatchObject({ sourceGroupCode: p.maNguon, attributionId: p.attributionId, leadId: p.leadId, entryKind: "ORIGINAL" });
  }
}

/** SỔ BẤT BIẾN trên dòng do ENGINE ghi: sửa tiền / nguồn / xoá ⇒ Postgres chặn; đối chứng dương: chuyển trạng thái chi trả TIẾN được và không đổi số tiền. */
async function kiemBatBien(khoan: string) {
  const dong = (await dongSoCuaKhoan(khoan)).find((d) => d.roleCode === "SALE")!;
  await expect(db.commissionTransaction.update({ where: { id: dong.id }, data: { amount: dong.amount + 1 } })).rejects.toThrow(/sổ bất biến/);
  await expect(db.commissionTransaction.update({ where: { id: dong.id }, data: { sourceGroupCode: "NGUON_KHAC" } })).rejects.toThrow(/sổ bất biến/);
  await expect(db.commissionTransaction.update({ where: { id: dong.id }, data: { beneficiaryUserId: null } })).rejects.toThrow(/sổ bất biến/);
  await expect(db.commissionTransaction.delete({ where: { id: dong.id } })).rejects.toThrow(/xoá bị chặn/);
  await expect(db.$executeRaw`DELETE FROM "CommissionTransaction" WHERE "id" = ${dong.id}`).rejects.toThrow(/xoá bị chặn/);
  await db.commissionTransaction.update({ where: { id: dong.id }, data: { payoutStatus: "APPROVED", payoutStatusAt: NOW } }); // đối chứng dương: cột chi trả tiến được
  const sau = await db.commissionTransaction.findUniqueOrThrow({ where: { id: dong.id } });
  expect({ amount: sau.amount, sourceGroupCode: sau.sourceGroupCode, beneficiaryUserId: sau.beneficiaryUserId }).toEqual({ amount: dong.amount, sourceGroupCode: dong.sourceGroupCode, beneficiaryUserId: dong.beneficiaryUserId });
}

describe.skipIf(!RUN_DB_TESTS)("[SRC-INT-HH] tích hợp nguồn → hoa hồng — bốn nguồn, bản chụp, bất biến", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    await datLaiChuNguon({ code: "PAID_ADS" });
    admin = { userId: (await seedUser({ email: `srcint-hh-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Quản trị fixture", phone: null })).id, ten: "Quản trị fixture" };
  }, 120_000);
  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });
  afterAll(async () => {
    await donKichBan(cuaToi);
    const nhom = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: P } }, select: { id: true } })).map((g) => g.id);
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", entityId: { in: nhom } } });
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhom } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhom } }, { originalGroupId: { in: nhom } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
    await db.student.deleteMany({ where: { name: { startsWith: "fx-srcint" } } });
    await datLaiChuNguon({ code: "PAID_ADS" }); // trả PAID_ADS về «chưa có chủ» như lúc nhận (nguồn dựng sẵn bền qua tệp)
    await datMocCutover(null);
  }, 120_000);

  /** Gắn chủ PAID_ADS (nguồn dựng sẵn) — khoảng KHỞI TẠO mở từ 05/10, mô phỏng bản migration. */
  async function chuPaidAds(empId: string) {
    const g = await db.leadSourceGroup.findFirstOrThrow({ where: { code: "PAID_ADS" }, select: { id: true } });
    await datLaiChuNguon({ id: g.id });
    await db.leadSourceOwnerPeriod.create({ data: { groupId: g.id, ownerEmployeeId: empId, kind: "KHOI_TAO", effectiveFrom: D("2026-10-05"), createdAt: D("2026-10-05"), reason: "Khởi tạo lịch sử chủ nguồn (fixture mô phỏng migration)" } });
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: empId } });
    return g.id;
  }

  it("[SRC-INT-30] PAID_ADS: Sale 4% + chủ nguồn 1%; bản chụp khớp attribution; đổi chủ SAU ⇒ dòng cũ byte-identical, 0 INPUT_DRIFT; sổ bất biến", async () => {
    // Cấy: engine bỏ `sourceGroupCode` khỏi dòng ghi (hoặc ghi nhóm sống thay vì nhóm của attribution) ⇒ `kiemBanChup` đỏ. Cấy 2: tra chủ theo «hôm nay» ⇒ quét lại sau đổi chủ ra INPUT_DRIFT ⇒ đỏ.
    const k = await kb("h30");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const gid = await chuPaidAds(A.empId);
    await themChinhSachNhom(k, "PAID_ADS", ruleSeedCuaNguon("PAID_ADS"));
    const attr = await ghiNguonQuaDuongThat(k, { nguonChon: chon(gid) }, ATTRIBUTED);
    expect(attr.group.code).toBe("PAID_ADS");

    const t = await thuVaQuet(k, "a", D("2026-11-10"));
    expect(t.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    await kiemBanChup(t.khoan, { maNguon: "PAID_ADS", attributionId: attr.id, leadId: k.lead!.id });
    expect((await dongSoCuaKhoan(t.khoan)).find((d) => d.roleCode === "SOURCE_OWNER")!.resolverBasis).toMatchObject({ sourceOwnerEmployeeId: A.empId, nguonChuGoc: "LICH_SU", attributionId: attr.id });

    const soTruoc = await chupSo(t.khoan);
    expect(await suaNguon({ nguoi: admin, id: gid, updatedAtDaThay: await moiNhat(gid), vao: { ownerEmployeeId: B.empId }, lyDo: "Chuyển phụ trách nguồn sang B từ 30/11", now: D("2026-11-15"), hieuLucChuTu: D("2026-11-30") })).toMatchObject({ ok: true, doi: true });
    expect((await quetKhoan(db, await boiCanh(k, D("2027-03-01")), t.khoan)).loai).toBe("KHONG_DOI");
    expect(await holdMo(t.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(await chupSo(t.khoan)).toEqual(soTruoc);
    await kiemBatBien(t.khoan);
  });

  it("[SRC-INT-31] PARENT_REFERRAL (SRC-14): Sale 4% + 2% về Sale phụ trách PH lúc ghi nhận; PH chuyển Sale SAU ⇒ dòng cũ nguyên; bản chụp attribution giữ Sale cũ; sổ bất biến", async () => {
    // Cấy: engine đọc Sale phụ trách PH «hôm nay» thay vì `referrerSaleUserId` trên attribution ⇒ quét lại ra Z ⇒ INPUT_DRIFT ⇒ đỏ.
    const k = await kb("h31");
    const nv = (ten: string) => seedUser({ email: `${k.ma}-${ten}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${ten}`, phone: null });
    const [saleX, saleZ, ph] = await Promise.all([nv("x"), nv("z"), seedUser({ email: `${k.ma}-ph@ci.test`, role: "PARENT", name: `${k.ma}-ph`, phone: null })]);
    const leadGoc = await db.lead.create({ data: { parentName: `${k.ma}-goc`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "DA_DANG_KY", convertedById: saleX.id, centerId: k.centerId, createdAt: D("2026-09-01") } });
    const hv = await db.student.create({ data: { id: `${k.ma}-hvph`, name: `fx-srcint Bé PH ${k.ma}`, centerId: k.centerId, parentUserId: ph.id, leadId: leadGoc.id } });
    await themChinhSachNhom(k, "PARENT_REFERRAL", ruleSeedCuaNguon("PARENT_REFERRAL"));
    const attr = await ghiNguonQuaDuongThat(k, { phuHuynhGioiThieu: { parentUserId: ph.id, studentId: hv.id } }, ATTRIBUTED);
    expect(attr).toMatchObject({ referrerParentUserId: ph.id, referrerSaleUserId: saleX.id });
    expect(attr.group.code).toBe("PARENT_REFERRAL");

    const t = await thuVaQuet(k, "a", D("2026-11-20"));
    expect(t.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT_SALE:${saleX.id}`]: 200_000 });
    await kiemBanChup(t.khoan, { maNguon: "PARENT_REFERRAL", attributionId: attr.id, leadId: k.lead!.id });

    const soTruoc = await chupSo(t.khoan);
    await db.lead.update({ where: { id: leadGoc.id }, data: { convertedById: saleZ.id } }); // PH chuyển sang Sale Z SAU ghi nhận
    expect((await quetKhoan(db, await boiCanh(k, D("2027-03-01")), t.khoan)).loai).toBe("KHONG_DOI");
    expect(await holdMo(t.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(await chupSo(t.khoan)).toEqual(soTruoc);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } })).referrerSaleUserId).toBe(saleX.id);
    await kiemBatBien(t.khoan);
  });

  it("[SRC-INT-32] EMPLOYEE_REFERRAL (SRC-13/14): Sale 4% + 2% về nhân sự giới thiệu; nhân sự NGHỈ SAU khi đã được chi ⇒ không thu hồi, dòng cũ nguyên; sổ bất biến", async () => {
    // Cấy: quét lại coi nhân sự nghỉ là «người hưởng sai» ⇒ INPUT_DRIFT «E −200.000» ⇒ đỏ.
    const k = await kb("h32");
    const u = await seedUser({ email: `${k.ma}-e@ci.test`, role: "SALES_CSM", name: `${k.ma}-e`, phone: null });
    const employeeId = await lamNhanVien(u.id, `${k.ma}-e`);
    await ganVai(u.id, k.ouId, "CENTER_SALES_CSM");
    await themChinhSachNhom(k, "EMPLOYEE_REFERRAL", ruleSeedCuaNguon("EMPLOYEE_REFERRAL"));
    const attr = await ghiNguonQuaDuongThat(k, { nhanSuGioiThieuEmployeeId: employeeId }, ATTRIBUTED);
    expect(attr).toMatchObject({ referrerEmployeeId: employeeId, referrerRoleCode: "SALE" });
    expect(attr.group.code).toBe("EMPLOYEE_REFERRAL");

    const t = await thuVaQuet(k, "a", D("2026-11-20"));
    expect(t.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_EMPLOYEE:${u.id}`]: 200_000 });
    await kiemBanChup(t.khoan, { maNguon: "EMPLOYEE_REFERRAL", attributionId: attr.id, leadId: k.lead!.id });

    const soTruoc = await chupSo(t.khoan);
    await db.employee.update({ where: { id: employeeId }, data: { status: "RESIGNED" } });
    const r = await quetKhoan(db, await boiCanh(k, D("2027-03-01")), t.khoan);
    expect(r.loai).toBe("KHONG_DOI");
    expect(await holdMo(t.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(await chupSo(t.khoan)).toEqual(soTruoc);
    await kiemBatBien(t.khoan);
  });

  it("[SRC-INT-33] nguồn TUỲ BIẾN: admin tạo (taoNguon) + gắn chủ (suaNguon) + chính sách riêng ⇒ Sale 4% + chủ 1%, KHÔNG sửa mã; mã nguồn có trong dòng sổ; đổi chủ SAU ⇒ dòng cũ nguyên; sổ bất biến", async () => {
    // Cấy: engine/quy nguồn phân nhánh theo MÃ nguồn dựng sẵn (nguồn lạ rơi về UNKNOWN / không có dòng chủ nguồn) ⇒ `tom` thiếu SOURCE_OWNER ⇒ đỏ (lưới [DYN-NOHARD] canh phần mã, ca này canh phần hành vi).
    const k = await kb("h33");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    dem += 1;
    const code = `${P}KOL${Date.now().toString(36).toUpperCase()}${dem}`;
    const tao = await taoNguon({
      nguoi: admin,
      vao: { code, name: "KOL tuỳ biến (SRC-INT)", description: null, sourceType: "MARKETING", referrerRequirement: "NONE", requiresNote: false, selectable: true, sortOrder: 790 + dem, trangThai: "ACTIVE", attributionWindowDays: null, commissionEnabled: true, ownerOrgUnitId: null, ownerEmployeeId: null, effectiveFrom: null, effectiveTo: null },
    });
    if (!tao.ok) throw new Error(`taoNguon: ${tao.truong}: ${tao.loi}`);
    expect(await suaNguon({ nguoi: admin, id: tao.id, updatedAtDaThay: await moiNhat(tao.id), vao: { ownerEmployeeId: A.empId }, lyDo: "Gắn chủ nguồn A từ 10/10", now: D("2026-10-09"), hieuLucChuTu: D("2026-10-10") })).toMatchObject({ ok: true, doi: true });
    await themChinhSachNhom(k, tao.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const attr = await ghiNguonQuaDuongThat(k, { nguonChon: chon(tao.id) }, ATTRIBUTED);
    expect(attr.group.code).toBe(tao.code);

    const t = await thuVaQuet(k, "a", D("2026-11-10"));
    expect(t.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    await kiemBanChup(t.khoan, { maNguon: tao.code, attributionId: attr.id, leadId: k.lead!.id });

    const soTruoc = await chupSo(t.khoan);
    expect(await suaNguon({ nguoi: admin, id: tao.id, updatedAtDaThay: await moiNhat(tao.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Chuyển phụ trách nguồn sang B từ 30/11", now: D("2026-11-15"), hieuLucChuTu: D("2026-11-30") })).toMatchObject({ ok: true, doi: true });
    expect((await quetKhoan(db, await boiCanh(k, D("2027-03-01")), t.khoan)).loai).toBe("KHONG_DOI");
    expect(await holdMo(t.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(await chupSo(t.khoan)).toEqual(soTruoc);
    await kiemBatBien(t.khoan);
  });

  it("[SRC-INT-35] SRC-12 (D12) đi tới SỔ: người nhập sale-form-app lúc 30/09/2026 23:59:59 +07 ⇒ PAID_ADS (chủ nguồn 1%, người nhập KHÔNG có dòng); lúc 01/10/2026 00:00:00 +07 ⇒ EMPLOYEE_REFERRAL, chính người nhập nhận 2%", async () => {
    // Cấy: so mốc theo UTC thay vì giờ VN (`bayGio` 16:59:59Z và 17:00:00Z cùng ngày 30/09 UTC) ⇒ cả hai lead cùng một nhóm ⇒ một trong hai khẳng định nhóm/tiền đỏ.
    const kTruoc = await kb("h35a");
    const kSau = await kb("h35b");
    const nguoiNhapTruoc = await nhanSu(kTruoc, "n");
    const nguoiNhapSau = await nhanSu(kSau, "n");
    await ganVai(nguoiNhapTruoc.userId, kTruoc.ouId, "CENTER_SALES_CSM");
    await ganVai(nguoiNhapSau.userId, kSau.ouId, "CENTER_SALES_CSM");
    const chu = await nhanSu(kTruoc, "c");
    await chuPaidAds(chu.empId);
    await themChinhSachNhom(kTruoc, "PAID_ADS", ruleSeedCuaNguon("PAID_ADS"));
    await themChinhSachNhom(kSau, "EMPLOYEE_REFERRAL", ruleSeedCuaNguon("EMPLOYEE_REFERRAL"));
    const nhap = (nguoiNhapUserId: string, bayGio: Date) => ({ duongVao: "sale-form-app", nhanKhai: nhanKhaiCuaDuongVao("sale-form-app", null), nguoiNhapUserId, bayGio });

    const truoc = await ghiNguonQuaDuongThat(kTruoc, nhap(nguoiNhapTruoc.userId, new Date("2026-09-30T16:59:59.000Z")), ATTRIBUTED);
    const sau = await ghiNguonQuaDuongThat(kSau, nhap(nguoiNhapSau.userId, new Date("2026-09-30T17:00:00.000Z")), ATTRIBUTED);
    expect(truoc.group.code).toBe("PAID_ADS");
    expect(truoc.referrerEmployeeId).toBeNull();
    expect(sau.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(sau.referrerEmployeeId).toBe(nguoiNhapSau.empId);

    const t1 = await thuVaQuet(kTruoc, "a", D("2026-11-10"));
    expect(t1.tom).toEqual({ [`SALE:${kTruoc.sale.id}`]: 400_000, [`SOURCE_OWNER:${chu.userId}`]: 100_000 });
    expect(Object.keys(t1.tom).some((x) => x.startsWith("REFERRER_EMPLOYEE:"))).toBe(false); // người nhập TRƯỚC mốc không được ghi công
    await kiemBanChup(t1.khoan, { maNguon: "PAID_ADS", attributionId: truoc.id, leadId: kTruoc.lead!.id });
    const t2 = await thuVaQuet(kSau, "a", D("2026-11-10"));
    expect(t2.tom).toEqual({ [`SALE:${kSau.sale.id}`]: 400_000, [`REFERRER_EMPLOYEE:${nguoiNhapSau.userId}`]: 200_000 });
    await kiemBanChup(t2.khoan, { maNguon: "EMPLOYEE_REFERRAL", attributionId: sau.id, leadId: kSau.lead!.id });
  });

  it("[SRC-INT-34] cách ly nguồn: hai lead cùng cơ sở, hai nguồn, cùng quét ⇒ mỗi nguồn nhận ĐÚNG chính sách của nó (đối chứng: nguồn kia KHÔNG có dòng thu hút của nguồn này)", async () => {
    // Cấy: chọn quy tắc theo cơ sở/GLOBAL thay vì phạm vi nguồn của attribution ⇒ lead EMPLOYEE_REFERRAL cũng ra dòng chủ nguồn (hoặc lead tuỳ biến ra dòng REFERRER_EMPLOYEE) ⇒ đỏ.
    const k = await kb("h34");
    const A = await nhanSu(k, "a");
    const u = await nhanSu(k, "e");
    await ganVai(u.userId, k.ouId, "CENTER_SALES_CSM");
    dem += 1;
    const code = `${P}CL${Date.now().toString(36).toUpperCase()}${dem}`;
    const tao = await taoNguon({
      nguoi: admin,
      vao: { code, name: "Nguồn cách ly (SRC-INT)", description: null, sourceType: "MARKETING", referrerRequirement: "NONE", requiresNote: false, selectable: true, sortOrder: 795 + dem, trangThai: "ACTIVE", attributionWindowDays: null, commissionEnabled: true, ownerOrgUnitId: null, ownerEmployeeId: null, effectiveFrom: null, effectiveTo: null },
    });
    if (!tao.ok) throw new Error(`taoNguon: ${tao.truong}: ${tao.loi}`);
    await suaNguon({ nguoi: admin, id: tao.id, updatedAtDaThay: await moiNhat(tao.id), vao: { ownerEmployeeId: A.empId }, lyDo: "Gắn chủ nguồn A từ 10/10", now: D("2026-10-09"), hieuLucChuTu: D("2026-10-10") });
    await themChinhSachNhom(k, tao.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await themChinhSachNhom(k, "EMPLOYEE_REFERRAL", ruleSeedCuaNguon("EMPLOYEE_REFERRAL"));

    // lead 1 (của kịch bản): nguồn tuỳ biến. lead 2: nhân sự giới thiệu — cùng cơ sở, cùng Sale chốt, cùng bộ chính sách trong bối cảnh quét.
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(tao.id) }, ATTRIBUTED);
    const lead2 = await db.lead.create({ data: { parentName: `${k.ma}-l2`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "DA_DANG_KY", convertedById: k.sale.id, adminId: k.saleAdmin.id, centerId: k.centerId } });
    const k2: KichBan = { ...k, lead: lead2 };
    await ghiNguonQuaDuongThat(k2, { nhanSuGioiThieuEmployeeId: u.empId }, ATTRIBUTED, lead2.id);

    const bc = await boiCanh(k, D("2027-02-20"));
    const khoan1 = await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-11-10") });
    const khoan2 = await tienVe(k2, await dungBe(k2, "b", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-11-10") });
    await quetKhoan(db, bc, khoan1);
    await quetKhoan(db, bc, khoan2);
    expect(tomTat(await dongSoCuaKhoan(khoan1))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    expect(tomTat(await dongSoCuaKhoan(khoan2))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_EMPLOYEE:${u.userId}`]: 200_000 });
    // không rò chéo: đúng hai dòng mỗi khoản và KHÔNG hàng chờ nào (chính sách của nguồn kia mà áp nhầm sẽ ra dòng/hàng chờ thừa — vai không có người hưởng ở nguồn này)
    for (const khoan of [khoan1, khoan2]) {
      expect(await db.commissionTransaction.count({ where: { paymentId: khoan } })).toBe(2);
      expect(await db.commissionHold.count({ where: { paymentId: khoan } })).toBe(0);
    }
  });
});
