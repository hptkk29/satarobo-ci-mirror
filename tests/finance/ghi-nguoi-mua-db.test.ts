// tests/finance/ghi-nguoi-mua-db.test.ts — khối «Người mua trên hoá đơn» (8 ô) trên Postgres THẬT: lưu lên ĐƠN và
// đồng bộ sang HỒ SƠ HỌC VIÊN / PHIẾU LEAD trong cùng một transaction. 01/11/2026.
//
// Chạy:  DATABASE_URL=…/satarobo_test_hdnm DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/ghi-nguoi-mua-db.test.ts
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố (luật 18). Chạy MỘT MÌNH từng ca đều xanh.
//
// VÌ SAO DB THẬT: thứ cần chứng minh là (1) ô nào sang hồ sơ, ô nào KHÔNG (không đè giá trị hồ sơ chỉ vì nó được
// điền sẵn); (2) mọi bản sao đổi theo (Lead · LeadChild · Lead.childName) — mã đồng bộ chạm 5 bảng; (3) cổng quyền +
// cổng cơ sở là mã thật (RBAC v2 như prod); (4) vết không chứa giá trị CCCD.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; name: string; email: string; role: string; roles: string[] } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/audit/headers", () => ({ getRequestMetadata: async () => ({ ip: "10.0.0.8", userAgent: "vitest-db" }) }));
vi.mock("@/lib/email/trigger", () => ({ sendEmailForTrigger: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify/order", () => ({ notifyOrderByZnsIfNoEmail: vi.fn() }));
vi.mock("@/lib/lead/tuong-tac/ghi", () => ({ ghiTuongTacLeadBoQuaLoi: vi.fn(async () => undefined) }));

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { luuThongTinHoaDonAction } from "@/app/(admin)/admin/orders/_actions";
import { docHieuLucNguoiMuaTuDb } from "@/lib/finance/hoa-don/ghi-nguoi-mua";
import { FORM_TRONG, type FormNguoiMua } from "@/lib/finance/hoa-don/form-nguoi-mua";

if (!RUN_DB_TESTS) console.warn(`[HDN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = "ci-hdn-";
const LEAD = `${P}lead`;
const CON_A = `${P}con-a`;
const HV = `${P}hv`;
const CCCD_HV = "048215001234";
const CCCD_PH = "048183006790";
const HOM_NAY = new Date("2026-11-01T03:00:00Z");

type Nguoi = "admin" | "qlcs1" | "qlcs2" | "ketoan";
// `vai` = RoleDef (RBAC v2, đúng như prod); `role` = enum cột User.
const NGUOI: Record<Nguoi, { role: Role; vai: string; donVi: "CS1" | "CS2" | "HO" }> = {
  admin: { role: "SUPER_ADMIN", vai: "SUPER_ADMIN", donVi: "HO" },
  qlcs1: { role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS1" }, // có students:edit, KHÔNG payments:view-pii
  qlcs2: { role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS2" },
  ketoan: { role: "ACCOUNTANT", vai: "HO_ACCOUNTANT", donVi: "HO" }, // có orders:manage + view-pii, KHÔNG students:edit
};
const DS = Object.keys(NGUOI) as Nguoi[];
const id = {} as Record<Nguoi, string>;
const email = (n: Nguoi) => `${P}${n}@ci.test`;
const phien = (n: Nguoi) => ({ user: { id: id[n], name: `Fixture ${n}`, email: email(n), role: NGUOI[n].role, roles: [NGUOI[n].role] } });

let CS1 = "";
let dem = 0;

async function donDon() {
  const ids = (await db.order.findMany({ where: { customerName: { startsWith: P } }, select: { id: true } })).map((d) => d.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
}
async function donHoSo() {
  await db.auditLog.deleteMany({ where: { entityType: "Student", entityId: HV } });
  await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: LEAD } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.leadChild.deleteMany({ where: { leadId: LEAD } });
  await db.lead.deleteMany({ where: { id: LEAD } });
}
async function donNguoi() {
  const xs = (await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } })).map((u) => u.id);
  if (xs.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: xs } } });
    await db.user.deleteMany({ where: { id: { in: xs } } });
  }
}

/** Dựng hồ sơ: phiếu lead + một em + (tuỳ chọn) học viên nối phiếu. Mọi ô PH/địa chỉ/ngày sinh của hồ sơ đã có sẵn. */
async function dungHoSo(coHocVien: boolean) {
  await donHoSo();
  await db.lead.create({
    data: {
      id: LEAD,
      parentName: "Phan Thị Hồng (lead)",
      phone: "84905000111",
      email: "lead-ph@example.com",
      city: "Thành phố Đà Nẵng",
      ward: "Phường Hải Châu",
      addressLine: "60 Đồng Du",
      childName: "Bé Hoàng",
      centerId: CS1,
      children: { create: [{ id: CON_A, fullName: "Bé Hoàng", dob: new Date("2015-03-09T00:00:00Z") }] },
    },
  });
  if (coHocVien) {
    await db.student.create({
      data: {
        id: HV,
        name: "Bé Hoàng",
        dateOfBirth: new Date("2015-03-09T00:00:00Z"),
        parentName: "Phan Thị Hồng (hồ sơ)",
        parentPhone: "0905000111",
        parentEmail: null, // hồ sơ còn TRỐNG ô này ⇒ phải được điền
        parentNationalId: null,
        nationalId: null,
        city: "Thành phố Đà Nẵng",
        ward: "Phường Hải Châu",
        address: "60 Đồng Du",
        centerId: CS1,
        leadId: LEAD,
        leadChildId: CON_A,
      },
    });
  }
}

type DonThem = Partial<{
  customerName: string; customerPhone: string; customerEmail: string | null;
  invoiceBuyerName: string | null; invoiceStudentName: string | null; customerAddress: string | null; customerCity: string | null;
}>;
async function taoDon(coHocVien: boolean, them: DonThem = {}) {
  const n = ++dem;
  return db.order.create({
    data: {
      code: `${P}ORD-${n}-${Date.now() % 100000}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: `${P}khach-${n}`,
      customerPhone: "0905123477",
      centerId: CS1,
      leadId: LEAD,
      leadChildId: CON_A,
      studentId: coHocVien ? HV : null,
      ...them,
    },
    select: { id: true, updatedAt: true },
  });
}
const docDon = (orderId: string) => db.order.findUniqueOrThrow({ where: { id: orderId } });
async function luu(o: { id: string; updatedAt: Date }, form: FormNguoiMua, banDau: FormNguoiMua, cu = o.updatedAt) {
  return luuThongTinHoaDonAction(o.id, { form, banDau }, cu.toISOString());
}
const hieuLuc = async (orderId: string) => (await docHieuLucNguoiMuaTuDb(await docDon(orderId))).hieuLuc.form;
const anhChup = async (orderId: string) =>
  JSON.stringify({
    don: await docDon(orderId),
    hv: await db.student.findUnique({ where: { id: HV } }),
    lead: await db.lead.findUnique({ where: { id: LEAD } }),
    con: await db.leadChild.findUnique({ where: { id: CON_A } }),
    audit: await db.auditLog.count({ where: { OR: [{ entityId: orderId }, { entityId: HV }, { entityId: LEAD }] } }),
  });

describe.skipIf(!RUN_DB_TESTS)("[HDN-DB] người mua trên hoá đơn — đơn ⇄ hồ sơ, Postgres + RBAC v2 + scopedDb THẬT", () => {
  const rbacGoc = process.env.RBAC_V2_ENABLED;

  beforeAll(async () => {
    assertTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HOM_NAY);
    await donDon();
    await donHoSo();
    await donNguoi();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const n of DS) {
      const u = await seedUser({ email: email(n), name: `${P}${n}`, role: NGUOI[n].role });
      id[n] = u.id;
      const [vai, dv] = await Promise.all([
        db.roleDef.findUniqueOrThrow({ where: { code: NGUOI[n].vai }, select: { id: true } }),
        db.orgUnit.findUniqueOrThrow({ where: { code: NGUOI[n].donVi }, select: { id: true } }),
      ]);
      await db.userOrgRole.create({
        data: { userId: u.id, orgUnitId: dv.id, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
      });
    }
  });

  beforeEach(async () => {
    h.session = phien("admin");
    process.env.RBAC_V2_ENABLED = "true"; // như prod
    vi.setSystemTime(HOM_NAY);
    await donDon();
    await dungHoSo(true);
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      vi.useRealTimers();
      await donDon();
      await donHoSo();
      await donNguoi();
    } finally {
      await disconnectDb();
    }
  });

  it("[HDN-DB-01] điền sẵn: đơn trống ⇒ lấy hồ sơ HV (rồi lead); ba/mẹ lấy theo customer* của đơn", async () => {
    const o = await taoDon(true, { customerEmail: "khach@example.com" });
    const f = await hieuLuc(o.id);
    expect(f).toMatchObject({
      hocVienTen: "Bé Hoàng",
      hocVienNgaySinh: "2015-03-09",
      tinh: "Thành phố Đà Nẵng",
      phuong: "Phường Hải Châu",
      diaChi: "60 Đồng Du",
      phuHuynhTen: `${P}khach-${dem}`, // customerName của đơn thắng hồ sơ
      phuHuynhSdt: "0905123477",
      phuHuynhEmail: "khach@example.com",
    });
  });

  it("[HDN-DB-02] chưa có học viên (đơn trước chuyển đổi) ⇒ điền sẵn từ PHIẾU LEAD + đứa con", async () => {
    await dungHoSo(false);
    const o = await taoDon(false);
    const f = await hieuLuc(o.id);
    expect(f).toMatchObject({ hocVienTen: "Bé Hoàng", hocVienNgaySinh: "2015-03-09", diaChi: "60 Đồng Du" });
  });

  it("[HDN-DB-03] SỬA tên ba/mẹ + SĐT + địa chỉ + ngày sinh + tên em ⇒ đơn đổi, HV đổi, và DỘI sang lead + LeadChild + Lead.childName; customerName/Phone KHÔNG đổi", async () => {
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const form: FormNguoiMua = {
      ...banDau,
      hocVienTen: "Nguyễn Đức Huy Hoàng",
      hocVienNgaySinh: "2015-03-10",
      phuHuynhTen: "Phan Thị Hồng Mới",
      phuHuynhSdt: "0911222333",
      diaChi: "62 Đồng Du",
    };
    const res = await luu(o, form, banDau);
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const don = await docDon(o.id);
    expect(don).toMatchObject({
      invoiceStudentName: "Nguyễn Đức Huy Hoàng",
      invoiceBuyerName: "Phan Thị Hồng Mới",
      invoiceParentPhone: "0911222333",
      customerAddress: "62 Đồng Du",
      customerName: `${P}khach-${dem}`, // snapshot đơn + chìa đối khớp tiền: KHÔNG đụng
      customerPhone: "0905123477",
    });
    expect(don.invoiceStudentDob).toEqual(new Date("2015-03-10T00:00:00Z"));

    const hv = await db.student.findUniqueOrThrow({ where: { id: HV } });
    expect(hv).toMatchObject({ name: "Nguyễn Đức Huy Hoàng", parentName: "Phan Thị Hồng Mới", parentPhone: "0911222333", address: "62 Đồng Du" });
    expect(hv.dateOfBirth).toEqual(new Date("2015-03-10T00:00:00Z"));

    const lead = await db.lead.findUniqueOrThrow({ where: { id: LEAD } });
    expect(lead).toMatchObject({ parentName: "Phan Thị Hồng Mới", phone: "84911222333", addressLine: "62 Đồng Du", childName: "Nguyễn Đức Huy Hoàng" });
    const con = await db.leadChild.findUniqueOrThrow({ where: { id: CON_A } });
    expect(con.fullName).toBe("Nguyễn Đức Huy Hoàng");
    expect(con.dob).toEqual(new Date("2015-03-10T00:00:00Z"));
  });

  it("[HDN-DB-04] ô chỉ ĐIỀN SẴN (người dùng không sửa) KHÔNG đè hồ sơ đang có giá trị khác; ô hồ sơ còn TRỐNG thì được điền", async () => {
    // Đơn mang email riêng; hồ sơ còn trống email. Đơn mang tên ba/mẹ khác hồ sơ.
    const o = await taoDon(true, { customerEmail: "khach@example.com", invoiceBuyerName: "Tên trên đơn" });
    const banDau = await hieuLuc(o.id);
    expect(banDau.phuHuynhTen).toBe("Tên trên đơn");
    const res = await luu(o, banDau, banDau); // bấm Lưu mà không sửa gì
    expect(res.ok).toBe(true);
    const hv = await db.student.findUniqueOrThrow({ where: { id: HV } });
    expect(hv.parentName).toBe("Phan Thị Hồng (hồ sơ)"); // KHÔNG bị đơn đè
    expect(hv.parentEmail).toBe("khach@example.com"); // trống ⇒ được điền
    expect((await db.lead.findUniqueOrThrow({ where: { id: LEAD } })).parentName).toBe("Phan Thị Hồng (lead)");
    // …nhưng đơn thì đã GHI đủ (snapshot "đã khai")
    expect((await docDon(o.id)).invoiceStudentName).toBe("Bé Hoàng");
  });

  it("[HDN-DB-05] CCCD học viên + CCCD ba/mẹ: admin ghi cả đơn lẫn hồ sơ; VẾT chỉ có TÊN cột, không có giá trị CCCD", async () => {
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const res = await luu(o, { ...banDau, hocVienCccd: CCCD_HV, phuHuynhCccd: CCCD_PH }, banDau);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await docDon(o.id)).toMatchObject({ invoiceStudentCccd: CCCD_HV, customerCccd: CCCD_PH });
    expect(await db.student.findUniqueOrThrow({ where: { id: HV }, select: { nationalId: true, parentNationalId: true } })).toEqual({
      nationalId: CCCD_HV,
      parentNationalId: CCCD_PH,
    });
    const vet = JSON.stringify(
      await db.auditLog.findMany({ where: { OR: [{ entityId: o.id }, { entityId: HV }, { entityId: LEAD }] } }),
    );
    expect(vet).not.toContain(CCCD_HV);
    expect(vet).not.toContain(CCCD_PH);
    expect(vet).toContain("invoiceStudentCccd"); // tên cột thì có
    expect(vet).toContain("nationalId");
  });

  it("[HDN-DB-06] QLCS (có students:edit, KHÔNG payments:view-pii): đơn ghi đủ, hồ sơ nhận mọi ô TRỪ CCCD — và nói rõ vì sao", async () => {
    h.session = phien("qlcs1");
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const res = await luu(o, { ...banDau, hocVienCccd: CCCD_HV, phuHuynhTen: "Tên mới QLCS" }, banDau);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.dongBo.boQua.map((b) => b.khoa)).toEqual(["hocVienCccd"]);
    expect(res.dongBo.boQua[0]!.lyDo).toMatch(/Thiếu quyền ghi CCCD/);
    expect((await docDon(o.id)).invoiceStudentCccd).toBe(CCCD_HV); // đơn vẫn lưu
    const hv = await db.student.findUniqueOrThrow({ where: { id: HV } });
    expect(hv.nationalId).toBeNull();
    expect(hv.parentName).toBe("Tên mới QLCS");
  });

  it("[HDN-DB-07] Kế toán Hội sở (orders:manage, KHÔNG students:edit): chỉ ghi ĐƠN, hồ sơ nguyên vẹn, mọi ô cần đẩy được báo là không ghi", async () => {
    h.session = phien("ketoan");
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const hvTruoc = JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }));
    const leadTruoc = JSON.stringify(await db.lead.findUniqueOrThrow({ where: { id: LEAD } }));
    const res = await luu(o, { ...banDau, phuHuynhTen: "Kế toán sửa" }, banDau);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect((await docDon(o.id)).invoiceBuyerName).toBe("Kế toán sửa");
    expect(JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }))).toBe(hvTruoc);
    expect(JSON.stringify(await db.lead.findUniqueOrThrow({ where: { id: LEAD } }))).toBe(leadTruoc);
    expect(res.dongBo.daGhi).toEqual([]);
    expect(res.dongBo.boQua.length).toBeGreaterThan(0);
    expect(res.dongBo.boQua[0]!.lyDo).toMatch(/Thiếu quyền sửa hồ sơ/);
  });

  it("[HDN-DB-08] chưa có học viên: ghi thẳng PHIẾU LEAD + LeadChild (+ childName); CCCD không có chỗ lưu ⇒ nói rõ, đơn vẫn giữ", async () => {
    await dungHoSo(false);
    const o = await taoDon(false);
    const banDau = await hieuLuc(o.id);
    const res = await luu(o, { ...banDau, hocVienTen: "Tên em mới", phuHuynhTen: "Mẹ mới", phuHuynhSdt: "0933444555", hocVienCccd: CCCD_HV }, banDau);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.dongBo.muc).toBe("LEAD");
    expect(res.dongBo.boQua).toEqual([{ khoa: "hocVienCccd", lyDo: expect.stringMatching(/Chưa có hồ sơ học viên/) }]);
    expect(await db.lead.findUniqueOrThrow({ where: { id: LEAD } })).toMatchObject({ parentName: "Mẹ mới", phone: "84933444555", childName: "Tên em mới" });
    expect((await db.leadChild.findUniqueOrThrow({ where: { id: CON_A } })).fullName).toBe("Tên em mới");
    expect((await docDon(o.id)).invoiceStudentCccd).toBe(CCCD_HV);
  });

  it("[HDN-DB-09] bản đã thấy cũ (updatedAt lệch) ⇒ STALE_WRITE và KHÔNG phép ghi nào ở đơn / HV / lead / nhật ký", async () => {
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const truoc = await anhChup(o.id);
    const res = await luu(o, { ...banDau, phuHuynhTen: "Không được ghi" }, banDau, new Date(o.updatedAt.getTime() - 1000));
    expect(res).toEqual({ ok: false, error: "STALE_WRITE" });
    expect(await anhChup(o.id)).toBe(truoc);
  });

  it("[HDN-DB-10] đơn ở cơ sở khác ⇒ 'Không tìm thấy đơn hàng', KHÔNG phép ghi nào", async () => {
    h.session = phien("qlcs2");
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const truoc = await anhChup(o.id);
    const res = await luu(o, { ...banDau, phuHuynhTen: "Cơ sở khác sửa" }, banDau);
    expect(res).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    expect(await anhChup(o.id)).toBe(truoc);
  });

  it("[HDN-DB-11] đầu vào sai (CCCD 5 số, email hỏng) ⇒ từ chối TRƯỚC mọi đọc/ghi", async () => {
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const truoc = await anhChup(o.id);
    for (const sai of [{ hocVienCccd: "12345" }, { phuHuynhEmail: "khong-phai-email" }, { hocVienNgaySinh: "2099-01-01" }]) {
      const res = await luu(o, { ...banDau, ...sai }, banDau);
      expect(res.ok, JSON.stringify(sai)).toBe(false);
    }
    expect(await anhChup(o.id)).toBe(truoc);
  });

  it("[HDN-DB-12] không đổi gì (đơn đã khớp hồ sơ) ⇒ không đẻ vết rỗng, không bump updatedAt", async () => {
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    expect((await luu(o, banDau, banDau)).ok).toBe(true); // lượt đầu: snapshot các ô lên đơn
    const sau1 = await docDon(o.id);
    const baoNhieu = await db.auditLog.count({ where: { OR: [{ entityId: o.id }, { entityId: HV }, { entityId: LEAD }] } });
    const f2 = await hieuLuc(o.id);
    expect((await luu({ id: o.id, updatedAt: sau1.updatedAt }, f2, f2)).ok).toBe(true); // lượt hai: y hệt
    expect((await docDon(o.id)).updatedAt).toEqual(sau1.updatedAt);
    expect(await db.auditLog.count({ where: { OR: [{ entityId: o.id }, { entityId: HV }, { entityId: LEAD }] } })).toBe(baoNhieu);
  });

  it("[HDN-DB-14] học viên của đơn nằm ở cơ sở NGOÀI tầm nhìn người sửa ⇒ đơn vẫn lưu, hồ sơ HV KHÔNG đổi, và nói rõ vì sao", async () => {
    h.session = phien("qlcs1");
    const cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    await db.student.update({ where: { id: HV }, data: { centerId: cs2 } });
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const hvTruoc = JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }));
    const res = await luu(o, { ...banDau, phuHuynhTen: "Sửa chéo cơ sở" }, banDau);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect((await docDon(o.id)).invoiceBuyerName).toBe("Sửa chéo cơ sở");
    expect(JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }))).toBe(hvTruoc);
    expect(res.dongBo.boQua[0]!.lyDo).toMatch(/ngoài tầm nhìn/);
  });

  it("[HDN-DB-13] đối chứng ÂM của form trống: FORM_TRONG không bao giờ xoá hồ sơ", async () => {
    const o = await taoDon(true);
    const banDau = await hieuLuc(o.id);
    const res = await luu(o, { ...FORM_TRONG }, banDau);
    expect(res.ok).toBe(true);
    const hv = await db.student.findUniqueOrThrow({ where: { id: HV } });
    expect(hv).toMatchObject({ name: "Bé Hoàng", parentName: "Phan Thị Hồng (hồ sơ)", address: "60 Đồng Du" });
  });
});
