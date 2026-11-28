// @vitest-environment node
/**
 * PR2 — FK `Restrict` sang NGƯỜI GIỚI THIỆU (07 §2.8): `LeadAttribution.referrer{Employee,ParentUser,Student,Affiliate}Id` đều
 * `onDelete: Restrict`. Trước PR2 không dòng nào trỏ tới nên các đường xoá cứng có sẵn chưa từng bị cắn; từ khi PR2 ghi dòng
 * người giới thiệu đầu tiên thì xoá cứng một nhân viên/học viên/phụ huynh đang được dòng quy nguồn trỏ tới sẽ ném lỗi THÔ. ⚠️ Đo 08/10: `ON DELETE RESTRICT` trả SQLSTATE **23001** (restrict_violation), KHÔNG phải 23503 — nên Prisma KHÔNG dịch
 * thành `P2003` mà ném `PrismaClientUnknownRequestError`. Bắt `P2003` ở đường xoá là bắt HỤT; phải hỏi TRƯỚC (`nguoiDangGioiThieuLead`).
 *
 *   [NHH-SRC-FK-01]  đối chứng: FK Restrict là THẬT (xoá thẳng nhân viên đang là người giới thiệu ⇒ DB từ chối, nêu đúng ràng buộc)
 *   [NHH-SRC-FK-02]  `nguoiDangGioiThieuLead` bắt được cả bốn loại người; không bắt oan người không ai giới thiệu
 *   [NHH-SRC-FK-03]  `xoaQuyNguonTheoNguoiGioiThieu` dọn đúng dòng của tập sắp xoá, KHÔNG đụng dòng của người khác
 *   [NHH-SRC-FK-W]   lưới dây nối: `deleteEmployeeAction` hỏi TRƯỚC khi xoá; hai script dọn dữ liệu dọn quy nguồn TRƯỚC khi xoá học viên
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `NFK_`.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { nguoiDangGioiThieuLead } from "../../lib/nguon/nguoi-gioi-thieu";
import { xoaQuyNguonTheoNguoiGioiThieu } from "../../lib/nguon/ghi-nguon";
import { damBaoDanhMucGoc, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "NFK_";
const CASE = 60_000;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  if (leads.length > 0) await db.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } }); // Cascade kéo quy nguồn
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: P } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "NFK" } } });
}

describe.skipIf(!RUN)("PR2 — FK Restrict sang người giới thiệu", () => {
  let nhom: IdNhom;

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
  }, CASE);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 120_000);

  const dungLeadCoNguoi = async (ten: string, nguoi: Record<string, string | null>, kind: "EMPLOYEE" | "PARENT" | "AFFILIATE") => {
    const l = await db.lead.create({ data: { parentName: `${P}${ten}`, phone: `0907${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, status: "MOI" }, select: { id: true } });
    await db.leadAttribution.create({
      data: { leadId: l.id, groupId: nhom.EMPLOYEE_REFERRAL, originalGroupId: nhom.EMPLOYEE_REFERRAL, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "t", referrerKind: kind, ...nguoi },
    });
    return l.id;
  };
  const dungEmp = (hau: string) =>
    db.employee.create({ data: { employeeCode: `${P}${hau}`, fullName: `${P}NV ${hau}`, jobTitle: "x", department: "TUYEN_SINH", isActive: true }, select: { id: true } });
  /** `pg_constraint.confdeltype`: 'r' = RESTRICT, 'a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL. */
  const kieuXoaCuaFk = async (ten: string): Promise<string | undefined> =>
    (await db.$queryRaw<{ confdeltype: string }[]>`SELECT confdeltype::text AS confdeltype FROM pg_constraint WHERE conname = ${ten}`)[0]?.confdeltype;
  const dungStudent = (hau: string) => db.student.create({ data: { name: `${P}HS ${hau}` }, select: { id: true } });

  it("[NHH-SRC-FK-01] đối chứng: xoá THẲNG nhân viên đang là người giới thiệu ⇒ DB từ chối, nêu đúng ràng buộc; ràng buộc là RESTRICT thật", async () => {
    const e = await dungEmp("E1");
    await dungLeadCoNguoi("L1", { referrerEmployeeId: e.id }, "EMPLOYEE");
    // ⚠️ KHÔNG khẳng định câu chữ lỗi của Postgres: PG 18 (máy dev) báo "RESTRICT setting of foreign key
    // constraint" (23001), PG 16 (CI) báo 23503 và Prisma dịch thành "Foreign key constraint violated". Bản
    // cũ chỉ nhận câu của PG 18 ⇒ xanh ở máy dev, đỏ ở CI. Thứ ổn định ở cả hai: TÊN ràng buộc trong
    // thông báo, và `confdeltype = 'r'` trong catalog (đo tính chất RESTRICT trực tiếp, không qua câu chữ).
    await expect(db.employee.delete({ where: { id: e.id } })).rejects.toThrow(/LeadAttribution_referrerEmployeeId_fkey/);
    expect(await kieuXoaCuaFk("LeadAttribution_referrerEmployeeId_fkey")).toBe("r");
  }, CASE);

  it("[NHH-SRC-FK-02] nguoiDangGioiThieuLead: bắt cả NHÂN VIÊN · HỌC VIÊN · PHỤ HUYNH · ĐỐI TÁC; không bắt oan người chưa giới thiệu ai", async () => {
    const e = await dungEmp("E2");
    const s = await dungStudent("S2");
    const u = await db.user.create({ data: { name: `${P}U`, email: `${P}u2@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    const a = await db.affiliate.create({ data: { code: "NFKAFF1", name: `${P}aff`, isActive: true }, select: { id: true } });
    const rong = await dungEmp("RONG");

    expect(await nguoiDangGioiThieuLead({ employeeId: e.id })).toBe(false);
    await dungLeadCoNguoi("L2a", { referrerEmployeeId: e.id }, "EMPLOYEE");
    await dungLeadCoNguoi("L2b", { referrerStudentId: s.id }, "PARENT");
    await dungLeadCoNguoi("L2c", { referrerParentUserId: u.id }, "PARENT");
    await dungLeadCoNguoi("L2d", { referrerAffiliateId: a.id }, "AFFILIATE");
    expect(await nguoiDangGioiThieuLead({ employeeId: e.id })).toBe(true);
    expect(await nguoiDangGioiThieuLead({ studentId: s.id })).toBe(true);
    expect(await nguoiDangGioiThieuLead({ userId: u.id })).toBe(true);
    expect(await nguoiDangGioiThieuLead({ affiliateId: a.id })).toBe(true);
    expect(await nguoiDangGioiThieuLead({ employeeId: rong.id })).toBe(false); // đối chứng âm
    expect(await nguoiDangGioiThieuLead({})).toBe(false); // không hỏi gì ⇒ không bắt gì
  }, CASE);

  it("[NHH-SRC-FK-03] xoaQuyNguonTheoNguoiGioiThieu dọn ĐÚNG dòng của tập sắp xoá rồi xoá cứng học viên được; dòng của học viên KHÁC còn nguyên", async () => {
    const s1 = await dungStudent("S3a");
    const s2 = await dungStudent("S3b");
    const l1 = await dungLeadCoNguoi("L3a", { referrerStudentId: s1.id }, "PARENT");
    const l2 = await dungLeadCoNguoi("L3b", { referrerStudentId: s2.id }, "PARENT");
    // Chưa dọn ⇒ xoá cứng bị chặn.
    await expect(db.student.delete({ where: { id: s1.id } })).rejects.toThrow(/LeadAttribution_referrerStudentId_fkey/);
    expect(await kieuXoaCuaFk("LeadAttribution_referrerStudentId_fkey")).toBe("r");
    const n = await xoaQuyNguonTheoNguoiGioiThieu(db, { studentIds: [s1.id], userIds: [], employeeIds: [], affiliateIds: [] });
    expect(n).toBe(1);
    await db.student.delete({ where: { id: s1.id } }); // giờ xoá được
    expect(await db.leadAttribution.count({ where: { leadId: l1 } })).toBe(0);
    expect(await db.leadAttribution.count({ where: { leadId: l2 } })).toBe(1); // KHÔNG đụng người khác
    expect(await db.lead.count({ where: { id: l1 } })).toBe(1); // chỉ dòng quy nguồn bị dọn, lead còn
  }, CASE);

  it("[NHH-SRC-FK-02b] `referrerSaleUserId` (Sale phụ trách PH, FK Restrict sang User): xoá cứng user ĐANG LÀ Sale của một dòng quy nguồn bị DB chặn; `nguoiDangGioiThieuLead({ userId })` bắt được; user không dính thì không", async () => {
    // Cấy: bỏ `{ referrerSaleUserId: m.userId }` khỏi `nguoiDangGioiThieuLead` ⇒ Sale lọt qua rồi xoá User nổ RESTRICT thô (đỏ).
    const sale = await db.user.create({ data: { name: `${P}Sale`, email: `${P}sale2b@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], isActive: true }, select: { id: true } });
    const roi = await db.user.create({ data: { name: `${P}Roi`, email: `${P}roi2b@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], isActive: true }, select: { id: true } });
    expect(await nguoiDangGioiThieuLead({ userId: sale.id })).toBe(false);
    const ph = await db.user.create({ data: { name: `${P}PH2b`, email: `${P}ph2b@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    await dungLeadCoNguoi("L2b2", { referrerParentUserId: ph.id, referrerSaleUserId: sale.id }, "PARENT");
    expect(await nguoiDangGioiThieuLead({ userId: sale.id })).toBe(true);
    expect(await nguoiDangGioiThieuLead({ userId: roi.id })).toBe(false); // đối chứng âm
    // đường XOÁ NHÂN SỰ: `saleUserId` = tài khoản của nhân sự — chỉ hỏi cột Sale, KHÔNG hỏi cột phụ huynh
    expect(await nguoiDangGioiThieuLead({ saleUserId: sale.id })).toBe(true);
    expect(await nguoiDangGioiThieuLead({ saleUserId: roi.id })).toBe(false);
    expect(await nguoiDangGioiThieuLead({ saleUserId: ph.id }), "PH là referrerParentUserId, không phải Sale ⇒ saleUserId không hỏi cột đó").toBe(false);
    await expect(db.user.delete({ where: { id: sale.id } })).rejects.toThrow(/LeadAttribution_referrerSaleUserId_fkey/);
    expect(await kieuXoaCuaFk("LeadAttribution_referrerSaleUserId_fkey")).toBe("r");
  }, CASE);

  it("[NHH-SRC-FK-03c] dọn dữ liệu thử với User là SALE phụ trách PH: chỉ GỠ cột `referrerSaleUserId`, KHÔNG xoá dòng quy nguồn của lead (lead thật không mất nguồn); xoá cứng User được sau đó", async () => {
    // Cấy: dọn bằng `deleteMany` theo referrerSaleUserId ⇒ ca «dòng quy nguồn còn» đỏ. Cấy: bỏ `updateMany` ⇒ xoá User nổ RESTRICT (đỏ).
    const sale = await db.user.create({ data: { name: `${P}Sale3`, email: `${P}sale3c@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], isActive: true }, select: { id: true } });
    const ph = await db.user.create({ data: { name: `${P}PH3`, email: `${P}ph3c@example.test`, role: "PARENT", roles: ["PARENT"], isActive: true }, select: { id: true } });
    const l = await dungLeadCoNguoi("L3c", { referrerParentUserId: ph.id, referrerSaleUserId: sale.id }, "PARENT");
    await expect(db.user.delete({ where: { id: sale.id } })).rejects.toThrow(/LeadAttribution_referrerSaleUserId_fkey/);
    const xoa = await xoaQuyNguonTheoNguoiGioiThieu(db, { studentIds: [], userIds: [sale.id], employeeIds: [], affiliateIds: [] });
    expect(xoa, "không có dòng nào có PH thuộc tập xoá ⇒ 0 dòng bị xoá").toBe(0);
    const con = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: l } });
    expect(con.referrerSaleUserId).toBeNull(); // chỉ cột Sale bị gỡ
    expect(con.referrerParentUserId).toBe(ph.id); // phụ huynh giới thiệu GIỮ NGUYÊN
    await db.user.delete({ where: { id: sale.id } }); // giờ xoá được
  }, CASE);

  it("[NHH-SRC-FK-03b] danh sách rỗng ⇒ xoá 0 dòng (không bao giờ thành `deleteMany` không điều kiện)", async () => {
    const e = await dungEmp("E4");
    await dungLeadCoNguoi("L4", { referrerEmployeeId: e.id }, "EMPLOYEE");
    expect(await xoaQuyNguonTheoNguoiGioiThieu(db, { studentIds: [], userIds: [], employeeIds: [], affiliateIds: [] })).toBe(0);
    expect(await db.leadAttribution.count({ where: { referrerEmployeeId: e.id } })).toBe(1);
  }, CASE);
});
