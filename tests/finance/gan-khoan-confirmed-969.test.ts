// tests/finance/gan-khoan-confirmed-969.test.ts — [G969-*] GẮN NGUYÊN KHOẢN ĐÃ XÁC NHẬN CHƯA CÓ GHI DANH (#969, E4 đối soát T9–T10), Postgres THẬT.
//
// Chạy:  DATABASE_URL=…/satarobo_test_xxx DIRECT_URL=$DATABASE_URL TEST_DATABASE_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/gan-khoan-confirmed-969.test.ts
//
// Luật cần giữ (ticket #969):
//   · khoản ĐÃ XÁC NHẬN, chưa gắn ghi danh, GẮN NGUYÊN được (một mảnh, đúng số cũ) ⇒ chỉ điền `enrollmentId` — số tiền, trạng thái kế toán, ngày thu, ghi chú,
//     người/giờ xác nhận KHÔNG đổi; không Payment mới; có AuditLog; không tự cấp phiếu thu;
//   · KHÔNG hạ CONFIRMED để lách; KHÔNG tăng tiền thu; KHÔNG gắn trùng (đua, bấm lại);
//   · phải TÁCH tiền, hoặc dữ liệu bất thường (điều chỉnh/đảo/số âm) ⇒ NÉM trước phép ghi đầu tiên và cả lượt chuyển đổi rollback;
//   · hoá đơn không đổi; không gộp bé trùng tên gần giống (Lê Phước Anh Quân ≠ Lê Anh Quân).
//
// Fixture mang HÌNH DẠNG THẬT của E4 (đo PROD 25/10/2026): lead DA_DANG_KY, đơn legacy 1 dòng (metadata courseId + leadChildId, KHÔNG dấu SCOPE), một
// khoản cọc CONFIRMED sepay chưa gắn ghi danh, KHÔNG người xác nhận, KHÔNG giờ xác nhận, 0 phiếu thu. Mỗi ca tự dựng lại từ đầu (luật 18).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  actor: null as unknown as Actor,
  uid: "fx-g969-sale",
  quyen: new Set<string>(),
  hongSync: false,
}));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.uid, name: "G969 Sale" } }) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (p: string) => h.quyen.has(p) }));
vi.mock("@/lib/auth/actor", async (goc) => {
  const m = await goc<typeof import("@/lib/auth/actor")>();
  return { ...m, resolveActor: async () => h.actor };
});
// Bước CUỐI trong transaction chuyển đổi — dùng để ép một lỗi SAU khi khoản đã gắn, chứng minh rollback.
vi.mock("@/lib/chat/sync-membership", async (goc) => {
  const m = await goc<typeof import("@/lib/chat/sync-membership")>();
  return {
    ...m,
    syncConversationMembership: async (...a: Parameters<typeof m.syncConversationMembership>) => {
      if (h.hongSync) throw new Error("G969: lỗi giả lập sau khi đã gắn khoản");
      return m.syncConversationMembership(...a);
    },
  };
});

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { submitConvertV2 } from "@/app/(admin)/admin/leads/[id]/convert/actions";
import { ganGhiDanhChoKhoanCuaDon, thucHienKeHoachGan, napGanGhiDanhCuaDon } from "@/lib/finance/payment";
import { lapKeHoachGanGhiDanh } from "@/lib/finance/ke-hoach-gan-ghi-danh";

if (!RUN_DB_TESTS) console.warn(`[G969] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const T = "fx-g969-";
const KHOA = `${T}khoa`;
const SALE = `${T}sale`;
const KT = { id: `${T}ke-toan`, name: "G969 KT" };
const DA_XAC_NHAN = "CONFIRMED" as const;
const SDT = "0905969001";
const SDT_CANON = "84905969001";
const QUYEN_SALE = ["students:create", "enrollments:create", "enrollments:edit", "orders:view", "payments:record"];
const NGAY_THU = new Date("2026-09-30T13:26:47.000Z");

let CS = "";

const actorSale = (): Actor =>
  ({
    userId: SALE,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [CS],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) satisfies Actor;

async function donDep() {
  const dons = await db.order.findMany({ where: { OR: [{ id: { startsWith: T } }, { customerName: { startsWith: T } }] }, select: { id: true } });
  const ids = dons.map((d) => d.id);
  const pays = await db.payment.findMany({ where: { orderId: { in: ids } }, select: { id: true } });
  const idPay = pays.map((p) => p.id);
  const hvs = await db.student.findMany({ where: { OR: [{ id: { startsWith: T } }, { name: { startsWith: T } }] }, select: { id: true, parentUserId: true } });
  const hvIds = hvs.map((x) => x.id);
  const gds = await db.enrollment.findMany({ where: { OR: [{ id: { startsWith: T } }, { classId: { startsWith: T } }, { studentId: { in: hvIds } }] }, select: { id: true } });
  const gdIds = gds.map((x) => x.id);
  await db.hoaDonKhoan.deleteMany({ where: { paymentId: { in: idPay } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: ids } } });
  await db.commissionLine.deleteMany({ where: { enrollmentId: { in: gdIds } } });
  await db.receipt.deleteMany({ where: { paymentId: { in: idPay } } });
  await db.domainEvent.deleteMany({ where: { OR: [{ payloadJson: { path: ["leadId"], string_starts_with: T } }, ...idPay.map((id) => ({ dedupeKey: { contains: id } }))] } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...idPay, ...ids, ...gdIds, ...hvIds] } }, { entityId: { startsWith: T } }, { actorName: { startsWith: "G969" } }] } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.studentConsent.deleteMany({ where: { studentId: { in: hvIds } } });
  await db.enrollment.deleteMany({ where: { id: { in: gdIds } } });
  await db.student.deleteMany({ where: { id: { in: hvIds } } });
  await db.leadChild.deleteMany({ where: { lead: { parentName: { startsWith: T } } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: T } } });
  await db.idempotencyKey.deleteMany({ where: { key: { startsWith: "convert:" }, scope: "convert", result: { not: undefined } } }).catch(() => undefined);
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.user.deleteMany({ where: { OR: [{ id: { startsWith: T } }, { name: { startsWith: T } }, { phone: { in: [SDT_CANON, "84905969002"] } }] } });
}

async function dungNen() {
  await db.course.upsert({ where: { id: KHOA }, create: { id: KHOA, name: `${T}Sata 6`, slug: KHOA, price: 13_440_000, totalSessions: 48 }, update: { price: 13_440_000, totalSessions: 48 } });
  await db.user.upsert({ where: { id: SALE }, create: { id: SALE, name: `${T}Sale`, email: `${SALE}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS, isActive: true }, update: {} });
  await db.user.upsert({ where: { id: KT.id }, create: { id: KT.id, name: `${T}Kế toán`, email: `${KT.id}@example.test`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"], centerId: CS, isActive: true }, update: {} });
}

async function dungLop(id: string) {
  await db.class.create({ data: { id, name: `${T}${id}`, courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 12 } });
}

/** Một lead + (n) bé + một đơn legacy mỗi bé hoặc một đơn chung. */
async function dungLead(o: { ten: string; soBe: 1 | 2; giaDong?: number[] }) {
  const lead = await db.lead.create({ data: { parentName: `${T}${o.ten}`, phone: SDT, centerId: CS, assignedToId: SALE, status: "DA_DANG_KY", courseId: KHOA }, select: { id: true } });
  const cons: string[] = [];
  for (let i = 0; i < o.soBe; i++) {
    cons.push((await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}Be ${o.ten} ${i + 1}`, interestedCourseId: KHOA }, select: { id: true } })).id);
  }
  const gia = o.giaDong ?? cons.map(() => 12_768_000);
  const tong = gia.reduce((s, x) => s + x, 0);
  const don = await db.order.create({
    data: { id: `${T}don-${o.ten}`, code: `ORD-2699-G969-${o.ten}`, type: "COURSE", status: "PENDING_PAYMENT", customerName: `${T}${o.ten}`, customerPhone: SDT_CANON, subtotal: tong, totalAmount: tong, centerId: CS, leadId: lead.id },
    select: { id: true },
  });
  for (const [i, c] of cons.entries()) {
    await db.orderItem.create({
      data: { id: `${T}it-${o.ten}-${i}`, orderId: don.id, type: "COURSE_ENROLLMENT", itemName: "Sata6", quantity: 1, unitPrice: gia[i]!, totalPrice: gia[i]!, discountAmount: 0, status: "ACTIVE", metadata: { courseId: KHOA, soBuoi: 48, leadChildId: c } },
    });
  }
  return { lead: lead.id, cons, don: don.id, dong: cons.map((_, i) => `${T}it-${o.ten}-${i}`) };
}

const khoan = (id: string, orderId: string, amount: number, o: { kt?: "PENDING" | typeof DA_XAC_NHAN | "REJECTED"; loai?: "PAYMENT" | "ADJUSTMENT"; adj?: string } = {}) =>
  db.payment.create({
    data: {
      id,
      orderId,
      amount,
      method: "sepay",
      paidDate: NGAY_THU,
      saleStatus: "RECORDED",
      accountantStatus: o.kt ?? DA_XAC_NHAN,
      centerId: CS,
      paymentType: o.loai ?? "PAYMENT",
      adjustmentOfId: o.adj ?? null,
      note: `Phiếu gộp G969 — SEPAY FT${id} [auto:sepay:FT${id}]`,
    },
  });

const form = (l: { cons: string[] }, lop: string, ten: string) => ({
  parentName: `${T}${ten}`,
  parentEmail: "",
  parentPhone: SDT,
  students: l.cons.map((c, i) => ({ leadChildId: c, name: `${T}Be ${ten} ${i + 1}`, dob: "", classId: lop, consentMedia: false })),
});

async function chuyen(l: { lead: string; cons: string[] }, lop: string, ten: string) {
  h.uid = SALE;
  h.actor = actorSale();
  h.quyen = new Set(QUYEN_SALE);
  try {
    return await submitConvertV2(l.lead, form(l, lop, ten));
  } catch (e) {
    return { ok: false as const, nem: e instanceof Error ? e.message : String(e) };
  }
}
const pay = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });

describe.skipIf(!RUN_DB_TESTS)("[G969] gắn nguyên khoản ĐÃ XÁC NHẬN chưa gắn ghi danh — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    await dungNen();
  });
  beforeEach(async () => {
    h.hongSync = false;
    await donDep();
    await dungNen();
  });
  afterAll(async () => {
    await donDep();
    await db.course.deleteMany({ where: { id: KHOA } });
  });

  it("[G969-00] fixture đúng hình dạng E4: CONFIRMED, chưa gắn ghi danh, KHÔNG người/giờ xác nhận, 0 phiếu thu, đơn legacy KHÔNG dấu phạm vi", async () => {
    const l = await dungLead({ ten: "E4", soBe: 1 });
    await khoan(`${T}p1`, l.don, 1_000_000);
    const p = await pay(`${T}p1`);
    expect(p).toMatchObject({ accountantStatus: DA_XAC_NHAN, enrollmentId: null, confirmedById: null, confirmedAt: null });
    expect(await db.receipt.count({ where: { paymentId: p.id } })).toBe(0);
    expect(JSON.stringify((await db.orderItem.findFirstOrThrow({ where: { orderId: l.don } })).metadata)).not.toContain("phamVi");
  });

  it("[G969-01] E4: chuyển lead THÀNH CÔNG; khoản gắn NGUYÊN vào ghi danh MỚI — số tiền/trạng thái/ngày thu/ghi chú/người-giờ xác nhận giữ nguyên, không Payment mới, không phiếu thu, có AuditLog", async () => {
    const l = await dungLead({ ten: "E4", soBe: 1 });
    await dungLop(`${T}lop`);
    await khoan(`${T}p1`, l.don, 1_000_000);
    const truoc = await pay(`${T}p1`);
    const kq = await chuyen(l, `${T}lop`, "E4");
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok || !("enrollmentIds" in kq)) return;

    const sau = await pay(`${T}p1`);
    expect(sau).toMatchObject({
      enrollmentId: kq.enrollmentIds[0],
      amount: 1_000_000,
      accountantStatus: DA_XAC_NHAN,
      saleStatus: "RECORDED",
      confirmedById: null,
      confirmedAt: null,
      note: truoc.note,
      deletedAt: null,
    });
    expect(sau.paidDate.toISOString()).toBe(truoc.paidDate.toISOString());
    expect(await db.payment.count({ where: { orderId: l.don } }), "không Payment mới").toBe(1);
    expect(await db.receipt.count({ where: { paymentId: sau.id } }), "gắn KHÔNG tự cấp phiếu thu").toBe(0);
    const nk = await db.auditLog.findFirst({ where: { entityType: "Payment", entityId: sau.id, action: "UPDATE" } });
    expect(nk?.oldValues).toMatchObject({ enrollmentId: null });
    expect(nk?.newValues).toMatchObject({ enrollmentId: kq.enrollmentIds[0], source: "convert-gan-nguyen-da-xac-nhan", amount: 1_000_000 });
    expect(nk?.changedFields).toEqual(["enrollmentId"]);
    expect((await db.lead.findUniqueOrThrow({ where: { id: l.lead } })).convertedAt).not.toBeNull();
  });

  it("[G969-02] KHÔNG gộp bé trùng tên gần giống: học viên 'Lê Anh Quân' của PH khác (cùng cơ sở, cùng khoá) giữ nguyên ghi danh + khoản; khoản E4 chỉ gắn vào ghi danh của bé MỚI", async () => {
    const khac = await dungLead({ ten: "Khac", soBe: 1, giaDong: [10_560_000] });
    await db.user.create({ data: { id: `${T}ph-khac`, name: `${T}PH khác`, phone: "84905969002", role: "PARENT", roles: ["PARENT"], centerId: CS, isActive: true } });
    await db.student.create({ data: { id: `${T}hv-khac`, name: `${T}Lê Anh Quân`, parentUserId: `${T}ph-khac`, parentPhone: "84905969002", centerId: CS, status: "ACTIVE" } });
    await dungLop(`${T}lop`);
    await db.enrollment.create({ data: { id: `${T}gd-khac`, studentId: `${T}hv-khac`, classId: `${T}lop`, courseId: KHOA, centerId: CS, status: "STUDYING", finalPrice: 10_560_000 } });
    await khoan(`${T}p-khac`, khac.don, 2_640_000, { kt: "PENDING" });
    await db.payment.update({ where: { id: `${T}p-khac` }, data: { enrollmentId: `${T}gd-khac` } });
    const anhKhac = JSON.stringify({ gd: await db.enrollment.findUniqueOrThrow({ where: { id: `${T}gd-khac` } }), p: await pay(`${T}p-khac`) });

    const l = await dungLead({ ten: "E4", soBe: 1 });
    await khoan(`${T}p1`, l.don, 1_000_000);
    const kq = await chuyen(l, `${T}lop`, "E4");
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok || !("studentIds" in kq)) return;

    expect(kq.studentIds[0]).not.toBe(`${T}hv-khac`);
    expect((await pay(`${T}p1`)).enrollmentId).toBe(kq.enrollmentIds[0]);
    expect((await pay(`${T}p1`)).enrollmentId).not.toBe(`${T}gd-khac`);
    expect(JSON.stringify({ gd: await db.enrollment.findUniqueOrThrow({ where: { id: `${T}gd-khac` } }), p: await pay(`${T}p-khac`) }), "bé trùng tên gần giống không bị đụng").toBe(anhKhac);
    expect(await db.student.count({ where: { name: { startsWith: `${T}` }, id: { not: `${T}hv-khac` } } })).toBe(1);
  });

  it("[G969-03] IDEMPOTENT: bấm lại ⇒ deduped, không gắn lần hai, không thêm AuditLog; chạy lại chính hàm gắn ⇒ 0", async () => {
    const l = await dungLead({ ten: "E4", soBe: 1 });
    await dungLop(`${T}lop`);
    await khoan(`${T}p1`, l.don, 1_000_000);
    const a = await chuyen(l, `${T}lop`, "E4");
    expect(a.ok, JSON.stringify(a)).toBe(true);
    const demNk = () => db.auditLog.count({ where: { entityType: "Payment", entityId: `${T}p1` } });
    const nk1 = await demNk();
    const b = await chuyen(l, `${T}lop`, "E4");
    expect(b).toMatchObject({ ok: true, deduped: true });
    expect(await demNk()).toBe(nk1);
    const lai = await db.$transaction((tx) => ganGhiDanhChoKhoanCuaDon(tx, { orderId: l.don, actor: KT }));
    expect(lai).toMatchObject({ linked: 0, splitCreated: 0 });
    expect(await demNk()).toBe(nk1);
  });

  it("[G969-04] CHỈ ĐIỀN CỘT: khoản CONFIRMED + khoản PENDING cùng đơn ⇒ cả hai gắn đúng ghi danh; PENDING vẫn PENDING, CONFIRMED vẫn CONFIRMED; tổng tiền đơn không đổi", async () => {
    const l = await dungLead({ ten: "E4", soBe: 1 });
    await dungLop(`${T}lop`);
    await khoan(`${T}p-xn`, l.don, 1_000_000);
    await khoan(`${T}p-cho`, l.don, 2_000_000, { kt: "PENDING" });
    const kq = await chuyen(l, `${T}lop`, "E4");
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok || !("enrollmentIds" in kq)) return;
    const ds = await db.payment.findMany({ where: { orderId: l.don }, orderBy: { id: "asc" } });
    expect(ds.map((p) => [p.id, p.enrollmentId, p.accountantStatus, p.amount])).toEqual([
      [`${T}p-cho`, kq.enrollmentIds[0], "PENDING", 2_000_000],
      [`${T}p-xn`, kq.enrollmentIds[0], DA_XAC_NHAN, 1_000_000],
    ]);
    expect(ds.reduce((s, p) => s + p.amount, 0)).toBe(3_000_000);
  });

  it("[G969-05] PHẢI TÁCH tiền đã xác nhận (đơn 2 bé, một khoản CONFIRMED chung) ⇒ NÉM; ROLLBACK TRỌN: không học viên, không ghi danh, lead chưa chuyển, khoản CHỜ cũng KHÔNG bị gắn, không khoá idempotency", async () => {
    const l = await dungLead({ ten: "HaiBe", soBe: 2, giaDong: [8_000_000, 4_000_000] });
    await dungLop(`${T}lop`);
    await khoan(`${T}p-xn`, l.don, 3_000_000);
    await khoan(`${T}p-cho`, l.don, 1_000_000, { kt: "PENDING" });
    const kq = await chuyen(l, `${T}lop`, "HaiBe");
    expect(kq.ok).toBe(false);
    expect(JSON.stringify(kq)).toMatch(/ĐÃ XÁC NHẬN/);
    expect(await db.student.count({ where: { leadId: l.lead } })).toBe(0);
    expect(await db.enrollment.count({ where: { classId: `${T}lop` } })).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: l.lead } })).convertedAt).toBeNull();
    for (const id of [`${T}p-xn`, `${T}p-cho`]) expect((await pay(id)).enrollmentId).toBeNull();
    expect((await pay(`${T}p-xn`)).amount).toBe(3_000_000);
    expect(await db.idempotencyKey.count({ where: { key: { startsWith: `convert:${l.lead}` } } })).toBe(0);
  });

  it("[G969-06] ROLLBACK SAU KHI ĐÃ GẮN: một lỗi ở bước cuối của transaction chuyển đổi ⇒ khoản CONFIRMED trở lại CHƯA gắn, không học viên, không audit gắn", async () => {
    const l = await dungLead({ ten: "E4", soBe: 1 });
    await dungLop(`${T}lop`);
    await khoan(`${T}p1`, l.don, 1_000_000);
    h.hongSync = true;
    const kq = await chuyen(l, `${T}lop`, "E4");
    h.hongSync = false;
    expect(kq.ok).toBe(false);
    expect((await pay(`${T}p1`)).enrollmentId, "rollback: khoản không còn gắn").toBeNull();
    expect(await db.student.count({ where: { leadId: l.lead } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "Payment", entityId: `${T}p1`, action: "UPDATE" } })).toBe(0);
    // Sau khi hết lỗi, chuyển lại bình thường.
    const lai = await chuyen(l, `${T}lop`, "E4");
    expect(lai.ok, JSON.stringify(lai)).toBe(true);
    expect((await pay(`${T}p1`)).enrollmentId).not.toBeNull();
  });

  it("[G969-07] DỮ LIỆU BẤT THƯỜNG: khoản CONFIRMED đã bị ĐIỀU CHỈNH/ĐẢO, hoặc dòng điều chỉnh số ÂM chưa gắn ⇒ NÉM như cũ (không gắn riêng một nửa); khoản REJECTED chưa gắn ⇒ không đụng, chuyển lead vẫn thành công", async () => {
    // (a) khoản gốc bị đảo
    const a = await dungLead({ ten: "DaoA", soBe: 1 });
    await dungLop(`${T}lop`);
    await khoan(`${T}pa`, a.don, 1_000_000);
    await khoan(`${T}pa-dao`, a.don, -1_000_000, { loai: "ADJUSTMENT", adj: `${T}pa` });
    const ka = await chuyen(a, `${T}lop`, "DaoA");
    expect(ka.ok).toBe(false);
    expect(JSON.stringify(ka)).toMatch(/không phải tiền thu sạch/);
    expect((await pay(`${T}pa`)).enrollmentId).toBeNull();
    expect(await db.student.count({ where: { leadId: a.lead } })).toBe(0);
    // (b) khoản REJECTED chưa gắn: không nằm trong tập "đã ghi nhận" ⇒ nằm yên
    await donDep();
    await dungNen();
    const b = await dungLead({ ten: "TuChoi", soBe: 1 });
    await dungLop(`${T}lop`);
    await khoan(`${T}pb-rj`, b.don, 500_000, { kt: "REJECTED" });
    await khoan(`${T}pb-cho`, b.don, 1_000_000, { kt: "PENDING" });
    const kb = await chuyen(b, `${T}lop`, "TuChoi");
    expect(kb.ok, JSON.stringify(kb)).toBe(true);
    expect(await pay(`${T}pb-rj`)).toMatchObject({ enrollmentId: null, accountantStatus: "REJECTED", amount: 500_000 });
    expect((await pay(`${T}pb-cho`)).enrollmentId).not.toBeNull();
  });

  it("[G969-08] ĐUA: hai lượt cùng gắn MỘT khoản CONFIRMED ⇒ đúng MỘT lượt gắn (lượt kia đổi 0 dòng), đúng MỘT AuditLog, số tiền không đổi", async () => {
    const l = await dungLead({ ten: "Dua", soBe: 1 });
    await dungLop(`${T}lop`);
    await db.student.create({ data: { id: `${T}hv-dua`, name: `${T}Be Dua`, parentPhone: SDT_CANON, centerId: CS, status: "ACTIVE" } });
    await db.enrollment.create({ data: { id: `${T}gd-dua`, studentId: `${T}hv-dua`, classId: `${T}lop`, courseId: KHOA, centerId: CS, status: "STUDYING", finalPrice: 12_768_000 } });
    await khoan(`${T}p1`, l.don, 1_000_000);
    const duLieu = (await db.$transaction((tx) => napGanGhiDanhCuaDon(tx, l.don)))!;
    const kh = lapKeHoachGanGhiDanh({ ...duLieu, trongTam: () => true });
    expect(kh.chan).toBeNull();
    expect(kh.dong[0]).toMatchObject({ ketQua: "GAN" });
    const [x, y] = await Promise.all([
      db.$transaction((tx) => thucHienKeHoachGan(tx, duLieu, kh, KT, "test-dua-969")),
      db.$transaction((tx) => thucHienKeHoachGan(tx, duLieu, kh, KT, "test-dua-969")),
    ]);
    expect(x.linked + y.linked, JSON.stringify([x, y])).toBe(1);
    expect(x.doi.length + y.doi.length).toBe(1);
    expect(await pay(`${T}p1`)).toMatchObject({ enrollmentId: `${T}gd-dua`, amount: 1_000_000, accountantStatus: DA_XAC_NHAN });
    expect(await db.auditLog.count({ where: { entityType: "Payment", entityId: `${T}p1`, action: "UPDATE" } })).toBe(1);
  });

  it("[G969-09] KHÔNG HẠ TRẠNG THÁI / KHÔNG LÁCH: khoản bị TỪ CHỐI giữa lúc lập kế hoạch và lúc ghi ⇒ không gắn; thực hiện kế hoạch KHÔNG BAO GIỜ ghi `accountantStatus`", async () => {
    const l = await dungLead({ ten: "Lach", soBe: 1 });
    await dungLop(`${T}lop`);
    await db.student.create({ data: { id: `${T}hv-lach`, name: `${T}Be Lach`, parentPhone: SDT_CANON, centerId: CS, status: "ACTIVE" } });
    await db.enrollment.create({ data: { id: `${T}gd-lach`, studentId: `${T}hv-lach`, classId: `${T}lop`, courseId: KHOA, centerId: CS, status: "STUDYING", finalPrice: 12_768_000 } });
    await khoan(`${T}p1`, l.don, 1_000_000);
    const duLieu = (await db.$transaction((tx) => napGanGhiDanhCuaDon(tx, l.don)))!;
    const kh = lapKeHoachGanGhiDanh({ ...duLieu, trongTam: () => true });
    await db.payment.update({ where: { id: `${T}p1` }, data: { accountantStatus: "REJECTED" } });
    const kq = await db.$transaction((tx) => thucHienKeHoachGan(tx, duLieu, kh, KT, "test-lach-969"));
    expect(kq).toMatchObject({ linked: 0, doi: [`${T}p1`] });
    expect(await pay(`${T}p1`)).toMatchObject({ enrollmentId: null, accountantStatus: "REJECTED" });
  });

  it("[G969-10] HOÁ ĐƠN: khoản CONFIRMED nằm trong hoá đơn nháp được gắn nguyên khi chuyển lead; dòng nối, số tiền và tổng hoá đơn KHÔNG đổi", async () => {
    const l = await dungLead({ ten: "HoaDon", soBe: 1 });
    await dungLop(`${T}lop`);
    await khoan(`${T}p1`, l.don, 1_000_000);
    await db.hoaDonDienTu.create({
      data: {
        id: `${T}hd`, orderId: l.don, centerId: CS, trangThai: "NHAP", kyHieu: "1C26TSR", soHoaDon: "969", ngayPhatHanh: new Date("2026-10-01T00:00:00Z"),
        tepPdfKey: `hoa-don/CS2/2026/${l.don}/u.pdf`, tepPdfTen: "hd.pdf", guiEmailKhach: false, tongTien: 1_000_000, taoBoiId: KT.id,
        khoan: { create: [{ paymentId: `${T}p1`, soTien: 1_000_000 }] },
      },
    });
    const truoc = JSON.stringify(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: `${T}hd` }, include: { khoan: true } }));
    const kq = await chuyen(l, `${T}lop`, "HoaDon");
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    expect((await pay(`${T}p1`)).enrollmentId).not.toBeNull();
    expect(JSON.stringify(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: `${T}hd` }, include: { khoan: true } }))).toBe(truoc);
  });
});
