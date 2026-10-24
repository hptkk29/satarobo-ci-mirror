// tests/finance/don-pham-vi-ke-hoach-dot-db.test.ts — CỔNG D: đơn theo PHẠM VI HỌC không dùng kế hoạch thanh toán nhiều đợt,
// trên Postgres THẬT, qua chuỗi thật (tạo đơn bằng form-action → đổi cờ → gọi các đường tạo kế hoạch/đợt).
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Hoặc:  DATABASE_URL=…/satarobo_test_cd DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/don-pham-vi-ke-hoach-dot-db.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố. Chạy được MỘT MÌNH (luật 18). Đồng hồ ĐÓNG BĂNG (luật 19).
//
// VÌ SAO LÀ DB THẬT. Cổng nằm TRƯỚC phép ghi đầu tiên — điều đó chỉ chứng minh được bằng cách ĐẾM HÀNG trước/sau ở mọi bảng mà
// đường tạo kế hoạch/đợt có thể chạm (`OrderInstallment`, `PaymentRequest`, `Payment`, `PaymentAllocation`, `QrSession`, `AuditLog`).
// Và ca then chốt ("cờ TẮT sau khi tạo đơn SCOPE vẫn bị chặn") chỉ có nghĩa khi dấu được đọc TỪ DB chứ không từ cờ.
//
// Mock: như `don-pham-vi-db.test.ts` — phiên next-auth, `next/cache`, header, và ba lời gọi fire-and-forget sau giao dịch tạo đơn.
// Mọi thứ còn lại (RBAC, scopedDb, planner, giao dịch, khoá advisory) là mã THẬT.
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
import { createOrderManualAction, markOrderInstallmentPaidAction, recordOrderInstallmentsAction, taoDotChoConAction } from "@/app/(admin)/admin/orders/_actions";
import { taiChiTietDonDeGan } from "@/app/(admin)/admin/bien-dong-so-du/_gan-theo-con";
import { recordInstallmentPlan } from "@/lib/orders/installments";
import { taoDotChoCon } from "@/lib/finance/ghi-tien-don";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { KHOA_CONG_TAC } from "@/lib/finance/feature";
import { khoiKeHoachTrangDon } from "@/lib/orders/pham-vi/khoi-ke-hoach";
import { clearSettingsCache } from "@/lib/settings/service";

if (!RUN_DB_TESTS) console.warn(`[P-D-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = "ci-pd-";
const KHOA3 = `${P}khoa-sata3`; // 48 buổi — đi theo phạm vi khi cờ bật
const KHOA1 = `${P}khoa-sata1`; // 11 buổi — KHÔNG thuộc phạm vi luật
const LEAD = `${P}lead`;
const CON_A = `${P}con-a`;
const PTTT = `${P}pttt`;
const HOM_NAY = new Date("2026-10-11T03:00:00Z");
const LY_DO = "Đơn theo phạm vi học không dùng kế hoạch thanh toán nhiều đợt.";

type Nguoi = "qlcs1" | "admin";
const NGUOI: Record<Nguoi, { role: Role; vai: string; donVi: "CS1" | "HO" }> = {
  qlcs1: { role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS1" },
  admin: { role: "SUPER_ADMIN", vai: "SUPER_ADMIN", donVi: "HO" },
};
const DS = Object.keys(NGUOI) as Nguoi[];
const id = {} as Record<Nguoi, string>;
const email = (n: Nguoi) => `${P}${n}@ci.test`;
const phien = (n: Nguoi) => ({ user: { id: id[n], name: `Fixture ${n}`, email: email(n), role: NGUOI[n].role, roles: [NGUOI[n].role] } });
const chonCheDo = (v2: boolean) => {
  process.env.RBAC_V2_ENABLED = v2 ? "true" : "false";
};

let CS1 = "";
let OU1 = "";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────
async function donDon() {
  const don = await db.order.findMany({ where: { customerName: { startsWith: P } }, select: { id: true } });
  const ids = don.map((d) => d.id);
  if (ids.length > 0) {
    await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { orderId: { in: ids } } } });
    await db.studyEntitlement.deleteMany({ where: { orderId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: ids } } });
    await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
    // Payment / Receipt theo orderId, ĐÚNG THỨ TỰ khoá ngoại (Receipt.paymentId -> Payment, onDelete Restrict): một lượt đỏ giữa chừng
    // mà rò Payment thì `order.deleteMany` bên dưới ném FK ở `beforeAll` của MỌI lần chạy lại, với lỗi rỗng.
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
    await db.payment.deleteMany({ where: { orderId: { in: ids } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderInstallment.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  await db.studyEntitlement.deleteMany({ where: { courseId: { in: [KHOA3, KHOA1] } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: P } } });
}

async function datCo(orgUnitId: string, key: string, bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId, key } },
      create: { orgUnitId, key, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}
const coPhamVi = (bat: boolean | null) => datCo(OU1, KHOA_CONG_TAC_PHAM_VI, bat);
const coThuLinhHoat = (bat: boolean | null) => datCo(OU1, KHOA_CONG_TAC, bat);

async function dungKhoa(maKhoa: string, ten: string, price: number | null, totalSessions: number) {
  await db.course.upsert({
    where: { id: maKhoa },
    create: { id: maKhoa, name: ten, slug: maKhoa, price, totalSessions },
    update: { name: ten, price, totalSessions },
  });
}

async function donNguoi() {
  const us = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const xs = us.map((u) => u.id);
  if (xs.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: xs } } });
    await db.user.deleteMany({ where: { id: { in: xs } } });
  }
}

async function dungNen() {
  await dungKhoa(KHOA3, "Sata 3 (fixture)", 10_560_000, 48);
  await dungKhoa(KHOA1, "Sata 1 (fixture)", 5_200_003, 11);
  await db.leadChild.deleteMany({ where: { leadId: LEAD } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.lead.create({ data: { id: LEAD, parentName: `${P}Phụ huynh`, phone: "0905123488", centerId: CS1, children: { create: [{ id: CON_A, fullName: "Bé A" }] } } });
  await db.paymentMethod.deleteMany({ where: { id: PTTT } });
  await db.paymentMethod.create({ data: { id: PTTT, code: `${P}CK`, name: "Chuyển khoản (fixture)", type: "BANK_TRANSFER", isActive: true, centerId: null } });
}

type Dong = Record<string, unknown>;
const dong = (o: Dong = {}): Dong => ({
  type: "COURSE_ENROLLMENT",
  itemName: "Sata 3",
  quantity: 1,
  unitPrice: 8_976_000, // 48 buổi, sản phẩm 48 #1, con 1 ⇒ 10.560.000 × 85%
  leadChildId: CON_A,
  metadata: { courseId: KHOA3, soBuoi: 48 },
  ...o,
});
/** Dòng khoá 11 buổi: KHÔNG thuộc phạm vi luật dù cờ bật ⇒ đơn thường. */
const dongThuong = (): Dong => dong({ itemName: "Sata 1", unitPrice: 5_200_003, metadata: { courseId: KHOA1, soBuoi: 11 } });
let dem = 0;
function don(items: Dong[], o: Dong = {}) {
  return {
    type: "COURSE" as const,
    status: "PENDING_PAYMENT" as const,
    customerName: `${P}khach-${++dem}`,
    customerPhone: "0905123488",
    customerEmail: "",
    leadId: LEAD,
    centerId: CS1,
    paymentMethodId: PTTT,
    items,
    shippingFee: 0,
    ...o,
  };
}
const docDon = (customerName: string) => db.order.findFirstOrThrow({ where: { customerName }, include: { items: { orderBy: { createdAt: "asc" } } } });

/** Mọi con số mà một đường tạo kế hoạch/đợt CÓ THỂ làm đổi. Bằng nhau trước/sau ⇒ không phép ghi nào xảy ra. */
async function anhChup(orderId: string) {
  const [dot, phieu, pay, phanBo, qr, audit, don, mdItems] = await Promise.all([
    db.orderInstallment.findMany({ where: { orderId }, orderBy: { soDot: "asc" } }),
    db.paymentRequest.findMany({ where: { orderId }, orderBy: [{ installmentNo: "asc" }, { id: "asc" }] }),
    db.payment.count({ where: { orderId } }),
    db.paymentAllocation.count({ where: { paymentRequest: { orderId } } }),
    db.qrSession.count({ where: { paymentRequest: { orderId } } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: orderId } }),
    db.order.findUniqueOrThrow({ where: { id: orderId }, select: { totalAmount: true, updatedAt: true, status: true } }),
    db.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" }, select: { id: true, metadata: true, unitPrice: true } }),
  ]);
  return JSON.stringify({ dot, phieu, pay, phanBo, qr, audit, don, mdItems });
}

// Kế hoạch HỢP LỆ ở mọi mặt khác (đủ ngày hẹn, tổng đúng tổng đơn) — để câu từ chối chỉ có thể đến từ cổng phạm vi.
const HAN_1 = new Date("2026-10-20T00:00:00+07:00");
const HAN_2 = new Date("2026-11-20T00:00:00+07:00");
const HAI_DOT = [
  { amount: 4_488_000, daThu: false, dueDate: HAN_1 },
  { amount: 4_488_000, daThu: false, dueDate: HAN_2 },
];
const HAI_DOT_FORM = [
  { amount: 4_488_000, daThu: false, dueDate: "2026-10-20" },
  { amount: 4_488_000, daThu: false, dueDate: "2026-11-20" },
];
/** Chia đôi tổng đơn thường thành 2 đợt hợp lệ (dạng lib: `Date`). */
const chiaDoi = (tong: number) => [
  { amount: Math.floor(tong / 2), daThu: false, dueDate: HAN_1 },
  { amount: tong - Math.floor(tong / 2), daThu: false, dueDate: HAN_2 },
];

// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[P-D-DB] cổng D — đơn SCOPE không tạo kế hoạch/đợt nhiều đợt — Postgres + RBAC + scopedDb THẬT", () => {
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
        db.roleDef.findUniqueOrThrow({ where: { code: NGUOI[n].vai }, select: { id: true } }),
        db.orgUnit.findUniqueOrThrow({ where: { code: NGUOI[n].donVi }, select: { id: true } }),
      ]);
      // `effectiveFrom` TUYỆT ĐỐI (luật 19): đồng hồ đóng băng ở 11/10/2026, còn default của cột là `now()` thật của DB.
      await db.userOrgRole.create({
        data: { userId: u.id, orgUnitId: dv.id, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
      });
    }
    await dungNen();
  });

  beforeEach(async () => {
    h.session = phien("qlcs1");
    chonCheDo(false);
    vi.setSystemTime(HOM_NAY);
    await donDon();
    await coPhamVi(null);
    await coThuLinhHoat(null);
    await dungKhoa(KHOA3, "Sata 3 (fixture)", 10_560_000, 48);
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      vi.useRealTimers();
      await coPhamVi(null).catch(() => undefined);
      await coThuLinhHoat(null).catch(() => undefined);
      await donDon();
      await db.leadChild.deleteMany({ where: { leadId: LEAD } });
      await db.lead.deleteMany({ where: { id: LEAD } });
      await db.paymentMethod.deleteMany({ where: { id: PTTT } });
      await db.course.deleteMany({ where: { id: { in: [KHOA3, KHOA1] } } });
      await donNguoi();
    } finally {
      await disconnectDb();
    }
  });

  /** Tạo một đơn SCOPE THẬT bằng form-action (cờ phạm vi BẬT ở CS1), rồi trả về id + tên khách. */
  async function taoDonScope() {
    await coPhamVi(true);
    const d = don([dong()]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    expect(khoiKeHoachTrangDon(o.items)).toBe("PHAM_VI"); // tiền đề: đây đúng là đơn SCOPE (đối chứng cho mọi ca "bị chặn" bên dưới)
    return o;
  }
  async function taoDonThuong(cuaPhamViBat: boolean) {
    await coPhamVi(cuaPhamViBat);
    const d = don([dongThuong()]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    expect(khoiKeHoachTrangDon(o.items)).toBe("THUONG");
    return o;
  }

  it("[P-D-DB-01] đơn SCOPE: `recordInstallmentPlan` từ chối đúng câu, KHÔNG phép ghi nào (đếm/so mọi bảng tiền trước/sau)", async () => {
    const o = await taoDonScope();
    const truoc = await anhChup(o.id);
    expect(await db.orderInstallment.count({ where: { orderId: o.id } })).toBe(0);

    const res = await recordInstallmentPlan({ orderId: o.id, dots: HAI_DOT, actorId: id.qlcs1 });
    expect(res).toEqual({ ok: false, error: LY_DO });
    // Cả kế hoạch MỘT đợt trả sau lẫn kế hoạch "đã thu đợt 1" đều bị chặn — cổng không nhìn số đợt.
    expect(await recordInstallmentPlan({ orderId: o.id, dots: [{ amount: 8_976_000, daThu: false, dueDate: HAN_1 }], actorId: id.qlcs1 })).toEqual({ ok: false, error: LY_DO });
    expect(await recordInstallmentPlan({ orderId: o.id, dots: [{ amount: 8_976_000, daThu: true, dueDate: null }], actorId: id.qlcs1 })).toEqual({ ok: false, error: LY_DO });
    // Đường cũ (deprecated) cũng đi qua cùng một cổng.
    expect(await recordInstallmentPlan({ orderId: o.id, dot1Amount: 4_488_000, dot2Amount: 4_488_000, dot2DueDate: HAN_2, actorId: id.qlcs1 })).toEqual({ ok: false, error: LY_DO });

    expect(await anhChup(o.id)).toBe(truoc);
    // Phiếu thu toàn đơn do tạo đơn sinh vẫn còn nguyên (thu tiền qua QR toàn đơn không bị ảnh hưởng).
    const yc = await db.paymentRequest.findMany({ where: { orderId: o.id } });
    expect(yc).toHaveLength(1);
    expect(yc[0]).toMatchObject({ installmentNo: 0, amountDue: 8_976_000, status: "PENDING" });
  });

  it("[P-D-DB-02] CA THEN CHỐT — cờ TẮT sau khi tạo đơn SCOPE: vẫn bị chặn (dấu đọc từ DB, không từ cờ); qua action trên màn đơn", async () => {
    const o = await taoDonScope();
    // Cờ phạm vi TẮT (ghi rõ false, rồi gỡ hẳn): đơn đã tạo vẫn là SCOPE.
    for (const bat of [false, null] as const) {
      await coPhamVi(bat);
      h.session = phien("admin");
      const truoc = await anhChup(o.id);
      const res = await recordOrderInstallmentsAction({ orderId: o.id, dots: HAI_DOT_FORM });
      expect(res.ok).toBe(false);
      // [20/10/2026] `recordOrderInstallmentsAction` nay từ chối MỌI đơn bằng câu chung "Đã bỏ kế hoạch…" (chủ dự án bỏ kế hoạch thanh
      // toán). Ca vẫn giữ: không ghi gì, và kết quả không đổi theo cờ. Cổng RIÊNG của đơn SCOPE (`LY_DO`) còn ở `recordInstallmentPlan` (P-D-DB-01).
      expect(res.error).toContain("Đã bỏ kế hoạch thanh toán chia đợt");
      expect(await anhChup(o.id)).toBe(truoc);
      expect(await db.orderInstallment.count({ where: { orderId: o.id } })).toBe(0);
    }
    // Và hàm đọc dùng chung của màn hình cũng vẫn ra PHAM_VI khi cờ tắt.
    expect(khoiKeHoachTrangDon((await docDon(o.customerName)).items)).toBe("PHAM_VI");
  });

  it("[P-D-DB-03] đơn SCOPE: `taoDotChoCon` (lib) và `taoDotChoConAction` (màn đơn, cờ thu linh hoạt BẬT) từ chối đúng câu, 0 đợt/phiếu/audit mới", async () => {
    const o = await taoDonScope();
    const it0 = o.items[0]!;
    // QUAN TRỌNG: phiếu "thu toàn đơn" do tạo đơn sinh đang giữ trọn học phí như một đợt mở của đơn, nên chính `kiemTaoDot` cũng sẽ
    // từ chối tạo đợt mới — khi đó cổng phạm vi KHÔNG phải thứ chặn và ca này xanh cả khi cổng bị bỏ hoặc đứng SAU phép ghi (phép cấy
    // M06 đã lộ đúng lỗ này). Nhả phiếu toàn đơn (VOID — trạng thái lưu kế hoạch vẫn đặt cho nó) để đợt MỚI sẽ được tạo nếu không có cổng:
    // [P-D-DB-06] chứng minh đúng điều đó trên đơn thường.
    await db.paymentRequest.updateMany({ where: { orderId: o.id, installmentNo: 0 }, data: { status: "VOID" } });
    const truoc = await anhChup(o.id);
    const actor = { id: id.qlcs1, name: "Fixture" };

    // Cờ phạm vi TẮT (ghi rõ `false`) trước khi gọi — như [P-D-DB-02]: cổng đọc DẤU trên dòng đơn, không đọc cờ. Nếu cổng của
    // `taoDotChoCon` đọc cờ thì ca này đỏ (đơn tạo lúc cờ bật, gọi lúc cờ tắt).
    await coPhamVi(false);
    const lib = await taoDotChoCon({ orderId: o.id, orderItemId: it0.id, soTien: 1_000_000, dueDate: null, centerId: CS1, actor });
    expect(lib).toEqual({ ok: false, error: LY_DO });
    expect(await anhChup(o.id)).toBe(truoc);

    await coPhamVi(null); // gỡ hẳn cờ cho đường action
    // Qua action: bật cờ thu linh hoạt của CS1 để KHÔNG dừng ở cổng cờ ("chưa bật cho cơ sở này") mà tới đúng cổng phạm vi.
    await coThuLinhHoat(true);
    h.session = phien("admin");
    const act = await taoDotChoConAction({ orderId: o.id, orderItemId: it0.id, soTien: 1_000_000 });
    expect(act).toEqual({ ok: false, error: LY_DO });
    expect(await anhChup(o.id)).toBe(truoc);
    expect(await db.paymentRequest.count({ where: { orderId: o.id, orderItemId: { not: null } } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: o.id, action: "DOT_THEO_CON_CREATED" } })).toBe(0);
  });

  it("[P-D-DB-04] ĐỐI CHỨNG DƯƠNG — đơn thường (cờ phạm vi TẮT): lưu kế hoạch 2 đợt chạy như cũ (2 OrderInstallment, 2 phiếu theo đợt)", async () => {
    const o = await taoDonThuong(false);
    const tong = o.totalAmount;
    const res = await recordInstallmentPlan({
      orderId: o.id,
      dots: chiaDoi(tong),
      actorId: id.qlcs1,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await db.orderInstallment.count({ where: { orderId: o.id } })).toBe(2);
    expect(await db.paymentRequest.count({ where: { orderId: o.id, installmentNo: { gt: 0 }, status: { not: "VOID" } } })).toBe(2);
  });

  it("[P-D-DB-05] [20/10/2026] ĐƠN THƯỜNG (cơ sở bật cờ, khoá 11 buổi): action lưu kế hoạch nay TỪ CHỐI — không ghi gì; trong khi `recordInstallmentPlan` mức thư viện vẫn chạy (P-D-DB-04)", async () => {
    const o = await taoDonThuong(true);
    h.session = phien("admin");
    const tong = o.totalAmount;
    const truoc = await anhChup(o.id);
    const res = await recordOrderInstallmentsAction({
      orderId: o.id,
      dots: chiaDoi(tong).map((d) => ({ ...d, dueDate: d.dueDate.toISOString().slice(0, 10) })),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Đã bỏ kế hoạch thanh toán chia đợt");
    expect(await anhChup(o.id)).toBe(truoc);
    expect(await db.orderInstallment.count({ where: { orderId: o.id } })).toBe(0);
    // Phiếu thu toàn đơn do tạo đơn sinh vẫn nguyên: đơn vẫn thu tiền được.
    expect(await db.paymentRequest.count({ where: { orderId: o.id, installmentNo: 0, status: "PENDING" } })).toBe(1);
  });

  it("[P-D-DB-05b] ĐƠN CŨ ĐANG CÓ ĐỢT DỞ DANG (kế hoạch lập trước 20/10/2026) KHÔNG kẹt tiền: đợt còn đó, đánh dấu đã đóng qua action vẫn chạy, còn lưu lại kế hoạch thì bị từ chối", async () => {
    const o = await taoDonThuong(true);
    const tong = o.totalAmount;
    // Dựng đơn cũ bằng lõi thư viện (đúng thứ convert-lead-v2/backfill vẫn gọi) — action đã khoá nên không dựng bằng nó được.
    const lap = await recordInstallmentPlan({ orderId: o.id, dots: chiaDoi(tong), actorId: id.qlcs1 });
    expect(lap.ok, JSON.stringify(lap)).toBe(true);
    const dots = await db.orderInstallment.findMany({ where: { orderId: o.id }, orderBy: { soDot: "asc" } });
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => d.status)).toEqual(["PENDING", "PENDING"]);

    h.session = phien("admin");
    // Lưu lại/sửa kế hoạch: từ chối, đợt nguyên vẹn.
    const truoc = await anhChup(o.id);
    const sua = await recordOrderInstallmentsAction({ orderId: o.id, dots: HAI_DOT_FORM });
    expect(sua.ok).toBe(false);
    expect(await anhChup(o.id)).toBe(truoc);

    // Nhưng THU TIỀN của đợt cũ vẫn chạy: cùng action mà nút 'Đánh dấu đã đóng' gọi.
    const dong = await markOrderInstallmentPaidAction(dots[0]!.id, o.id);
    expect(dong.ok, JSON.stringify(dong)).toBe(true);
    expect((await db.orderInstallment.findUniqueOrThrow({ where: { id: dots[0]!.id } })).status).toBe("PAID");
    expect((await db.orderInstallment.findUniqueOrThrow({ where: { id: dots[1]!.id } })).status).toBe("PENDING");
  });

  it("[P-D-DB-06] ĐỐI CHỨNG DƯƠNG — đơn thường: `taoDotChoCon` tạo được đợt cho bé (+1 phiếu theo con, +1 audit DOT_THEO_CON_CREATED)", async () => {
    const o = await taoDonThuong(false);
    const it0 = o.items[0]!;
    // Phiếu "thu toàn đơn" do tạo đơn sinh đang GIỮ trọn học phí như một đợt mở của đơn; muốn thu theo bé thì nó phải thôi mở
    // (VOID — đúng trạng thái mà lưu kế hoạch đặt cho nó). Nếu không, cổng vế ĐƠN của `kiemTaoDot` chặn vì lý do chẳng liên quan.
    await db.paymentRequest.updateMany({ where: { orderId: o.id, installmentNo: 0 }, data: { status: "VOID" } });
    const truoc = await db.paymentRequest.count({ where: { orderId: o.id } });
    const kq = await taoDotChoCon({ orderId: o.id, orderItemId: it0.id, soTien: 1_000_000, dueDate: null, centerId: CS1, actor: { id: id.qlcs1, name: "Fixture" } });
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    expect(await db.paymentRequest.count({ where: { orderId: o.id } })).toBe(truoc + 1);
    expect(await db.paymentRequest.count({ where: { orderId: o.id, orderItemId: it0.id, installmentNo: 1, amountDue: 1_000_000 } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: o.id, action: "DOT_THEO_CON_CREATED" } })).toBe(1);
  });

  it("[P-D-DB-07] cách ly: cổng chỉ nhìn đơn ĐANG GỌI — đơn SCOPE bị chặn không làm đơn thường cùng cơ sở/cùng khách bị chặn theo", async () => {
    const scope = await taoDonScope();
    const thuong = await taoDonThuong(true); // cùng lúc cờ BẬT, cùng lead, cùng cơ sở
    expect((await recordInstallmentPlan({ orderId: scope.id, dots: HAI_DOT, actorId: id.qlcs1 })).ok).toBe(false);
    const tong = thuong.totalAmount;
    const res = await recordInstallmentPlan({
      orderId: thuong.id,
      dots: chiaDoi(tong),
      actorId: id.qlcs1,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await db.orderInstallment.count({ where: { orderId: scope.id } })).toBe(0);
    expect(await db.orderInstallment.count({ where: { orderId: thuong.id } })).toBe(2);
  });

  it("[P-D-DB-08] cách ly theo orderId của `taoDotChoCon`: có đơn SCOPE cùng cơ sở/cùng lead, đơn THƯỜNG vẫn tạo được đợt (cổng không đọc dòng của đơn khác)", async () => {
    const scope = await taoDonScope();
    const thuong = await taoDonThuong(true); // cùng cơ sở, cùng lead, cờ phạm vi đang BẬT
    expect(scope.id).not.toBe(thuong.id);
    // Nhả phiếu toàn đơn của đơn THƯỜNG để chính `kiemTaoDot` không chặn (xem [P-D-DB-03]/[P-D-DB-06]).
    await db.paymentRequest.updateMany({ where: { orderId: thuong.id, installmentNo: 0 }, data: { status: "VOID" } });
    const actor = { id: id.qlcs1, name: "Fixture" };

    // ĐỐI CHỨNG DƯƠNG: đơn thường => tạo được. Cổng đọc dòng của MỌI đơn (`where: {}`) hay đọc nhầm đơn kia đều làm ca này đỏ.
    const ok = await taoDotChoCon({ orderId: thuong.id, orderItemId: thuong.items[0]!.id, soTien: 1_000_000, dueDate: null, centerId: CS1, actor });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await db.paymentRequest.count({ where: { orderId: thuong.id, orderItemId: thuong.items[0]!.id, installmentNo: 1 } })).toBe(1);

    // Và đơn SCOPE (cũng nhả phiếu toàn đơn, để cổng phạm vi là thứ DUY NHẤT chặn) vẫn bị chặn, không đổi gì.
    await db.paymentRequest.updateMany({ where: { orderId: scope.id, installmentNo: 0 }, data: { status: "VOID" } });
    const truoc = await anhChup(scope.id);
    const chan = await taoDotChoCon({ orderId: scope.id, orderItemId: scope.items[0]!.id, soTien: 1_000_000, dueDate: null, centerId: CS1, actor });
    expect(chan).toEqual({ ok: false, error: LY_DO });
    expect(await anhChup(scope.id)).toBe(truoc);
  });

  it("[P-D-DB-09] loader màn gắn giao dịch `taiChiTietDonDeGan`: `donPhamVi` đọc từ DẤU trên dòng đơn — đơn SCOPE => true, đơn thường => false (cờ phạm vi bật / tắt / gỡ đều không đổi)", async () => {
    const scope = await taoDonScope();
    const thuong = await taoDonThuong(true);
    const TXN = `${P}bt-1`;
    await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: TXN, amount: 1_000_000, transferredAt: new Date("2026-10-11T02:00:00Z"), status: "UNMATCHED", centerId: CS1 },
    });
    const bt = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: TXN }, select: { id: true } });
    h.session = phien("admin"); // SUPER_ADMIN: qua cổng `congGanVaoDon` (quyền + phạm vi cơ sở) bằng RBAC v1 thật

    for (const batCo of [true, false, null] as const) {
      await coPhamVi(batCo); // dấu, không cờ: kết quả không đổi theo cờ
      const a = await taiChiTietDonDeGan(scope.id, bt.id);
      if ("error" in a) throw new Error(`loader (đơn SCOPE) từ chối: ${a.error}`);
      expect(a.orderId).toBe(scope.id);
      expect(a.donPhamVi).toBe(true);
      const b = await taiChiTietDonDeGan(thuong.id, bt.id);
      if ("error" in b) throw new Error(`loader (đơn thường) từ chối: ${b.error}`);
      expect(b.orderId).toBe(thuong.id);
      expect(b.donPhamVi).toBe(false);
    }
  });
});
