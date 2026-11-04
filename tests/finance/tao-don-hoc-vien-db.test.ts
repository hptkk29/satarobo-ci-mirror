// tests/finance/tao-don-hoc-vien-db.test.ts — ba ô HỌC VIÊN (tên · ngày sinh · CCCD) khai ngay lúc TẠO ĐƠN, Postgres THẬT.
// 01/11/2026.
//
// Chạy:  DATABASE_URL=…/satarobo_test_hdnm DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/tao-don-hoc-vien-db.test.ts
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố (luật 18). Đồng hồ đóng băng (luật 19).
//
// VÌ SAO DB THẬT: bẫy đã gặp hai lần (`keHoachDot`, `soBuoi`) là «ô gửi lên từ form mà cột trên đơn KHÔNG BAO GIỜ có giá trị» —
// `z.object` gỡ khoá lạ im lặng, mọi test thuần vẫn xanh. Chỉ đọc lại cột sau `createOrderManualAction` mới chứng minh nó được ghi.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; name: string; email: string; role: string; roles: string[] } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/audit/headers", () => ({ getRequestMetadata: async () => ({ ip: "10.0.0.9", userAgent: "vitest-db" }) }));
vi.mock("@/lib/email/trigger", () => ({ sendEmailForTrigger: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify/order", () => ({ notifyOrderByZnsIfNoEmail: vi.fn() }));
vi.mock("@/lib/lead/tuong-tac/ghi", () => ({ ghiTuongTacLeadBoQuaLoi: vi.fn(async () => undefined) }));

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { createOrderManualAction } from "@/app/(admin)/admin/orders/_actions";

if (!RUN_DB_TESTS) console.warn(`[TDH-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = "ci-tdh-";
const KHOA = `${P}khoa`;
const LEAD = `${P}lead`;
const CON_A = `${P}con-a`;
const HV = `${P}hv`;
const PTTT = `${P}pttt`;
const CCCD = "048215001234";
const HOM_NAY = new Date("2026-11-01T03:00:00Z");

type Nguoi = "admin" | "qlcs1" | "ketoan";
const NGUOI: Record<Nguoi, { role: Role; vai: string; donVi: "CS1" | "HO" }> = {
  admin: { role: "SUPER_ADMIN", vai: "SUPER_ADMIN", donVi: "HO" },
  qlcs1: { role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS1" }, // students:edit, KHÔNG payments:view-pii
  ketoan: { role: "ACCOUNTANT", vai: "HO_ACCOUNTANT", donVi: "HO" }, // KHÔNG students:edit
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
    await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
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

/** Hồ sơ: phiếu lead + một em + học viên nối em đó; ngày sinh / CCCD của HỌC VIÊN còn TRỐNG (tuỳ chọn). */
async function dungHoSo(o: { hvDob?: Date | null; hvCccd?: string | null } = {}) {
  await donHoSo();
  await db.lead.create({
    data: {
      id: LEAD, parentName: `${P}Phụ huynh`, phone: "0905123477", centerId: CS1,
      children: { create: [{ id: CON_A, fullName: "Bé Hoàng", dob: new Date("2015-03-09T00:00:00Z") }] },
    },
  });
  await db.student.create({
    data: {
      id: HV, name: "Bé Hoàng", dateOfBirth: o.hvDob ?? null, nationalId: o.hvCccd ?? null,
      parentName: `${P}Phụ huynh`, parentPhone: "0905123477", centerId: CS1, leadId: LEAD, leadChildId: CON_A,
    },
  });
}

const dong = () => ({
  type: "COURSE_ENROLLMENT" as const, itemName: "Khoá fixture", quantity: 1, unitPrice: 5_000_000, leadChildId: CON_A,
  metadata: { courseId: KHOA, soBuoi: 11 },
});
function don(them: Record<string, unknown> = {}) {
  return {
    type: "COURSE" as const, status: "PENDING_PAYMENT" as const, customerName: `${P}khach-${++dem}`, customerPhone: "0905123477",
    customerEmail: "", leadId: LEAD, centerId: CS1, paymentMethodId: PTTT, items: [dong()], shippingFee: 0, ...them,
  };
}
const docDon = (customerName: string) => db.order.findFirstOrThrow({ where: { customerName } });

describe.skipIf(!RUN_DB_TESTS)("[TDH-DB] ba ô học viên lúc tạo đơn — Postgres + RBAC v2 + scopedDb THẬT", () => {
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
    await db.course.upsert({
      where: { id: KHOA }, create: { id: KHOA, name: "Khoá fixture", slug: KHOA, price: 5_000_000, totalSessions: 11 },
      update: { price: 5_000_000, totalSessions: 11 },
    });
    await db.paymentMethod.deleteMany({ where: { id: PTTT } });
    await db.paymentMethod.create({ data: { id: PTTT, code: `${P}CK`, name: "Chuyển khoản (fixture)", type: "BANK_TRANSFER", isActive: true, centerId: null } });
  });

  beforeEach(async () => {
    h.session = phien("admin");
    process.env.RBAC_V2_ENABLED = "true"; // như prod
    vi.setSystemTime(HOM_NAY);
    await donDon();
    await dungHoSo();
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      vi.useRealTimers();
      await donDon();
      await donHoSo();
      await db.paymentMethod.deleteMany({ where: { id: PTTT } });
      await db.course.deleteMany({ where: { id: KHOA } });
      await donNguoi();
    } finally {
      await disconnectDb();
    }
  });

  it("[TDH-DB-01] form gửi 3 ô ⇒ CỘT TRÊN ĐƠN có giá trị (ngày sinh = nửa đêm UTC của ngày VN); hồ sơ trống được điền; tên hồ sơ KHÔNG bị đè", async () => {
    const d = don({ invoiceStudentName: "Hoàng Gia Bảo", invoiceStudentDob: "2015-03-09", invoiceStudentCccd: CCCD });
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.canhBaoHoSo).toBeNull();
    const o = await docDon(d.customerName);
    expect(o.invoiceStudentName).toBe("Hoàng Gia Bảo");
    expect(o.invoiceStudentDob?.toISOString()).toBe("2015-03-09T00:00:00.000Z");
    expect(o.invoiceStudentCccd).toBe(CCCD);
    const hv = await db.student.findUniqueOrThrow({ where: { id: HV } });
    expect(hv.dateOfBirth?.toISOString()).toBe("2015-03-09T00:00:00.000Z"); // ô trống ⇒ được điền
    expect(hv.nationalId).toBe(CCCD);
    expect(hv.name).toBe("Bé Hoàng"); // hồ sơ đã có tên ⇒ KHÔNG đè bằng tên gõ ở form tạo đơn
  });

  it("[TDH-DB-02] hồ sơ ĐÃ CÓ ngày sinh / CCCD khác ⇒ KHÔNG bị đè (đơn giữ giá trị người dùng khai)", async () => {
    await dungHoSo({ hvDob: new Date("2014-01-02T00:00:00Z"), hvCccd: "079099001111" });
    const d = don({ invoiceStudentDob: "2015-03-09", invoiceStudentCccd: CCCD });
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    expect(o.invoiceStudentCccd).toBe(CCCD);
    const hv = await db.student.findUniqueOrThrow({ where: { id: HV } });
    expect(hv.dateOfBirth?.toISOString()).toBe("2014-01-02T00:00:00.000Z");
    expect(hv.nationalId).toBe("079099001111");
  });

  it("[TDH-DB-03] đối chứng ÂM: KHÔNG khai ô nào ⇒ ba cột null, hồ sơ không đổi, không cảnh báo", async () => {
    const hvTruoc = JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }));
    const d = don();
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.canhBaoHoSo).toBeNull();
    const o = await docDon(d.customerName);
    expect([o.invoiceStudentName, o.invoiceStudentDob, o.invoiceStudentCccd]).toEqual([null, null, null]);
    expect(JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }))).toBe(hvTruoc);
  });

  it("[TDH-DB-04] CCCD sai độ dài / ngày sinh ở tương lai ⇒ TỪ CHỐI, không đơn nào được tạo", async () => {
    const xau = don({ invoiceStudentCccd: "12345" });
    const r1 = await createOrderManualAction(xau);
    expect(r1.ok).toBe(false);
    const tuongLai = don({ invoiceStudentDob: "2030-01-01" });
    const r2 = await createOrderManualAction(tuongLai);
    expect(r2.ok).toBe(false);
    expect(await db.order.count({ where: { customerName: { in: [xau.customerName, tuongLai.customerName] } } })).toBe(0);
  });

  it("[TDH-DB-05] người tạo thiếu `students:edit` (kế toán) ⇒ đơn VẪN lưu đủ 3 ô, hồ sơ KHÔNG đổi, và nói rõ vì sao", async () => {
    h.session = phien("ketoan");
    const hvTruoc = JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }));
    const d = don({ invoiceStudentDob: "2015-03-09", invoiceStudentCccd: CCCD });
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.canhBaoHoSo).toMatch(/chưa ghi sang hồ sơ/);
    const o = await docDon(d.customerName);
    expect(o.invoiceStudentCccd).toBe(CCCD);
    expect(JSON.stringify(await db.student.findUniqueOrThrow({ where: { id: HV } }))).toBe(hvTruoc);
  });

  it("[TDH-DB-06] QLCS (có students:edit, KHÔNG payments:view-pii): ngày sinh sang hồ sơ, CCCD thì KHÔNG — và nói rõ", async () => {
    h.session = phien("qlcs1");
    const d = don({ invoiceStudentDob: "2015-03-09", invoiceStudentCccd: CCCD });
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    const hv = await db.student.findUniqueOrThrow({ where: { id: HV } });
    expect(hv.dateOfBirth?.toISOString()).toBe("2015-03-09T00:00:00.000Z");
    expect(hv.nationalId).toBeNull();
    expect(res.canhBaoHoSo).toMatch(/CCCD/);
  });

  it("[TDH-DB-07] vết kiểm toán của đơn và của học viên KHÔNG chứa số CCCD", async () => {
    const d = don({ invoiceStudentCccd: CCCD });
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    const vet = await db.auditLog.findMany({ where: { OR: [{ entityType: "Order", entityId: o.id }, { entityType: "Student", entityId: HV }] } });
    expect(vet.length).toBeGreaterThan(0);
    expect(JSON.stringify(vet)).not.toContain(CCCD);
  });
});
