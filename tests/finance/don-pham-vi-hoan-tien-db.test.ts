// tests/finance/don-pham-vi-hoan-tien-db.test.ts — ĐƠN THEO PHẠM VI HỌC (SCOPE) × DỪNG HỌC + ĐỀ XUẤT HOÀN TIỀN, trên Postgres THẬT.
//
// Chạy:  pnpm exec vitest run -c vitest.db.config.ts tests/finance/don-pham-vi-hoan-tien-db.test.ts
//        (DATABASE_URL/DIRECT_URL trỏ MỘT database tên chứa `satarobo_test`/`ci_test`, vd `satarobo_test_f1a`)
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố `fx-ht-`. Mỗi ca tự dựng đơn + học viên + ghi danh của riêng mình (chạy MỘT MÌNH vẫn xanh — luật 18).
// Đồng hồ truyền vào (luật 19): `now` là tham số; ngày buổi học là hằng tuyệt đối.
//
// ── BẤT BIẾN ĐANG CANH ──────────────────────────────────────────────────────────────────────────────────────────────
// Đơn SCOPE mua 12/24/36/48 buổi, nhưng dừng học chia học phí cho `Course.totalSessions` và `computeRefund` chia cho số buổi của lớp ⇒ đơn giá/buổi quá thấp ⇒ hoàn THỪA.
// Công thức đúng chờ MT-14 ⇒ CHẶN (trạng thái chờ an toàn). Tệp này đo: mọi đường TIỀN RA từ đơn SCOPE đều bị chặn, KHÔNG phép ghi nào xảy ra, bé vẫn được nghỉ,
// và đơn THƯỜNG chạy y như cũ.
//
// ── CÁCH ĐO ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Mỗi ca "bị chặn" có ĐỐI CHỨNG DƯƠNG trên đơn thường, cùng đường, cùng đầu vào, cùng fixture (luật 11): nếu không, "bị từ chối" có thể đến từ một cổng khác chứ không phải cổng phạm vi.
// Dấu SCOPE là dấu THẬT do planner sinh ra (không gõ tay). Ghi danh nối đơn bằng `OrderItem.enrollmentId` — đúng cầu nối `chuyenDoiDonAction` gán.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/lib/actions/factory";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { dungHocMotCon, xemTruocDungHoc } from "@/lib/finance/dung-hoc-con";
import { layChoDeXuatHoanTien } from "@/lib/finance/cho-de-xuat-hoan-tien";
import { ghiDanhThuocDonPhamVi, lyDoGhiDanhDonPhamVi } from "@/lib/finance/ghi-danh-don-pham-vi";
import { createRefundRequest } from "@/lib/finance/refund";
import { nghiHocHan } from "@/lib/students/withdraw";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, laDonPhamVi, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC, LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN } from "@/lib/orders/pham-vi/cong-hoan-tien";

if (!RUN_DB_TESTS) console.warn(`[HT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-ht-";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture HT" };
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const GIA48 = 10_560_000;
/** Thành tiền dòng SCOPE 48 buổi: niêm yết × 85% — do planner thật tính, ghim lại ở `metadataScope`. */
const TIEN = 8_976_000;
/** Mốc "bây giờ" cho dừng học: 4 buổi đã qua (07/09, 14/09, 21/09, 28/09); buổi 5 (05/10 12:30 UTC) còn SAU `NOW`. */
const NOW = new Date("2026-10-05T03:00:00Z");
/** Mốc cho đề xuất hoàn: TRƯỚC buổi đầu ⇒ sổ buổi "tin được" (không buổi nào đã qua ngày mà chưa chốt) ⇒ lưới sổ buổi không chặn. */
const NOW_SO_BUOI_TIN_DUOC = new Date("2026-09-01T00:00:00Z");
const BUOI_CUOI = `${T}buoi-4`;
const DA_XAC_NHAN = "CONFIRMED" as const;

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: NOW,
  coKeHoachDot: false,
};
const dongVao: DongVao = {
  loai: "COURSE_ENROLLMENT",
  tenDong: "Sata 3",
  soLuong: 1,
  donGiaKhach: TIEN,
  soKhoanGiam: 0,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 48,
  gia48: GIA48,
  conKhoa: "con-a",
};

/** Dấu SCOPE THẬT do planner của tầng tạo đơn sinh ra — không gõ tay. */
function metadataScope(): Record<string, unknown> {
  const kq = keHoachDon([dongVao], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId: KHOA, soBuoi: 48 }, KHOA);
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: planner không ra SCOPE");
  expect(docPhamViDong(md)?.thanhTien, "fixture: thành tiền planner").toBe(TIEN);
  return md;
}

let CS1 = "";
let OU1 = "";
let dem = 0;

async function datCo(bat: boolean | null) {
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

async function donDep() {
  const don = await db.order.findMany({ where: { id: { startsWith: T } }, select: { id: true } });
  const ids = don.map((d) => d.id);
  const gd = await db.enrollment.findMany({ where: { studentId: { startsWith: T } }, select: { id: true } });
  const gdIds = gd.map((g) => g.id);
  await db.studyEntitlementXuLy.deleteMany({ where: { orderId: { in: ids } } });
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } } });
  await db.studyEntitlement.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } });
  await db.refundRequest.deleteMany({ where: { OR: [{ orderItem: { orderId: { in: ids } } }, { enrollmentId: { in: gdIds } }] } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { entityType: "Order", entityId: { in: ids } },
        { entityType: "Enrollment", entityId: { in: gdIds } },
        { actorName: { startsWith: "Hệ thống — cấp quyền học" } },
        { actorId: ACTOR.id },
      ],
    },
  });
  await db.receipt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: ids } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: ids } } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderInstallment.deleteMany({ where: { orderId: { in: ids } } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollment: { studentId: { startsWith: T } } } });
  await db.enrollment.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
}

async function donNen() {
  await donDep();
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
}

interface DonFx {
  id: string;
  /** `true` = dòng mang dấu SCOPE THẬT; `false` = đơn thường (đối chứng dương). */
  scope: boolean;
  /** Đã thu (CONFIRMED, gắn dòng + ghi danh). */
  daThu?: number;
  /** Có nối `OrderItem.enrollmentId` không (mặc định CÓ — đúng thứ `chuyenDoiDonAction` để lại). */
  noiDong?: boolean;
  /** Trạng thái ghi danh. */
  trangThai?: "STUDYING" | "WITHDREW";
}

interface DonDung {
  orderId: string;
  itemId: string;
  studentId: string;
  enrollmentId: string;
}

/** Đơn 1 dòng + học viên + ghi danh + phiếu thu toàn đơn do `ensureFullOrderRequest` dựng (đúng thứ tạo đơn để lại). */
async function dungDon(o: DonFx): Promise<DonDung> {
  const itemId = `${o.id}-it`;
  const studentId = `${o.id}-hv`;
  const enrollmentId = `${o.id}-gd`;
  const gia = o.scope ? TIEN : GIA48;
  await db.student.create({ data: { id: studentId, name: `${T}Bé ${o.id.slice(-4)}`, centerId: CS1, status: "ACTIVE" } });
  await db.enrollment.create({
    data: {
      id: enrollmentId,
      studentId,
      classId: LOP,
      courseId: KHOA,
      centerId: CS1,
      status: o.trangThai ?? "STUDYING",
      finalPrice: gia,
      tuition: gia,
    },
  });
  await db.order.create({
    data: {
      id: o.id,
      code: `ORD-2699-HT-${++dem}-${o.id.slice(-6)}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: "0399000222",
      subtotal: gia,
      discountAmount: 0,
      totalAmount: gia,
      centerId: CS1,
      studentId,
    },
  });
  await db.orderItem.create({
    data: {
      id: itemId,
      orderId: o.id,
      type: "COURSE_ENROLLMENT",
      itemName: "Sata 3",
      quantity: 1,
      unitPrice: gia,
      totalPrice: gia,
      discountAmount: 0,
      studentId,
      enrollmentId: o.noiDong === false ? null : enrollmentId,
      status: "ACTIVE",
      metadata: (o.scope ? metadataScope() : { courseId: KHOA, soBuoi: 48 }) as Prisma.InputJsonValue,
    },
  });
  const r0 = await db.$transaction((tx) => ensureFullOrderRequest(tx, { id: o.id, code: `ORD-2699-HT-${dem}-${o.id.slice(-6)}`, totalAmount: gia, centerId: CS1 }));
  if (o.daThu && o.daThu > 0) {
    // Tiền THẬT ở cả hai sổ (như một khách đã quét QR phiếu toàn đơn): Payment + giao dịch ngân hàng → phân bổ vào phiếu.
    await db.payment.create({
      data: {
        orderId: o.id,
        orderItemId: itemId,
        enrollmentId,
        amount: o.daThu,
        method: "cash",
        paidDate: NOW,
        saleStatus: "RECORDED",
        accountantStatus: DA_XAC_NHAN,
        centerId: CS1,
      },
    });
    const bt = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: `${o.id}-bt`, amount: o.daThu, transferredAt: NOW, status: "MATCHED", centerId: CS1 },
    });
    await db.paymentAllocation.create({ data: { bankTransactionId: bt.id, paymentRequestId: r0!, amount: o.daThu, centerId: CS1 } });
    await db.paymentRequest.update({ where: { id: r0! }, data: { status: o.daThu >= gia ? "PAID" : "PARTIAL" } });
  }
  return { orderId: o.id, itemId, studentId, enrollmentId };
}

/** Mọi thứ mà ba đường này CÓ THỂ làm đổi. Bằng nhau trước/sau ⇒ không phép ghi nào xảy ra. */
async function anhChup(d: DonDung) {
  const [phieu, pay, phanBo, qr, auditDon, auditGd, dong, ghiDanh, hoan, hoanTheoGd] = await Promise.all([
    db.paymentRequest.findMany({ where: { orderId: d.orderId }, orderBy: [{ installmentNo: "asc" }, { id: "asc" }] }),
    db.payment.findMany({ where: { orderId: d.orderId }, orderBy: { id: "asc" }, select: { id: true, amount: true, orderItemId: true, accountantStatus: true } }),
    db.paymentAllocation.count({ where: { paymentRequest: { orderId: d.orderId } } }),
    db.qrSession.count({ where: { paymentRequest: { orderId: d.orderId } } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: d.orderId } }),
    db.auditLog.count({ where: { entityType: "Enrollment", entityId: d.enrollmentId } }),
    db.orderItem.findMany({ where: { orderId: d.orderId }, orderBy: { id: "asc" }, select: { id: true, status: true, usedValue: true, enrollmentId: true, totalPrice: true, discountAmount: true } }),
    db.enrollment.findMany({ where: { studentId: d.studentId }, orderBy: { id: "asc" }, select: { id: true, classId: true, status: true } }),
    db.refundRequest.count({ where: { orderItem: { orderId: d.orderId } } }),
    db.refundRequest.count({ where: { enrollmentId: d.enrollmentId } }),
  ]);
  return JSON.stringify({ phieu, pay, phanBo, qr, auditDon, auditGd, dong, ghiDanh, hoan, hoanTheoGd });
}

/**
 * Một ĐỢT đang mở của bé (PaymentRequest `installmentNo` 1). Dừng học VOID nó ngay ở phép ghi ĐẦU TIÊN (`huyDotKhiDungHoc`) — nên đây là mồi để phép đo thấy một cổng đặt SAU phép ghi:
 * thiếu nó thì đơn chỉ có phiếu toàn đơn, không phép ghi nào đứng trước cổng bị cấy lệch, và lệch ấy KHÔNG ca nào đỏ (đo bằng phép cấy).
 */
async function themDotMo(d: DonDung): Promise<string> {
  const r = await db.paymentRequest.create({
    data: { orderId: d.orderId, orderItemId: d.itemId, centerId: CS1, installmentNo: 1, amountDue: 1_000_000, status: "PENDING", dueDate: new Date("2026-11-01T00:00:00Z") },
    select: { id: true },
  });
  return r.id;
}
const trangThaiPhieu = async (id: string) => (await db.paymentRequest.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

const soHoan = (d: DonDung) => db.refundRequest.count({ where: { OR: [{ enrollmentId: d.enrollmentId }, { orderItem: { orderId: d.orderId } }] } });

const dungHoc = (d: DonDung, phanDu: { kieu: "HOAN"; soTien: number }[] = []) =>
  dungHocMotCon({
    orderId: d.orderId,
    orderItemId: d.itemId,
    lyDo: "PH_CHU_DONG",
    buoiCuoiId: BUOI_CUOI,
    ghiChu: null,
    phanDu,
    actor: ACTOR,
    now: NOW,
  });

describe.skipIf(!RUN_DB_TESTS)("[HT-DB] đơn SCOPE × dừng học + đề xuất hoàn — chặn, không phép ghi nào; đơn thường y như cũ — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donNen();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    await db.course.create({ data: { id: KHOA, name: "Sata 3 (fixture HT)", slug: KHOA, price: GIA48, totalSessions: 48 } });
    await db.class.create({ data: { id: LOP, name: `Lớp ${LOP}`, courseId: KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 30 } });
    // 48 buổi hằng tuần từ 2026-09-07 (tuyệt đối — luật 19).
    await db.classSession.createMany({
      data: Array.from({ length: 48 }, (_, i) => ({
        id: `${T}buoi-${i + 1}`,
        classId: LOP,
        date: new Date(Date.UTC(2026, 8, 7 + i * 7, 12, 30, 0)),
        status: "SCHEDULED" as const,
      })),
    });
  });
  beforeEach(async () => {
    await donDep();
    await datCo(true);
  });
  afterAll(async () => {
    try {
      await donNen();
      await datCo(null).catch(() => undefined);
    } finally {
      await disconnectDb();
    }
  });

  // ═══ 1 · DỪNG HỌC ═══════════════════════════════════════════════════════════════════════════════════════════════

  it("[HT-DB-00] ĐỐI CHỨNG DƯƠNG — đơn THƯỜNG: dừng học chạy được (cùng đầu vào, cùng fixture) ⇒ dòng STOPPED", async () => {
    const d = await dungDon({ id: `${T}d00`, scope: false });
    const dot = await themDotMo(d);
    const kq = await dungHoc(d);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: d.itemId }, select: { status: true } })).status).toBe("STOPPED");
    expect(await trangThaiPhieu(dot), "đối chứng: đường thường VOID đợt mở — phép ghi đầu tiên mà cổng SCOPE phải đứng trước").toBe("VOID");
  });

  it("[HT-DB-01] đơn SCOPE: dừng học ⇒ từ chối đúng câu, KHÔNG phép ghi nào (dòng ACTIVE, phiếu không VOID, ghi danh còn học, 0 yêu cầu hoàn)", async () => {
    const d = await dungDon({ id: `${T}d01`, scope: true });
    const dot = await themDotMo(d);
    expect(laDonPhamVi(await db.orderItem.findMany({ where: { orderId: d.orderId }, select: { metadata: true } })), "tiền đề: đây là đơn SCOPE").toBe(true);
    const truoc = await anhChup(d);
    const kq = await dungHoc(d);
    expect(kq).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC });
    expect(await anhChup(d)).toBe(truoc);
    expect(await trangThaiPhieu(dot), "đợt mở KHÔNG bị VOID — cổng đứng trước phép ghi đầu tiên").toBe("PENDING");
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: d.itemId }, select: { status: true } })).status).toBe("ACTIVE");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { status: true } })).status).toBe("STUDYING");
    expect(await db.paymentRequest.count({ where: { orderId: d.orderId, status: "VOID" } })).toBe(0);
    expect(await soHoan(d)).toBe(0);
  });

  it("[HT-DB-02] CÓ TIỀN (đường sinh yêu cầu hoàn thật): đơn thường dừng học ⇒ sinh 1 yêu cầu hoàn; đơn SCOPE cùng đầu vào ⇒ chặn, 0 yêu cầu hoàn, tiền không đụng", async () => {
    const thuong = await dungDon({ id: `${T}d02a`, scope: false, daThu: 5_000_000 });
    // giá trị đã dùng = 4 buổi × 220.000 = 880.000 ⇒ dư 4.120.000 phải phân hết
    const ok = await dungHoc(thuong, [{ kieu: "HOAN", soTien: 4_120_000 }]);
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await soHoan(thuong), "đối chứng dương: đường thường VẪN sinh yêu cầu hoàn").toBe(1);

    const scope = await dungDon({ id: `${T}d02b`, scope: true, daThu: 5_000_000 });
    const dotScope = await themDotMo(scope);
    const truoc = await anhChup(scope);
    const kq = await dungHoc(scope, [{ kieu: "HOAN", soTien: 4_120_000 }]);
    expect(kq).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC });
    expect(await anhChup(scope)).toBe(truoc);
    expect(await soHoan(scope)).toBe(0);
    expect(await trangThaiPhieu(dotScope)).toBe("PENDING");
  });

  it("[HT-DB-03] xem trước nói ĐÚNG câu của lượt ghi (luật 12): đơn thường ra bảng quyết toán, đơn SCOPE ra đúng câu chặn", async () => {
    const thuong = await dungDon({ id: `${T}d03a`, scope: false });
    const xt = await xemTruocDungHoc({ orderId: thuong.orderId, orderItemId: thuong.itemId, lyDo: "PH_CHU_DONG", buoiCuoiId: BUOI_CUOI, now: NOW });
    expect(xt.ok, JSON.stringify(xt)).toBe(true);
    const scope = await dungDon({ id: `${T}d03b`, scope: true });
    expect(await xemTruocDungHoc({ orderId: scope.orderId, orderItemId: scope.itemId, lyDo: "PH_CHU_DONG", buoiCuoiId: BUOI_CUOI, now: NOW })).toEqual({
      ok: false,
      error: LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC,
    });
  });

  it("[HT-DB-04] cổng đọc DẤU trên dòng đơn, KHÔNG đọc cờ cơ sở: cờ TẮT mà đơn đã là SCOPE vẫn bị chặn (khách của đơn đó vẫn cần được hoàn đúng)", async () => {
    const d = await dungDon({ id: `${T}d04`, scope: true });
    await datCo(false);
    expect(await dungHoc(d)).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC });
    await datCo(null);
    expect(await dungHoc(d)).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC });
  });

  // ═══ 2 · ĐỀ XUẤT HOÀN (createRefundRequest — lưới cuối) ═════════════════════════════════════════════════════════

  it("[HT-DB-10] ĐỐI CHỨNG DƯƠNG — ghi danh của đơn THƯỜNG đã thu tiền: createRefundRequest sinh 1 yêu cầu PENDING", async () => {
    const d = await dungDon({ id: `${T}r10`, scope: false, daThu: 5_000_000, trangThai: "WITHDREW" });
    const tao = await createRefundRequest({ enrollmentId: d.enrollmentId, trigger: "WITHDRAW", reason: "đối chứng", requestedById: ACTOR.id, actorName: ACTOR.name, now: NOW_SO_BUOI_TIN_DUOC });
    expect(tao, "đối chứng: đường thường phải tạo được").not.toBeNull();
    expect(tao?.status).toBe("PENDING");
    expect(await soHoan(d)).toBe(1);
  });

  it("[HT-DB-11] ghi danh của đơn SCOPE đã thu tiền: createRefundRequest ⇒ null (KHÔNG ném) + AuditLog REFUND_REQUEST_BLOCKED nói rõ đơn SCOPE; 0 yêu cầu hoàn; tiền không đổi", async () => {
    const d = await dungDon({ id: `${T}r11`, scope: true, daThu: 5_000_000, trangThai: "WITHDREW" });
    const truoc = await anhChup(d);
    const tao = await createRefundRequest({ enrollmentId: d.enrollmentId, trigger: "WITHDRAW", reason: "thử", requestedById: ACTOR.id, actorName: ACTOR.name, now: NOW_SO_BUOI_TIN_DUOC });
    expect(tao).toBeNull();
    expect(await soHoan(d)).toBe(0);
    const sau = JSON.parse(await anhChup(d)) as Record<string, unknown>;
    // đúng MỘT thứ đổi: thêm đúng một dòng AuditLog của ghi danh
    expect(sau.auditGd).toBe(1);
    expect({ ...sau, auditGd: 0 }).toEqual(JSON.parse(truoc));
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "Enrollment", entityId: d.enrollmentId, action: "REFUND_REQUEST_BLOCKED" } });
    expect(log.reason).toBe(LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN);
    expect(JSON.stringify(log.newValues)).toContain('"donPhamVi":true');
  });

  it("[HT-DB-12] lưới cuối không nhìn OrderItem.enrollmentId một mình: ghi danh chỉ có QUYỀN HỌC (StudyEntitlement) mà dòng đơn chưa nối ⇒ vẫn chặn", async () => {
    const d = await dungDon({ id: `${T}r12`, scope: false, daThu: 5_000_000, trangThai: "WITHDREW", noiDong: false });
    // Tiền đề: đơn thường, dòng KHÔNG nối ghi danh ⇒ đường (1) không bắt được gì.
    expect((await ghiDanhThuocDonPhamVi(db, [d.enrollmentId])).size).toBe(0);
    await db.studyEntitlement.create({
      data: {
        studentId: d.studentId,
        courseId: KHOA,
        orderId: d.orderId,
        orderItemId: d.itemId,
        enrollmentId: d.enrollmentId,
        centerId: CS1,
        purchaseKind: "MILESTONE",
        purchaseSessions: 12,
        listAmount: 1_000_000,
        netAmount: 1_000_000,
        pricingSnapshot: {},
      },
    });
    const tao = await createRefundRequest({ enrollmentId: d.enrollmentId, trigger: "WITHDRAW", reason: "thử", requestedById: ACTOR.id, actorName: ACTOR.name, now: NOW_SO_BUOI_TIN_DUOC });
    expect(tao).toBeNull();
    expect(await soHoan(d)).toBe(0);
    const co = (await ghiDanhThuocDonPhamVi(db, [d.enrollmentId])).get(d.enrollmentId);
    expect(co).toEqual({ orderItemId: d.itemId, orderCode: null });
  });

  // ═══ 3 · NGHỈ HỌC HẲN — bé VẪN được nghỉ, phần tiền bỏ qua + nói ra ════════════════════════════════════════════

  const nghi = (studentId: string) =>
    db.$transaction((tx) =>
      nghiHocHan({ tx, studentId, actorId: ACTOR.id, actorName: ACTOR.name, reason: "Học viên nghỉ học: thử", now: NOW_SO_BUOI_TIN_DUOC }),
    );

  it("[HT-DB-20] ĐỐI CHỨNG DƯƠNG — đơn THƯỜNG đã thu tiền: nghỉ học hẳn gỡ lớp VÀ sinh đề xuất hoàn; không ghi danh nào bị bỏ qua", async () => {
    const d = await dungDon({ id: `${T}n20`, scope: false, daThu: 5_000_000 });
    const kq = await nghi(d.studentId);
    expect(kq.daGo.map((g) => g.id)).toEqual([d.enrollmentId]);
    expect(kq.boQuaHoanTien).toEqual([]);
    expect(await soHoan(d)).toBe(1);
  });

  it("[HT-DB-21] đơn SCOPE đã thu tiền: nghỉ học hẳn VẪN gỡ lớp (daGo KHÔNG rỗng, ghi danh rời trạng thái học) nhưng bỏ qua phần tiền: boQuaHoanTien nói lý do, 0 yêu cầu hoàn, AuditLog SKIPPED", async () => {
    const d = await dungDon({ id: `${T}n21`, scope: true, daThu: 5_000_000 });
    const kq = await nghi(d.studentId);
    expect(kq.daGo.map((g) => g.id), "không chặn cho bé nghỉ").toEqual([d.enrollmentId]);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { status: true } })).status).not.toBe("STUDYING");
    expect(kq.boQuaHoanTien).toEqual([
      {
        enrollmentId: d.enrollmentId,
        classId: LOP,
        orderItemId: d.itemId,
        orderCode: (await db.order.findUniqueOrThrow({ where: { id: d.orderId }, select: { code: true } })).code,
        lyDo: LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN,
      },
    ]);
    expect(await soHoan(d)).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "Enrollment", entityId: d.enrollmentId, action: "REFUND_REQUEST_SKIPPED" } });
    expect(log.reason).toBe(LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN);
    // không có dòng BLOCKED: nhánh hỏi-trước đã bỏ qua, `createRefundRequest` không bị gọi
    expect(await db.auditLog.count({ where: { entityType: "Enrollment", entityId: d.enrollmentId, action: "REFUND_REQUEST_BLOCKED" } })).toBe(0);
    // tiền không đổi
    expect((await db.payment.findMany({ where: { orderId: d.orderId }, select: { amount: true } })).map((p) => p.amount)).toEqual([5_000_000]);
  });

  // ═══ 4 · MÀN "CHỜ ĐỀ XUẤT HOÀN" + NÚT TẠO TAY ═════════════════════════════════════════════════════════════════

  it("[HT-DB-30] màn 'Chờ đề xuất hoàn': ghi danh SCOPE ⇒ donPhamVi, không số, không cho tạo, VẪN trong danh sách; ghi danh thường ⇒ cho tạo và có số (một lần tra cho cả lô)", async () => {
    const thuong = await dungDon({ id: `${T}c30a`, scope: false, daThu: 5_000_000, trangThai: "WITHDREW" });
    const scope = await dungDon({ id: `${T}c30b`, scope: true, daThu: 5_000_000, trangThai: "WITHDREW" });
    const phamViGia = { class: { findMany: async () => [{ id: LOP }] } } as unknown as ScopedDb;
    const kq = await layChoDeXuatHoanTien(phamViGia, { now: NOW_SO_BUOI_TIN_DUOC });
    const dongThuong = kq.dong.find((x) => x.enrollmentId === thuong.enrollmentId);
    const dongScope = kq.dong.find((x) => x.enrollmentId === scope.enrollmentId);
    expect(dongThuong, "đối chứng dương: ca thường có mặt").toBeDefined();
    expect(dongThuong?.donPhamVi).toBe(false);
    expect(dongThuong?.choDeXuat).toBe(true);
    expect(dongThuong?.deXuatDuKien).toBeGreaterThan(0);
    expect(dongScope, "tiền đang treo ⇒ dòng SCOPE phải CÒN trong danh sách").toBeDefined();
    expect(dongScope?.donPhamVi).toBe(true);
    expect(dongScope?.choDeXuat).toBe(false);
    expect(dongScope?.deXuatDuKien).toBe(0);
    expect(dongScope?.lyDo).toBe(LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN);
  });

  it("[HT-DB-31] nút tạo tay: lyDoGhiDanhDonPhamVi trả đúng câu cho ghi danh SCOPE, null cho ghi danh thường, null cho id lạ", async () => {
    const thuong = await dungDon({ id: `${T}c31a`, scope: false, daThu: 5_000_000, trangThai: "WITHDREW" });
    const scope = await dungDon({ id: `${T}c31b`, scope: true, daThu: 5_000_000, trangThai: "WITHDREW" });
    expect(await lyDoGhiDanhDonPhamVi(scope.enrollmentId)).toBe(LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN);
    expect(await lyDoGhiDanhDonPhamVi(thuong.enrollmentId)).toBeNull();
    expect(await lyDoGhiDanhDonPhamVi(`${T}khong-co`)).toBeNull();
    // BATCH: một lần hỏi cho cả lô, chỉ trả đúng các ghi danh SCOPE
    const lo = await ghiDanhThuocDonPhamVi(db, [thuong.enrollmentId, scope.enrollmentId, `${T}khong-co`]);
    expect([...lo.keys()]).toEqual([scope.enrollmentId]);
  });
});
