// tests/finance/don-pham-vi-db.test.ts — CỔNG SCOPE CỦA `createOrderManualAction` TRÊN POSTGRES THẬT, qua chuỗi thật.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Hoặc:  DATABASE_URL=…/satarobo_test_don DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/don-pham-vi-db.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố. Chạy được MỘT MÌNH (luật 18).
//
// VÌ SAO CÓ TỆP NÀY. Bộ unit cùng chủ đề (`lib/orders/pham-vi/cong-tao-don.test.ts`) MOCK `scopedDb`, giao dịch và audit — nó chứng minh cổng
// rẽ đúng, nhưng KHÔNG chứng minh được những điều chỉ Postgres trả lời:
//   · dòng được ghi xuống thật mang snapshot gì, và đọc lại ra gì;
//   · đơn mới tạo (chưa ai xác nhận tiền) có KHÔNG sinh quyền học nào không (Q2: chỉ tiền xác nhận mới cấp quyền);
//   · giao dịch hỏng giữa chừng có để lại Order/OrderItem mồ côi không;
//   · cờ riêng của cơ sở A không kéo cơ sở B;
//   · phân quyền + cách ly cơ sở vẫn gác — chạy RBAC thật (`checkPermission` → `resolveActor` → `scopedDb` → `passesScope`).
//
// Chỉ mock những thứ không có trong vitest: `@/lib/auth` (phiên next-auth), `next/cache`, `@/lib/audit/headers` (cần `headers()` của Next);
// và ba lời gọi FIRE-AND-FORGET phía sau giao dịch (email, ZNS, lịch sử lead) — chúng không thuộc thứ đang kiểm và nếu chạy thật thì có thể ghi
// vào DB sau khi ca đã dọn xong. Mọi thứ còn lại là mã thật. `ensureFullOrderRequest` được BỌC (không thay): mặc định gọi hàm thật, chỉ ca
// rollback mới ép nó ném — để có một lỗi THẬT xảy ra SAU `order.create` bên trong giao dịch.
//
// Đồng hồ ĐÓNG BĂNG (luật 19): cửa sổ chính sách PL02 kết thúc 31/12/2026; ca chạy theo đồng hồ thật sẽ nổ sau ~80 ngày với mã không đổi.
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
vi.mock("@/lib/payments/payment-request", async (goc) => {
  const m = await goc<typeof import("@/lib/payments/payment-request")>();
  return { ...m, ensureFullOrderRequest: vi.fn(m.ensureFullOrderRequest) };
});

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { createOrderManualAction } from "@/app/(admin)/admin/orders/_actions";
import { xemTruocGiaPhamViAction } from "@/app/(admin)/admin/orders/_pham-vi-actions";
import { docCoSoBatPhamVi } from "@/lib/orders/pham-vi/ap-dung";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { docPhamViDong } from "@/lib/orders/pham-vi/doc-dong";
import { clearSettingsCache } from "@/lib/settings/service";
import { approveOrderAction } from "@/app/(admin)/admin/orders/duyet/_actions";
import { hichCapQuyenHocChoDon } from "@/lib/entitlements/hich";
import { dongDonCuaLead } from "@/lib/finance/dong-don-cua-lead";
import { giaTuDongDon } from "@/lib/finance/gia-tu-dong-don";
import { laDonChoDuyet, lyDoChuaDuyetQr } from "@/lib/orders/cho-duyet";
import { allocateToOrder } from "@/lib/payments/payos-ingest";
import { huyDotChoCon } from "@/lib/finance/ghi-tien-don";
import { LY_DO_DON_PHAM_VI_KHONG_HUY_KHOAN } from "@/lib/orders/pham-vi/cong-sua-don";

if (!RUN_DB_TESTS) console.warn(`[ĐSC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = "ci-dsc-";
const KHOA3 = `${P}khoa-sata3`;
const KHOA4 = `${P}khoa-sata4`;
const KHOA1 = `${P}khoa-sata1`;
const LEAD = `${P}lead`;
const CON_A = `${P}con-a`;
const CON_B = `${P}con-b`;
const PTTT = `${P}pttt`;
const HOM_NAY = new Date("2026-10-11T03:00:00Z");
const KHOA_TRAN_PHAM_VI = "billing.scopeMaxDiscountPercent";
const KHOA_FLEX = "billing.flexV1Enabled";
const HV_GT = `${P}hv-gt`;
/** Hằng thay cho literal sau tên cột trạng thái kế toán: lưới [BUOC-6] (lib/finance/truc-a.test.ts) cấm cặp đó ngoài debt.ts. */
const DA_XAC_NHAN = "CONFIRMED" as const;

type Nguoi = "qlcs1" | "qlcs2" | "gv";
const NGUOI: Record<Nguoi, { role: Role; vai: string; donVi: "CS1" | "CS2" }> = {
  qlcs1: { role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS1" },
  qlcs2: { role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS2" },
  gv: { role: "TEACHER", vai: "TEACHER", donVi: "CS1" },
};
const DS = Object.keys(NGUOI) as Nguoi[];
const id = {} as Record<Nguoi, string>;
const email = (n: Nguoi) => `${P}${n}@ci.test`;
const phien = (n: Nguoi) => ({ user: { id: id[n], name: `Fixture ${n}`, email: email(n), role: NGUOI[n].role, roles: [NGUOI[n].role] } });
const chonCheDo = (v2: boolean) => {
  process.env.RBAC_V2_ENABLED = v2 ? "true" : "false";
};

let CS1 = "";
let CS2 = "";
let OU1 = "";
let OU2 = "";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────
async function donDon() {
  const don = await db.order.findMany({ where: { customerName: { startsWith: P } }, select: { id: true } });
  const ids = don.map((d) => d.id);
  if (ids.length > 0) {
    await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { orderId: { in: ids } } } });
    await db.studyEntitlement.deleteMany({ where: { orderId: { in: ids } } });
    await db.studyEntitlementXuLy.deleteMany({ where: { orderId: { in: ids } } });
    await db.voucherRedemption.deleteMany({ where: { orderId: { in: ids } } });
    await db.payment.deleteMany({ where: { orderId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: ids } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderInstallment.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  await db.studyEntitlement.deleteMany({ where: { courseId: { in: [KHOA3, KHOA4, KHOA1] } } });
  // [20/10/2026] Khoản giảm thêm: chương trình khuyến mãi + trần theo cơ sở dựng riêng cho ca nào cần, dọn ở đây.
  await db.voucher.deleteMany({ where: { code: { startsWith: P } } });
  await db.promotionPolicy.deleteMany({ where: { documentCode: { startsWith: P } } });
  await db.centerSetting.deleteMany({ where: { key: { in: [KHOA_TRAN_PHAM_VI, KHOA_FLEX] } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: P } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { in: [HV_GT, `${P}hv-ptd`] } } });
  clearSettingsCache();
}

async function datCo(orgUnitId: string, bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}

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
  await dungKhoa(KHOA4, "Sata 4 (fixture)", 11_520_000, 48);
  await dungKhoa(KHOA1, "Sata 1 (fixture)", 5_200_003, 11);
  await db.leadChild.deleteMany({ where: { leadId: LEAD } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.lead.create({
    data: { id: LEAD, parentName: `${P}Phụ huynh`, phone: "0905123499", centerId: CS1, children: { create: [{ id: CON_A, fullName: "Bé A" }, { id: CON_B, fullName: "Bé B" }] } },
  });
  await db.paymentMethod.deleteMany({ where: { id: PTTT } });
  await db.paymentMethod.create({ data: { id: PTTT, code: `${P}CK`, name: "Chuyển khoản (fixture)", type: "BANK_TRANSFER", isActive: true, centerId: null } });
}

type Dong = Record<string, unknown>;
const dong = (o: Dong = {}): Dong => ({
  type: "COURSE_ENROLLMENT",
  itemName: "Sata 3",
  quantity: 1,
  unitPrice: 8_976_000,
  leadChildId: CON_A,
  metadata: { courseId: KHOA3, soBuoi: 48 },
  ...o,
});
let dem = 0;
/** Mỗi đơn mang `customerName` riêng (tiền tố P) để dọn và để đếm "đơn mồ côi" theo đúng ca. */
function don(items: Dong[], o: Dong = {}) {
  return {
    type: "COURSE" as const,
    status: "PENDING_PAYMENT" as const,
    customerName: `${P}khach-${++dem}`,
    customerPhone: "0905123499",
    customerEmail: "",
    leadId: LEAD,
    centerId: CS1,
    paymentMethodId: PTTT,
    items,
    shippingFee: 0,
    ...o,
  };
}
const docDon = (customerName: string) =>
  db.order.findFirstOrThrow({ where: { customerName }, include: { items: { orderBy: { createdAt: "asc" } } } });

// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[ĐSC-DB] cổng SCOPE của createOrderManualAction — Postgres + RBAC + scopedDb THẬT", () => {
  const rbacGoc = process.env.RBAC_V2_ENABLED;

  beforeAll(async () => {
    assertTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HOM_NAY);
    await donDon();
    await donNguoi();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    [CS1, CS2] = (await Promise.all(["CS1", "CS2"].map((code) => db.center.findUniqueOrThrow({ where: { code }, select: { id: true } })))).map((c) => c.id) as [string, string];
    [OU1, OU2] = (await Promise.all(["CS1", "CS2"].map((code) => db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true } })))).map((c) => c.id) as [string, string];
    for (const n of DS) {
      const u = await seedUser({ email: email(n), name: `${P}${n}`, role: NGUOI[n].role });
      id[n] = u.id;
      const [vai, dv] = await Promise.all([
        db.roleDef.findUniqueOrThrow({ where: { code: NGUOI[n].vai }, select: { id: true } }),
        db.orgUnit.findUniqueOrThrow({ where: { code: NGUOI[n].donVi }, select: { id: true } }),
      ]);
      // `effectiveFrom` TUYỆT ĐỐI (luật 19): đồng hồ bị đóng băng ở 11/10/2026, còn default của cột là `now()` thật của DB.
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
    vi.mocked(ensureFullOrderRequest).mockClear();
    await donDon();
    await datCo(OU1, null);
    await datCo(OU2, null);
    await dungKhoa(KHOA3, "Sata 3 (fixture)", 10_560_000, 48); // ca nào đổi giá thì ca sau vẫn bắt đầu từ giá chuẩn
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      vi.useRealTimers();
      await datCo(OU1, null).catch(() => undefined);
      await datCo(OU2, null).catch(() => undefined);
      await donDon();
      await db.leadChild.deleteMany({ where: { leadId: LEAD } });
      await db.lead.deleteMany({ where: { id: LEAD } });
      await db.paymentMethod.deleteMany({ where: { id: PTTT } });
      await db.course.deleteMany({ where: { id: { in: [KHOA3, KHOA4, KHOA1] } } });
      await donNguoi();
    } finally {
      await disconnectDb();
    }
  });

  it("[ĐSC-DB-01] cờ BẬT: đơn SCOPE được ghi đủ snapshot; tạo xong (chờ thanh toán) thì KHÔNG có quyền học nào", async () => {
    await datCo(OU1, true);
    const d = don([dong()]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);

    // ĐỐI CHỨNG DƯƠNG (nếu không, "0 quyền học" xanh cả khi chưa có gì chạy): đơn + dòng + phiếu thu thật sự có mặt.
    const o = await docDon(d.customerName);
    expect(o).toMatchObject({ status: "PENDING_PAYMENT", subtotal: 8_976_000, discountAmount: 0, totalAmount: 8_976_000, centerId: CS1 });
    expect(o.items).toHaveLength(1);
    const it0 = o.items[0]!;
    expect(it0).toMatchObject({ quantity: 1, unitPrice: 8_976_000, totalPrice: 8_976_000, discountAmount: 0 });
    const pv = docPhamViDong(it0.metadata)!;
    expect(pv).toMatchObject({ loaiMua: "FULL", soBuoiMua: 48, niemYet: 10_560_000, giamGia: 1_584_000, thanhTien: 8_976_000 });
    expect(pv.pricingSnapshot).toMatchObject({ gia48: 10_560_000, nguonGia48: "Course.price", thuTuCon: 1, thuTuSanPham48: 1 });
    expect((it0.metadata as Record<string, unknown>).soBuoi).toBe(48);
    expect((it0.metadata as Record<string, unknown>).courseId).toBe(KHOA3);
    expect((it0.metadata as Record<string, unknown>).leadChildId).toBe(CON_A);
    // tạm tính − giảm = thành tiền của snapshot: `giaTuDongDon` (ghi danh khi convert) đọc `totalPrice` và ra đúng số khách trả.
    expect(it0.totalPrice - it0.discountAmount).toBe(pv.thanhTien);
    const yc = await db.paymentRequest.findMany({ where: { orderId: o.id } });
    expect(yc).toHaveLength(1);
    expect(yc[0]).toMatchObject({ amountDue: 8_976_000, status: "PENDING" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: o.id, action: "CREATE" } });
    expect((audit.newValues as { phamVi?: unknown[] }).phamVi).toHaveLength(1);

    // CHƯA XÁC NHẬN TIỀN ⇒ CHƯA CÓ QUYỀN HỌC (Q2). Đếm cả theo đơn, theo khoá, và theo học viên/dòng.
    expect(await db.payment.count({ where: { orderId: o.id } })).toBe(0);
    expect(await db.studyEntitlement.count({ where: { OR: [{ orderId: o.id }, { orderItemId: it0.id }, { courseId: { in: [KHOA3, KHOA4, KHOA1] } }] } })).toBe(0);
  });

  it("[ĐSC-DB-02] theo học phần & nhiều con nhiều khoá: mỗi dòng đúng con, đúng giá; tổng đúng; vẫn 0 quyền học", async () => {
    await datCo(OU1, true);
    // Con A: Sata3-24 (niêm yết 5.280.000) rẻ hơn con B: Sata4-48 (11.520.000) ⇒ A là con 1, B là con 2.
    // A: bảng A 24 buổi 5% ⇒ 5.016.000.   B: sp48 #1 ⇒ 15% + con 2 +10% = 25% ⇒ 8.640.000.
    const d = don([
      dong({ itemName: "Sata 3", metadata: { courseId: KHOA3, soBuoi: 24 }, unitPrice: 5_016_000, leadChildId: CON_A }),
      dong({ itemName: "Sata 4", metadata: { courseId: KHOA4, soBuoi: 48 }, unitPrice: 8_640_000, leadChildId: CON_B }),
    ]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    expect(o.items.map((x) => x.unitPrice).sort((a, b) => a - b)).toEqual([5_016_000, 8_640_000]);
    expect(o.totalAmount).toBe(13_656_000);
    const theoKhoa = new Map(o.items.map((x) => [(x.metadata as Record<string, unknown>).courseId as string, x]));
    const a = theoKhoa.get(KHOA3)!;
    const b = theoKhoa.get(KHOA4)!;
    expect(docPhamViDong(a.metadata)).toMatchObject({ loaiMua: "MILESTONE", soBuoiMua: 24, thanhTien: 5_016_000 });
    expect(docPhamViDong(b.metadata)).toMatchObject({ loaiMua: "FULL", soBuoiMua: 48, thanhTien: 8_640_000 });
    expect((a.metadata as Record<string, unknown>).leadChildId).toBe(CON_A);
    expect((b.metadata as Record<string, unknown>).leadChildId).toBe(CON_B);
    expect(o.leadChildId).toBeNull(); // hai con ⇒ không quy đơn về một con
    expect(await db.studyEntitlement.count({ where: { orderId: o.id } })).toBe(0);
  });

  it("[ĐSC-DB-03] snapshot BẤT BIẾN: đổi `Course.price` sau đó không đổi dòng đã ghi; đơn tạo SAU mới ăn giá mới", async () => {
    await datCo(OU1, true);
    const d1 = don([dong()]);
    expect((await createOrderManualAction(d1)).ok).toBe(true);
    const truoc = await docDon(d1.customerName);
    const anhChup = JSON.stringify(truoc.items[0]!.metadata);

    await dungKhoa(KHOA3, "Sata 3 (fixture)", 12_000_000, 48); // giá khoá tăng
    const sau = await docDon(d1.customerName);
    expect(JSON.stringify(sau.items[0]!.metadata)).toBe(anhChup);
    expect(sau.items[0]).toMatchObject({ unitPrice: 8_976_000, totalPrice: 8_976_000 });
    expect(sau.totalAmount).toBe(8_976_000);
    expect(docPhamViDong(sau.items[0]!.metadata)!.pricingSnapshot.gia48).toBe(10_560_000);

    // Giá cũ gửi lại sau khi giá khoá đã đổi ⇒ bị từ chối (đơn giá phải là 10.200.000 = 12.000.000 × 85%).
    const d2 = don([dong()]);
    const tuChoi = await createOrderManualAction(d2);
    expect(tuChoi.ok).toBe(false);
    expect("error" in tuChoi ? tuChoi.error : "").toContain("10.200.000đ");
    expect(await db.order.count({ where: { customerName: d2.customerName } })).toBe(0);
    // Gửi đúng giá mới ⇒ qua, và snapshot mới mang giá mới.
    const d3 = don([dong({ unitPrice: 10_200_000 })]);
    expect((await createOrderManualAction(d3)).ok).toBe(true);
    expect(docPhamViDong((await docDon(d3.customerName)).items[0]!.metadata)!.pricingSnapshot.gia48).toBe(12_000_000);
  });

  it("[ĐSC-DB-04] cờ TẮT (mặc định): đường cũ NGUYÊN VĂN — giá niêm yết, metadata không dấu phạm vi, audit không khoá `phamVi`", async () => {
    // Không bật cờ ở cơ sở nào.
    const d = don([dong({ unitPrice: 10_560_000 })]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    expect(o.items[0]).toMatchObject({ unitPrice: 10_560_000, totalPrice: 10_560_000, discountAmount: 0 });
    expect(o.items[0]!.metadata).toEqual({ courseId: KHOA3, soBuoi: 48, leadChildId: CON_A });
    expect(docPhamViDong(o.items[0]!.metadata)).toBeNull();
    expect(o.totalAmount).toBe(10_560_000);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: o.id, action: "CREATE" } });
    expect("phamVi" in (audit.newValues as Record<string, unknown>)).toBe(false);
  });

  // ── MỖI CON MỘT KHOẢN PHẢI THU [21/10/2026] — `lib/payments/phieu-theo-con-don-moi.ts` ───────────────────────────────────────────────────
  async function datFlex(orgUnitId: string, bat: boolean) {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId, key: KHOA_FLEX } },
      create: { orgUnitId, key: KHOA_FLEX, valueJson: bat },
      update: { valueJson: bat },
    });
    clearSettingsCache();
  }
  /** Hai con, hai khoá: A = Sata3-24 (5.016.000), B = Sata4-48 (8.640.000) — cùng số với [ĐSC-DB-02]. */
  const haiCon = (o: Dong = {}) =>
    don(
      [
        dong({ itemName: "Sata 3", metadata: { courseId: KHOA3, soBuoi: 24 }, unitPrice: 5_016_000, leadChildId: CON_A }),
        dong({ itemName: "Sata 4", metadata: { courseId: KHOA4, soBuoi: 48 }, unitPrice: 8_640_000, leadChildId: CON_B }),
      ],
      o,
    );
  const phieuCuaDon = (orderId: string) => db.paymentRequest.findMany({ where: { orderId }, orderBy: [{ sortOrder: "asc" }, { installmentNo: "asc" }] });
  /** Id hai dòng đơn theo ĐÚNG thứ tự rót tiền (`sortOrder` của phiếu) — A là con được rót trước. KHÔNG lấy theo `createdAt` của dòng: hai dòng cùng được tạo trong một giao dịch nên `createdAt` TRÙNG nhau, thứ tự trả về là tuỳ ý (id là UUID ngẫu nhiên nên tiêu chí phụ `id` cũng không cứu được) ⇒ lúc A/B bị hoán, ca đỏ với hai khoản 5.016.000 và 984.000 đổi chỗ ([PTD-04] chập chờn). */
  const haiConTheoThuTuRot = async (orderId: string) => {
    const ids = (await phieuCuaDon(orderId)).map((r) => r.orderItemId);
    expect(ids, "phải có đúng hai phiếu theo con").toHaveLength(2);
    return ids as [string, string];
  };
  let demTxn = 0;
  /** Tiền về qua đường KHÔNG có mã phiếu gộp: giao dịch + `allocateToOrder` rót theo `sortOrder` (đúng thân chung của webhook và gắn tay). */
  async function tienVe(orderId: string, soTien: number) {
    const txn = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: `${P}txn-${++demTxn}`, amount: soTien, transferredAt: new Date(), content: "Chi co so dien thoai" },
    });
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, code: true, status: true, centerId: true, orgUnitId: true, studentId: true, leadId: true, student: { select: { id: true, parentUserId: true } } },
    });
    const dau = (await phieuCuaDon(orderId)).find((r) => r.status === "PENDING" || r.status === "PARTIAL")!;
    return allocateToOrder({
      bankTransactionId: txn.id,
      order,
      amount: soTien,
      provider: "SEPAY",
      providerTxnId: txn.providerTxnId,
      target: { paymentRequestId: dau.id, orderId, via: "manual" },
      data: { description: txn.content ?? undefined, amount: soTien, reference: txn.providerTxnId },
    });
  }
  /** BẤT BIẾN: với MỖI con, Σ Payment gắn con = Σ phân bổ vào phiếu của con. Sổ phân bổ và sổ Payment phải nói CÙNG một điều. */
  async function soKhop(orderId: string) {
    const phieu = await phieuCuaDon(orderId);
    const ra: Record<string, { payment: number; phanBo: number }> = {};
    for (const r of phieu) {
      const pb = await db.paymentAllocation.aggregate({ where: { paymentRequestId: r.id }, _sum: { amount: true } });
      const pm = await db.payment.aggregate({ where: { orderId, orderItemId: r.orderItemId, deletedAt: null }, _sum: { amount: true } });
      ra[r.orderItemId ?? "∅"] = { payment: pm._sum.amount ?? 0, phanBo: pb._sum.amount ?? 0 };
    }
    return ra;
  }

  it("[PTD-01] SCOPE + thu linh hoạt BẬT + 2 con: MỖI CON một khoản phải thu (installmentNo 1, có orderItemId), KHÔNG có phiếu toàn đơn; Σ = tổng đơn", async () => {
    await datCo(OU1, true);
    await datFlex(OU1, true);
    const d = haiCon();
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    const yc = await phieuCuaDon(o.id);
    expect(yc).toHaveLength(2);
    expect(yc.every((r) => r.installmentNo === 1 && r.orderItemId !== null && r.status === "PENDING" && r.matchKey === null)).toBe(true);
    expect(yc.some((r) => r.installmentNo === 0)).toBe(false);
    const theoDong = new Map(yc.map((r) => [r.orderItemId, r.amountDue]));
    for (const it of o.items) expect(theoDong.get(it.id), it.itemName).toBe(it.totalPrice - it.discountAmount);
    expect(yc.reduce((s, r) => s + r.amountDue, 0)).toBe(o.totalAmount);
    expect(yc[0]!.sortOrder).toBeLessThan(yc[1]!.sortOrder); // thứ tự rót cố định theo thứ tự dòng
    expect(vi.mocked(ensureFullOrderRequest)).not.toHaveBeenCalled();
  });

  it("[PTD-02] giữ phiếu TOÀN ĐƠN y như cũ khi thiếu MỘT trong bốn điều kiện: thu linh hoạt TẮT · một con · có phí ship (đối chứng dương: PTD-01)", async () => {
    await datCo(OU1, true);
    // (a) thu linh hoạt TẮT (mặc định)
    const a = haiCon();
    expect((await createOrderManualAction(a)).ok).toBe(true);
    const ya = await phieuCuaDon((await docDon(a.customerName)).id);
    expect(ya.map((r) => [r.installmentNo, r.orderItemId])).toEqual([[0, null]]);
    // (b) bật nhưng MỘT con
    await datFlex(OU1, true);
    const b = don([dong()]);
    expect((await createOrderManualAction(b)).ok).toBe(true);
    const yb = await phieuCuaDon((await docDon(b.customerName)).id);
    expect(yb.map((r) => [r.installmentNo, r.orderItemId, r.matchKey !== null])).toEqual([[0, null, true]]);
    // (c) bật, hai con, CÓ phí ship ⇒ Σ phiếu theo con sẽ hụt đúng phí ship
    const c = haiCon({ shippingFee: 30_000 });
    const rc = await createOrderManualAction(c);
    expect(rc.ok, JSON.stringify(rc)).toBe(true);
    const yc = await phieuCuaDon((await docDon(c.customerName)).id);
    expect(yc.map((r) => [r.installmentNo, r.orderItemId])).toEqual([[0, null]]);
    expect(yc[0]!.amountDue).toBe(13_686_000);
  });

  it("[PTD-03] tiền về KHÔNG qua mã phiếu gộp: rót theo thứ tự ⇒ `Payment` ghi THEO CON, khớp sổ phân bổ (đủ con A; rồi lấn sang con B)", async () => {
    await datCo(OU1, true);
    await datFlex(OU1, true);
    const d = haiCon();
    expect((await createOrderManualAction(d)).ok).toBe(true);
    const o = await docDon(d.customerName);
    const [a, b] = await haiConTheoThuTuRot(o.id);

    await tienVe(o.id, 5_016_000); // đúng con A
    let pm = await db.payment.findMany({ where: { orderId: o.id }, select: { orderItemId: true, amount: true } });
    expect(pm).toEqual([{ orderItemId: a, amount: 5_016_000 }]);

    await tienVe(o.id, 1_000_000); // sang con B
    pm = await db.payment.findMany({ where: { orderId: o.id }, select: { orderItemId: true, amount: true }, orderBy: { createdAt: "asc" } });
    expect(pm).toEqual([{ orderItemId: a, amount: 5_016_000 }, { orderItemId: b, amount: 1_000_000 }]);
    expect(await soKhop(o.id)).toEqual({ [a]: { payment: 5_016_000, phanBo: 5_016_000 }, [b]: { payment: 1_000_000, phanBo: 1_000_000 } });
    expect(await db.payment.count({ where: { orderId: o.id, orderItemId: null } })).toBe(0);
  });

  it("[PTD-04] MỘT lượt tiền trải hai con ⇒ hai dòng Payment (mỗi con một dòng), tổng đúng; sổ phân bổ và sổ Payment khớp từng con", async () => {
    await datCo(OU1, true);
    await datFlex(OU1, true);
    const d = haiCon();
    expect((await createOrderManualAction(d)).ok).toBe(true);
    const o = await docDon(d.customerName);
    const [a, b] = await haiConTheoThuTuRot(o.id);
    // Con A đã có ghi danh (đơn đã Chuyển đổi): `Payment` của A phải mang `enrollmentId` — điều kiện `confirmPayment` đòi để phát phiếu thu và cổng phụ huynh trừ công nợ.
    await db.student.create({ data: { id: `${P}hv-ptd`, name: "HV PTD", studentCode: `${P}hv-ptd-ma`, centerId: CS1, parentName: "PH", parentPhone: "0905000111" } });
    await db.class.create({ data: { id: `${P}lop-ptd`, name: "Lớp PTD", courseId: KHOA3, centerId: CS1 } });
    await db.enrollment.create({ data: { id: `${P}gd-ptd`, studentId: `${P}hv-ptd`, classId: `${P}lop-ptd`, courseId: KHOA3, centerId: CS1, status: "STUDYING" } });
    await db.orderItem.update({ where: { id: a }, data: { enrollmentId: `${P}gd-ptd` } });
    await tienVe(o.id, 6_000_000); // A đủ 5.016.000 + B 984.000
    expect(await soKhop(o.id)).toEqual({ [a]: { payment: 5_016_000, phanBo: 5_016_000 }, [b]: { payment: 984_000, phanBo: 984_000 } });
    expect(await db.payment.count({ where: { orderId: o.id } })).toBe(2);
    expect(await db.payment.findMany({ where: { orderId: o.id }, select: { orderItemId: true, enrollmentId: true }, orderBy: { amount: "desc" } })).toEqual([
      { orderItemId: a, enrollmentId: `${P}gd-ptd` },
      { orderItemId: b, enrollmentId: null },
    ]);
  });

  it("[PTD-05] đơn kiểu CŨ (phiếu toàn đơn, `orderItemId` NULL) vẫn ghi MỘT dòng Payment như trước — không đổi hành vi đơn thường", async () => {
    await datCo(OU1, true); // thu linh hoạt TẮT ⇒ phiếu toàn đơn
    const d = haiCon();
    expect((await createOrderManualAction(d)).ok).toBe(true);
    const o = await docDon(d.customerName);
    await tienVe(o.id, 6_000_000);
    const pm = await db.payment.findMany({ where: { orderId: o.id }, select: { orderItemId: true, amount: true } });
    expect(pm).toEqual([{ orderItemId: null, amount: 6_000_000 }]);
  });

  it("[PTD-06] KHÔNG huỷ riêng khoản của một con: máy chủ từ chối, phiếu còn nguyên; con A đóng đủ thì đơn KHÔNG tự chốt khi con B chưa đóng đồng nào", async () => {
    await datCo(OU1, true);
    await datFlex(OU1, true);
    const d = haiCon();
    expect((await createOrderManualAction(d)).ok).toBe(true);
    const o = await docDon(d.customerName);
    const phieu = await phieuCuaDon(o.id);
    const r = await huyDotChoCon({ orderId: o.id, paymentRequestId: phieu[1]!.id, centerId: CS1, actor: { id: id.qlcs1, name: "QLCS 1" } });
    expect(r).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_HUY_KHOAN });
    expect((await phieuCuaDon(o.id)).map((x) => x.status)).toEqual(["PENDING", "PENDING"]);

    await tienVe(o.id, 5_016_000); // con A đủ
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true } })).status).not.toBe("CONFIRMED");
  });

  it("[ĐSC-DB-05] cờ RIÊNG TỪNG CƠ SỞ: bật ở CS2 không kéo CS1", async () => {
    await datCo(OU2, true);
    // CS1 vẫn legacy: giá niêm yết được nhận, không dấu.
    const d1 = don([dong({ unitPrice: 10_560_000 })]);
    expect((await createOrderManualAction(d1)).ok).toBe(true);
    expect(docPhamViDong((await docDon(d1.customerName)).items[0]!.metadata)).toBeNull();

    // CS2 chạy SCOPE (người tạo là QLCS của CS2; lead ở CS1 nên đơn walk-in không gắn lead).
    h.session = phien("qlcs2");
    const d2 = don([dong({ leadChildId: undefined })], { centerId: CS2, leadId: undefined });
    const res = await createOrderManualAction(d2);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o2 = await docDon(d2.customerName);
    expect(docPhamViDong(o2.items[0]!.metadata)).toMatchObject({ thanhTien: 8_976_000 });
    // Giá niêm yết ở CS2 (cờ bật) bị từ chối — đối chứng cho nhánh trên.
    const d3 = don([dong({ unitPrice: 10_560_000, leadChildId: undefined })], { centerId: CS2, leadId: undefined });
    expect((await createOrderManualAction(d3)).ok).toBe(false);
  });

  it("[ĐSC-DB-06] ROLLBACK: lỗi THẬT giữa giao dịch (sau `order.create`) ⇒ không còn Order / OrderItem / phiếu thu / audit mồ côi", async () => {
    await datCo(OU1, true);
    const hong = don([dong({ itemName: `${P}dong-rollback` })]);
    vi.mocked(ensureFullOrderRequest).mockImplementationOnce(async () => {
      throw new Error("hỏng giữa giao dịch (fixture)");
    });
    await expect(createOrderManualAction(hong)).rejects.toThrow("hỏng giữa giao dịch");
    expect(await db.order.count({ where: { customerName: hong.customerName } })).toBe(0);
    // Đếm dòng đơn theo TÊN RIÊNG của dòng (không qua quan hệ `order`): dòng mồ côi sẽ không có đơn để lọc theo.
    expect(await db.orderItem.count({ where: { itemName: `${P}dong-rollback` } })).toBe(0);
    expect(await db.paymentRequest.count({ where: { order: { customerName: hong.customerName } } })).toBe(0);
    expect(await db.studyEntitlement.count({ where: { courseId: KHOA3 } })).toBe(0);
    expect(vi.mocked(ensureFullOrderRequest)).toHaveBeenCalledTimes(1);

    // Đối chứng dương: chính đầu vào ấy, không ép lỗi ⇒ tạo được (lỗi trước là do giao dịch, không phải do đầu vào).
    const tot = don([dong()]);
    expect((await createOrderManualAction(tot)).ok).toBe(true);
    expect(await db.order.count({ where: { customerName: tot.customerName } })).toBe(1);
  });

  it("[ĐSC-DB-07] TỪ CHỐI trước giao dịch: kế hoạch đợt / đơn trộn / số buổi lẻ ⇒ không ghi gì", async () => {
    await datCo(OU1, true);
    const truoc = await db.order.count({ where: { customerName: { startsWith: P } } });
    const ca: Array<[string, ReturnType<typeof don>, string]> = [
      ["kế hoạch đợt", don([dong()], { keHoachDot: [{ amount: 8_976_000, daThu: false, dueDate: "2026-11-01" }] }), "Đã bỏ kế hoạch thanh toán chia đợt"],
      // [20/10/2026] "khoản giảm tay" ĐÃ RA KHỎI danh sách từ chối (chủ dự án mở lại) — xem [GT-DB-*]. Còn lại đúng những thứ chưa chốt.
      ["đơn trộn", don([dong(), dong({ itemName: "Sata 1", unitPrice: 5_200_003, leadChildId: CON_B, metadata: { courseId: KHOA1, soBuoi: 11 } })]), "đơn trộn"],
      ["số buổi lẻ", don([dong({ metadata: { courseId: KHOA3, soBuoi: 13 } })]), "không nằm trong các mốc"],
    ];
    for (const [ten, d, chua] of ca) {
      const res = await createOrderManualAction(d);
      expect(res.ok, ten).toBe(false);
      expect("error" in res ? res.error : "", ten).toContain(chua);
    }
    expect(await db.order.count({ where: { customerName: { startsWith: P } } })).toBe(truoc);
    expect(vi.mocked(ensureFullOrderRequest)).not.toHaveBeenCalled();
  });

  // ═══ PR UI TẠO ĐƠN SCOPE — xem trước giá + bảng cờ theo cơ sở + tạo đơn KHÔNG kế hoạch đợt ═════════════════════════
  /** Đếm các bảng mà một lượt XEM TRƯỚC tuyệt đối không được làm thay đổi. */
  const demGhi = async () => ({
    order: await db.order.count({ where: { customerName: { startsWith: P } } }),
    item: await db.orderItem.count({ where: { itemName: { startsWith: "Sata" }, order: { customerName: { startsWith: P } } } }),
    yeuCau: await db.paymentRequest.count({ where: { order: { customerName: { startsWith: P } } } }),
    dot: await db.orderInstallment.count({ where: { order: { customerName: { startsWith: P } } } }),
    audit: await db.auditLog.count({ where: { entityType: "Order", actorId: { in: Object.values(id) } } }),
    quyen: await db.studyEntitlement.count({ where: { courseId: { in: [KHOA3, KHOA4, KHOA1] } } }),
    suKien: await db.domainEvent.count(),
    tien: await db.payment.count({ where: { order: { customerName: { startsWith: P } } } }),
  });
  const xemTruoc = (items: Dong[], centerId: string | null = CS1) => xemTruocGiaPhamViAction({ centerId, items });

  it("[P6-DB-01] cờ BẬT: xem trước chỉ ĐỌC (mọi bảng đếm trước = sau); số trả về là số đường tạo đơn thật chấp nhận", async () => {
    await datCo(OU1, true);
    const truoc = await demGhi();
    const kq = await xemTruoc([dong({ unitPrice: 0 })]);
    expect(kq).toMatchObject({ ok: true, kieu: "SCOPE", dong: [{ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, phanTramApDung: 15, thanhTien: 8_976_000 }] });
    expect(await demGhi()).toEqual(truoc);

    // Vòng tròn: số xem trước đưa vào đường thật ⇒ tạo được; và đúng số đó là số ghi xuống.
    if (kq.ok !== true || kq.kieu !== "SCOPE") throw new Error("không phải SCOPE");
    const d = don([dong({ unitPrice: kq.dong[0]!.thanhTien })]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect((await docDon(d.customerName)).items[0]!.unitPrice).toBe(kq.dong[0]!.thanhTien);
  });

  it("[P6-DB-02] cờ BẬT: tạo đơn KHÔNG kế hoạch đợt (null như form gửi, và mảng rỗng) ⇒ thành công, 0 đợt, đúng MỘT phiếu thu toàn đơn", async () => {
    await datCo(OU1, true);
    for (const keHoachDot of [null, []]) {
      const d = don([dong()], { keHoachDot });
      const res = await createOrderManualAction(d);
      expect(res.ok, JSON.stringify(res)).toBe(true);
      const o = await docDon(d.customerName);
      expect(o.items[0]).toMatchObject({ unitPrice: 8_976_000, totalPrice: 8_976_000 });
      expect(await db.orderInstallment.count({ where: { orderId: o.id } })).toBe(0);
      const yc = await db.paymentRequest.findMany({ where: { orderId: o.id } });
      expect(yc).toHaveLength(1);
      expect(yc[0]).toMatchObject({ amountDue: 8_976_000, status: "PENDING" });
    }
  });

  it("[P6-DB-03] [20/10/2026] cờ TẮT: xem trước LEGACY; kế hoạch HAI đợt nay bị TỪ CHỐI (đã bỏ cho mọi đơn) — không ghi gì; cùng đơn không kế hoạch thì tạo được, đúng MỘT phiếu toàn đơn", async () => {
    const truoc = await demGhi();
    expect(await xemTruoc([dong({ unitPrice: 10_560_000 })])).toEqual({ ok: true, kieu: "LEGACY" });
    expect(await demGhi()).toEqual(truoc);

    const dotCu = [
      { amount: 5_280_000, daThu: false, dueDate: "2026-10-12", reminderDays: 14, laCoc: false },
      { amount: 5_280_000, daThu: false, dueDate: "2026-11-11", reminderDays: 14, laCoc: false },
    ];
    const bi = don([dong({ unitPrice: 10_560_000 })], { keHoachDot: dotCu });
    const resBi = await createOrderManualAction(bi);
    expect(resBi.ok).toBe(false);
    expect("error" in resBi ? resBi.error : "").toContain("Đã bỏ kế hoạch thanh toán chia đợt");
    // Không ghi gì: mọi bảng đếm trước = sau (đơn, dòng, phiếu, đợt, audit, quyền học, sự kiện, tiền).
    expect(await demGhi()).toEqual(truoc);

    // Đối chứng dương: CHÍNH đầu vào ấy bỏ kế hoạch ⇒ tạo được, 0 đợt, đúng một phiếu thu toàn đơn.
    const tot = don([dong({ unitPrice: 10_560_000 })]);
    const res = await createOrderManualAction(tot);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(tot.customerName);
    expect(o.items[0]!.unitPrice).toBe(10_560_000);
    expect(await db.orderInstallment.count({ where: { orderId: o.id } })).toBe(0);
    expect(await db.paymentRequest.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("[P6-DB-04] bảng cờ theo cơ sở: CS2 bật / CS1 tắt ⇒ đúng; cơ sở chưa ánh xạ OrgUnit ⇒ tắt; KHỚP với cổng tạo đơn của từng cơ sở", async () => {
    await datCo(OU2, true);
    const mo = await db.center.create({ data: { code: `${P}mo-coi`, name: `${P}Cơ sở mồ côi`, slug: `${P}mo-coi`, address: "-" } });
    try {
      const bang = await docCoSoBatPhamVi([CS1, CS2, mo.id]);
      expect(bang).toEqual({ [CS1]: false, [CS2]: true, [mo.id]: false });

      // Khớp với đường thật: cơ sở bật ⇒ xem trước SCOPE; cơ sở tắt/mồ côi ⇒ LEGACY. (Người tạo: QLCS tương ứng; mồ côi: không có OrgUnit để gán vai nên bỏ.)
      h.session = phien("qlcs2");
      expect(await xemTruoc([dong({ leadChildId: undefined })], CS2)).toMatchObject({ ok: true, kieu: "SCOPE" });
      h.session = phien("qlcs1");
      expect(await xemTruoc([dong({ leadChildId: undefined })], CS1)).toEqual({ ok: true, kieu: "LEGACY" });
    } finally {
      await db.center.delete({ where: { id: mo.id } });
    }
    // Đảo cờ ⇒ bảng đảo theo (đối chứng: bảng không cứng).
    await datCo(OU2, null);
    await datCo(OU1, true);
    expect(await docCoSoBatPhamVi([CS1, CS2])).toEqual({ [CS1]: true, [CS2]: false });
  });

  for (const v2 of [true, false] as const) {
    describe(`[P6-DB-05] xem trước giữ phân quyền + cách ly cơ sở — RBAC ${v2 ? "v2 (PROD)" : "v1 (mặc định local/CI)"}`, () => {
      beforeEach(async () => {
        chonCheDo(v2);
        await datCo(OU1, true);
        await datCo(OU2, true);
      });

      it("không đăng nhập / giáo viên (không có `orders:create`) ⇒ { ok:false }, không tiết lộ giá", async () => {
        h.session = null;
        expect(await xemTruoc([dong()])).toMatchObject({ ok: false });
        h.session = phien("gv");
        expect(await xemTruoc([dong()])).toMatchObject({ ok: false });
      });

      it("QLCS của CS2 xem trước cho CS1 ⇒ { ok:false }; [đối chứng] QLCS CS1 xem cho CS1 ⇒ SCOPE", async () => {
        h.session = phien("qlcs2");
        expect(await xemTruoc([dong()], CS1)).toMatchObject({ ok: false });
        h.session = phien("qlcs1");
        expect(await xemTruoc([dong()], CS1)).toMatchObject({ ok: true, kieu: "SCOPE" });
      });
    });
  }

  for (const v2 of [true, false] as const) {
    describe(`[ĐSC-DB-08] PHÂN QUYỀN + cách ly cơ sở vẫn gác khi cờ BẬT — RBAC ${v2 ? "v2 (PROD)" : "v1 (mặc định local/CI)"}`, () => {
      beforeEach(async () => {
        chonCheDo(v2);
        await datCo(OU1, true);
        await datCo(OU2, true);
      });

      it("không đăng nhập ⇒ bị chặn, không ghi gì", async () => {
        h.session = null;
        await expect(createOrderManualAction(don([dong()]))).rejects.toThrow();
        expect(await db.order.count({ where: { customerName: { startsWith: P } } })).toBe(0);
      });

      it("giáo viên (không có `orders:create`) ⇒ bị chặn, không ghi gì", async () => {
        h.session = phien("gv");
        await expect(createOrderManualAction(don([dong()]))).rejects.toThrow();
        expect(await db.order.count({ where: { customerName: { startsWith: P } } })).toBe(0);
      });

      it("QLCS của CS2 tạo đơn cho CS1 ⇒ 'Không có quyền tạo đơn cho cơ sở này' (scopedDb/passesScope không bị bỏ)", async () => {
        h.session = phien("qlcs2");
        const res = await createOrderManualAction(don([dong({ leadChildId: undefined })], { leadId: undefined }));
        expect(res.ok).toBe(false);
        expect("error" in res ? res.error : "").toContain("Không có quyền tạo đơn cho cơ sở này");
        expect(await db.order.count({ where: { customerName: { startsWith: P } } })).toBe(0);
      });

      it("đối chứng dương: QLCS của CS1 tạo đơn SCOPE cho CS1 ⇒ được", async () => {
        h.session = phien("qlcs1");
        const d = don([dong()]);
        const res = await createOrderManualAction(d);
        expect(res.ok, JSON.stringify(res)).toBe(true);
        expect(docPhamViDong((await docDon(d.customerName)).items[0]!.metadata)).not.toBeNull();
      });
    });
  }

  // ═══ [GT-DB] KHOẢN GIẢM THÊM TRÊN DÒNG SCOPE — chuỗi thật tạo đơn → duyệt → tiền → quyền học → giá ghi danh [20/10/2026] ═══════════════════
  //
  // Chủ dự án: *"phải để linh hoạt, tuỳ chính được chương trình giảm giá chứ… chuyển cho quản lý duyệt nếu thêm chính sách giảm thứ 2"* và
  // *"trần mức giảm thì để max 25% mà cho qlcs tự chỉnh cho từng cơ sở được"*. Fixture: Sata 3 48 buổi, chính sách 15% ⇒ 8.976.000.
  const khoanTay = (giaTri: number) => ({ kieu: "SO_TIEN", giaTri, lyDo: "Khách quen, quản lý đã đồng ý" });
  const datTran = async (orgUnitId: string, tran: number | null) => {
    if (tran === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key: KHOA_TRAN_PHAM_VI } });
    else {
      await db.centerSetting.upsert({
        where: { orgUnitId_key: { orgUnitId, key: KHOA_TRAN_PHAM_VI } },
        create: { orgUnitId, key: KHOA_TRAN_PHAM_VI, valueJson: tran },
        update: { valueJson: tran },
      });
    }
    clearSettingsCache();
  };
  const thu = (orderId: string, orderItemId: string, amount: number) =>
    db.payment.create({
      data: {
        orderId,
        orderItemId,
        amount,
        method: "cash",
        paidDate: HOM_NAY,
        saleStatus: "RECORDED",
        accountantStatus: DA_XAC_NHAN,
        centerId: CS1,
      },
    });

  it("[GT-DB-01] CHUỖI THẬT: SCOPE + 1 khoản thêm ⇒ lưu, tiền đúng, CHỜ DUYỆT, chưa xuất được QR; QLCS duyệt xong ⇒ QR mở", async () => {
    await datCo(OU1, true);
    const d = don([dong({ discounts: [khoanTay(100_000)] })]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    const it0 = o.items[0]!;
    // Tiền: đơn giá dòng = giá CHÍNH SÁCH; khoản thêm nằm ở discountAmount; tổng đơn = chính sách − khoản thêm.
    expect(it0).toMatchObject({ unitPrice: 8_976_000, totalPrice: 8_976_000, discountAmount: 100_000 });
    expect(o).toMatchObject({ subtotal: 8_976_000, discountAmount: 100_000, totalAmount: 8_876_000 });
    expect(docPhamViDong(it0.metadata)).toMatchObject({ thanhTien: 8_976_000, niemYet: 10_560_000 });
    // Phiếu thu toàn đơn đúng số khách phải trả sau giảm.
    const yc = await db.paymentRequest.findMany({ where: { orderId: o.id } });
    expect(yc).toHaveLength(1);
    expect(yc[0]).toMatchObject({ amountDue: 8_876_000, status: "PENDING" });
    // Chính sách thứ 2 ⇒ chờ duyệt giảm giá, và cổng QR dùng đúng câu chặn có sẵn.
    expect(o.discountApprovalStatus).toBe("PENDING_APPROVAL");
    expect(o.installmentApprovalStatus).toBeNull();
    expect(o.soBuoiApprovalStatus).toBeNull();
    const chan = lyDoChuaDuyetQr(laDonChoDuyet(o), false);
    expect(chan).toContain("chờ Quản lý cơ sở duyệt mới xuất được mã QR");
    // Quyền học KHÔNG sinh ra khi mới tạo (Q2: chỉ tiền xác nhận mới cấp).
    expect(await db.studyEntitlement.count({ where: { orderId: o.id } })).toBe(0);

    // Duyệt bằng ĐÚNG đường hiện có (KHÔNG quyền mới): QLCS của cơ sở duyệt → hết chặn.
    h.session = phien("qlcs1");
    const duyet = await approveOrderAction(o.id);
    expect(duyet.ok, JSON.stringify(duyet)).toBe(true);
    const sau = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(sau.discountApprovalStatus).toBe("APPROVED");
    expect(lyDoChuaDuyetQr(laDonChoDuyet(sau), false)).toBeNull();
  });

  it("[GT-DB-02] ĐỐI CHỨNG: SCOPE KHÔNG khoản thêm (đã giảm 15% theo chính sách) ⇒ KHÔNG chờ duyệt; hai anh em đóng đủ 48 buổi (15% + 25% chính sách) ⇒ KHÔNG chờ duyệt", async () => {
    await datCo(OU1, true);
    const d1 = don([dong()]);
    expect((await createOrderManualAction(d1)).ok).toBe(true);
    const o1 = await docDon(d1.customerName);
    expect(o1.discountApprovalStatus).toBeNull();
    expect(lyDoChuaDuyetQr(laDonChoDuyet(o1), false)).toBeNull();

    const d2 = don([
      dong({ leadChildId: CON_A }),
      dong({ itemName: "Sata 4", unitPrice: 8_640_000, leadChildId: CON_B, metadata: { courseId: KHOA4, soBuoi: 48 } }),
    ]);
    const res2 = await createOrderManualAction(d2);
    expect(res2.ok, JSON.stringify(res2)).toBe(true);
    const o2 = await docDon(d2.customerName);
    expect(o2.totalAmount).toBe(8_976_000 + 8_640_000);
    expect(o2.discountApprovalStatus).toBeNull();
  });

  it("[GT-DB-03] TRẦN THEO CƠ SỞ đọc bằng orgUnitId THẬT: CS1 trần 20 ⇒ khoản 600.000đ bị từ chối, KHÔNG ghi gì; trần CS2 hạ 10 không kéo CS1; CS1 trần mặc định 25 ⇒ cùng khoản LƯU", async () => {
    await datCo(OU1, true);
    await datCo(OU2, true);
    await datTran(OU1, 20);
    const truoc = await db.order.count({ where: { customerName: { startsWith: P } } });
    const bi = await createOrderManualAction(don([dong({ discounts: [khoanTay(600_000)] })]));
    expect(bi.ok).toBe(false);
    expect("error" in bi ? bi.error : "").toContain("vượt trần 20% của cơ sở này");
    expect(await db.order.count({ where: { customerName: { startsWith: P } } })).toBe(truoc);
    expect(vi.mocked(ensureFullOrderRequest)).not.toHaveBeenCalled();

    await datTran(OU1, null);
    await datTran(OU2, 10); // CS2 siết 10% — KHÔNG được kéo CS1 (CS1 vẫn mặc định 25)
    const ok = await createOrderManualAction(don([dong({ discounts: [khoanTay(600_000)] })]));
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
  });

  it("[GT-DB-04] TRẦN THẤP HƠN CHÍNH SÁCH (CS1 hạ 10%): đơn KHÔNG khoản thêm vẫn LƯU với giá chính sách; chỉ khoản thêm bị chặn", async () => {
    await datCo(OU1, true);
    await datTran(OU1, 10);
    const d = don([dong()]);
    const ok = await createOrderManualAction(d);
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect((await docDon(d.customerName)).totalAmount).toBe(8_976_000);
    const bi = await createOrderManualAction(don([dong({ discounts: [khoanTay(1_000)] })]));
    expect(bi.ok).toBe(false);
    expect("error" in bi ? bi.error : "").toContain("Trần thấp hơn mức chính sách phạm vi học");
  });

  it("[GT-DB-05] CHUỖI TIỀN → QUYỀN HỌC: khách đóng ĐÚNG số sau giảm (8.876.000) ⇒ cấp quyền học đúng 48 buổi, netAmount = số thực trả, KHÔNG báo dauKhongKhop oan; thiếu 1.000đ ⇒ chưa cấp", async () => {
    await datCo(OU1, true);
    const d = don([dong({ discounts: [khoanTay(100_000)] })]);
    expect((await createOrderManualAction(d)).ok).toBe(true);
    const o = await docDon(d.customerName);
    const dongId = o.items[0]!.id;
    // Mô phỏng sau Chuyển đổi: dòng đã biết học viên (đường cấp quyền học chỉ cần `OrderItem.studentId`).
    await db.student.create({ data: { id: HV_GT, name: `${P}Bé GT`, centerId: CS1, status: "ACTIVE" } });
    await db.orderItem.update({ where: { id: dongId }, data: { studentId: HV_GT } });

    await thu(o.id, dongId, 8_875_000); // thiếu 1.000đ so với số thực trả
    await hichCapQuyenHocChoDon(o.id, "GAN_TAY", HOM_NAY);
    expect(await db.studyEntitlement.count({ where: { orderId: o.id } }), "thiếu tiền ⇒ chưa cấp").toBe(0);

    await thu(o.id, dongId, 1_000); // đủ 8.876.000
    await hichCapQuyenHocChoDon(o.id, "GAN_TAY", HOM_NAY);
    const q = await db.studyEntitlement.findMany({ where: { orderId: o.id } });
    expect(q, "đủ đúng số sau giảm ⇒ cấp MỘT quyền học (không bị 'dấu không khớp')").toHaveLength(1);
    expect(q[0]).toMatchObject({
      studentId: HV_GT,
      orderItemId: dongId,
      purchaseSessions: 48,
      listAmount: 10_560_000,
      discountAmount: 1_684_000, // 1.584.000 chính sách + 100.000 khoản thêm
      netAmount: 8_876_000,
    });
    expect(q[0]!.listAmount - q[0]!.discountAmount).toBe(q[0]!.netAmount);
    // Không có dòng xử lý LECH_DU_LIEU / dấu không khớp nào mở ra.
    expect(await db.studyEntitlementXuLy.count({ where: { orderId: o.id, loai: "LECH_DU_LIEU", trangThai: "OPEN" } })).toBe(0);
  });

  it("[GT-DB-06] GIÁ GHI DANH khi chuyển đổi: dòng SCOPE có khoản thêm ⇒ giá = số khách THỰC trả (khoản thêm trừ ĐÚNG MỘT LẦN); đơn SCOPE không khoản thêm ⇒ như cũ", async () => {
    await datCo(OU1, true);
    const co = don([dong({ discounts: [khoanTay(100_000)] })]);
    expect((await createOrderManualAction(co)).ok).toBe(true);
    const dongDon = await dongDonCuaLead(LEAD);
    const dong1 = dongDon.filter((x) => x.leadChildId === CON_A && x.courseId === KHOA3);
    expect(dong1).toHaveLength(1);
    expect(dong1[0]!.totalPrice).toBe(8_876_000);
    expect(giaTuDongDon(dongDon, { leadChildId: CON_A, courseId: KHOA3 })).toBe(8_876_000);
  });

  it("[GT-DB-07] MÃ KHUYẾN MÃI trên dòng SCOPE: VoucherRedemption ghi đúng dòng + số tiền thực áp, usedCount +1, chờ duyệt; số tiền do MÁY CHỦ tính từ mã (không tin số client)", async () => {
    await datCo(OU1, true);
    const policy = await db.promotionPolicy.create({
      data: {
        documentCode: `${P}KM-GT`,
        name: "Chương trình thử (fixture)",
        benefitText: "Giảm 200.000đ",
        validFrom: new Date("2026-10-01T00:00:00Z"),
        validUntil: new Date("2026-12-31T00:00:00Z"),
      },
    });
    const v = await db.voucher.create({
      data: {
        code: `${P}MA200`,
        name: "Mã 200k (fixture)",
        type: "ALL",
        discountKind: "FIXED",
        discountAmount: 200_000,
        validFrom: new Date("2026-10-01T00:00:00Z"),
        validUntil: new Date("2026-12-31T00:00:00Z"),
        policyId: policy.id,
      },
    });
    // Client gửi giaTri = 1 (cố gian lận): máy chủ phải ghi đè bằng số của MÃ.
    const d = don([dong({ discounts: [{ kieu: "SO_TIEN", giaTri: 1, lyDo: "Chương trình thử (fixture)", voucherId: v.id }] })]);
    const res = await createOrderManualAction(d);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = await docDon(d.customerName);
    expect(o.items[0]).toMatchObject({ unitPrice: 8_976_000, discountAmount: 200_000 });
    expect(o.totalAmount).toBe(8_776_000);
    expect(o.discountApprovalStatus).toBe("PENDING_APPROVAL");
    const lan = await db.voucherRedemption.findMany({ where: { orderId: o.id } });
    expect(lan).toHaveLength(1);
    expect(lan[0]).toMatchObject({ voucherId: v.id, orderItemId: o.items[0]!.id, discountApplied: 200_000 });
    expect((await db.voucher.findUniqueOrThrow({ where: { id: v.id } })).usedCount).toBe(1);
  });

});
