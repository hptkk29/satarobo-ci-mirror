// tests/finance/uat-doi-soat-hoc-phan-2.test.ts — [UAT-HP2-*] UAT GIẢ LẬP ca "học phần 2 của cùng ghi danh" (E2 — kiểu Nguyễn Minh Đạt), Postgres THẬT.
//
// Chạy:  DATABASE_URL=…/satarobo_test_xxx DIRECT_URL=$DATABASE_URL TEST_DATABASE_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/uat-doi-soat-hoc-phan-2.test.ts
//
// ĐÂY LÀ UAT GIẢ LẬP trên dữ liệu tổng hợp — KHÔNG phải phê duyệt giá 8.640.000đ trên PROD. Gọi THẲNG Server Action thật
// (`suaHocPhiGhiDanhAction` của /cong-no, `ganGhiDanhChoKhoanAction` của màn Thanh toán) và `confirmPayment`; chỉ mock phiên đăng nhập,
// `revalidatePath` và quyền (= đúng tập quyền vai trên PROD, đo 25/10/2026).
//
// Fixture mang HÌNH DẠNG THẬT của E2 (đo PROD 25/10): MỘT ghi danh ACTIVE lớp 48 buổi, finalPrice 4.320.000, đã thu đủ 4.320.000 (1.000.000 +
// 3.320.000 nhập lịch sử, CONFIRMED, đã gắn); đơn thứ hai 4.320.000 (soBuoi 24, giảm 25%, đã gắn học viên) với Payment PENDING sepay CHƯA gắn ghi
// danh; hai giao dịch ngân hàng 4.320.000 — một MATCHED (phân bổ vào phiếu thu của đơn hai), một IGNORED (0 phân bổ).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({ actor: null as unknown as Actor, uid: "fx-uat5b-ke-toan", quyen: new Set<string>(), hoi: [] as string[] }));

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.uid, name: "UAT người thao tác" } }) }));
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
import { suaHocPhiGhiDanhAction } from "@/app/(admin)/admin/cong-no/_actions";
import { ganGhiDanhChoKhoanAction } from "@/app/(admin)/admin/payments/_actions";
import { confirmPayment, rejectPayment } from "@/lib/finance/payment";
import { sumConfirmed } from "@/lib/finance/debt";

if (!RUN_DB_TESTS) console.warn(`[UAT-HP2] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const T = "fx-uat5b-";
const KHOA = `${T}khoa-sata4`;
const LOP = `${T}lop`;
const HV = `${T}hv`;
const GD = `${T}gd`;
const DON1 = `${T}don1`;
const DON2 = `${T}don2`;
const IT2 = `${T}it2`;
const P_DAT1 = `${T}pay-1m`;
const P_DAT2 = `${T}pay-3m32`;
const P_MOI = `${T}pay-moi`;
const KE_TOAN = `${T}ke-toan`;
const SALE = `${T}sale`;
const GIA_NIEM_YET = 11_520_000;
const DA_XAC_NHAN = "CONFIRMED" as const;

/**
 * Quyền THẬT trên PROD 25/10/2026: Kế toán Hội sở = payments:confirm (KHÔNG enrollments:edit); Quản lý cơ sở = enrollments:edit + payments:view (KHÔNG payments:confirm).
 * ⚠️ Sale CSM có `enrollments:edit` nhưng KHÔNG mở được /cong-no (màn đó đòi payments:view|manage) ⇒ nút "Sửa học phí hợp đồng" chỉ tới được với QUẢN LÝ CƠ SỞ
 * (và SUPER_ADMIN). Persona "sale" trong tệp này vì vậy là QUẢN LÝ CƠ SỞ; đo bằng UAT giao diện trên TEST (25/10): Sale CSM bị đá về /dashboard.
 */
const QUYEN_KE_TOAN_HO = ["payments:confirm", "payments:record", "orders:manage", "orders:view"];
const QUYEN_QUAN_LY_CS = ["students:create", "enrollments:create", "enrollments:edit", "leads:view-all", "orders:manage", "orders:view", "payments:view", "payments:record"];

let CS = "";

const actorHo = (): Actor =>
  ({
    userId: KE_TOAN,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) satisfies Actor;
const actorCoSo = (): Actor => ({ ...actorHo(), userId: SALE, isHoLevel: false, visibleCenterIds: [CS] });

const nguoiThaoTac = (vai: "ke-toan" | "sale") => {
  if (vai === "ke-toan") {
    h.uid = KE_TOAN;
    h.actor = actorHo();
    h.quyen = new Set(QUYEN_KE_TOAN_HO);
  } else {
    h.uid = SALE;
    h.actor = actorCoSo();
    h.quyen = new Set(QUYEN_QUAN_LY_CS);
  }
  h.hoi = [];
};

async function donDep() {
  const ids = [DON1, DON2];
  const pays = await db.payment.findMany({ where: { orderId: { in: ids } }, select: { id: true } });
  const idPay = pays.map((p) => p.id);
  await db.hoaDonKhoan.deleteMany({ where: { paymentId: { in: idPay } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: ids } } });
  await db.receipt.deleteMany({ where: { paymentId: { in: idPay } } });
  await db.domainEvent.deleteMany({ where: { OR: idPay.map((id) => ({ dedupeKey: { contains: id } })) } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...idPay, ...ids, GD, HV] } }, { actorName: { startsWith: "UAT" } }] } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: { providerTxnId: { startsWith: T } } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.attendance.deleteMany({ where: { studentId: HV } });
  await db.enrollment.deleteMany({ where: { OR: [{ id: GD }, { classId: LOP }, { studentId: HV }] } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.classSessionPlan.deleteMany({ where: { classId: LOP } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.user.deleteMany({ where: { id: { startsWith: T } } });
}

async function dungNen() {
  await db.course.upsert({ where: { id: KHOA }, create: { id: KHOA, name: `${T}Sata 4`, slug: KHOA, price: GIA_NIEM_YET, totalSessions: 48 }, update: { price: GIA_NIEM_YET, totalSessions: 48 } });
  for (const [id, ten, role] of [[KE_TOAN, "UAT Kế toán Hội sở", "ACCOUNTANT"], [SALE, "UAT Sale CS", "SALES_CSM"]] as const) {
    await db.user.upsert({ where: { id }, create: { id, name: `${T}${ten}`, email: `${id}@example.test`, role, roles: [role], centerId: CS, isActive: true }, update: {} });
  }
}

/** Dựng nguyên trạng "trước khi xử lý" của E2. */
async function dungCa() {
  await db.class.create({ data: { id: LOP, name: `${T}lop`, courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 12 } });
  for (let i = 0; i < 4; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${LOP}-p${i}`, classId: LOP, seq: i + 1, order: i } });
    await db.classSession.create({ data: { id: `${LOP}-s${i}`, classId: LOP, centerId: CS, planId: plan.id, date: new Date(Date.UTC(2026, 5, 20 + i * 7)), status: "COMPLETED" } });
  }
  await db.student.create({ data: { id: HV, name: `${T}Be Dat`, centerId: CS, status: "ACTIVE", parentName: `${T}Phu huynh`, parentPhone: "84905008998" } });
  await db.enrollment.create({ data: { id: GD, studentId: HV, classId: LOP, courseId: KHOA, centerId: CS, status: "STUDYING", listPrice: GIA_NIEM_YET, finalPrice: 4_320_000, tuition: 4_320_000 } });
  for (let i = 0; i < 3; i++) {
    await db.attendance.create({ data: { sessionId: `${LOP}-s${i}`, studentId: HV, status: "PRESENT" } });
  }

  // Đơn 1 — nhập lịch sử: 2 khoản CONFIRMED đã gắn ghi danh.
  await db.order.create({ data: { id: DON1, code: `ORD-2699-UAT5B-1`, type: "COURSE", status: "CONFIRMED", customerName: `${T}khach`, customerPhone: "84905008998", subtotal: 4_320_000, totalAmount: 4_320_000, centerId: CS, studentId: HV } });
  await db.orderItem.create({ data: { id: `${T}it1`, orderId: DON1, type: "COURSE_ENROLLMENT", itemName: "Sata4", quantity: 1, unitPrice: 4_320_000, totalPrice: 4_320_000, discountAmount: 0, studentId: HV, status: "ACTIVE", metadata: { courseId: KHOA } } });
  for (const [id, amount, ngay] of [[P_DAT1, 1_000_000, "2026-07-04T17:00:00Z"], [P_DAT2, 3_320_000, "2026-07-30T17:00:00Z"]] as const) {
    await db.payment.create({ data: { id, orderId: DON1, enrollmentId: GD, amount, method: "backfill", paidDate: new Date(ngay), saleStatus: "RECORDED", accountantStatus: DA_XAC_NHAN, centerId: CS, note: "Nhập liệu ban đầu [backfill-import]" } });
  }

  // Đơn 2 — kế toán lập 23/10: soBuoi 24, giảm 25% ("đợt 2 của giảm theo chính sách cũ"), đã gắn học viên, CHƯA gắn ghi danh.
  await db.order.create({ data: { id: DON2, code: `ORD-2699-UAT5B-2`, type: "COURSE", status: "CONFIRMED", customerName: `${T}khach`, customerPhone: "84905008998", subtotal: 5_760_000, discountAmount: 1_440_000, totalAmount: 4_320_000, centerId: CS, studentId: HV } });
  await db.orderItem.create({ data: { id: IT2, orderId: DON2, type: "COURSE_ENROLLMENT", itemName: "Sata4", quantity: 1, unitPrice: 5_760_000, totalPrice: 5_760_000, discountAmount: 1_440_000, studentId: HV, status: "ACTIVE", metadata: { soBuoi: 24, courseId: KHOA } } });
  const pr = await db.paymentRequest.create({ data: { orderId: DON2, orderItemId: IT2, centerId: CS, installmentNo: 1, amountDue: 4_320_000, status: "PAID" }, select: { id: true } });
  await db.payment.create({ data: { id: P_MOI, orderId: DON2, amount: 4_320_000, method: "sepay", paidDate: new Date("2026-10-06T09:03:00Z"), saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS, note: `Gắn tay giao dịch SEPAY ${T}201961182 [gan-tay:${T}x]` } });
  const mat = await db.bankTransaction.create({ data: { provider: "SEPAY", providerTxnId: `${T}201961182`, amount: 4_320_000, transferredAt: new Date("2026-10-06T09:03:00Z"), accountNumber: "2610043939041", content: "IBFT UAT nop hoc phi", status: "MATCHED", centerId: CS }, select: { id: true } });
  await db.paymentAllocation.create({ data: { bankTransactionId: mat.id, paymentRequestId: pr.id, centerId: CS, amount: 4_320_000 } });
  const ign = await db.bankTransaction.create({ data: { provider: "SEPAY", providerTxnId: `${T}934951934`, amount: 4_320_000, transferredAt: new Date("2026-10-06T08:19:00Z"), accountNumber: "2102025686868", content: "IBFT UAT nop tien hoc phi", status: "IGNORED", unmatchedNote: "Bỏ qua: KH chuyển nhầm TK (UAT)", centerId: CS }, select: { id: true } });
  return { prId: pr.id, matId: mat.id, ignId: ign.id };
}

/** Ảnh chụp mọi thứ KHÔNG được đổi bởi quy trình (trừ cột có chủ đích). */
async function anhChup() {
  const pays = await db.payment.findMany({ where: { orderId: { in: [DON1, DON2] } }, orderBy: { id: "asc" }, select: { id: true, amount: true, paidDate: true, method: true, accountantStatus: true, saleStatus: true, deletedAt: true, orderId: true } });
  const gd = await db.enrollment.findUniqueOrThrow({ where: { id: GD }, select: { classId: true, courseId: true, status: true, buoiBatDau: true, listPrice: true, studentId: true } });
  return {
    pays,
    gd,
    soGhiDanh: await db.enrollment.count({ where: { studentId: HV, deletedAt: null } }),
    soBuoiLop: await db.classSession.count({ where: { classId: LOP } }),
    diemDanh: await db.attendance.count({ where: { studentId: HV } }),
    ngan: (await db.bankTransaction.findMany({ where: { providerTxnId: { startsWith: T } }, orderBy: { providerTxnId: "asc" }, select: { providerTxnId: true, status: true, amount: true, unmatchedNote: true } })),
    phanBo: await db.paymentAllocation.count({ where: { bankTransaction: { providerTxnId: { startsWith: T } } } }),
    donItem: await db.orderItem.findUniqueOrThrow({ where: { id: IT2 }, select: { totalPrice: true, discountAmount: true, metadata: true, studentId: true } }),
    hoaDon: await db.hoaDonDienTu.count({ where: { orderId: { in: [DON1, DON2] } } }),
  };
}

describe.skipIf(!RUN_DB_TESTS)("[UAT-HP2] học phần 2 của cùng ghi danh (E2) — Postgres THẬT, dữ liệu tổng hợp", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    await dungNen();
  });
  beforeEach(async () => {
    await donDep();
    await dungNen();
  });
  afterAll(async () => {
    await donDep();
    await db.course.deleteMany({ where: { id: KHOA } });
  });

  it("[UAT-HP2-00] fixture đúng hình dạng E2; và TẠO GHI DANH THỨ HAI cùng lớp BỊ CẤM bởi chỉ mục duy nhất ⇒ phương án (a) của P2 không khả thi", async () => {
    await dungCa();
    expect(await sumConfirmed(GD)).toBe(4_320_000);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).finalPrice).toBe(4_320_000);
    expect(await db.payment.findUniqueOrThrow({ where: { id: P_MOI } })).toMatchObject({ enrollmentId: null, accountantStatus: "PENDING", amount: 4_320_000 });
    await expect(
      db.enrollment.create({ data: { id: `${T}gd2`, studentId: HV, classId: LOP, courseId: KHOA, centerId: CS, status: "STUDYING", finalPrice: 4_320_000 } }),
    ).rejects.toThrow(/Unique constraint/);
    expect(await db.enrollment.count({ where: { studentId: HV } })).toBe(1);
  });

  it("[UAT-HP2-01] KHÔNG nâng giá mà gắn + xác nhận ⇒ ĐÓNG THỪA 4.320.000 (công nợ −4.320.000) ⇒ phương án 'chỉ gắn' không khả thi", async () => {
    await dungCa();
    nguoiThaoTac("ke-toan");
    const gan = await ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD });
    expect(gan, JSON.stringify(gan)).toMatchObject({ ok: true });
    const xn = await confirmPayment({ paymentId: P_MOI, confirmedById: KE_TOAN });
    expect(xn.ok, JSON.stringify(xn)).toBe(true);
    const gd = await db.enrollment.findUniqueOrThrow({ where: { id: GD } });
    expect((gd.finalPrice ?? 0) - (await sumConfirmed(GD))).toBe(-4_320_000);
  });

  it("[UAT-HP2-02] LUỒNG ĐỀ XUẤT: (1) Quản lý cơ sở sửa học phí hợp đồng 4.320.000→8.640.000 (2) kế toán gắn Payment 16:03 vào ghi danh hiện hữu (3) kế toán xác nhận ⇒ công nợ 0; không ghi danh mới, không Payment mới, IGNORED vẫn IGNORED, số buổi/điểm danh/dòng đơn/hoá đơn không đổi; có AuditLog", async () => {
    await dungCa();
    const truoc = await anhChup();

    nguoiThaoTac("sale");
    const sua = await suaHocPhiGhiDanhAction({ enrollmentId: GD, hocPhi: 8_640_000, lyDo: "UAT giả lập: hợp đồng 48 buổi giá ưu đãi 25% chia 2 đợt" });
    expect(sua, JSON.stringify(sua)).toMatchObject({ ok: true, hocPhiCu: 4_320_000, hocPhiMoi: 8_640_000 });
    expect(h.hoi).toContain("enrollments:edit");

    nguoiThaoTac("ke-toan");
    const gan = await ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD });
    expect(gan, JSON.stringify(gan)).toMatchObject({ ok: true });
    expect(h.hoi).toContain("payments:confirm");
    const xn = await confirmPayment({ paymentId: P_MOI, confirmedById: KE_TOAN });
    expect(xn.ok, JSON.stringify(xn)).toBe(true);

    const gd = await db.enrollment.findUniqueOrThrow({ where: { id: GD } });
    expect(gd.finalPrice).toBe(8_640_000);
    expect(await sumConfirmed(GD)).toBe(8_640_000);
    expect((gd.finalPrice ?? 0) - (await sumConfirmed(GD)), "công nợ về 0, không đóng thừa").toBe(0);

    const sau = await anhChup();
    // KHÔNG đổi:
    expect(sau.soGhiDanh, "không ghi danh trùng").toBe(truoc.soGhiDanh);
    expect(sau.pays.length, "không Payment mới").toBe(truoc.pays.length);
    expect(sau.ngan, "giao dịch ngân hàng giữ nguyên (IGNORED vẫn IGNORED, MATCHED vẫn MATCHED)").toEqual(truoc.ngan);
    expect(sau.phanBo, "không thêm phân bổ").toBe(truoc.phanBo);
    expect(sau.soBuoiLop).toBe(truoc.soBuoiLop);
    expect(sau.diemDanh).toBe(truoc.diemDanh);
    expect(sau.gd, "buoiBatDau/lớp/khoá/trạng thái ghi danh không đổi").toEqual(truoc.gd);
    expect(sau.donItem, "dòng đơn 2 (24 buổi, giảm 25%) không đổi").toEqual(truoc.donItem);
    expect(sau.hoaDon, "không hoá đơn nào bị tạo/đổi").toBe(truoc.hoaDon);
    // ĐỔI đúng chỗ có chủ đích:
    const dong = Object.fromEntries(sau.pays.map((p) => [p.id, p]));
    expect(dong[P_MOI]).toMatchObject({ accountantStatus: DA_XAC_NHAN, amount: 4_320_000 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_MOI } })).enrollmentId).toBe(GD);
    for (const id of [P_DAT1, P_DAT2]) expect(dong[id]).toEqual(truoc.pays.find((p) => p.id === id));
    // Tiền đã thu trong sổ = 8.640.000, KHÔNG phải 12.960.000: giao dịch IGNORED không thành tiền thu.
    const tong = (await db.payment.aggregate({ where: { orderId: { in: [DON1, DON2] }, deletedAt: null, accountantStatus: { not: "REJECTED" } }, _sum: { amount: true } }))._sum.amount;
    expect(tong).toBe(8_640_000);
    // AuditLog + phiếu thu:
    const nkGia = await db.auditLog.findFirst({ where: { entityType: "Enrollment", entityId: GD, action: "UPDATE" } });
    expect(nkGia?.oldValues).toMatchObject({ finalPrice: 4_320_000 });
    expect(nkGia?.newValues).toMatchObject({ finalPrice: 8_640_000, lyDo: expect.stringContaining("UAT") });
    expect(await db.auditLog.count({ where: { entityType: "Payment", entityId: P_MOI } }), "gắn + xác nhận đều có dấu vết").toBeGreaterThanOrEqual(2);
    expect(await db.receipt.count({ where: { paymentId: P_MOI, deletedAt: null } })).toBe(1);
  });

  it("[UAT-HP2-03] QUYỀN: Quản lý cơ sở sửa được giá nhưng KHÔNG xác nhận/gắn được khoản (không `payments:confirm`); Kế toán Hội sở gắn+xác nhận được nhưng KHÔNG sửa được giá (không `enrollments:edit`)", async () => {
    await dungCa();
    nguoiThaoTac("sale");
    expect(await ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD })).toMatchObject({ ok: false, error: "Không có quyền xác nhận khoản thu" });
    nguoiThaoTac("ke-toan");
    expect(await suaHocPhiGhiDanhAction({ enrollmentId: GD, hocPhi: 8_640_000, lyDo: "UAT thử quyền" })).toMatchObject({ ok: false, error: "Không có quyền sửa ghi danh" });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).finalPrice).toBe(4_320_000);
  });

  it("[UAT-HP2-04] HOÀN TÁC: giá đưa về 4.320.000 được bằng cùng màn (có log), nhưng khoản đã xác nhận chỉ TỪ CHỐI được (REJECTED, phiếu thu VOID) — không trở lại PENDING; khoản gốc 1.000.000/3.320.000 và giao dịch ngân hàng giữ nguyên", async () => {
    await dungCa();
    nguoiThaoTac("sale");
    await suaHocPhiGhiDanhAction({ enrollmentId: GD, hocPhi: 8_640_000, lyDo: "UAT giả lập" });
    nguoiThaoTac("ke-toan");
    await ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD });
    await confirmPayment({ paymentId: P_MOI, confirmedById: KE_TOAN });

    const rj = await rejectPayment({ paymentId: P_MOI, confirmedById: KE_TOAN, reason: "UAT hoàn tác thử" });
    expect(rj, JSON.stringify(rj)).toMatchObject({ ok: true });
    expect(await db.payment.findUniqueOrThrow({ where: { id: P_MOI } })).toMatchObject({ accountantStatus: "REJECTED", enrollmentId: GD });
    expect(await db.receipt.count({ where: { paymentId: P_MOI, status: "ACTIVE" } })).toBe(0);
    expect(await confirmPayment({ paymentId: P_MOI, confirmedById: KE_TOAN })).toMatchObject({ ok: false });

    nguoiThaoTac("sale");
    const lui = await suaHocPhiGhiDanhAction({ enrollmentId: GD, hocPhi: 4_320_000, lyDo: "UAT đưa giá về như cũ" });
    expect(lui).toMatchObject({ ok: true, hocPhiCu: 8_640_000, hocPhiMoi: 4_320_000 });
    expect(await sumConfirmed(GD)).toBe(4_320_000);
    const nk = await db.auditLog.findMany({ where: { entityType: "Enrollment", entityId: GD, action: "UPDATE" }, orderBy: { createdAt: "asc" } });
    expect(nk.map((x) => (x.newValues as { finalPrice: number }).finalPrice)).toEqual([8_640_000, 4_320_000]);
  });

  it("[UAT-HP2-05] ĐUA: hai kế toán cùng gắn một khoản ⇒ cuối cùng khoản gắn đúng MỘT ghi danh, không nhân đôi tiền; lượt thứ hai (sau khi đã gắn) bị từ chối", async () => {
    await dungCa();
    nguoiThaoTac("ke-toan");
    const [a, b] = await Promise.all([
      ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD }),
      ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length, `kết quả: ${JSON.stringify([a, b])}`).toBeGreaterThanOrEqual(1);
    expect(await db.payment.count({ where: { orderId: DON2 } })).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_MOI } })).enrollmentId).toBe(GD);
    const lan3 = await ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD });
    expect(lan3).toMatchObject({ ok: false, error: expect.stringContaining("đã gắn ghi danh") });
  });

  it("[UAT-HP2-06] HOÁ ĐƠN KHOÁ HOÀN TÁC: khoản đã nằm trong hoá đơn còn hiệu lực KHÔNG từ chối được (phải huỷ hoá đơn trước) ⇒ sau khi xác nhận, việc 'quay lại' bị chặn; hoá đơn và khoản không đổi", async () => {
    await dungCa();
    nguoiThaoTac("sale");
    await suaHocPhiGhiDanhAction({ enrollmentId: GD, hocPhi: 8_640_000, lyDo: "UAT giả lập" });
    nguoiThaoTac("ke-toan");
    await ganGhiDanhChoKhoanAction({ paymentId: P_MOI, enrollmentId: GD });
    await confirmPayment({ paymentId: P_MOI, confirmedById: KE_TOAN });
    await db.hoaDonDienTu.create({
      data: {
        id: `${T}hd`, orderId: DON2, centerId: CS, trangThai: "DA_XAC_NHAN", kyHieu: "1C26TSR", soHoaDon: "970", ngayPhatHanh: new Date("2026-10-24T00:00:00Z"),
        tepPdfKey: `hoa-don/CS1/2026/${DON2}/u.pdf`, tepPdfTen: "hd.pdf", guiEmailKhach: false, tongTien: 4_320_000, taoBoiId: KE_TOAN,
        khoan: { create: [{ paymentId: P_MOI, soTien: 4_320_000 }] },
      },
    });
    const rj = await rejectPayment({ paymentId: P_MOI, confirmedById: KE_TOAN, reason: "UAT thử hoàn tác khi đã có hoá đơn" });
    expect(rj).toMatchObject({ ok: false, error: expect.stringContaining("huỷ hoá đơn") });
    expect(await db.payment.findUniqueOrThrow({ where: { id: P_MOI } })).toMatchObject({ accountantStatus: DA_XAC_NHAN, enrollmentId: GD, amount: 4_320_000 });
    expect(await db.hoaDonKhoan.count({ where: { paymentId: P_MOI, hieuLuc: true } })).toBe(1);
  });
});
