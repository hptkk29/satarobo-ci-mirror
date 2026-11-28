// tests/finance/don-pham-vi-duong-con-lai-db.test.ts — CỔNG D, PHẦN CÒN LẠI: ba đường sửa đơn đã có (`themConVaoDon`, `doiKhoaChoCon`,
// `mienGiamNoChoCon`) trên một đơn theo PHẠM VI HỌC (SCOPE), trên Postgres THẬT.
//
// Chạy:  pnpm exec vitest run -c vitest.db.config.ts tests/finance/don-pham-vi-duong-con-lai-db.test.ts
//        (DATABASE_URL/DIRECT_URL trỏ MỘT database tên chứa `satarobo_test`, vd `satarobo_test_cd2`)
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố `fx-cd2-`. Mỗi ca tự dựng đơn của mình (chạy MỘT MÌNH vẫn xanh — luật 18).
// Đồng hồ truyền vào (luật 19): `now` của đổi khoá là tham số; ngày buổi học là hằng tuyệt đối.
//
// ── BẤT BIẾN ĐANG CANH ──────────────────────────────────────────────────────────────────────────────────────────────
// Đơn SCOPE = "thu theo số buổi đã chọn, KHÔNG chia nhiều đợt, giá = giá báo, KHÔNG đơn trộn" (cổng D + Q17). Cổng D đã che
// `recordInstallmentPlan` và `taoDotChoCon`; tệp này đo BA đường còn lại:
//   · `themConVaoDon`  — thêm một dòng KHÔNG dấu vào đơn (đơn trộn) và/hoặc xếp lại ưu đãi anh em lên dòng SCOPE;
//   · `doiKhoaChoCon`  — dừng dòng SCOPE, dựng dòng mới KHÔNG dấu theo `Course.price` và tạo ĐỢT cho phần còn thiếu qua
//                         `taoDotChoConTrongTx` (không bị cổng D gác);
//   · `mienGiamNoChoCon` — hạ `discountAmount` của dòng SCOPE ⇒ giá ≠ giá báo. Đây là "giảm tay trên dòng SCOPE" (Q12/D3 còn MỞ)
//                         nên tệp này CHỈ GHI NHẬN hiện trạng, KHÔNG chặn (xem nhóm [CD2-MG]).
//
// ── CÁCH ĐO ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Mỗi ca đối chứng ĐƠN THƯỜNG (cùng đường, cùng đầu vào, không dấu SCOPE) phải CHẠY ĐƯỢC — nếu không, "bị từ chối" trên đơn SCOPE có thể
// đến từ một cổng khác chứ không phải cổng phạm vi (bài học `[P-D-DB-03]`).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { xetCapQuyenHocChoDon } from "@/lib/entitlements/cap-tu-don";
import { doiKhoaChoCon, xemTruocDoiKhoa } from "@/lib/finance/doi-khoa-db";
import { mienGiamNoChoCon } from "@/lib/finance/mien-giam-db";
import { themConVaoDon, xemTruocThemCon } from "@/lib/finance/them-con-vao-don";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { CHINH_SACH_MAC_DINH, CACH_HAP_THU, type ChinhSachUuDai } from "@/lib/orders/chinh-sach-uu-dai";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, laDonPhamVi, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA, LY_DO_DON_PHAM_VI_KHONG_THEM_CON } from "@/lib/orders/pham-vi/cong-sua-don";

if (!RUN_DB_TESTS) console.warn(`[CD2-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-cd2-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture CD2" };
const KHOA = `${T}khoa`;
const KHOA_DICH = `${T}khoa-dich`;
const KHOA_RE = `${T}khoa-re`;
const LOP = `${T}lop`;
const LOP_DICH = `${T}lop-dich`;
const HV = `${T}hv`;
const GD = `${T}gd`;
const GIA48 = 10_560_000;
const GIA_DICH = 12_000_000;
const GIA_RE = 5_000_000;
/** Thành tiền dòng SCOPE 48 buổi (con 1, sản phẩm 1): niêm yết × 85% — do planner thật tính, ghim lại ở `metadataScope`. */
const TIEN = 8_976_000;
const NOW = new Date("2026-10-05T03:00:00Z");
/** Buổi cuối bé học: buổi 4 (07/09, 14/09, 21/09, 28/09 đã qua; buổi 5 ngày 05/10 12:30 UTC còn SAU `NOW`). */
const BUOI_CUOI = `${T}buoi-4`;
const TRAN_PHAN_TRAM = 50;
/** Chính sách anh em BẬT (mặc định của repo là TẮT). */
const UU_DAI_BAT: ChinhSachUuDai = { ...CHINH_SACH_MAC_DINH, tuDong: true };
/** Hằng thay cho literal sau tên cột trạng thái kế toán: lưới [BUOC-6] (lib/finance/truc-a.test.ts) cấm cặp đó ngoài debt.ts. */
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
  await db.studyEntitlementXuLy.deleteMany({ where: { orderId: { in: ids } } });
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } } });
  await db.studyEntitlement.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } });
  await db.refundRequest.deleteMany({ where: { orderItem: { orderId: { in: ids } } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "Order", entityId: { in: ids } }, { actorName: { startsWith: "Hệ thống — cấp quyền học" } }, { actorId: ACTOR.id }] } });
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
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP_DICH] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP_DICH] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_DICH, KHOA_RE] } } });
}

interface DonFx {
  id: string;
  /** `true` = dòng mang dấu SCOPE THẬT (đơn SCOPE); `false` = đơn thường (đối chứng dương). */
  scope: boolean;
  /** Đã thu (CONFIRMED, gắn dòng) — để đổi khoá có tiền để chuyển. */
  daThu?: number;
}

/** Đơn 1 dòng + ghi danh + phiếu thu toàn đơn do `ensureFullOrderRequest` dựng (đúng thứ tạo đơn để lại). */
async function dungDon(o: DonFx): Promise<{ orderId: string; itemId: string }> {
  const itemId = `${o.id}-it`;
  await db.student.upsert({ where: { id: HV }, create: { id: HV, name: `${T}Bé A`, centerId: CS1, status: "ACTIVE" }, update: {} });
  await db.enrollment.upsert({
    where: { id: GD },
    create: { id: GD, studentId: HV, classId: LOP, courseId: KHOA, centerId: CS1, status: "STUDYING" },
    update: {},
  });
  const gia = o.scope ? TIEN : GIA48;
  await db.order.create({
    data: {
      id: o.id,
      code: `ORD-2699-CD2-${++dem}-${o.id.slice(-6)}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: "0399000111",
      subtotal: gia,
      discountAmount: 0,
      totalAmount: gia,
      centerId: CS1,
      studentId: HV,
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
      studentId: HV,
      enrollmentId: GD,
      status: "ACTIVE",
      metadata: (o.scope ? metadataScope() : { courseId: KHOA, soBuoi: 48 }) as Prisma.InputJsonValue,
    },
  });
  const r0 = await db.$transaction((tx) => ensureFullOrderRequest(tx, { id: o.id, code: `ORD-2699-CD2-${dem}-${o.id.slice(-6)}`, totalAmount: gia, centerId: CS1 }));
  if (o.daThu && o.daThu > 0) {
    // Tiền THẬT ở cả hai sổ (như một khách đã quét QR phiếu toàn đơn): Payment + giao dịch ngân hàng → phân bổ vào phiếu → phiếu PAID.
    // Phiếu toàn đơn còn PENDING thì chính `kiemTaoDot` chặn đợt mới vì lý do chẳng liên quan tới cổng phạm vi (bài học [P-D-DB-03]).
    await db.payment.create({
      data: {
        orderId: o.id,
        orderItemId: itemId,
        enrollmentId: GD,
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
  return { orderId: o.id, itemId };
}

/** Mọi con số mà ba đường này CÓ THỂ làm đổi. Bằng nhau trước/sau ⇒ không phép ghi nào xảy ra. */
async function anhChup(orderId: string) {
  const [phieu, dot, pay, phanBo, qr, audit, don, dong, ghiDanh, hoan, quyen] = await Promise.all([
    db.paymentRequest.findMany({ where: { orderId }, orderBy: [{ installmentNo: "asc" }, { id: "asc" }] }),
    db.orderInstallment.findMany({ where: { orderId }, orderBy: { soDot: "asc" } }),
    db.payment.findMany({ where: { orderId }, orderBy: { id: "asc" }, select: { id: true, amount: true, orderItemId: true, accountantStatus: true } }),
    db.paymentAllocation.count({ where: { paymentRequest: { orderId } } }),
    db.qrSession.count({ where: { paymentRequest: { orderId } } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: orderId } }),
    db.order.findUniqueOrThrow({ where: { id: orderId }, select: { subtotal: true, discountAmount: true, totalAmount: true, status: true, updatedAt: true } }),
    db.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" }, select: { id: true, metadata: true, unitPrice: true, totalPrice: true, discountAmount: true, discounts: true, status: true, usedValue: true, enrollmentId: true } }),
    db.enrollment.findMany({ where: { studentId: HV }, orderBy: { id: "asc" }, select: { id: true, classId: true, status: true } }),
    db.refundRequest.count({ where: { orderItem: { orderId } } }),
    db.studyEntitlement.count({ where: { orderId } }),
  ]);
  return JSON.stringify({ phieu, dot, pay, phanBo, qr, audit, don, dong, ghiDanh, hoan, quyen });
}

const demDot = (orderId: string) => db.paymentRequest.count({ where: { orderId, installmentNo: { gt: 0 } } });

const themCon = (orderId: string, o: { gia?: number; chinhSach?: ChinhSachUuDai } = {}) =>
  themConVaoDon({
    orderId,
    conMoi: { itemName: "Bé B", courseId: KHOA_RE, quantity: 1, unitPrice: o.gia ?? GIA_RE },
    chinhSach: o.chinhSach ?? UU_DAI_BAT,
    tranPhanTram: TRAN_PHAN_TRAM,
    lyDo: "Em thứ hai vào học",
    actor: ACTOR,
  });

const doiKhoa = (orderId: string, orderItemId: string) =>
  doiKhoaChoCon({
    orderId,
    orderItemId,
    targetClassId: LOP_DICH,
    buoiCuoiId: BUOI_CUOI,
    unitPriceMoi: GIA_DICH,
    tranPhanTram: TRAN_PHAN_TRAM,
    lyDo: "Đổi sang khoá cao hơn",
    actor: ACTOR,
    now: NOW,
  });

describe.skipIf(!RUN_DB_TESTS)("[CD2-DB] cổng D phần còn lại — đơn SCOPE × thêm con / đổi khoá / miễn giảm — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donNen();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const [id, ten, gia] of [[KHOA, "Sata 3 (fixture CD2)", GIA48], [KHOA_DICH, "Sata 5 (fixture CD2)", GIA_DICH], [KHOA_RE, "Khoá rẻ (fixture CD2)", GIA_RE]] as const) {
      await db.course.create({ data: { id, name: ten, slug: id, price: gia, totalSessions: 48 } });
    }
    for (const [id, courseId] of [[LOP, KHOA], [LOP_DICH, KHOA_DICH]] as const) {
      await db.class.create({ data: { id, name: `Lớp ${id}`, courseId, centerId: CS1, status: "ACTIVE", maxStudents: 12 } });
    }
    // 48 buổi hằng tuần từ 2026-09-07 (tuyệt đối — luật 19); `NOW` = 2026-10-05 ⇒ 5 buổi đã qua.
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

  // ═══ 1 · THÊM CON VÀO ĐƠN ═══════════════════════════════════════════════════════════════════════════════════════

  it("[CD2-TC-00] ĐỐI CHỨNG DƯƠNG — đơn THƯỜNG: thêm con chạy được (cùng đầu vào, cùng chính sách) ⇒ sinh dòng mới", async () => {
    const { orderId } = await dungDon({ id: `${T}tc00`, scope: false });
    const truoc = await db.orderItem.count({ where: { orderId } });
    const kq = await themCon(orderId);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    expect(await db.orderItem.count({ where: { orderId } })).toBe(truoc + 1);
  });

  it("[CD2-TC-01] đơn SCOPE: thêm con RẺ HƠN (con mới là 'thứ hai') ⇒ từ chối, KHÔNG phép ghi nào (so mọi bảng tiền trước/sau)", async () => {
    const { orderId } = await dungDon({ id: `${T}tc01`, scope: true });
    expect(laDonPhamVi(await db.orderItem.findMany({ where: { orderId }, select: { metadata: true } })), "tiền đề: đây là đơn SCOPE").toBe(true);
    const truoc = await anhChup(orderId);
    const kq = await themCon(orderId, { gia: GIA_RE });
    expect(kq).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_THEM_CON });
    expect(await anhChup(orderId)).toBe(truoc);
  });

  it("[CD2-TC-02] đơn SCOPE: thêm con ĐẮT HƠN (dòng SCOPE bị xếp xuống 'thứ hai' ⇒ nhận ưu đãi anh em) ⇒ từ chối, dòng SCOPE không đổi một đồng", async () => {
    const { orderId, itemId } = await dungDon({ id: `${T}tc02`, scope: true });
    const truoc = await anhChup(orderId);
    const kq = await themCon(orderId, { gia: GIA_DICH });
    expect(kq).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_THEM_CON });
    expect(await anhChup(orderId)).toBe(truoc);
    const d = await db.orderItem.findUniqueOrThrow({ where: { id: itemId }, select: { unitPrice: true, totalPrice: true, discountAmount: true } });
    expect(d).toEqual({ unitPrice: TIEN, totalPrice: TIEN, discountAmount: 0 });
  });

  it("[CD2-TC-03] đơn SCOPE: chính sách anh em TẮT (mặc định) cũng bị từ chối — cổng đọc DẤU, không đọc chính sách", async () => {
    const { orderId } = await dungDon({ id: `${T}tc03`, scope: true });
    const truoc = await anhChup(orderId);
    expect(await themCon(orderId, { chinhSach: CHINH_SACH_MAC_DINH })).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_THEM_CON });
    expect(await anhChup(orderId)).toBe(truoc);
  });

  it("[CD2-TC-04] đơn SCOPE: cờ phạm vi TẮT sau khi tạo đơn vẫn bị chặn (dấu đọc từ DB, không từ cờ) — và màn XEM TRƯỚC nói cùng một câu", async () => {
    const { orderId } = await dungDon({ id: `${T}tc04`, scope: true });
    for (const bat of [false, null] as const) {
      await datCo(bat);
      const truoc = await anhChup(orderId);
      expect(await themCon(orderId)).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_THEM_CON });
      const xt = await xemTruocThemCon({
        orderId,
        conMoi: { itemName: "Bé B", courseId: KHOA_RE, quantity: 1, unitPrice: GIA_RE },
        chinhSach: UU_DAI_BAT,
        tranPhanTram: TRAN_PHAN_TRAM,
      });
      expect(xt).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_THEM_CON });
      expect(await anhChup(orderId)).toBe(truoc);
    }
  });

  it("[CD2-TC-05] cách ly theo orderId: có đơn SCOPE cùng cơ sở thì đơn THƯỜNG khác vẫn thêm con được (cổng không đọc dòng của đơn khác)", async () => {
    await dungDon({ id: `${T}tc05a`, scope: true });
    const { orderId: thuong } = await dungDon({ id: `${T}tc05b`, scope: false });
    const kq = await themCon(thuong);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
  });

  // ═══ 2 · ĐỔI KHOÁ ═══════════════════════════════════════════════════════════════════════════════════════════════

  it("[CD2-DK-00] ĐỐI CHỨNG DƯƠNG — đơn THƯỜNG đã thu đủ: đổi khoá sang khoá đắt hơn chạy được và TẠO ĐỢT cho phần còn thiếu", async () => {
    const { orderId, itemId } = await dungDon({ id: `${T}dk00`, scope: false, daThu: GIA48 });
    const kq = await doiKhoa(orderId, itemId);
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    expect(kq.dotConThieuId, "phần còn thiếu phải thành một đợt").not.toBeNull();
    expect(await demDot(orderId)).toBeGreaterThan(0);
  });

  it("[CD2-DK-01] đơn SCOPE đã thu đủ: đổi khoá ⇒ từ chối, KHÔNG đợt/dòng/ghi danh/hoàn tiền nào sinh ra (đúng nơi lỗ cũ: `taoDotChoConTrongTx` không bị cổng D gác)", async () => {
    const { orderId, itemId } = await dungDon({ id: `${T}dk01`, scope: true, daThu: TIEN });
    const truoc = await anhChup(orderId);
    expect(await doiKhoa(orderId, itemId)).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA });
    expect(await anhChup(orderId)).toBe(truoc);
    expect(await demDot(orderId)).toBe(0);
  });

  it("[CD2-DK-02] đơn SCOPE: cờ TẮT sau khi tạo đơn vẫn bị chặn; màn XEM TRƯỚC đổi khoá nói cùng một câu và không ghi gì", async () => {
    const { orderId, itemId } = await dungDon({ id: `${T}dk02`, scope: true, daThu: TIEN });
    for (const bat of [false, null] as const) {
      await datCo(bat);
      const truoc = await anhChup(orderId);
      expect(await doiKhoa(orderId, itemId)).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA });
      const xt = await xemTruocDoiKhoa({ orderId, orderItemId: itemId, targetClassId: LOP_DICH, buoiCuoiId: BUOI_CUOI, unitPriceMoi: GIA_DICH, tranPhanTram: TRAN_PHAN_TRAM, now: NOW });
      expect(xt).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA });
      expect(await anhChup(orderId)).toBe(truoc);
    }
  });

  it("[CD2-DK-03] đơn SCOPE CHƯA thu đồng nào: đổi khoá cũng bị từ chối (cổng không nhìn số tiền)", async () => {
    const { orderId, itemId } = await dungDon({ id: `${T}dk03`, scope: true });
    const truoc = await anhChup(orderId);
    expect(await doiKhoa(orderId, itemId)).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA });
    expect(await anhChup(orderId)).toBe(truoc);
  });

  it("[CD2-DK-04] THỨ TỰ CỔNG — đơn SCOPE + lớp đích TRÙNG lớp đang học: câu trả về là câu PHẠM VI (cổng đứng trước mọi câu chặn khác), không phải 'Lớp đích trùng lớp bé đang học'", async () => {
    const { orderId, itemId } = await dungDon({ id: `${T}dk04`, scope: true, daThu: TIEN });
    const truoc = await anhChup(orderId);
    const kq = await doiKhoaChoCon({
      orderId,
      orderItemId: itemId,
      targetClassId: LOP, // chính lớp bé đang học
      buoiCuoiId: BUOI_CUOI,
      unitPriceMoi: GIA48,
      tranPhanTram: TRAN_PHAN_TRAM,
      lyDo: "Thử",
      actor: ACTOR,
      now: NOW,
    });
    expect(kq).toEqual({ ok: false, error: LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA });
    expect(await anhChup(orderId)).toBe(truoc);
    // Đối chứng dương: đơn THƯỜNG cùng đầu vào ⇒ vẫn nhận đúng câu cũ của nó.
    const { orderId: thuong, itemId: itemThuong } = await dungDon({ id: `${T}dk04b`, scope: false, daThu: GIA48 });
    const cu = await doiKhoaChoCon({
      orderId: thuong,
      orderItemId: itemThuong,
      targetClassId: LOP,
      buoiCuoiId: BUOI_CUOI,
      unitPriceMoi: GIA48,
      tranPhanTram: TRAN_PHAN_TRAM,
      lyDo: "Thử",
      actor: ACTOR,
      now: NOW,
    });
    expect(cu).toEqual({ ok: false, error: "Lớp đích trùng lớp bé đang học" });
  });

  // ═══ 3 · MIỄN GIẢM NỢ — HIỆN TRẠNG, CHỜ Q12/D3 (KHÔNG CHẶN) ═════════════════════════════════════════════════════

  it("[CD2-MG-01] HIỆN TRẠNG (chờ Q12/D3): miễn giảm trên dòng SCOPE KHÔNG tạo đợt/kế hoạch, nhưng hạ giá dòng dưới giá báo ⇒ `xetCapQuyenHocChoDon` báo `dauKhongKhop` và KHÔNG cấp quyền học", async () => {
    const MIEN = 500_000;
    const { orderId, itemId } = await dungDon({ id: `${T}mg01`, scope: true });
    const kq = await mienGiamNoChoCon({
      orderId,
      orderItemId: itemId,
      soTien: MIEN,
      lyDo: "Khách khó khăn, QLCS đồng ý",
      hapThu: CACH_HAP_THU.DOT_XA_NHAT,
      tranPhanTram: TRAN_PHAN_TRAM,
      actor: ACTOR,
    });
    expect(kq.ok, JSON.stringify(kq)).toBe(true);

    // (a) bất biến "không đợt" VẪN đúng: miễn giảm chỉ dựng lại phiếu THU TOÀN ĐƠN (installmentNo 0).
    expect(await demDot(orderId)).toBe(0);
    expect(await db.orderInstallment.count({ where: { orderId } })).toBe(0);
    expect(await db.paymentRequest.count({ where: { orderId, orderItemId: { not: null } } })).toBe(0);

    // (b) bất biến "giá = giá báo" ĐÃ GÃY: dòng giờ thấp hơn thành tiền ghi trong dấu.
    const d = await db.orderItem.findUniqueOrThrow({ where: { id: itemId }, select: { unitPrice: true, totalPrice: true, discountAmount: true, metadata: true } });
    expect(d.totalPrice - d.discountAmount).toBe(TIEN - MIEN);
    expect(docPhamViDong(d.metadata)?.thanhTien).toBe(TIEN);

    // (c) hệ quả: khách trả đúng số đã miễn nhưng quyền học KHÔNG được cấp, và dòng KHÔNG vào hàng chờ nào.
    await db.payment.create({
      data: { orderId, orderItemId: itemId, enrollmentId: GD, amount: TIEN - MIEN, method: "cash", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: DA_XAC_NHAN, centerId: CS1 },
    });
    const xet = await xetCapQuyenHocChoDon(orderId, "GAN_TAY", NOW, "CAP");
    expect(xet.daCap).toHaveLength(0);
    expect(xet.dauKhongKhop).toEqual([itemId]);
    expect(await db.studyEntitlement.count({ where: { orderId } })).toBe(0);
    expect(await db.studyEntitlementXuLy.count({ where: { orderId, trangThai: "OPEN" } }), "không dòng xử lý nào MỞ ⇒ không ai thấy trong hàng đợi").toBe(0);
  });
});
