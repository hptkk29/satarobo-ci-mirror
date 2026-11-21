// @vitest-environment node
/**
 * NGUỒN ĐỘNG (SPEC 09/10/2026 §2) — ĐƯỜNG NHẬP LEAD thật: nhóm "nhân sự giới thiệu" là CẤU HÌNH, vai là ẢNH CHỤP, Sale phụ trách PH là ẢNH CHỤP.
 * Postgres LOCAL thật; mỗi ca đi qua `ingestIntakeLead` (chuẩn bị → ghi) y như lead thật.
 *
 *   [DYN-INT-01] nhân sự do picker chọn, KHÔNG ai chọn rõ nhóm ⇒ nhóm = setting `nguon.nhomNhanSuMacDinh`; ảnh chụp vai + dấu vết
 *   [DYN-INT-02] setting trỏ sang nhóm admin tạo ⇒ nhóm ấy; trỏ sang nhóm KHÔNG kiểu nhân sự ⇒ luật không khớp (không ghi nhân sự vào nhóm Ads)
 *   [DYN-INT-03] người nhập CHỌN RÕ nhóm admin tạo + nhân sự (ô chọn nguồn) ⇒ GIỮ nhóm đã chọn
 *   [DYN-INT-04] PH giới thiệu: Sale phụ trách PH lúc đó vào ảnh chụp; PH đổi Sale SAU ĐÓ ⇒ KHÔNG đổi; không tìm được ⇒ NULL + THIEU_SALE_PH
 *   [DYN-INT-05] FIRST-CLAIM: phiếu đến sau trên SĐT đã có (PH khác, Sale khác) chỉ thành touchpoint — ảnh chụp gốc nguyên vẹn
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `ANHC_`. LUẬT 18: mỗi ca tự dựng hiện trường. LUẬT 19: ngày tuyệt đối / lùi giờ vai.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { ingestIntakeLead } from "../../lib/lead/intake/ingest";
import type { MappedLead } from "../../lib/lead/intake/types";
import { KHONG_CO_TIN_HIEU_NGUON, type TinHieuNguonDauVao } from "../../lib/nguon/tin-hieu";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "ANHC_";
const CASE = 90_000;

const tinHieu = (over: Partial<TinHieuNguonDauVao> = {}): TinHieuNguonDauVao => ({ ...KHONG_CO_TIN_HIEU_NGUON, ...over });

function phieu(phone: string): MappedLead {
  return {
    parentName: `${P}Phụ huynh`,
    phone,
    email: null,
    centerHint: null,
    children: [],
    employeeCode: null,
    noteLines: [],
    externalId: null,
    consentMarketing: false,
    warnings: [],
  };
}

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo quy nguồn + touchpoint
  }
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email: { startsWith: P } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.center.deleteMany({ where: { code: { startsWith: "ANHC" } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

async function dungSale(hau: string, centerId: string, roleDef = "CENTER_SALES_CSM") {
  const code = `${P}NV${hau}`;
  const emp = await db.employee.create({
    data: { employeeCode: code, fullName: `${P}Sale ${hau}`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId, isActive: true },
    select: { id: true },
  });
  const user = await db.user.create({
    data: { name: `${P}Sale ${hau}`, email: `${P}sale-${hau}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId, employeeId: emp.id, isActive: true },
    select: { id: true },
  });
  const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: roleDef }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: user.id, orgUnitId: cs1.id, roleId: role.id, grantedById: "anhc", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  return { employeeId: emp.id, userId: user.id, code };
}

describe.skipIf(!RUN)("Nguồn động — ảnh chụp người giới thiệu trên đường nhập lead", () => {
  let nhom: IdNhom;
  let coSo = "";
  let sdt = 0;
  const soDt = () => `0905${String(100000 + sdt++)}`;

  beforeAll(async () => {
    await don();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM", "CENTER_MANAGER", "TEACHER"] });
  }, 180_000);
  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    coSo = (await db.center.create({ data: { code: "ANHC1", name: "ANHC 1", slug: "anhc-1", address: "a", city: "" } })).id;
    await datCoNguon(CO_NGUON_DAY_DU);
  }, CASE);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  const attr = (leadId: string) =>
    db.leadAttribution.findUniqueOrThrow({ where: { leadId }, include: { group: { select: { code: true } } } });

  async function nhomAdmin(code: string, referrerRequirement: "EMPLOYEE" | "NONE" = "EMPLOYEE") {
    return db.leadSourceGroup.create({ data: { code: `${P}${code}`, name: `${P}${code}`, referrerRequirement, sortOrder: 200, commissionEnabled: true } });
  }

  it("[DYN-INT-01] nhân sự do picker chọn (không ai chọn rõ nhóm): nhóm = setting mặc định; ẢNH CHỤP vai SALE + dấu vết {mã NV, vai thô}; cùng nhóm cho vai khác, khác ảnh chụp", async () => {
    const sale = await dungSale("A", coSo);
    const quanLy = await dungSale("B", coSo, "CENTER_MANAGER");
    const r1 = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: tinHieu({ nhanSuGioiThieuEmployeeId: sale.employeeId }) });
    expect(r1.ok, r1.error).toBe(true);
    const a = await attr(r1.leadId!);
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.matchedRule).toBe("NV_GIOI_THIEU");
    expect(a.referrerRoleCode).toBe("SALE");
    expect(a.referrerSaleUserId).toBeNull();
    expect(a.signals).toMatchObject({ nguoiGioiThieu: { employeeCode: sale.code, roleCodes: ["CENTER_SALES_CSM"] } });
    const r2 = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: tinHieu({ nhanSuGioiThieuEmployeeId: quanLy.employeeId }) });
    const b = await attr(r2.leadId!);
    expect(b.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(b.referrerRoleCode).toBe("MANAGER");
  }, CASE);

  it("[DYN-INT-02] setting nhóm nhân sự: trỏ sang NGUỒN ADMIN TẠO ⇒ ghi vào nhóm đó (không sửa mã); trỏ sang nhóm KHÔNG kiểu nhân sự ⇒ luật không khớp, người giới thiệu KHÔNG bị ghi vào nhóm Ads", async () => {
    const sale = await dungSale("C", coSo);
    const g = await nhomAdmin("TRUONG");
    await datCoNguon(CO_NGUON_DAY_DU, { "nguon.nhomNhanSuMacDinh": g.code });
    const r = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: tinHieu({ nhanSuGioiThieuEmployeeId: sale.employeeId }) });
    expect((await attr(r.leadId!)).group.code).toBe(g.code);
    // cấu hình sai: trỏ vào PAID_ADS (NONE) — kiểm theo THUỘC TÍNH, không ghi nhân sự vào nhóm không cần người
    await datCoNguon(CO_NGUON_DAY_DU, { "nguon.nhomNhanSuMacDinh": "PAID_ADS" });
    const r2 = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: tinHieu({ nhanSuGioiThieuEmployeeId: sale.employeeId }) });
    const b = await attr(r2.leadId!);
    expect(b.group.code).not.toBe("PAID_ADS");
    expect(b.referrerEmployeeId).toBeNull();
  }, CASE);

  it("[DYN-INT-03] người nhập CHỌN RÕ nhóm admin tạo + nhân sự (ô chọn nguồn) ⇒ GIỮ nhóm đã chọn; ảnh chụp vai vẫn ghi; đối chứng: chọn rõ nhóm gốc ⇒ nhóm gốc", async () => {
    const gv = await dungSale("D", coSo, "TEACHER");
    const g = await nhomAdmin("CTV");
    const chon = (groupId: string) => tinHieu({ nguonChon: { groupId, employeeId: gv.employeeId, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null } });
    const r = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: chon(g.id) });
    expect(r.ok, r.error).toBe(true);
    const a = await attr(r.leadId!);
    expect(a.group.code).toBe(g.code);
    expect(a.matchedRule).toBe("CHON_NGUON");
    expect(a.referrerEmployeeId).toBe(gv.employeeId);
    expect(a.referrerRoleCode).toBe("TEACHER");
    const r2 = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: chon(nhom.EMPLOYEE_REFERRAL) });
    expect((await attr(r2.leadId!)).group.code).toBe("EMPLOYEE_REFERRAL");
  }, CASE);

  async function dungPh(hau: string, saleUserId: string | null) {
    const ph = await db.user.create({ data: { name: `${P}ph${hau}`, email: `${P}ph${hau}@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    const leadGoc = await db.lead.create({
      data: { parentName: `${P}goc${hau}`, phone: soDt(), status: "DA_DANG_KY", centerId: coSo, convertedById: saleUserId },
      select: { id: true },
    });
    const hv = await db.student.create({ data: { name: `${P}Bé ${hau}`, centerId: coSo, parentUserId: ph.id, leadId: leadGoc.id }, select: { id: true } });
    return { parentUserId: ph.id, studentId: hv.id, leadGocId: leadGoc.id };
  }

  it("[DYN-INT-04] PH giới thiệu: ảnh chụp Sale lúc đó; PH đổi Sale SAU ĐÓ ⇒ dòng cũ KHÔNG đổi, lead mới ghi Sale mới; không tìm được ⇒ NULL + coXemTay/THIEU_SALE_PH", async () => {
    const saleX = await dungSale("X", coSo);
    const saleY = await dungSale("Y", coSo);
    const ph = await dungPh("1", saleX.userId);
    const gt = tinHieu({ phuHuynhGioiThieu: { parentUserId: ph.parentUserId, studentId: ph.studentId } });
    const r = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: gt });
    const a = await attr(r.leadId!);
    expect(a.group.code).toBe("PARENT_REFERRAL");
    expect(a.referrerSaleUserId).toBe(saleX.userId);
    expect((a.signals as { coXemTay?: boolean }).coXemTay).not.toBe(true);
    await db.lead.update({ where: { id: ph.leadGocId }, data: { convertedById: saleY.userId } }); // PH chuyển sang Sale Y
    expect((await attr(r.leadId!)).referrerSaleUserId).toBe(saleX.userId);
    const r2 = await ingestIntakeLead(phieu(soDt()), { source: "nhap-tay", centerId: coSo, tinHieuNguon: gt });
    expect((await attr(r2.leadId!)).referrerSaleUserId).toBe(saleY.userId);
    // không có Sale để chụp
    const khong = await dungPh("2", null);
    const r3 = await ingestIntakeLead(phieu(soDt()), {
      source: "nhap-tay",
      centerId: coSo,
      tinHieuNguon: tinHieu({ phuHuynhGioiThieu: { parentUserId: khong.parentUserId, studentId: khong.studentId } }),
    });
    const c = await attr(r3.leadId!);
    expect(c.referrerSaleUserId).toBeNull();
    expect(c.signals).toMatchObject({ coXemTay: true, xemTay: ["THIEU_SALE_PH"] });
    expect(c.canhBao).not.toContain("THIEU_SALE_PH");
  }, CASE);

  it("[DYN-INT-05] FIRST-CLAIM: phiếu đến SAU trên SĐT còn sống (PH khác, Sale khác) chỉ thành touchpoint — ảnh chụp gốc (Sale lúc đầu) nguyên vẹn", async () => {
    const saleX = await dungSale("P", coSo);
    const saleY = await dungSale("Q", coSo);
    const phX = await dungPh("3", saleX.userId);
    const phY = await dungPh("4", saleY.userId);
    const so = soDt();
    const dau = await ingestIntakeLead(phieu(so), { source: "nhap-tay", centerId: coSo, tinHieuNguon: tinHieu({ phuHuynhGioiThieu: { parentUserId: phX.parentUserId, studentId: phX.studentId } }) });
    const truoc = await attr(dau.leadId!);
    const sau = await ingestIntakeLead(phieu(so), {
      source: "nhap-tay",
      centerId: coSo,
      tinHieuNguon: tinHieu({ phuHuynhGioiThieu: { parentUserId: phY.parentUserId, studentId: phY.studentId } }),
    });
    expect(sau.duplicate).toBe(true);
    const a = await attr(dau.leadId!);
    expect(a.referrerSaleUserId).toBe(saleX.userId);
    expect(a.referrerParentUserId).toBe(phX.parentUserId);
    expect(a.updatedAt).toEqual(truoc.updatedAt);
  }, CASE);
});
