// @vitest-environment node
/**
 * [NHH-RES-DB-*] — NẠP ngữ cảnh người hưởng từ cột thật + chạy resolver (04 §7), trên Postgres THẬT.
 *
 * Thứ chỉ DB chứng minh: `Lead.convertedById/adminId`, `CenterCommissionAssignee` (biên MỞ, theo cơ sở của GIAO DỊCH),
 * `Employee.status` qua `User.employeeId`, `Affiliate.isActive` được đọc đúng cột. Hàm quyết định đã có lưới thuần ở
 * `lib/hoa-hong/nguoi-huong.test.ts`. KHÔNG đọc `LeadAttribution` ở đây (lưới `[QN-W11]`): nguồn truyền vào từ ngoài.
 *
 * Dữ liệu mang tiền tố `fx-res-`, dọn đầu mỗi ca (luật 18); ngày tuyệt đối (luật 19).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { phanGiaiNguoiHuong } from "../../lib/hoa-hong/nguoi-huong";
import { docNguCanhNguoiHuong } from "../../lib/hoa-hong/nguoi-huong-db";
import { MASTER_VAI_HUONG } from "../../lib/hoa-hong/vai-huong";

if (!RUN_DB_TESTS) console.warn(`[NHH-RES-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fx-res-";
const NGAY = new Date("2026-10-20T03:00:00.000Z");
const vai = (code: string) => {
  const v = MASTER_VAI_HUONG.find((x) => x.code === code)!;
  return { code, resolverType: v.resolverType, resolverKey: v.resolverKey };
};

async function don() {
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } });
  await db.centerCommissionAssignee.deleteMany({ where: { note: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "FXRES" } } });
  const u = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  if (u.length) await db.user.deleteMany({ where: { id: { in: u.map((x) => x.id) } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: "FXRES" } } });
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-RES-DB] người hưởng — nạp từ DB", () => {
  let cs1 = "";
  let cs2 = "";
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    const o = await db.orgUnit.findMany({ where: { code: { in: ["CS1", "CS2"] } }, select: { code: true, centerId: true } });
    cs1 = o.find((x) => x.code === "CS1")!.centerId!;
    cs2 = o.find((x) => x.code === "CS2")!.centerId!;
  }, 120_000);
  beforeEach(don, 60_000);
  afterAll(don, 60_000);

  const nguoi = (ten: string) => seedUser({ email: `${P}${ten}@ci.test`, role: "SALES_CSM", name: `${P}${ten}` });

  it("[NHH-RES-DB-01] SALE/SALE_ADMIN đọc từ lead của GIAO DỊCH; đơn KHÔNG lead ⇒ TREO KHONG_CO_LEAD (không lùi về ai khác)", async () => {
    const sale = await nguoi("sale");
    const admin = await nguoi("admin");
    const lead = await db.lead.create({ data: { parentName: `${P}l`, phone: "0990400001", status: "DA_DANG_KY", convertedById: sale.id, adminId: admin.id } });
    const c = await docNguCanhNguoiHuong(db, { leadId: lead.id, leadChildId: null, centerId: cs1, assigneeDate: NGAY, nguon: null });
    expect(phanGiaiNguoiHuong(vai("SALE"), c)).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: sale.id }] });
    expect(phanGiaiNguoiHuong(vai("SALE_ADMIN"), c)).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: admin.id }] });
    const khong = await docNguCanhNguoiHuong(db, { leadId: null, leadChildId: null, centerId: cs1, assigneeDate: NGAY, nguon: null });
    expect(phanGiaiNguoiHuong(vai("SALE"), khong)).toMatchObject({ loai: "TREO", lyDo: "KHONG_CO_LEAD" });
  });

  it("[NHH-RES-DB-02] QLCS/Marketing theo cơ sở của GIAO DỊCH, biên MỞ; cơ sở khác không lẫn; chưa khai ⇒ TREO", async () => {
    const cu = await nguoi("ql-cu");
    const moi = await nguoi("ql-moi");
    const khac = await nguoi("ql-cs2");
    const ban = (userId: string, centerId: string, from: string, to: string | null) =>
      db.centerCommissionAssignee.create({
        data: { centerId, role: "QL_TT", userId, effectiveFrom: new Date(`${from}T00:00:00.000Z`), effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null, note: `${P}x` },
      });
    await ban(cu.id, cs1, "2026-01-01", "2026-10-01");
    await ban(moi.id, cs1, "2026-10-01", null);
    await ban(khac.id, cs2, "2026-01-01", null);
    const luc = (d: string, centerId: string | null) =>
      docNguCanhNguoiHuong(db, { leadId: null, leadChildId: null, centerId, assigneeDate: new Date(`${d}T00:00:00.000Z`), nguon: null });
    expect(phanGiaiNguoiHuong(vai("CENTER_MANAGER"), await luc("2026-09-30", cs1))).toMatchObject({ nguoi: [{ id: cu.id }] });
    expect(phanGiaiNguoiHuong(vai("CENTER_MANAGER"), await luc("2026-10-01", cs1))).toMatchObject({ nguoi: [{ id: moi.id }] }); // đúng giờ bàn giao: người MỚI
    expect(phanGiaiNguoiHuong(vai("CENTER_MANAGER"), await luc("2026-10-20", cs2))).toMatchObject({ nguoi: [{ id: khac.id }] });
    expect(phanGiaiNguoiHuong(vai("MARKETING"), await luc("2026-10-20", cs1))).toMatchObject({ loai: "TREO", lyDo: "CHUA_KHAI_NGUOI_PHU_TRACH" });
    expect(phanGiaiNguoiHuong(vai("CENTER_MANAGER"), await luc("2026-10-20", null))).toMatchObject({ loai: "TREO", lyDo: "KHONG_QUY_VE_CO_SO" });
  });

  it("[NHH-RES-DB-03] người hưởng RESIGNED/TERMINATED (qua User.employeeId) ⇒ TREO NGUOI_HUONG_NGHI; ON_LEAVE và ACTIVE vẫn hưởng; PH (không nhân sự) vẫn hưởng", async () => {
    const mk = async (ten: string, status: "ACTIVE" | "ON_LEAVE" | "RESIGNED" | "TERMINATED", phone: string) => {
      const nv = await db.employee.create({ data: { employeeCode: `FXRES-${ten}`, fullName: `NV ${ten}`, jobTitle: "Sale", department: "KINH_DOANH", status } });
      const u = await nguoi(ten);
      await db.user.update({ where: { id: u.id }, data: { employeeId: nv.id } });
      const lead = await db.lead.create({ data: { parentName: `${P}${ten}`, phone, status: "DA_DANG_KY", convertedById: u.id } });
      const c = await docNguCanhNguoiHuong(db, { leadId: lead.id, leadChildId: null, centerId: cs1, assigneeDate: NGAY, nguon: null });
      return phanGiaiNguoiHuong(vai("SALE"), c);
    };
    expect(await mk("nghi", "RESIGNED", "0990400011")).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
    expect(await mk("duoi", "TERMINATED", "0990400012")).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
    expect((await mk("phep", "ON_LEAVE", "0990400013")).loai).toBe("CO_NGUOI");
    expect((await mk("lam", "ACTIVE", "0990400014")).loai).toBe("CO_NGUOI");
    // phụ huynh: User không có employeeId
    const ph = await nguoi("ph");
    const c = await docNguCanhNguoiHuong(db, {
      leadId: null,
      leadChildId: null,
      centerId: cs1,
      assigneeDate: NGAY,
      nguon: { referrerKind: "PARENT", referrerParentUserId: ph.id, referrerSaleUserId: null, referrerEmployeeId: null, referrerAffiliateId: null, nguonChuEmployeeId: null },
    });
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT"), c)).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: ph.id }] });
  });

  it("[NHH-RES-DB-04] người giới thiệu là NHÂN SỰ: Employee.id → User.id; affiliate ngừng hoạt động ⇒ TREO; còn hoạt động ⇒ có người", async () => {
    const nv = await db.employee.create({ data: { employeeCode: "FXRES-gt", fullName: "NV giới thiệu", jobTitle: "GV", department: "KINH_DOANH" } });
    const u = await nguoi("gt");
    await db.user.update({ where: { id: u.id }, data: { employeeId: nv.id } });
    const aff = await db.affiliate.create({ data: { code: "FXRES1", name: `${P}aff`, isActive: true } });
    const c = await docNguCanhNguoiHuong(db, {
      leadId: null,
      leadChildId: null,
      centerId: cs1,
      assigneeDate: NGAY,
      nguon: { referrerKind: "EMPLOYEE", referrerParentUserId: null, referrerSaleUserId: null, referrerEmployeeId: nv.id, referrerAffiliateId: aff.id, nguonChuEmployeeId: null },
    });
    expect(phanGiaiNguoiHuong(vai("REFERRER_EMPLOYEE"), c)).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id: u.id }] });
    expect(phanGiaiNguoiHuong(vai("AFFILIATE"), c)).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ kind: "AFFILIATE", id: aff.id }] });
    await db.affiliate.update({ where: { id: aff.id }, data: { isActive: false } });
    const c2 = await docNguCanhNguoiHuong(db, {
      leadId: null,
      leadChildId: null,
      centerId: cs1,
      assigneeDate: NGAY,
      nguon: { referrerKind: "EMPLOYEE", referrerParentUserId: null, referrerSaleUserId: null, referrerEmployeeId: nv.id, referrerAffiliateId: aff.id, nguonChuEmployeeId: null },
    });
    expect(phanGiaiNguoiHuong(vai("AFFILIATE"), c2)).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
  });
});
