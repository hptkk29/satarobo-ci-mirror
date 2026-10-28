// tests/finance/uat-doi-soat-chuyen-lead.test.ts — [UAT-CL-*] UAT GIẢ LẬP luồng CHUYỂN LEAD cho E1/E3 (đối soát T9–T10), Postgres THẬT.
//
// Chạy:  DATABASE_URL=…/satarobo_test_xxx DIRECT_URL=$DATABASE_URL TEST_DATABASE_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/uat-doi-soat-chuyen-lead.test.ts
//
// ĐÂY LÀ UAT GIẢ LẬP trên dữ liệu tổng hợp — KHÔNG phải phê duyệt giá/ghi sổ nào trên PROD. Gọi THẲNG `submitConvertV2` (Server Action thật
// của màn Chuyển lead) và `suaHocPhiGhiDanhAction`/`confirmPayment`; chỉ mock cổng ngoài (phiên đăng nhập, `revalidatePath`, quyền = đúng TẬP QUYỀN
// của vai trên PROD đo 25/10/2026). Kênh gửi tin: bộ test KHÔNG có credential Zalo/Resend ⇒ `fetch` bị chặn cứng, và ta đọc `ZaloMessageLog` để biết
// tin SẼ gửi gì.
//
// Fixture mang HÌNH DẠNG THẬT của E1/E3 (đo PROD 25/10): lead DA_DANG_KY + 1 bé; đơn legacy (KHÔNG dấu SCOPE) 1 dòng, giá dòng = giá niêm yết
// khoá, giảm 15% nằm ở `OrderItem.discountAmount`; MỘT Payment PENDING (sepay) chưa gắn ghi danh; bé đã học thử (PRESENT) với GV có tài khoản.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  actor: null as unknown as Actor,
  uid: "fx-uat5-sale",
  quyen: new Set<string>(),
  hoi: [] as string[],
}));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.uid, name: "UAT Sale CS" } }) }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: async (p: string) => {
    h.hoi.push(p);
    return h.quyen.has(p);
  },
}));
vi.mock("@/lib/auth/actor", async (goc) => {
  const m = await goc<typeof import("@/lib/auth/actor")>();
  return { ...m, resolveActor: async () => h.actor };
});

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { submitConvertV2 } from "@/app/(admin)/admin/leads/[id]/convert/actions";
import { suaHocPhiGhiDanhAction } from "@/app/(admin)/admin/cong-no/_actions";
import { confirmPayment, rejectPayment } from "@/lib/finance/payment";
import { sumConfirmed } from "@/lib/finance/debt";
import { onLeadConverted } from "@/lib/crm/_handlers/lead-converted";
import { trialTeacherCommissionAmount } from "@/lib/crm/trial-teacher-commission";

if (!RUN_DB_TESTS) console.warn(`[UAT-CL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const T = "fx-uat5-";
const KHOA = `${T}khoa-sata3`;
const KHOA4 = `${T}khoa-sata4`;
const SALE = `${T}sale`;
const KE_TOAN = `${T}ke-toan`;
const GV = `${T}gv`;

/** Tập quyền THẬT của hai vai trên PROD (truy vấn RolePermission 25/10/2026) — chỉ các quyền mà các màn này hỏi. */
const QUYEN_SALE_CSM = ["students:create", "enrollments:create", "enrollments:edit", "orders:view", "payments:record"];
const QUYEN_KE_TOAN_HO = ["payments:confirm", "payments:record", "orders:manage", "orders:view"];

let CS = "";
let dem = 0;

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
  await db.commissionLine.deleteMany({ where: { OR: [{ enrollmentId: { in: gdIds } }, { recipientId: GV }] } });
  await db.receipt.deleteMany({ where: { paymentId: { in: idPay } } });
  await db.domainEvent.deleteMany({
    where: { OR: [{ payloadJson: { path: ["leadId"], string_starts_with: T } }, ...idPay.map((id) => ({ dedupeKey: { contains: id } }))] },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { entityId: { in: [...idPay, ...ids, ...gdIds, ...hvIds] } },
        { entityId: { startsWith: T } },
        { actorName: { startsWith: "UAT" } },
      ],
    },
  });
  await db.zaloMessageLog.deleteMany({ where: { toPhone: { in: ["84905500001", "84905500003"] } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.studentConsent.deleteMany({ where: { studentId: { in: hvIds } } });
  await db.enrollment.deleteMany({ where: { id: { in: gdIds } } });
  await db.student.deleteMany({ where: { id: { in: hvIds } } });
  await db.trialAttendance.deleteMany({ where: { trialEnrollment: { trialClassId: { startsWith: T } } } });
  await db.trialEnrollment.deleteMany({ where: { trialClassId: { startsWith: T } } });
  await db.trialClassSession.deleteMany({ where: { trialClassId: { startsWith: T } } });
  await db.trialClassV2.deleteMany({ where: { id: { startsWith: T } } });
  await db.leadChild.deleteMany({ where: { lead: { parentName: { startsWith: T } } } });
  await db.leadActivity.deleteMany({ where: { lead: { parentName: { startsWith: T } } } }).catch(() => undefined);
  await db.lead.deleteMany({ where: { parentName: { startsWith: T } } });
  await db.idempotencyKey.deleteMany({ where: { key: { startsWith: "convert:fx-uat5" } } });
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  const phUsers = hvs.map((x) => x.parentUserId).filter((x): x is string => Boolean(x));
  await db.user.deleteMany({ where: { OR: [{ id: { in: phUsers }, name: { startsWith: T } }, { id: { startsWith: T } }, { name: { startsWith: T } }] } });
}

async function dungNen() {
  await db.course.upsert({ where: { id: KHOA }, create: { id: KHOA, name: `${T}Sata 3`, slug: KHOA, price: 10_560_000, totalSessions: 48 }, update: { price: 10_560_000, totalSessions: 48 } });
  await db.course.upsert({ where: { id: KHOA4 }, create: { id: KHOA4, name: `${T}Sata 4`, slug: KHOA4, price: 11_520_000, totalSessions: 48 }, update: { price: 11_520_000, totalSessions: 48 } });
  for (const [id, ten, role] of [[SALE, "UAT Sale", "SALES_CSM"], [KE_TOAN, "UAT Kế toán", "ACCOUNTANT"], [GV, "UAT Giáo viên trial", "TEACHER"]] as const) {
    await db.user.upsert({ where: { id }, create: { id, name: `${T}${ten}`, email: `${id}@example.test`, role, roles: [role], centerId: CS, isActive: true }, update: {} });
  }
}

async function dungLop(id: string, courseId: string) {
  await db.class.create({ data: { id, name: `${T}${id}`, courseId, centerId: CS, status: "ACTIVE", maxStudents: 12 } });
  for (let i = 0; i < 3; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${id}-p${i}`, classId: id, seq: i + 1, order: i } });
    await db.classSession.create({ data: { id: `${id}-s${i}`, classId: id, centerId: CS, planId: plan.id, date: new Date(Date.now() + (i + 1) * 86_400_000), status: "SCHEDULED" } });
  }
}

type KichBan = {
  ma: string; // E1 | E3
  khoa: string;
  giaNiemYet: number;
  giam: number;
  phone: string; // 0905…
  phoneCanon: string; // 84905…
  coPhuHuynhSan: boolean;
  trial: boolean;
};

/** Dựng nguyên trạng "trước khi chuyển" của một ca: lead + bé + đơn legacy + Payment PENDING (+ trial PRESENT). */
async function dungCa(k: KichBan) {
  const lop = `${T}lop-${k.ma}`;
  await dungLop(lop, k.khoa);
  if (k.coPhuHuynhSan) {
    await db.user.create({ data: { id: `${T}ph-${k.ma}`, name: `${T}Phụ huynh ${k.ma}`, phone: k.phoneCanon, role: "PARENT", roles: ["PARENT"], centerId: CS, isActive: true } });
  }
  const lead = await db.lead.create({
    data: { parentName: `${T}khach-${k.ma}`, phone: k.phone, centerId: CS, assignedToId: SALE, status: "DA_DANG_KY", courseId: k.khoa },
    select: { id: true },
  });
  const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}Be ${k.ma}`, interestedCourseId: k.khoa }, select: { id: true } });
  const thanhTien = k.giaNiemYet - k.giam;
  const don = await db.order.create({
    data: {
      id: `${T}don-${k.ma}`,
      code: `ORD-2699-UAT5-${++dem}-${k.ma}`,
      type: "COURSE",
      status: "CONFIRMED",
      customerName: `${T}khach-${k.ma}`,
      customerPhone: k.phoneCanon,
      subtotal: k.giaNiemYet,
      discountAmount: k.giam,
      totalAmount: thanhTien,
      centerId: CS,
      leadId: lead.id,
      leadChildId: con.id,
    },
    select: { id: true },
  });
  const dong = await db.orderItem.create({
    data: {
      id: `${T}it-${k.ma}`,
      orderId: don.id,
      type: "COURSE_ENROLLMENT",
      itemName: "Sata (UAT)",
      quantity: 1,
      unitPrice: k.giaNiemYet,
      totalPrice: k.giaNiemYet,
      discountAmount: k.giam,
      status: "ACTIVE",
      metadata: { soBuoi: 48, courseId: k.khoa, leadChildId: con.id },
    },
    select: { id: true },
  });
  const khoan = await db.payment.create({
    data: {
      id: `${T}pay-${k.ma}`,
      orderId: don.id,
      amount: thanhTien,
      method: "sepay",
      paidDate: new Date("2026-10-23T12:02:35Z"),
      saleStatus: "RECORDED",
      accountantStatus: "PENDING",
      centerId: CS,
      note: `Gắn tay giao dịch SEPAY FT${k.ma} [gan-tay:${T}${k.ma}]`,
    },
    select: { id: true },
  });
  if (k.trial) {
    const tc = await db.trialClassV2.create({
      data: { id: `${T}tc-${k.ma}`, code: `${T}TC-${k.ma}`, name: `${T}Lớp trial ${k.ma}`, centerId: CS, teacherId: GV, sessionCount: 1, status: "OPEN" },
      select: { id: true },
    });
    const ss = await db.trialClassSession.create({ data: { trialClassId: tc.id, seq: 1, date: new Date("2026-10-10T00:00:00Z"), startTime: "15:45", endTime: "17:15", teacherId: GV, status: "COMPLETED" }, select: { id: true } });
    const te = await db.trialEnrollment.create({ data: { trialClassId: tc.id, leadChildId: con.id, status: "COMPLETED" }, select: { id: true } });
    await db.trialAttendance.create({ data: { trialSessionId: ss.id, trialEnrollmentId: te.id, status: "PRESENT" } });
  }
  return { lop, lead: lead.id, con: con.id, don: don.id, dong: dong.id, khoan: khoan.id, thanhTien };
}

const duLieuForm = (c: { con: string; lop: string }, k: KichBan) => ({
  parentName: `${T}khach-${k.ma}`,
  parentEmail: "",
  parentPhone: k.phone,
  students: [{ leadChildId: c.con, name: `${T}Be ${k.ma}`, dob: "", classId: c.lop, consentMedia: false }],
});

const E1: KichBan = { ma: "E1", khoa: KHOA, giaNiemYet: 10_560_000, giam: 1_584_000, phone: "0905500001", phoneCanon: "84905500001", coPhuHuynhSan: true, trial: true };
const E3: KichBan = { ma: "E3", khoa: KHOA4, giaNiemYet: 11_520_000, giam: 1_728_000, phone: "0905500003", phoneCanon: "84905500003", coPhuHuynhSan: false, trial: true };

async function chuyen(k: KichBan, c: Awaited<ReturnType<typeof dungCa>>) {
  h.uid = SALE;
  h.actor = actorSale();
  h.quyen = new Set(QUYEN_SALE_CSM);
  return submitConvertV2(c.lead, duLieuForm(c, k));
}

describe.skipIf(!RUN_DB_TESTS)("[UAT-CL] chuyển lead E1/E3 — Postgres THẬT, dữ liệu tổng hợp", () => {
  const fetchSpy = vi.fn(async () => {
    throw new Error("UAT: KHÔNG được gọi mạng (ZNS/email thật)");
  });
  beforeAll(async () => {
    assertTestDb();
    vi.stubGlobal("fetch", fetchSpy);
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    await dungNen();
  });
  beforeEach(async () => {
    await donDep();
    await dungNen();
    fetchSpy.mockClear();
    h.hoi = [];
  });
  afterAll(async () => {
    await donDep();
    await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA4] } } });
    vi.unstubAllGlobals();
  });

  it("[UAT-CL-00] fixture mang đúng hình dạng E1: đơn legacy KHÔNG dấu SCOPE, giá dòng = niêm yết, Payment PENDING chưa gắn, bé có trial PRESENT", async () => {
    const c = await dungCa(E1);
    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: c.dong } });
    expect(dong).toMatchObject({ totalPrice: 10_560_000, discountAmount: 1_584_000 });
    expect(JSON.stringify(dong.metadata)).not.toContain("phamVi");
    expect(await db.payment.findUniqueOrThrow({ where: { id: c.khoan } })).toMatchObject({ amount: 8_976_000, accountantStatus: "PENDING", enrollmentId: null });
    expect(await db.trialAttendance.count({ where: { status: "PRESENT", trialEnrollment: { leadChildId: c.con } } })).toBe(1);
  });

  it("[UAT-CL-01] E1: chuyển lead THÀNH CÔNG; KHÔNG tạo Order/Payment trùng; Payment gắn ĐÚNG ghi danh, số tiền & trạng thái không đổi", async () => {
    const c = await dungCa(E1);
    const truoc = { don: await db.order.count({ where: { leadId: c.lead } }), pay: await db.payment.count({ where: { order: { leadId: c.lead } } }) };
    const kq = await chuyen(E1, c);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    expect(kq.studentIds).toHaveLength(1);
    expect(kq.enrollmentIds).toHaveLength(1);
    expect(await db.order.count({ where: { leadId: c.lead } }), "không tạo đơn mới").toBe(truoc.don);
    expect(await db.payment.count({ where: { order: { leadId: c.lead } } }), "không tạo Payment mới").toBe(truoc.pay);
    const p = await db.payment.findUniqueOrThrow({ where: { id: c.khoan } });
    expect(p).toMatchObject({ enrollmentId: kq.enrollmentIds[0], amount: 8_976_000, accountantStatus: "PENDING", saleStatus: "RECORDED", deletedAt: null });
    expect(p.paidDate.toISOString(), "ngày thu không bị đổi").toBe("2026-10-23T12:02:35.000Z");
    expect(h.hoi, "form hỏi đúng hai quyền").toEqual(expect.arrayContaining(["students:create", "enrollments:create"]));
  });

  it("[UAT-CL-02] E1: tài khoản phụ huynh ĐÃ CÓ được dùng lại (không tạo thứ hai) và học viên gắn đúng phụ huynh + lead + bé", async () => {
    const c = await dungCa(E1);
    const truoc = await db.user.count({ where: { phone: E1.phoneCanon } });
    const kq = await chuyen(E1, c);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    expect(await db.user.count({ where: { phone: E1.phoneCanon } }), "không nhân đôi tài khoản").toBe(truoc);
    const hv = await db.student.findUniqueOrThrow({ where: { id: kq.studentIds[0]! } });
    expect(hv.parentUserId).toBe(`${T}ph-E1`);
    expect(hv.leadId).toBe(c.lead);
    expect(hv.leadChildId).toBe(c.con);
    expect(hv.name).toBe(`${T}Be E1`);
  });

  // [UAT-CL-03] — UAT FAIL ĐÃ ĐO (25/10/2026): chuyển lead KHÔNG có ô giảm giá (form chỉ còn học bổng toàn phần cho SUPER_ADMIN, chốt 31/08) và
  // `giaTuDongDon` lấy `totalPrice` của dòng (chưa trừ `discountAmount`) ⇒ finalPrice = giá niêm yết ⇒ NỢ ẢO = số giảm của dòng đơn. Ghim bằng
  // `it.fails`: hôm nay xanh (thân ném), vá #947 xong thì ĐỎ và buộc gỡ ghim. Đo thật: finalPrice = 10.560.000, discountAmount = 0 (E1).
  it.fails("[UAT-CL-03] KỲ VỌNG (đang FAIL, #947): giá ghi danh sau chuyển = 8.976.000 (niêm yết 10.560.000 − giảm 15% của dòng đơn)", async () => {
    const c = await dungCa(E1);
    const kq = await chuyen(E1, c);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    const gd = await db.enrollment.findUniqueOrThrow({ where: { id: kq.enrollmentIds[0]! } });
    expect(gd.finalPrice, `finalPrice thực đo = ${gd.finalPrice}, discountAmount = ${gd.discountAmount}`).toBe(8_976_000);
  });

  it("[UAT-CL-04] E1 ĐO THỰC TẾ + CÁCH SỬA CÓ SẴN: finalPrice = 10.560.000 (nợ ảo 1.584.000 sau xác nhận); sửa bằng `Sửa học phí hợp đồng` (/cong-no) → 8.976.000, công nợ về 0, có AuditLog cũ/mới, KHÔNG đổi Payment", async () => {
    const c = await dungCa(E1);
    const kq = await chuyen(E1, c);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    const gdId = kq.enrollmentIds[0]!;

    // Kế toán xác nhận khoản (đã gắn) — đúng thứ tự khuyến nghị: gắn TRƯỚC, xác nhận SAU.
    const xn = await confirmPayment({ paymentId: c.khoan, confirmedById: KE_TOAN });
    expect(xn.ok, JSON.stringify(xn)).toBe(true);
    /** Công nợ = giá chốt − tiền ĐÃ XÁC NHẬN (trục A, đọc thẳng DB — cùng hàm màn công nợ dùng). */
    const congNo = async () => ((await db.enrollment.findUniqueOrThrow({ where: { id: gdId } })).finalPrice ?? 0) - (await sumConfirmed(gdId));

    const gd0 = await db.enrollment.findUniqueOrThrow({ where: { id: gdId } });
    expect(gd0.finalPrice).toBe(10_560_000); // SỐ ĐO THẬT — nợ ảo
    expect(await congNo(), "nợ ảo = đúng khoản giảm của dòng đơn").toBe(1_584_000);

    // Cách sửa có sẵn: `enrollments:edit` (PROD đo 25/10: CENTER_MANAGER + CENTER_SALES_CSM); NHƯNG màn /cong-no chỉ mở cho vai có payments:view|manage ⇒ trên giao diện chỉ QUẢN LÝ CƠ SỞ sửa được (Sale CSM bị đá về dashboard — UAT TEST 25/10).
    const truocPay = await db.payment.findUniqueOrThrow({ where: { id: c.khoan } });
    const sua = await suaHocPhiGhiDanhAction({ enrollmentId: gdId, hocPhi: 8_976_000, lyDo: "UAT: đưa về giá sau giảm 15% của dòng đơn" });
    expect(sua, JSON.stringify(sua)).toMatchObject({ ok: true, hocPhiCu: 10_560_000, hocPhiMoi: 8_976_000 });
    const gd1 = await db.enrollment.findUniqueOrThrow({ where: { id: gdId } });
    expect(gd1.finalPrice).toBe(8_976_000);
    expect(await congNo()).toBe(0);
    expect(await db.payment.findUniqueOrThrow({ where: { id: c.khoan } }), "sửa giá KHÔNG chạm Payment").toEqual(truocPay);
    const nhatKy = await db.auditLog.findFirst({ where: { entityType: "Enrollment", entityId: gdId, action: "UPDATE" }, orderBy: { createdAt: "desc" } });
    expect(nhatKy?.oldValues).toMatchObject({ finalPrice: 10_560_000 });
    expect(nhatKy?.newValues).toMatchObject({ finalPrice: 8_976_000, nguon: "doi-soat-hoc-phi" });
    expect(h.hoi).toContain("enrollments:edit");
  });

  it("[UAT-CL-05] HOA HỒNG E1: bé có trial PRESENT + GV ⇒ đúng 1 dòng TRIAL_TEACHER = 1% finalPrice TẠI LÚC CHUYỂN (105.600) và KHÔNG tự tính lại khi sửa giá (chênh 15.840)", async () => {
    const c = await dungCa(E1);
    const kq = await chuyen(E1, c);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    const gdId = kq.enrollmentIds[0]!;
    const dong = await db.commissionLine.findMany({ where: { enrollmentId: gdId } });
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ tier: "TRIAL_TEACHER", recipientId: GV, amount: trialTeacherCommissionAmount(10_560_000), isClawback: false });
    expect(dong[0]!.amount).toBe(105_600);
    await suaHocPhiGhiDanhAction({ enrollmentId: gdId, hocPhi: 8_976_000, lyDo: "UAT: đưa về giá sau giảm 15%" });
    const sau = await db.commissionLine.findMany({ where: { enrollmentId: gdId } });
    expect(sau.map((x) => x.amount), "dòng hoa hồng KHÔNG đổi theo giá mới").toEqual([105_600]);
    expect(trialTeacherCommissionAmount(8_976_000)).toBe(89_760);
    const bangKe = await db.commissionStatement.findUniqueOrThrow({ where: { id: dong[0]!.statementId } });
    expect(bangKe.status).toBe("DRAFT");
  });

  it("[UAT-CL-06] TIN NHẮN E1/E3: sự kiện `lead.converted` được xếp hàng; chạy handler ⇒ KHÔNG gọi mạng; nếu có ZNS thì số tiền trong tin = số đã thu (nhánh test: không tin nào; nhánh main/PROD: 1 tin)", async () => {
    for (const k of [E1, E3]) {
      const c = await dungCa(k);
      const kq = await chuyen(k, c);
      expect(kq.ok, JSON.stringify(kq)).toBe(true);
      if (!kq.ok) return;
      const ev = await db.domainEvent.findFirst({ where: { type: "lead.converted", payloadJson: { path: ["leadId"], equals: c.lead } } });
      expect(ev, `${k.ma}: phải có sự kiện lead.converted`).not.toBeNull();
      const pl = ev!.payloadJson as { leadId: string; studentId: string; parentUserId: string };
      await onLeadConverted({ id: ev!.id, type: ev!.type, payload: pl });
      expect(fetchSpy, `${k.ma}: không được gọi mạng`).not.toHaveBeenCalled();
      const log = await db.zaloMessageLog.findMany({ where: { toPhone: k.phoneCanon } });
      // GHI LẠI hành vi đo được: nếu có log thì phải là SKIPPED (không credential).
      for (const l of log) expect(l.status).toBe("SKIPPED");
      // ĐO (25/10/2026) — HAI nhánh mã cho HAI kết quả, và test này chạy được trên cả hai:
      //   · nhánh `test` (chưa có `ganDanhTinhDongDonCuaLead`): `Order.studentId` vẫn NULL ⇒ handler bỏ qua ⇒ 0 ZaloMessageLog, 0 email;
      //   · nhánh `main` (PROD, đã có bước gắn danh tính dòng đơn 25/10): `Order.studentId` ĐƯỢC gắn ⇒ handler dựng ZNS học phí (không email ⇒ ZNS)
      //     ⇒ 1 ZaloMessageLog; trên PROD (znsLive=true + credential) tin này đi THẬT tới SĐT phụ huynh.
      // Điều test này khoá (đúng ở cả hai): KHÔNG gọi mạng khi không có credential; nếu có tin thì số tiền in trong tin = số đã thu, không phải con số khác.
      expect(log.length, `${k.ma}: tối đa một tin ZNS`).toBeLessThanOrEqual(1);
      for (const l of log) {
        expect(l.payload, `${k.ma}: nội dung tin`).toMatchObject({ paid_fee: c.thanhTien, total_course_fee: c.thanhTien });
      }
    }
  });

  it("[UAT-CL-07] E1: phụ huynh đã có được thêm vào nhóm chat lớp; E3: tài khoản phụ huynh MỚI được tạo đúng vai/cơ sở và cũng vào nhóm", async () => {
    for (const k of [E1, E3]) {
      const c = await dungCa(k);
      const kq = await chuyen(k, c);
      expect(kq.ok, JSON.stringify(kq)).toBe(true);
      if (!kq.ok) return;
      const hv = await db.student.findUniqueOrThrow({ where: { id: kq.studentIds[0]! } });
      const ph = await db.user.findUniqueOrThrow({ where: { id: hv.parentUserId! } });
      expect(ph).toMatchObject({ role: "PARENT", centerId: CS });
      expect(await db.user.count({ where: { phone: k.phoneCanon } })).toBe(1);
      const conv = await db.conversation.findFirst({ where: { type: "CLASS_GROUP", subjectType: "CLASS", subjectId: c.lop }, select: { id: true } });
      expect(conv, `${k.ma}: nhóm chat lớp phải tồn tại`).not.toBeNull();
      const tv = await db.conversationParticipant.findMany({ where: { conversationId: conv!.id, userId: ph.id } });
      expect(tv.length, `${k.ma}: phụ huynh phải là thành viên nhóm`).toBeGreaterThan(0);
    }
  });

  it("[UAT-CL-08] IDEMPOTENT: bấm lại cùng payload ⇒ deduped, không thêm học viên/ghi danh/dòng hoa hồng/Payment", async () => {
    const c = await dungCa(E3);
    const a = await chuyen(E3, c);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    const dem2 = async () => ({
      hv: await db.student.count({ where: { leadId: c.lead } }),
      gd: await db.enrollment.count({ where: { student: { leadId: c.lead } } }),
      hh: await db.commissionLine.count({ where: { recipientId: GV } }),
      pay: await db.payment.count({ where: { orderId: c.don } }),
    });
    const truoc = await dem2();
    const b = await chuyen(E3, c);
    expect(b).toMatchObject({ ok: true, deduped: true });
    expect(await dem2()).toEqual(truoc);
  });

  it("[UAT-CL-09] QUYỀN theo tập quyền PROD: Sale CSM chuyển được lead MÌNH PHỤ TRÁCH; không phải người phụ trách + không `leads:view-all` ⇒ bị chặn; Kế toán Hội sở (không `students:create`) ⇒ bị chặn", async () => {
    const c = await dungCa(E3);
    // Kế toán Hội sở
    h.quyen = new Set(QUYEN_KE_TOAN_HO);
    h.uid = KE_TOAN;
    const kt = await submitConvertV2(c.lead, duLieuForm(c, E3));
    expect(kt).toMatchObject({ ok: false });
    // Sale KHÔNG phải người phụ trách
    await db.lead.update({ where: { id: c.lead }, data: { assignedToId: KE_TOAN } });
    h.uid = SALE;
    h.actor = actorSale();
    h.quyen = new Set(QUYEN_SALE_CSM);
    const khac = await submitConvertV2(c.lead, duLieuForm(c, E3));
    expect(khac).toMatchObject({ ok: false, error: "Chỉ chuyển được lead của bạn" });
    expect(await db.student.count({ where: { leadId: c.lead } })).toBe(0);
  });

  it("[UAT-CL-10] NHÓM Y BỊ CHẶN: khoản CHƯA gắn ghi danh KHÔNG xác nhận được (`Khoản chưa gắn ghi danh…`); sau khi chuyển lead thì xác nhận được, sinh phiếu thu", async () => {
    const c = await dungCa(E3);
    const truoc = await confirmPayment({ paymentId: c.khoan, confirmedById: KE_TOAN });
    expect(truoc).toMatchObject({ ok: false, error: expect.stringContaining("chưa gắn ghi danh") });
    expect((await db.payment.findUniqueOrThrow({ where: { id: c.khoan } })).accountantStatus).toBe("PENDING");
    const kq = await chuyen(E3, c);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    const sau = await confirmPayment({ paymentId: c.khoan, confirmedById: KE_TOAN });
    expect(sau.ok, JSON.stringify(sau)).toBe(true);
    expect(await db.receipt.count({ where: { paymentId: c.khoan, deletedAt: null } })).toBe(1);
  });

  it("[UAT-CL-11] HOÀN TÁC SAU XÁC NHẬN: không có 'bỏ xác nhận'; đường duy nhất là TỪ CHỐI ⇒ REJECTED, phiếu thu VOID, KHÔNG xác nhận lại được; khoản bị loại khỏi công nợ", async () => {
    const c = await dungCa(E3);
    const kq = await chuyen(E3, c);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    await confirmPayment({ paymentId: c.khoan, confirmedById: KE_TOAN });
    const rj = await rejectPayment({ paymentId: c.khoan, confirmedById: KE_TOAN, reason: "UAT hoàn tác thử" });
    expect(rj, JSON.stringify(rj)).toMatchObject({ ok: true });
    expect((await db.payment.findUniqueOrThrow({ where: { id: c.khoan } })).accountantStatus).toBe("REJECTED");
    expect(await db.receipt.count({ where: { paymentId: c.khoan, status: "ACTIVE" } })).toBe(0);
    const lai = await confirmPayment({ paymentId: c.khoan, confirmedById: KE_TOAN });
    expect(lai).toMatchObject({ ok: false, error: "Khoản này không ở trạng thái chờ duyệt" });
    const gd = await db.enrollment.findUniqueOrThrow({ where: { id: kq.enrollmentIds[0]! } });
    expect(await sumConfirmed(gd.id), "khoản bị từ chối không tính vào đã đóng").toBe(0);
  });
});
