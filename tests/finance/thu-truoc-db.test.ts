// tests/finance/thu-truoc-db.test.ts — "Thu trước (cọc)" trên Postgres THẬT: tạo đơn bằng form-action → bấm thu trước qua action thật.
//
// Chạy:  DATABASE_URL=…/satarobo_test_tt DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/thu-truoc-db.test.ts
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố (luật 18). Đồng hồ đóng băng (luật 19).
//
// VÌ SAO DB THẬT: thứ cần chứng minh là (1) cổng đứng TRƯỚC phép ghi — đếm hàng trước/sau ở mọi bảng tiền; (2) sau khi ghi, phiếu
// toàn đơn được thay bằng ĐÚNG hai phiếu đợt cộng lại bằng tổng đơn; (3) quyền + phạm vi cơ sở của action là mã thật.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; name: string; email: string; role: string; roles: string[] } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/audit/headers", () => ({ getRequestMetadata: async () => ({ ip: "10.0.0.7", userAgent: "vitest-db" }) }));
vi.mock("@/lib/email/trigger", () => ({ sendEmailForTrigger: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify/order", () => ({ notifyOrderByZnsIfNoEmail: vi.fn() }));
vi.mock("@/lib/lead/tuong-tac/ghi", () => ({ ghiTuongTacLeadBoQuaLoi: vi.fn(async () => undefined) }));

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { createOrderManualAction } from "@/app/(admin)/admin/orders/_actions";
import { thuTruocAction } from "@/app/(admin)/admin/orders/_thu-truoc-actions";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { LY_DO_KHONG_THU_TRUOC } from "@/lib/orders/thu-truoc";
import { recordInstallmentPlan } from "@/lib/orders/installments";
import { clearSettingsCache } from "@/lib/settings/service";

if (!RUN_DB_TESTS) console.warn(`[TT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = "ci-tt-";
const KHOA1 = `${P}khoa-sata1`; // 11 buổi — đơn thường
const KHOA3 = `${P}khoa-sata3`; // 48 buổi — đơn SCOPE khi cờ bật
const LEAD = `${P}lead`;
const CON_A = `${P}con-a`;
const PTTT = `${P}pttt`;
const HOM_NAY = new Date("2026-10-30T03:00:00Z");

type Nguoi = "qlcs1" | "qlcs2" | "admin" | "gv";
const NGUOI: Record<Nguoi, { role: Role; donVi: "CS1" | "CS2" | "HO" }> = {
  qlcs1: { role: "CENTER_MANAGER", donVi: "CS1" },
  qlcs2: { role: "CENTER_MANAGER", donVi: "CS2" },
  admin: { role: "SUPER_ADMIN", donVi: "HO" },
  gv: { role: "TEACHER", donVi: "CS1" }, // đối chứng ÂM: vai không có `payments:record`
};
const DS = Object.keys(NGUOI) as Nguoi[];
const id = {} as Record<Nguoi, string>;
const email = (n: Nguoi) => `${P}${n}@ci.test`;
const phien = (n: Nguoi) => ({ user: { id: id[n], name: `Fixture ${n}`, email: email(n), role: NGUOI[n].role, roles: [NGUOI[n].role] } });

let CS1 = "";
let OU1 = "";

async function donDon() {
  const ids = (await db.order.findMany({ where: { customerName: { startsWith: P } }, select: { id: true } })).map((d) => d.id);
  if (ids.length > 0) {
    await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { orderId: { in: ids } } } });
    await db.studyEntitlement.deleteMany({ where: { orderId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: ids } } });
    await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
    await db.payment.deleteMany({ where: { orderId: { in: ids } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderInstallment.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  await db.studyEntitlement.deleteMany({ where: { courseId: { in: [KHOA1, KHOA3] } } });
}
async function donNguoi() {
  const xs = (await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } })).map((u) => u.id);
  if (xs.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: xs } } });
    await db.user.deleteMany({ where: { id: { in: xs } } });
  }
}
async function coPhamVi(bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId: OU1, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}
const khoa = (maKhoa: string, ten: string, price: number, totalSessions: number) =>
  db.course.upsert({ where: { id: maKhoa }, create: { id: maKhoa, name: ten, slug: maKhoa, price, totalSessions }, update: { name: ten, price, totalSessions } });

type Dong = Record<string, unknown>;
const dongThuong = (): Dong => ({ type: "COURSE_ENROLLMENT", itemName: "Sata 1", quantity: 1, unitPrice: 5_000_000, leadChildId: CON_A, metadata: { courseId: KHOA1, soBuoi: 11 } });
const dongScope = (): Dong => ({ type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 10_560_000, leadChildId: CON_A, metadata: { courseId: KHOA3, soBuoi: 48 } });
let dem = 0;
const don = (items: Dong[]) => ({
  type: "COURSE" as const,
  status: "PENDING_PAYMENT" as const,
  customerName: `${P}khach-${++dem}`,
  customerPhone: "0905123477",
  customerEmail: "",
  leadId: LEAD,
  centerId: CS1,
  paymentMethodId: PTTT,
  items,
  shippingFee: 0,
});
const docDon = (customerName: string) => db.order.findFirstOrThrow({ where: { customerName }, select: { id: true, totalAmount: true } });

async function anhChup(orderId: string) {
  const [dot, phieu, pay, phanBo, qr, audit] = await Promise.all([
    db.orderInstallment.findMany({ where: { orderId }, orderBy: { soDot: "asc" } }),
    db.paymentRequest.findMany({ where: { orderId }, orderBy: [{ installmentNo: "asc" }, { id: "asc" }] }),
    db.payment.count({ where: { orderId } }),
    db.paymentAllocation.count({ where: { paymentRequest: { orderId } } }),
    db.qrSession.count({ where: { paymentRequest: { orderId } } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: orderId } }),
  ]);
  return JSON.stringify({ dot, phieu, pay, phanBo, qr, audit });
}

describe.skipIf(!RUN_DB_TESTS)("[TT-DB] thu trước (cọc) — Postgres + RBAC + scopedDb THẬT", () => {
  const rbacGoc = process.env.RBAC_V2_ENABLED;

  beforeAll(async () => {
    assertTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HOM_NAY);
    await donDon();
    await donNguoi();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const n of DS) {
      const u = await seedUser({ email: email(n), name: `${P}${n}`, role: NGUOI[n].role });
      id[n] = u.id;
      const [vai, dv] = await Promise.all([
        db.roleDef.findUniqueOrThrow({ where: { code: NGUOI[n].role }, select: { id: true } }),
        db.orgUnit.findUniqueOrThrow({ where: { code: NGUOI[n].donVi }, select: { id: true } }),
      ]);
      await db.userOrgRole.create({
        data: { userId: u.id, orgUnitId: dv.id, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
      });
    }
    await khoa(KHOA1, "Sata 1 (fixture)", 5_000_000, 11);
    await khoa(KHOA3, "Sata 3 (fixture)", 10_560_000, 48);
    await db.leadChild.deleteMany({ where: { leadId: LEAD } });
    await db.lead.deleteMany({ where: { id: LEAD } });
    await db.lead.create({ data: { id: LEAD, parentName: `${P}Phụ huynh`, phone: "0905123477", centerId: CS1, children: { create: [{ id: CON_A, fullName: "Bé A" }] } } });
    await db.paymentMethod.deleteMany({ where: { id: PTTT } });
    await db.paymentMethod.create({ data: { id: PTTT, code: `${P}CK`, name: "Chuyển khoản (fixture)", type: "BANK_TRANSFER", isActive: true, centerId: null } });
  });

  beforeEach(async () => {
    h.session = phien("qlcs1");
    process.env.RBAC_V2_ENABLED = "false";
    vi.setSystemTime(HOM_NAY);
    await donDon();
    await coPhamVi(null);
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      vi.useRealTimers();
      await coPhamVi(null).catch(() => undefined);
      await donDon();
      await db.leadChild.deleteMany({ where: { leadId: LEAD } });
      await db.lead.deleteMany({ where: { id: LEAD } });
      await db.paymentMethod.deleteMany({ where: { id: PTTT } });
      await db.course.deleteMany({ where: { id: { in: [KHOA1, KHOA3] } } });
      await donNguoi();
    } finally {
      await disconnectDb();
    }
  });

  async function taoDonThuong() {
    const d = don([dongThuong()]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    return docDon(d.customerName);
  }

  it("[TT-DB-01] đơn sạch: thu trước X ⇒ phiếu toàn đơn được thay bằng ĐÚNG hai phiếu (cọc X + còn lại), cộng lại = tổng đơn, có audit", async () => {
    const o = await taoDonThuong();
    const truoc = await db.paymentRequest.findMany({ where: { orderId: o.id } });
    expect(truoc).toHaveLength(1); // tiền đề: chỉ có phiếu thu toàn đơn
    expect(truoc[0]).toMatchObject({ installmentNo: 0, amountDue: o.totalAmount, status: "PENDING" });

    const res = await thuTruocAction({ orderId: o.id, soTien: 2_000_000 });
    expect(res).toEqual({ ok: true, soTien: 2_000_000, conLai: o.totalAmount - 2_000_000 });

    const dot = await db.orderInstallment.findMany({ where: { orderId: o.id }, orderBy: { soDot: "asc" } });
    expect(dot.map((d) => d.amount)).toEqual([2_000_000, o.totalAmount - 2_000_000]);
    const phieu = await db.paymentRequest.findMany({ where: { orderId: o.id, status: { not: "VOID" } }, orderBy: { installmentNo: "asc" } });
    expect(phieu.map((p) => p.amountDue)).toEqual([2_000_000, o.totalAmount - 2_000_000]);
    expect(phieu.every((p) => p.installmentNo > 0 && p.status === "PENDING")).toBe(true);
    expect(phieu.reduce((s, p) => s + p.amountDue, 0)).toBe(o.totalAmount);
    expect(await db.payment.count({ where: { orderId: o.id } })).toBe(0); // thu trước KHÔNG tự ghi tiền
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: o.id, action: "THU_TRUOC_TAO" } })).toBe(1);
  });

  it("[TT-DB-02] số tiền sai (0, bằng tổng đơn, lớn hơn, lẻ, âm) ⇒ từ chối, KHÔNG phép ghi nào", async () => {
    const o = await taoDonThuong();
    const truoc = await anhChup(o.id);
    for (const x of [0, o.totalAmount, o.totalAmount + 1, 1.5, -5]) {
      const res = await thuTruocAction({ orderId: o.id, soTien: x });
      expect(res.ok, String(x)).toBe(false);
    }
    expect(await anhChup(o.id)).toBe(truoc);
  });

  it("[TT-DB-03] đơn theo PHẠM VI học VẪN thu trước được (chủ dự án 01/11); đường kế hoạch thường vẫn bị cổng D chặn", async () => {
    await coPhamVi(true);
    const d = don([dongScope()]);
    const res0 = await createOrderManualAction(d);
    expect(res0.ok, JSON.stringify(res0)).toBe(true);
    const o = await docDon(d.customerName);
    // Đối chứng ÂM: cổng D còn nguyên với đường kế hoạch thường (không truyền cờ) — nếu cổng bị gỡ hẳn thì ca này đỏ.
    const chan = await recordInstallmentPlan({ orderId: o.id, dots: [{ amount: 1_000_000, daThu: false, dueDate: new Date("2026-12-01T00:00:00Z") }, { amount: o.totalAmount - 1_000_000, daThu: false, dueDate: new Date("2026-12-15T00:00:00Z") }], actorId: id.qlcs1 });
    expect(chan.ok).toBe(false);
    expect(await db.orderInstallment.count({ where: { orderId: o.id } })).toBe(0);
    // Đường cọc: được, ra đúng hai phiếu cộng lại bằng tổng đơn.
    const res = await thuTruocAction({ orderId: o.id, soTien: 1_000_000 });
    expect(res).toEqual({ ok: true, soTien: 1_000_000, conLai: o.totalAmount - 1_000_000 });
    const phieu = await db.paymentRequest.findMany({ where: { orderId: o.id, status: { not: "VOID" } }, orderBy: { installmentNo: "asc" } });
    expect(phieu.map((p) => p.amountDue)).toEqual([1_000_000, o.totalAmount - 1_000_000]);
  });

  it("[TT-DB-04] đơn đã nhận tiền ⇒ từ chối, không tách lại phiếu dưới chân khoản đã thu", async () => {
    const o = await taoDonThuong();
    await db.payment.create({
      data: { orderId: o.id, amount: 500_000, method: "CASH", saleStatus: "RECORDED", accountantStatus: "CONFIRMED", paidDate: HOM_NAY },
    });
    const truoc = await anhChup(o.id);
    expect(await thuTruocAction({ orderId: o.id, soTien: 1_000_000 })).toEqual({ ok: false, error: LY_DO_KHONG_THU_TRUOC.daNhanTien });
    expect(await anhChup(o.id)).toBe(truoc);
  });

  it("[TT-DB-05] bấm lần hai (đã có đợt) ⇒ từ chối, không nhân đôi phiếu", async () => {
    const o = await taoDonThuong();
    expect((await thuTruocAction({ orderId: o.id, soTien: 1_000_000 })).ok).toBe(true);
    const sau1 = await anhChup(o.id);
    expect(await thuTruocAction({ orderId: o.id, soTien: 2_000_000 })).toEqual({ ok: false, error: LY_DO_KHONG_THU_TRUOC.coKeHoach });
    expect(await anhChup(o.id)).toBe(sau1);
  });

  it("[TT-DB-06] quyền + phạm vi: chưa đăng nhập ⇒ chặn; quản lý CƠ SỞ KHÁC ⇒ 'không tìm thấy'; Quản trị tối cao ⇒ được", async () => {
    const o = await taoDonThuong();
    const truoc = await anhChup(o.id);
    h.session = null;
    expect((await thuTruocAction({ orderId: o.id, soTien: 1_000_000 })).ok).toBe(false);
    h.session = phien("gv");
    expect(await thuTruocAction({ orderId: o.id, soTien: 1_000_000 })).toEqual({ ok: false, error: "Không có quyền" });
    expect(await anhChup(o.id)).toBe(truoc);
    h.session = phien("qlcs2");
    expect(await thuTruocAction({ orderId: o.id, soTien: 1_000_000 })).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
    expect(await anhChup(o.id)).toBe(truoc);
    h.session = phien("admin");
    expect((await thuTruocAction({ orderId: o.id, soTien: 1_000_000 })).ok).toBe(true);
  });
});
