// tests/finance/quyen-hoc-noi-duong-tien.test.ts — NỐI CÁC ĐƯỜNG TIỀN + TRẠNG THÁI "CHỜ CHUYỂN ĐỔI", trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Hoặc:  DATABASE_URL=…/satarobo_test_noi DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/quyen-hoc-noi-duong-tien.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng đơn của mình (chạy MỘT MÌNH vẫn xanh — luật 18).
// Đồng hồ truyền vào (luật 19). Số tiền lẻ nghìn, không tròn triệu.
//
// Phần cấp quyền học từ tiền đã có ở `quyen-hoc-cap-tu-don.test.ts` (#646). Tệp này đo PHẦN NỐI MỚI:
//   · webhook đời cũ / đối soát tay (`allocateToOrder`), xác nhận tay (`confirmPayment`), `recordPayment`, gắn tay theo con;
//   · khách mới chưa có học viên ⇒ dòng CHỜ bền (`StudyEntitlementXuLy` CHO_CHUYEN_DOI), KHÔNG quyền học active;
//   · sau Chuyển đổi ⇒ tự cấp đúng một lần, đúng dòng, và ĐÓNG dòng chờ cùng giao dịch;
//   · tiền không còn đủ ⇒ dòng chờ đóng HUY; REJECTED / hoàn / đơn huỷ ⇒ không cấp mới, không tạo dòng chờ;
//   · idempotent + 5 lượt đồng thời; cờ TẮT ⇒ không ghi gì (đếm hàng trước/sau).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { xetCapQuyenHocChoDon } from "@/lib/entitlements/cap-tu-don";
import { hichCapQuyenHocChoDon, hichCapQuyenHocChoLead } from "@/lib/entitlements/hich";
import { donChoXacNhanTruocGhiDanh } from "@/lib/entitlements/xac-nhan-truoc";
import { registerCapQuyenHocHandlers } from "@/lib/entitlements/su-kien";
import { clearHandlers, getHandlers } from "@/lib/events/registry";
import { ganKhoanDaThuChoCon } from "@/lib/finance/ghi-tien-don";
import { confirmPayment, linkRecordedPaymentsToEnrollments, recordPayment, refundPayment, rejectPayment } from "@/lib/finance/payment";
import { allocateToOrder } from "@/lib/payments/payos-ingest";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { veMetadataConLead } from "@/lib/orders/hoc-vien-dong-don";

if (!RUN_DB_TESTS) console.warn(`[NOI-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-noi-";
const KHOA = `${T}khoa`;
const KHOA_2 = `${T}khoa-2`;
const KHOA_CU = `${T}khoa-cu`;
const LOP_CU = `${T}lop-cu`;
const HV_A = `${T}hv-a`;
const HV_B = `${T}hv-b`;
const HV_CU = `${T}hv-cu`;
const GD_CU = `${T}gd-cu`;
const ITEM_A = `${T}item-a`;
const ITEM_B = `${T}item-b`;
const KE_TOAN = `${T}ke-toan`;
const SALE = `${T}sale`;
const NOW = new Date("2026-10-11T03:00:00Z");
const SAU = new Date("2026-10-11T05:00:00Z");
const GIA48 = 10_560_000;
const TIEN = 8_976_000;
const SDT = "0905123456";
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

/** Dấu SCOPE THẬT do planner của tầng tạo đơn sinh ra — không gõ tay. `leadChildId` ghép bằng chính hàm của tầng tạo đơn. */
function metadataScope(courseId: string = KHOA, leadChildId: string | null = null): Record<string, unknown> {
  const kq = keHoachDon([dongVao], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId, soBuoi: 48 }, courseId);
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: planner không ra SCOPE");
  expect(docPhamViDong(md)?.thanhTien).toBe(TIEN);
  return veMetadataConLead(md, leadChildId) ?? md;
}

let CS1 = "";
let OU1 = "";
let dem = 0;

interface DongFx {
  id: string;
  /** `null` = khách mới (chưa có học viên). Mặc định HV_A. */
  studentId?: string | null;
  courseId?: string;
  leadChildId?: string | null;
  /** Dùng metadata này thay dấu SCOPE (đơn thường: `null`/`{courseId}`). */
  metadata?: Record<string, unknown> | null;
}
interface DonFx {
  id: string;
  dong: DongFx[];
  status?: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED";
  leadId?: string | null;
}

async function dungDon(o: DonFx) {
  const tong = o.dong.length * TIEN;
  await db.order.create({
    data: {
      id: o.id,
      code: `ORD-2699-NOI-${++dem}-${o.id.slice(-6)}`,
      type: "COURSE",
      status: o.status ?? "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: SDT,
      totalAmount: tong,
      subtotal: tong,
      centerId: CS1,
      leadId: o.leadId ?? null,
    },
  });
  for (const d of o.dong) {
    await db.orderItem.create({
      data: {
        id: d.id,
        orderId: o.id,
        type: "COURSE_ENROLLMENT",
        itemName: "Sata 3",
        quantity: 1,
        unitPrice: TIEN,
        totalPrice: TIEN,
        discountAmount: 0,
        studentId: d.studentId === undefined ? HV_A : d.studentId,
        status: "ACTIVE",
        metadata: (d.metadata === undefined ? metadataScope(d.courseId ?? KHOA, d.leadChildId ?? null) : d.metadata) as Prisma.InputJsonValue,
      },
    });
  }
}

/** Dòng tiền trên sổ `Payment`. */
async function thu(
  orderId: string,
  orderItemId: string | null,
  amount: number,
  accountantStatus: "PENDING" | "CONFIRMED" | "REJECTED",
  o: { note?: string | null; enrollmentId?: string | null } = {},
) {
  return db.payment.create({
    data: {
      orderId,
      orderItemId,
      enrollmentId: o.enrollmentId ?? null,
      amount,
      method: o.note?.includes("[auto:") ? "sepay" : "cash",
      paidDate: NOW,
      note: o.note ?? null,
      saleStatus: "RECORDED",
      accountantStatus,
      centerId: CS1,
    },
  });
}

let demDot = 0;
/** Tiền ngân hàng THẬT: giao dịch MATCHED + phiếu thu + phân bổ vào đơn + dòng `Payment` PENDING mang marker (hình dạng webhook/phiếu gộp để lại). */
async function thuNganHang(orderId: string, orderItemId: string | null, amount: number, txn: string) {
  const providerTxnId = `${T}${txn}`;
  const bt = await db.bankTransaction.create({
    data: { provider: "SEPAY", providerTxnId, amount, transferredAt: NOW, status: "MATCHED", centerId: CS1 },
  });
  const dot = await db.paymentRequest.create({
    data: { orderId, orderItemId, centerId: CS1, installmentNo: 100 + ++demDot, amountDue: amount, status: "PAID", sortOrder: 100 + demDot },
  });
  await db.paymentAllocation.create({ data: { bankTransactionId: bt.id, paymentRequestId: dot.id, amount, centerId: CS1 } });
  return thu(orderId, orderItemId, amount, "PENDING", { note: `Tiền về qua SEPAY ${providerTxnId} [auto:sepay:${providerTxnId}]` });
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

async function donDep() {
  const don = await db.order.findMany({ where: { id: { startsWith: T } }, select: { id: true } });
  const ids = don.map((d) => d.id);
  await db.studyEntitlementXuLy.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { orderId: { startsWith: T } }] } });
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } } });
  await db.studyEntitlement.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorName: { startsWith: "Hệ thống — cấp quyền học" } },
        { entityType: "Payment", actorId: KE_TOAN },
        { entityType: "Order", entityId: { in: ids } },
      ],
    },
  });
  await db.receipt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T }, NOT: { id: GD_CU } } });
  await db.student.deleteMany({ where: { id: { startsWith: T }, NOT: { id: { in: [HV_A, HV_B, HV_CU] } } } });
  await db.leadChild.deleteMany({ where: { lead: { parentName: { startsWith: T } } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: T } } });
}

const quyenCua = (orderId: string) => db.studyEntitlement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
// Chỉ dòng CHỜ CHUYỂN ĐỔI — chủ đề của tệp này. Từ 12/10/2026 còn loại CHO_XEP_LOP (PR xếp lớp, đo ở xep-lop-buoi-bat-dau.test.ts): ghi danh giả lập ở đây
// nằm trong một lớp KHÔNG CÓ BUỔI NÀO nên `xetXepLopChoDon` đúng đắn mở một dòng CHO_XEP_LOP — không phải thứ các ca này đo.
const choCua = (orderId: string) => db.studyEntitlementXuLy.findMany({ where: { orderId, loai: "CHO_CHUYEN_DOI" }, orderBy: { createdAt: "asc" } });
const demHang = async () => ({
  quyen: await db.studyEntitlement.count(),
  cho: await db.studyEntitlementXuLy.count(),
  audit: await db.auditLog.count({ where: { module: "entitlements" } }),
  suKien: await db.domainEvent.count(),
});

const rejectPaymentThat = (paymentId: string) => rejectPayment({ paymentId, confirmedById: KE_TOAN, reason: "Tiền không về tài khoản" });
async function giaoSuKienVoided(orderId: string, denTrangThai: string) {
  const hs = getHandlers("order.voided");
  expect({ type: "order.voided", soHandler: hs.length }).toEqual({ type: "order.voided", soHandler: 1 });
  await hs[0]!({ id: "ev-voided", type: "order.voided", payload: { orderId, denTrangThai } });
}

/** Học viên + ghi danh của "con" sau Chuyển đổi — đúng hình dạng `convertLeadV2` để lại (Student.leadChildId, Enrollment.leadChildId; KHÔNG ghi OrderItem.studentId). */
async function giaLapConvert(leadChildId: string, courseId: string, tenHv: string): Promise<string> {
  const hv = await db.student.create({ data: { id: `${T}hv-${tenHv}`, name: `${T}${tenHv}`, centerId: CS1, status: "ACTIVE", leadChildId } });
  await db.enrollment.create({ data: { id: `${T}gd-${tenHv}`, studentId: hv.id, classId: LOP_CU, courseId, centerId: CS1, status: "STUDYING", leadChildId } });
  return hv.id;
}

async function dungLead(ten: string, soCon: number): Promise<{ leadId: string; conIds: string[] }> {
  const lead = await db.lead.create({ data: { parentName: `${T}${ten}`, phone: SDT, centerId: CS1 }, select: { id: true } });
  const conIds: string[] = [];
  for (let i = 0; i < soCon; i++) {
    conIds.push((await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}${ten}-con-${i}` }, select: { id: true } })).id);
  }
  return { leadId: lead.id, conIds };
}

/** Rót tiền như đường webhook đời cũ / đối soát tay: giao dịch UNMATCHED → `allocateToOrder` với đích là phiếu thu của dòng. */
async function rotQuaAllocate(orderId: string, orderItemId: string, amount: number, txn: string) {
  const providerTxnId = `${T}${txn}`;
  const bt = await db.bankTransaction.create({
    data: { provider: "SEPAY", providerTxnId, amount, transferredAt: NOW, status: "UNMATCHED", centerId: CS1 },
  });
  const dot = await db.paymentRequest.create({
    data: { orderId, orderItemId, centerId: CS1, installmentNo: 1, amountDue: amount, status: "PENDING", sortOrder: 1 },
  });
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      status: true,
      centerId: true,
      orgUnitId: true,
      studentId: true,
      leadId: true,
      student: { select: { id: true, parentUserId: true } },
    },
  });
  return allocateToOrder({
    bankTransactionId: bt.id,
    order,
    amount,
    provider: "SEPAY",
    providerTxnId,
    target: { paymentRequestId: dot.id, orderId, via: "manual" },
    data: { amount, reference: providerTxnId } as never,
  });
}

describe.skipIf(!RUN_DB_TESTS)("[NOI-DB] nối đường tiền + CHỜ CHUYỂN ĐỔI — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const [id, ten, gia] of [[KHOA, "Sata 3 (fixture)", GIA48], [KHOA_2, "Sata 4 (fixture)", GIA48], [KHOA_CU, "Sata 1 (fixture cũ)", 3_000_000]] as const) {
      await db.course.upsert({
        where: { id },
        create: { id, name: ten, slug: id, price: gia, totalSessions: 48 },
        update: { price: gia, totalSessions: 48 },
      });
    }
    await db.class.upsert({
      where: { id: LOP_CU },
      create: { id: LOP_CU, name: "Lớp cũ (fixture)", courseId: KHOA_CU, centerId: CS1, status: "ACTIVE", maxStudents: 12 },
      update: {},
    });
    for (const [id, ten] of [[HV_A, "Bé A"], [HV_B, "Bé B"], [HV_CU, "Bé cũ"]] as const) {
      await db.student.upsert({ where: { id }, create: { id, name: `${T}${ten}`, centerId: CS1, status: "ACTIVE" }, update: {} });
    }
    // Ghi danh CŨ của một học viên đã học khoá khác — chỗ để khoản tiền mặt bám vào cho qua cổng CHUA_GHI_DANH (cổng KHÔNG đổi).
    await db.enrollment.upsert({
      where: { id: GD_CU },
      create: { id: GD_CU, studentId: HV_CU, classId: LOP_CU, courseId: KHOA_CU, centerId: CS1, status: "STUDYING" },
      update: {},
    });
  });
  beforeEach(async () => {
    await donDep();
    await datCo(OU1, true);
    clearHandlers();
    registerCapQuyenHocHandlers();
  });
  afterAll(async () => {
    await donDep();
    await datCo(OU1, null);
    await db.enrollment.deleteMany({ where: { id: GD_CU } });
    await db.student.deleteMany({ where: { id: { in: [HV_A, HV_B, HV_CU] } } });
    await db.class.deleteMany({ where: { id: LOP_CU } });
    await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_2, KHOA_CU] } } });
  });

  // ═══ 1 · CÁC ĐƯỜNG TIỀN ═══════════════════════════════════════════════════════════════════════════════════════════

  it("[NOI-DB-01] WEBHOOK ĐỜI CŨ / ĐỐI SOÁT TAY (`allocateToOrder`): rót đủ tiền vào dòng ⇒ cấp ĐÚNG MỘT quyền học AWAITING_PLACEMENT, KHÔNG sổ tiêu thụ", async () => {
    const DON = `${T}don-01`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    const kq = await rotQuaAllocate(DON, ITEM_A, TIEN, "txn-01");
    expect(kq.status, "fixture: rót tiền phải thành công").toBe("MATCHED");

    const khoan = await db.payment.findMany({ where: { orderId: DON } });
    expect(khoan.map((k) => [k.orderItemId, k.accountantStatus, (k.note ?? "").includes("[auto:sepay:")])).toEqual([[ITEM_A, "PENDING", true]]);
    const [q, ...conLai] = await quyenCua(DON);
    expect(conLai).toHaveLength(0);
    expect(q).toMatchObject({ studentId: HV_A, courseId: KHOA, orderItemId: ITEM_A, status: "AWAITING_PLACEMENT", netAmount: TIEN, closedBySaleId: null, commissionSnapshot: null });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } })).toBe(0);
    expect(await choCua(DON), "đã biết học viên ⇒ không có dòng chờ").toHaveLength(0);
  });

  it("[NOI-DB-01b] `allocateToOrder` rót THIẾU tiền ⇒ chưa cấp; rót nốt ⇒ cấp (đối chứng dương cho [01])", async () => {
    const DON = `${T}don-01b`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await rotQuaAllocate(DON, ITEM_A, TIEN - 1_000, "txn-01b1");
    expect(await quyenCua(DON), "thiếu 1.000đ").toHaveLength(0);
    // Hích lần nữa không đổi gì (đủ tiền chưa).
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    expect(await quyenCua(DON)).toHaveLength(0);

    const dot2 = await db.paymentRequest.create({
      data: { orderId: DON, orderItemId: ITEM_A, centerId: CS1, installmentNo: 2, amountDue: 1_000, status: "PENDING", sortOrder: 2 },
    });
    const bt = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: `${T}txn-01b2`, amount: 1_000, transferredAt: NOW, status: "UNMATCHED", centerId: CS1 },
    });
    const order = await db.order.findUniqueOrThrow({
      where: { id: DON },
      select: { id: true, code: true, status: true, centerId: true, orgUnitId: true, studentId: true, leadId: true, student: { select: { id: true, parentUserId: true } } },
    });
    const kq = await allocateToOrder({
      bankTransactionId: bt.id,
      order,
      amount: 1_000,
      provider: "SEPAY",
      providerTxnId: `${T}txn-01b2`,
      target: { paymentRequestId: dot2.id, orderId: DON, via: "manual" },
      data: { amount: 1_000 } as never,
    });
    expect(kq.status).toBe("MATCHED");
    expect(await quyenCua(DON)).toHaveLength(1);
  });

  it("[NOI-DB-02] CỜ TẮT ⇒ `allocateToOrder` rót tiền bình thường nhưng KHÔNG ghi gì vào quyền học / dòng chờ / AuditLog entitlements / DomainEvent (đếm trước/sau)", async () => {
    const DON = `${T}don-02`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, studentId: null, leadChildId: null }] });
    for (const [ten, dat] of [["tắt hẳn", async () => datCo(OU1, false)], ["chưa đặt", async () => datCo(OU1, null)]] as const) {
      await dat();
      const truoc = await demHang();
      const kq = await rotQuaAllocate(DON, ITEM_A, TIEN, `txn-02-${ten.length}`);
      expect(kq.status, `${ten}: tiền vẫn vào sổ`).toBe("MATCHED");
      const sau = await demHang();
      // `allocateToOrder` có thể tự phát sự kiện của nó — chỉ ba bảng của quyền học phải đứng yên.
      expect({ ten, quyen: sau.quyen, cho: sau.cho, audit: sau.audit }).toEqual({ ten, quyen: truoc.quyen, cho: truoc.cho, audit: truoc.audit });
      // Dọn khoản vừa rót để lượt sau đo từ đầu.
      await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
      await db.payment.deleteMany({ where: { orderId: DON } });
      await db.paymentRequest.deleteMany({ where: { orderId: DON } });
    }
    expect(await quyenCua(DON)).toHaveLength(0);
    expect(await choCua(DON), "cờ TẮT: khách mới đủ tiền cũng KHÔNG sinh dòng chờ").toHaveLength(0);
  });

  it("[NOI-DB-03] đơn THƯỜNG (không dấu SCOPE) + cờ BẬT ⇒ `allocateToOrder` không ghi gì vào quyền học / dòng chờ (đối chứng dương: [01] cùng cờ, đơn SCOPE ⇒ cấp)", async () => {
    const DON = `${T}don-03`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, metadata: { courseId: KHOA, soBuoi: 48 }, studentId: null }] });
    const truoc = await demHang();
    expect((await rotQuaAllocate(DON, ITEM_A, TIEN, "txn-03")).status).toBe("MATCHED");
    const sau = await demHang();
    expect({ quyen: sau.quyen, cho: sau.cho, audit: sau.audit }).toEqual({ quyen: truoc.quyen, cho: truoc.cho, audit: truoc.audit });
  });

  it("[NOI-DB-04] XÁC NHẬN TAY (`confirmPayment`) ⇒ phát `payment.confirmed` ⇒ handler đã đăng ký cấp quyền học; cờ TẮT ⇒ cổng CHUA_GHI_DANH giữ nguyên chữ", async () => {
    const DON = `${T}don-04`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    // Đối chứng ÂM trước: cờ TẮT ⇒ khoản COURSE chưa gắn ghi danh KHÔNG xác nhận được (cổng giữ nguyên chữ). Cờ BẬT: xác nhận trước được — xem [NOI-DB-30].
    await datCo(OU1, false);
    const chuaGan = await thu(DON, ITEM_A, TIEN, "PENDING");
    const tuChoi = await confirmPayment({ paymentId: chuaGan.id, confirmedById: KE_TOAN });
    expect(tuChoi.ok).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: chuaGan.id } })).accountantStatus).toBe("PENDING");
    expect(await quyenCua(DON)).toHaveLength(0);
    await db.payment.deleteMany({ where: { orderId: DON } });
    await datCo(OU1, true);

    // Học viên đã có ghi danh cũ ⇒ khoản bám vào ghi danh đó ⇒ xác nhận được.
    await db.orderItem.update({ where: { id: ITEM_A }, data: { studentId: HV_CU } });
    const p = await thu(DON, ITEM_A, TIEN, "PENDING", { enrollmentId: GD_CU });
    const ok = await confirmPayment({ paymentId: p.id, confirmedById: KE_TOAN });
    expect(ok.ok, "fixture: xác nhận phải thành công").toBe(true);
    expect(await quyenCua(DON), "sự kiện chưa được dispatcher giao ⇒ chưa cấp").toHaveLength(0);

    const suKien = await db.domainEvent.findFirstOrThrow({ where: { type: "payment.confirmed", payloadJson: { path: ["orderId"], equals: DON } } });
    const hs = getHandlers("payment.confirmed");
    expect(hs).toHaveLength(1);
    await hs[0]!({ id: suKien.id, type: suKien.type, payload: suKien.payloadJson as Record<string, unknown> });
    expect((await quyenCua(DON)).map((q) => [q.orderItemId, q.studentId, q.status])).toEqual([[ITEM_A, HV_CU, "AWAITING_PLACEMENT"]]);
  });

  it("[NOI-DB-05] `recordPayment` KHÔNG nối (quyết định ghim): ghi tay luôn PENDING nên đóng góp 0 — hích sau khi ghi không cấp; chỉ khi kế toán xác nhận mới cấp", async () => {
    const DON = `${T}don-05`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, studentId: HV_CU }] });
    const r = await recordPayment({
      orderId: DON,
      enrollmentId: GD_CU,
      amount: TIEN,
      method: "cash",
      paidDate: NOW,
      note: "tiền mặt [auto:sepay:fx-noi-khong-co-that]",
      recordedById: SALE,
      centerId: CS1,
    });
    expect(r.ok).toBe(true);
    const khoan = await db.payment.findFirstOrThrow({ where: { orderId: DON } });
    expect(khoan.accountantStatus, "recordPayment luôn tạo PENDING").toBe("PENDING");

    await hichCapQuyenHocChoDon(DON, "GAN_TAY", NOW);
    expect(await quyenCua(DON), "PENDING (kể cả mạo marker ngân hàng) không tính").toHaveLength(0);
    expect(await choCua(DON), "đã biết học viên mà chưa đủ tiền ⇒ không có dòng chờ").toHaveLength(0);

    const ok = await confirmPayment({ paymentId: khoan.id, confirmedById: KE_TOAN });
    expect(ok.ok).toBe(true);
    await hichCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", NOW);
    expect(await quyenCua(DON)).toHaveLength(1);
  });

  it("[NOI-DB-06] GẮN TAY theo con: đơn 2 bé, tiền webhook rơi vào đơn nhiều dòng (orderItemId NULL) ⇒ chưa xác định được dòng; gắn cho bé A ⇒ CHỈ bé A được cấp, bé B không", async () => {
    const DON = `${T}don-06`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }, { id: ITEM_B, studentId: HV_B }] });
    const khoan = await thuNganHang(DON, null, TIEN, "txn-06");
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    expect(await quyenCua(DON), "đơn nhiều dòng, tiền không gắn dòng nào ⇒ không đoán").toHaveLength(0);

    const g = await ganKhoanDaThuChoCon({ orderId: DON, paymentId: khoan.id, orderItemId: ITEM_A, actor: { id: KE_TOAN, name: "Kế toán fixture" } });
    expect(g.ok, "fixture: gắn khoản cho bé A phải thành công").toBe(true);
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", NOW);
    expect((await quyenCua(DON)).map((q) => [q.orderItemId, q.studentId])).toEqual([[ITEM_A, HV_A]]);
  });

  // ═══ 2 · KHÁCH MỚI: CHỜ CHUYỂN ĐỔI ════════════════════════════════════════════════════════════════════════════════

  it("[NOI-DB-07] khách mới chưa có Student + tiền ngân hàng đã đối khớp ⇒ ghi dòng CHO_CHUYEN_DOI (OPEN), KHÔNG có quyền học; gọi lại KHÔNG ghi thêm gì (updatedAt đứng yên)", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-07", 1);
    const DON = `${T}don-07`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-07");

    const kq = await xetCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW, "CAP");
    expect(kq.daCap).toEqual([]);
    expect(kq.chuaCoHocVien).toEqual([ITEM_A]);
    expect(kq.choChuyenDoi).toHaveLength(1);
    expect(await quyenCua(DON), "chưa có Student ⇒ không quyền học active").toHaveLength(0);

    const [cho, ...thua] = await choCua(DON);
    expect(thua).toHaveLength(0);
    expect(cho).toMatchObject({
      loai: "CHO_CHUYEN_DOI",
      trangThai: "OPEN",
      orderId: DON,
      orderItemId: ITEM_A,
      courseId: KHOA,
      leadChildId: conIds[0],
      centerId: CS1,
      orgUnitId: OU1,
      studentId: null,
      entitlementId: null,
      resolvedAt: null,
    });
    expect(cho!.lyDo.length).toBeGreaterThan(20);

    // Idempotent: gọi lại → không dòng mới, không chạm updatedAt, kết quả báo "không đổi".
    const lai = await xetCapQuyenHocChoDon(DON, "GAN_TAY", SAU, "CAP");
    expect(lai.chuaCoHocVien).toEqual([ITEM_A]);
    expect(lai.choChuyenDoi, "không có gì đổi ⇒ không ghi").toEqual([]);
    const [sau, ...thua2] = await choCua(DON);
    expect(thua2).toHaveLength(0);
    expect(sau!.updatedAt.toISOString()).toBe(cho!.updatedAt.toISOString());
  });

  it("[NOI-DB-08] SAU CHUYỂN ĐỔI (mô phỏng đúng thứ `convertLeadV2` để lại): hích theo lead ⇒ cấp quyền học đúng học viên, đúng dòng; dòng chờ đóng DA_XU_LY CÙNG giao dịch; hích lần nữa không cấp đôi", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-08", 1);
    const DON = `${T}don-08`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-08");
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    expect((await choCua(DON))[0]?.trangThai).toBe("OPEN");
    expect(await quyenCua(DON)).toHaveLength(0);

    // Chưa Chuyển đổi mà hích theo lead ⇒ vẫn chờ.
    await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", NOW);
    expect(await quyenCua(DON)).toHaveLength(0);

    const hv = await giaLapConvert(conIds[0]!, KHOA, "convert-08");
    // Hình dạng THẬT sau `convertLeadV2`: dòng đơn VẪN chưa có studentId / enrollmentId.
    const dong = await db.orderItem.findUniqueOrThrow({ where: { id: ITEM_A } });
    expect({ studentId: dong.studentId, enrollmentId: dong.enrollmentId }).toEqual({ studentId: null, enrollmentId: null });

    await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", SAU);
    const quyen = await quyenCua(DON);
    expect(quyen.map((q) => [q.orderItemId, q.studentId, q.courseId, q.status])).toEqual([[ITEM_A, hv, KHOA, "AWAITING_PLACEMENT"]]);
    const [cho] = await choCua(DON);
    expect(cho).toMatchObject({ trangThai: "DA_XU_LY", studentId: hv, entitlementId: quyen[0]!.id });
    expect(cho!.resolvedAt?.toISOString()).toBe(SAU.toISOString());

    await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", SAU);
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", SAU);
    expect(await quyenCua(DON), "hích lại không cấp đôi").toHaveLength(1);
    expect(await choCua(DON)).toHaveLength(1);
  });

  it("[NOI-DB-09] Chuyển đổi kiểu `chuyenDoiDonAction` (ghi OrderItem.studentId + enrollmentId): hích theo đơn ⇒ cấp cho đúng học viên đó, đóng dòng chờ", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-09", 1);
    const DON = `${T}don-09`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-09");
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    expect((await choCua(DON))[0]?.trangThai).toBe("OPEN");

    await db.orderItem.update({ where: { id: ITEM_A }, data: { studentId: HV_B } });
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DON)).map((q) => [q.studentId, q.status])).toEqual([[HV_B, "AWAITING_PLACEMENT"]]);
    expect((await choCua(DON))[0]).toMatchObject({ trangThai: "DA_XU_LY", studentId: HV_B });
  });

  it("[NOI-DB-10] MƠ HỒ KHÔNG ĐOÁN: con lead khớp HAI hồ sơ học viên ⇒ vẫn chờ, lý do nói rõ; người vận hành gắn học viên vào dòng ⇒ tự cấp đúng người", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-10", 1);
    const DON = `${T}don-10`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-10");
    const hv1 = await giaLapConvert(conIds[0]!, KHOA, "mo-ho-1");
    const hv2 = (await db.student.create({ data: { id: `${T}hv-mo-ho-2`, name: `${T}mo-ho-2`, centerId: CS1, status: "ACTIVE", leadChildId: conIds[0] } })).id;
    expect(hv1).not.toBe(hv2);

    const kq = await xetCapQuyenHocChoDon(DON, "CHUYEN_DOI", NOW, "CAP");
    expect(kq.daCap).toEqual([]);
    expect(await quyenCua(DON)).toHaveLength(0);
    const [cho] = await choCua(DON);
    expect(cho).toMatchObject({ trangThai: "OPEN", loai: "CHO_CHUYEN_DOI" });
    expect(cho!.lyDo).toMatch(/2 hồ sơ học viên/);

    await db.orderItem.update({ where: { id: ITEM_A }, data: { studentId: hv2 } });
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DON)).map((q) => q.studentId)).toEqual([hv2]);
    expect((await choCua(DON))[0]).toMatchObject({ trangThai: "DA_XU_LY", studentId: hv2 });
  });

  it("[NOI-DB-11] ĐA CON / ĐA KHOÁ: mỗi dòng một dòng chờ, một quyền học đúng khoá — Chuyển đổi bé A chỉ cấp A, bé B vẫn chờ rồi mới cấp", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-11", 2);
    const DON = `${T}don-11`;
    await dungDon({
      id: DON,
      leadId,
      dong: [
        { id: ITEM_A, studentId: null, courseId: KHOA, leadChildId: conIds[0] },
        { id: ITEM_B, studentId: null, courseId: KHOA_2, leadChildId: conIds[1] },
      ],
    });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-11a");
    await thuNganHang(DON, ITEM_B, TIEN, "txn-11b");
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    expect((await choCua(DON)).map((c) => [c.orderItemId, c.courseId, c.leadChildId, c.trangThai]).sort()).toEqual(
      [[ITEM_A, KHOA, conIds[0], "OPEN"], [ITEM_B, KHOA_2, conIds[1], "OPEN"]].sort(),
    );
    expect(await quyenCua(DON)).toHaveLength(0);

    const hvA = await giaLapConvert(conIds[0]!, KHOA, "da-con-a");
    await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DON)).map((q) => [q.orderItemId, q.studentId, q.courseId])).toEqual([[ITEM_A, hvA, KHOA]]);
    const sauA = Object.fromEntries((await choCua(DON)).map((c) => [c.orderItemId, c.trangThai]));
    expect(sauA).toEqual({ [ITEM_A]: "DA_XU_LY", [ITEM_B]: "OPEN" });

    const hvB = await giaLapConvert(conIds[1]!, KHOA_2, "da-con-b");
    await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DON)).map((q) => [q.orderItemId, q.studentId, q.courseId]).sort()).toEqual([[ITEM_A, hvA, KHOA], [ITEM_B, hvB, KHOA_2]].sort());
    expect((await choCua(DON)).every((c) => c.trangThai === "DA_XU_LY")).toBe(true);
  });

  it("[NOI-DB-11b] cầu nối con lead lọc theo KHOÁ: cùng một con có ghi danh ở khoá KHÁC của học viên khác ⇒ KHÔNG làm dòng này mơ hồ (chọn đúng học viên của khoá đang mua)", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-11b", 1);
    const DON = `${T}don-11b`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, courseId: KHOA, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-11b2");
    const dung = await giaLapConvert(conIds[0]!, KHOA, "khoa-dung-11b");
    // Một học viên KHÁC có ghi danh mang cùng leadChildId nhưng ở khoá khác (hình dạng một lần chốt cũ khử trùng hỏng) — không có Student.leadChildId.
    const khac = (await db.student.create({ data: { id: `${T}hv-khoa-khac-11b`, name: `${T}khoa-khac`, centerId: CS1, status: "ACTIVE" } })).id;
    await db.enrollment.create({ data: { id: `${T}gd-khoa-khac-11b`, studentId: khac, classId: LOP_CU, courseId: KHOA_2, centerId: CS1, status: "STUDYING", leadChildId: conIds[0] } });

    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DON)).map((q) => [q.studentId, q.courseId])).toEqual([[dung, KHOA]]);
    expect((await choCua(DON)).length === 0 || (await choCua(DON))[0]!.trangThai === "DA_XU_LY").toBe(true);
  });

  it("[NOI-DB-12] đơn thường của chính lead đó KHÔNG bị kéo vào: hích theo lead chỉ xét đơn có dấu SCOPE", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-12", 1);
    const SCOPE = `${T}don-12s`;
    const THUONG = `${T}don-12t`;
    await dungDon({ id: SCOPE, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await dungDon({ id: THUONG, leadId, dong: [{ id: ITEM_B, studentId: null, metadata: { courseId: KHOA, soBuoi: 48, leadChildId: conIds[0] } }] });
    await thuNganHang(SCOPE, ITEM_A, TIEN, "txn-12s");
    await thuNganHang(THUONG, ITEM_B, TIEN, "txn-12t");
    await giaLapConvert(conIds[0]!, KHOA, "don-thuong-12");
    await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", SAU);
    expect(await quyenCua(SCOPE)).toHaveLength(1);
    expect(await quyenCua(THUONG), "đơn thường: không bao giờ có quyền học").toHaveLength(0);
    expect(await choCua(THUONG)).toHaveLength(0);
  });

  // ═══ 3 · TIỀN MẤT / KHÔNG HỢP LỆ ⇒ KHÔNG CẤP MỚI, KHÔNG TẠO DÒNG CHỜ ══════════════════════════════════════════════

  it("[NOI-DB-13] tiền KHÔNG còn đủ khi dòng đang chờ (kế toán từ chối khoản) ⇒ dòng chờ đóng HUY, không cấp; tiền về lại ⇒ MỞ LẠI cùng dòng (không dòng thứ hai)", async () => {
    const { conIds } = await dungLead("khach-moi-13", 1);
    const DON = `${T}don-13`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    const p = await thu(DON, ITEM_A, TIEN, DA_XAC_NHAN);
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    const [cho0] = await choCua(DON);
    expect(cho0?.trangThai).toBe("OPEN");

    await db.payment.update({ where: { id: p.id }, data: { accountantStatus: "REJECTED" } });
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", SAU);
    const [cho1, ...thua] = await choCua(DON);
    expect(thua).toHaveLength(0);
    expect(cho1).toMatchObject({ id: cho0!.id, trangThai: "HUY" });
    expect(cho1!.resolvedNote, "lý do ĐÓNG nằm ở resolvedNote, lý do CHỜ giữ nguyên ở lyDo").toMatch(/không còn đủ/);
    expect(await quyenCua(DON)).toHaveLength(0);

    await db.payment.update({ where: { id: p.id }, data: { accountantStatus: DA_XAC_NHAN } });
    await hichCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", SAU);
    const [cho2, ...thua2] = await choCua(DON);
    expect(thua2).toHaveLength(0);
    expect(cho2).toMatchObject({ id: cho0!.id, trangThai: "OPEN", resolvedAt: null });
  });

  it("[NOI-DB-14] payment REJECTED / chưa xác nhận / hoàn tiền / đơn HUỶ ⇒ KHÔNG cấp mới và KHÔNG tạo dòng chờ (đối chứng dương: tiền xác nhận đủ cùng đơn ⇒ có dòng chờ)", async () => {
    const { conIds } = await dungLead("khach-moi-14", 1);
    const mo = (id: string, status: DonFx["status"] = "PENDING_PAYMENT") =>
      dungDon({ id, status, dong: [{ id: `${ITEM_A}-${id.slice(-3)}`, studentId: null, leadChildId: conIds[0] }] });

    // REJECTED
    const D1 = `${T}don-14a`;
    await mo(D1);
    await thu(D1, `${ITEM_A}-14a`, TIEN, "REJECTED");
    // PENDING tiền mặt (chưa ai xác nhận)
    const D2 = `${T}don-14b`;
    await mo(D2);
    await thu(D2, `${ITEM_A}-14b`, TIEN, "PENDING");
    // HOÀN TIỀN thật: xác nhận đủ rồi hoàn 1.000đ ⇒ thiếu
    const D3 = `${T}don-14c`;
    await mo(D3);
    const goc = await thu(D3, `${ITEM_A}-14c`, TIEN, DA_XAC_NHAN);
    const hoan = await refundPayment({ paymentId: goc.id, confirmedById: KE_TOAN, reason: "Hoàn một phần theo yêu cầu phụ huynh", amount: 1_000 });
    expect(hoan.ok, "fixture: hoàn tiền thật phải thành công").toBe(true);
    // ĐƠN HUỶ
    const D4 = `${T}don-14d`;
    await mo(D4, "CANCELLED");
    await thu(D4, `${ITEM_A}-14d`, TIEN, DA_XAC_NHAN);
    for (const d of [D1, D2, D3, D4]) {
      await hichCapQuyenHocChoDon(d, "GAN_TAY", NOW);
      expect({ don: d, quyen: await quyenCua(d), cho: await choCua(d) }, d).toEqual({ don: d, quyen: [], cho: [] });
    }

    // Đối chứng dương: cùng cách dựng, tiền xác nhận đủ ⇒ có dòng chờ.
    const D5 = `${T}don-14e`;
    await mo(D5);
    await thu(D5, `${ITEM_A}-14e`, TIEN, DA_XAC_NHAN);
    await hichCapQuyenHocChoDon(D5, "GAN_TAY", NOW);
    expect((await choCua(D5)).map((c) => c.trangThai)).toEqual(["OPEN"]);
  });

  it("[NOI-DB-15] dấu SCOPE giả (không khớp tiền thật của dòng) ⇒ không cấp, không tạo dòng chờ; dòng chờ đang mở gặp dấu hỏng ⇒ đóng HUY", async () => {
    const { conIds } = await dungLead("khach-moi-15", 1);
    const DON = `${T}don-15`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thu(DON, ITEM_A, TIEN, DA_XAC_NHAN);
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", NOW);
    expect((await choCua(DON))[0]?.trangThai).toBe("OPEN");

    // Dòng bị sửa tay: giá khác dấu SCOPE.
    await db.orderItem.update({ where: { id: ITEM_A }, data: { unitPrice: 1_000_000, totalPrice: 1_000_000 } });
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", SAU);
    expect(await quyenCua(DON)).toHaveLength(0);
    expect((await choCua(DON))[0]).toMatchObject({ trangThai: "HUY" });
  });

  // ═══ 4 · ĐỒNG THỜI + CỜ ═══════════════════════════════════════════════════════════════════════════════════════════

  it("[NOI-DB-16] 5 lượt đồng thời trên khách mới ⇒ đúng MỘT dòng chờ; sau Chuyển đổi, 5 lượt đồng thời ⇒ đúng MỘT quyền học, dòng chờ DA_XU_LY; không P2002 nổi lên, không treo bể kết nối", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-16", 1);
    const DON = `${T}don-16`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-16");

    const ketQua = await Promise.all(Array.from({ length: 5 }, (_, i) => xetCapQuyenHocChoDon(DON, "WEBHOOK_CU", new Date(NOW.getTime() + i), "CAP")));
    expect(ketQua.every((k) => k.chuaCoHocVien.length === 1)).toBe(true);
    expect(await choCua(DON), "5 lượt cùng lúc ⇒ một dòng chờ").toHaveLength(1);
    expect(ketQua.filter((k) => k.choChuyenDoi.length > 0), "đúng MỘT lượt thực sự tạo dòng").toHaveLength(1);

    await giaLapConvert(conIds[0]!, KHOA, "dong-thoi-16");
    const sau = await Promise.all(Array.from({ length: 5 }, (_, i) => xetCapQuyenHocChoDon(DON, "CHUYEN_DOI", new Date(SAU.getTime() + i), "CAP")));
    expect(sau.flatMap((k) => k.daCap), "đúng MỘT lượt cấp").toHaveLength(1);
    expect(await quyenCua(DON)).toHaveLength(1);
    const cho = await choCua(DON);
    expect(cho).toHaveLength(1);
    expect(cho[0]!.trangThai).toBe("DA_XU_LY");
  });

  it("[NOI-DB-17] CỜ TẮT (tắt / chưa đặt / chỉ bật ở cơ sở khác) ⇒ khách mới đủ tiền KHÔNG sinh dòng chờ; đếm hàng quyền học + dòng chờ + AuditLog + DomainEvent trước/sau KHÔNG đổi", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-17", 1);
    const DON = `${T}don-17`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-17");
    const ou2 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    for (const [ten, dat] of [
      ["tắt hẳn", async () => datCo(OU1, false)],
      ["chưa đặt", async () => datCo(OU1, null)],
      ["chỉ bật ở cơ sở khác", async () => { await datCo(OU1, null); await datCo(ou2, true); }],
    ] as const) {
      await dat();
      const truoc = await demHang();
      await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
      await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", NOW);
      expect({ ten, ...(await demHang()) }, ten).toEqual({ ten, ...truoc });
    }
    await datCo(ou2, null);
    await datCo(OU1, true);
    // Đối chứng dương: bật cờ thì cùng đơn ấy ghi dòng chờ.
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    expect((await choCua(DON)).map((c) => c.trangThai)).toEqual(["OPEN"]);
  });

  it("[NOI-DB-18] vỏ KHÔNG BAO GIỜ NÉM: đơn / lead không tồn tại đều trả bình thường, không để lại gì", async () => {
    await expect(hichCapQuyenHocChoDon(`${T}khong-co-don`, "WEBHOOK_CU", NOW)).resolves.toBeUndefined();
    await expect(hichCapQuyenHocChoLead(`${T}khong-co-lead`, "CHUYEN_DOI", NOW)).resolves.toBeUndefined();
  });

  it("[NOI-DB-19] đường LỊCH SỬ không cấp: đơn nhập lịch sử (ghi-giao-dich-cu / backfill-order) không mang dấu SCOPE và không đi qua vỏ hích ⇒ không quyền học dù cờ BẬT", async () => {
    // Đơn lịch sử: Payment CONFIRMED đủ tiền, KHÔNG dấu SCOPE (đúng hình dạng hai script nhập đó tạo ra).
    const DON = `${T}don-19`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, metadata: { courseId: KHOA }, studentId: HV_A }] });
    await thu(DON, ITEM_A, TIEN, DA_XAC_NHAN);
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", NOW);
    expect(await quyenCua(DON)).toHaveLength(0);
    expect(await choCua(DON)).toHaveLength(0);
  });

  // ═══ 5 · CHIỀU NGƯỢC: tiền mất SAU khi đã cấp ⇒ ĐÁNH DẤU, KHÔNG xoá / huỷ quyền học ═════════════════════════════════════

  /** Đơn SCOPE của khách cũ (HV_A) đã đủ tiền xác nhận và ĐÃ được cấp quyền học. Trả về khoản tiền + quyền học. */
  async function donDaCapQuyen(id: string, itemId: string = ITEM_A) {
    await dungDon({ id, dong: [{ id: itemId }] });
    const khoan = await thu(id, itemId, TIEN, DA_XAC_NHAN);
    await hichCapQuyenHocChoDon(id, "KE_TOAN_XAC_NHAN", NOW);
    const [q, ...thua] = await quyenCua(id);
    expect(thua, "fixture: đúng một quyền học").toHaveLength(0);
    expect(q, "fixture: quyền học phải được cấp").toBeDefined();
    return { khoan, quyen: q! };
  }
  const xuLyCua = (orderId: string) => db.studyEntitlementXuLy.findMany({ where: { orderId }, orderBy: [{ loai: "asc" }, { createdAt: "asc" }] });
  /** Giao ĐÚNG sự kiện đã phát (qua handler đã đăng ký) — như dispatcher làm. */
  async function giaoSuKien(type: string, orderId: string) {
    const ev = await db.domainEvent.findFirstOrThrow({ where: { type, payloadJson: { path: ["orderId"], equals: orderId } }, orderBy: { createdAt: "desc" } });
    const hs = getHandlers(type);
    expect({ type, soHandler: hs.length }).toEqual({ type, soHandler: 1 });
    await hs[0]!({ id: ev.id, type: ev.type, payload: ev.payloadJson as Record<string, unknown> });
  }
  const dongQuyenKhongDoi = async (truoc: { id: string; status: string; netAmount: number }) => {
    const sau = await db.studyEntitlement.findUniqueOrThrow({ where: { id: truoc.id } });
    expect({ id: sau.id, status: sau.status, netAmount: sau.netAmount }, "quyền học KHÔNG bị xoá / huỷ / đổi").toEqual({ id: truoc.id, status: truoc.status, netAmount: truoc.netAmount });
  };

  it("[NOI-DB-21] kế toán TỪ CHỐI khoản sau khi đã cấp, CHƯA học buổi nào ⇒ dòng CAN_THU_HOI (OPEN); quyền học KHÔNG bị xoá / huỷ / đổi", async () => {
    const DON = `${T}don-21`;
    const { khoan, quyen } = await donDaCapQuyen(DON);
    const r = await rejectPaymentThat(khoan.id);
    expect(r.ok, "fixture: từ chối thật phải thành công").toBe(true);
    await giaoSuKien("payment.rejected", DON);

    const xl = await xuLyCua(DON);
    expect(xl.map((x) => [x.loai, x.trangThai])).toEqual([["CAN_THU_HOI", "OPEN"]]);
    expect(xl[0]).toMatchObject({ orderItemId: ITEM_A, studentId: HV_A, entitlementId: quyen.id, centerId: CS1, orgUnitId: OU1, courseId: KHOA });
    expect(xl[0]!.lyDo).toMatch(/thiếu 8976000đ/);
    await dongQuyenKhongDoi(quyen);
    expect(await quyenCua(DON)).toHaveLength(1);
  });

  it("[NOI-DB-22] ĐÃ có buổi tiêu thụ (dòng sổ cái chưa vô hiệu) ⇒ TREO_DUYET_TAY, KHÔNG CAN_THU_HOI; sổ cái chưa có buổi nhưng cache consumedSessions > 0 cũng treo (nghiêng về thận trọng)", async () => {
    const D1 = `${T}don-22a`;
    const a = await donDaCapQuyen(D1);
    await db.studyEntitlementUsage.create({ data: { entitlementId: a.quyen.id, studentId: HV_A, lessonOrder: 1, source: "CLASS" } });
    await rejectPaymentThat(a.khoan.id);
    await giaoSuKien("payment.rejected", D1);
    expect((await xuLyCua(D1)).map((x) => [x.loai, x.trangThai])).toEqual([["TREO_DUYET_TAY", "OPEN"]]);
    await dongQuyenKhongDoi(a.quyen);

    // Dòng sổ cái đã VÔ HIỆU (voidedAt) không tính là đã học ⇒ CAN_THU_HOI.
    const D2 = `${T}don-22b`;
    const b = await donDaCapQuyen(D2, `${ITEM_A}-22b`);
    await db.studyEntitlementUsage.create({
      data: { entitlementId: b.quyen.id, studentId: HV_A, lessonOrder: 1, source: "CLASS", voidedAt: NOW, voidReason: "sửa điểm danh" },
    });
    await rejectPaymentThat(b.khoan.id);
    await giaoSuKien("payment.rejected", D2);
    expect((await xuLyCua(D2)).map((x) => [x.loai, x.trangThai])).toEqual([["CAN_THU_HOI", "OPEN"]]);
  });

  it("[NOI-DB-23] HOÀN TIỀN một phần thật (`refundPayment`) ⇒ dòng CAN_THU_HOI nói đúng số thiếu; hoàn thêm ⇒ CHÍNH dòng đó đổi lý do (không dòng thứ hai)", async () => {
    const DON = `${T}don-23`;
    const { khoan, quyen } = await donDaCapQuyen(DON);
    const h1 = await refundPayment({ paymentId: khoan.id, confirmedById: KE_TOAN, reason: "Hoàn một phần theo yêu cầu phụ huynh", amount: 1_000 });
    expect(h1.ok, "fixture: hoàn tiền thật phải thành công").toBe(true);
    await giaoSuKien("payment.refunded", DON);
    const [x1, ...thua1] = await xuLyCua(DON);
    expect(thua1).toHaveLength(0);
    expect(x1).toMatchObject({ loai: "CAN_THU_HOI", trangThai: "OPEN" });
    expect(x1!.lyDo).toMatch(/thiếu 1000đ/);

    // Hoàn thêm bằng một dòng hoàn thứ hai (dòng âm trỏ về khoản gốc) — hình dạng chi hoàn tiền để lại.
    await db.payment.create({
      data: { orderId: DON, orderItemId: null, amount: -500, method: "cash", paidDate: NOW, note: "hoàn thêm", saleStatus: "RECORDED", accountantStatus: "REFUNDED", adjustmentOfId: khoan.id, centerId: CS1 },
    });
    await hichCapQuyenHocChoDon(DON, "TIEN_BI_HOAN", SAU);
    const [x2, ...thua2] = await xuLyCua(DON);
    expect(thua2, "một dòng cho mỗi (dòng đơn, loại)").toHaveLength(0);
    expect(x2!.id).toBe(x1!.id);
    expect(x2!.lyDo).toMatch(/thiếu 1500đ/);
    await dongQuyenKhongDoi(quyen);
  });

  it("[NOI-DB-24] tiền ĐỦ LẠI ⇒ dòng đóng HUY (quyền học vẫn nguyên); bị đảo lần nữa ⇒ MỞ LẠI cùng dòng", async () => {
    const DON = `${T}don-24`;
    const { khoan, quyen } = await donDaCapQuyen(DON);
    await rejectPaymentThat(khoan.id);
    await hichCapQuyenHocChoDon(DON, "TIEN_BI_TU_CHOI", NOW);
    const [mo] = await xuLyCua(DON);
    expect(mo).toMatchObject({ loai: "CAN_THU_HOI", trangThai: "OPEN" });

    await db.payment.update({ where: { id: khoan.id }, data: { accountantStatus: DA_XAC_NHAN } });
    await hichCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", SAU);
    const [dong] = await xuLyCua(DON);
    expect(dong).toMatchObject({ id: mo!.id, trangThai: "HUY" });
    expect(dong!.resolvedNote).toMatch(/đã đủ lại/);
    await dongQuyenKhongDoi(quyen);

    await db.payment.update({ where: { id: khoan.id }, data: { accountantStatus: "REJECTED" } });
    await hichCapQuyenHocChoDon(DON, "TIEN_BI_TU_CHOI", SAU);
    const xl = await xuLyCua(DON);
    expect(xl).toHaveLength(1);
    expect(xl[0]).toMatchObject({ id: mo!.id, trangThai: "OPEN", resolvedAt: null });
  });

  it("[NOI-DB-25] buổi tiêu thụ XUẤT HIỆN SAU khi đã đánh dấu CAN_THU_HOI ⇒ CAN_THU_HOI đóng HUY và TREO_DUYET_TAY mở (mỗi loại tối đa một dòng)", async () => {
    const DON = `${T}don-25`;
    const { khoan, quyen } = await donDaCapQuyen(DON);
    await rejectPaymentThat(khoan.id);
    await hichCapQuyenHocChoDon(DON, "TIEN_BI_TU_CHOI", NOW);
    expect((await xuLyCua(DON)).map((x) => [x.loai, x.trangThai])).toEqual([["CAN_THU_HOI", "OPEN"]]);

    await db.studyEntitlementUsage.create({ data: { entitlementId: quyen.id, studentId: HV_A, lessonOrder: 1, source: "CLASS" } });
    await hichCapQuyenHocChoDon(DON, "TIEN_BI_TU_CHOI", SAU);
    expect((await xuLyCua(DON)).map((x) => [x.loai, x.trangThai])).toEqual([["CAN_THU_HOI", "HUY"], ["TREO_DUYET_TAY", "OPEN"]]);
    await dongQuyenKhongDoi(quyen);
  });

  it("[NOI-DB-26] 5 lượt chiều ngược ĐỒNG THỜI ⇒ đúng MỘT dòng; không P2002 nổi lên, không treo bể kết nối", async () => {
    const DON = `${T}don-26`;
    const { khoan, quyen } = await donDaCapQuyen(DON);
    await rejectPaymentThat(khoan.id);
    const kq = await Promise.all(Array.from({ length: 5 }, (_, i) => xetCapQuyenHocChoDon(DON, "TIEN_BI_TU_CHOI", new Date(NOW.getTime() + i), "CAP")));
    expect(kq.filter((k) => k.chieuNguoc.length > 0), "đúng MỘT lượt thực sự tạo dòng").toHaveLength(1);
    const xl = await xuLyCua(DON);
    expect(xl.map((x) => [x.loai, x.trangThai])).toEqual([["CAN_THU_HOI", "OPEN"]]);
    await dongQuyenKhongDoi(quyen);
  });

  it("[NOI-DB-27] CỜ TẮT ⇒ tiền bị đảo sau khi đã cấp KHÔNG ghi dòng xử lý nào (đếm hàng quyền học + dòng xử lý + AuditLog + DomainEvent trước/sau)", async () => {
    const DON = `${T}don-27`;
    const { khoan } = await donDaCapQuyen(DON);
    await rejectPaymentThat(khoan.id);
    for (const [ten, dat] of [["tắt hẳn", async () => datCo(OU1, false)], ["chưa đặt", async () => datCo(OU1, null)]] as const) {
      await dat();
      const truoc = await demHang();
      await hichCapQuyenHocChoDon(DON, "TIEN_BI_TU_CHOI", SAU);
      expect({ ten, ...(await demHang()) }, ten).toEqual({ ten, ...truoc });
    }
    expect(await xuLyCua(DON)).toHaveLength(0);
  });

  it("[NOI-DB-28] ĐƠN BỊ HUỶ / HOÀN sau khi đã cấp ⇒ CAN_THU_HOI (chưa học) hoặc TREO_DUYET_TAY (đã học); dòng CHỜ đang mở của khách mới ⇒ đóng HUY; cấp mới ⇒ không", async () => {
    const { conIds } = await dungLead("khach-moi-28", 1);
    const DON = `${T}don-28`;
    await dungDon({
      id: DON,
      dong: [
        { id: ITEM_A }, // khách cũ, đã cấp
        { id: ITEM_B, studentId: null, courseId: KHOA_2, leadChildId: conIds[0] }, // khách mới, đang CHỜ
      ],
    });
    await thu(DON, ITEM_A, TIEN, DA_XAC_NHAN);
    await thuNganHang(DON, ITEM_B, TIEN, "txn-28");
    await hichCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(DON);
    expect((await xuLyCua(DON)).map((x) => [x.orderItemId, x.loai, x.trangThai])).toEqual([[ITEM_B, "CHO_CHUYEN_DOI", "OPEN"]]);

    await db.studyEntitlementUsage.create({ data: { entitlementId: q!.id, studentId: HV_A, lessonOrder: 1, source: "CLASS" } });
    await db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });
    await giaoSuKienVoided(DON, "CANCELLED");
    const xl = await xuLyCua(DON);
    expect(xl.map((x) => [x.orderItemId, x.loai, x.trangThai])).toEqual([
      [ITEM_B, "CHO_CHUYEN_DOI", "HUY"],
      [ITEM_A, "TREO_DUYET_TAY", "OPEN"],
    ]);
    expect(xl.find((x) => x.orderItemId === ITEM_A)!.lyDo).toMatch(/Đơn đã huỷ/);
    expect(await quyenCua(DON), "đơn huỷ không cấp thêm quyền học").toHaveLength(1);
    await dongQuyenKhongDoi(q!);
  });

  it("[NOI-DB-29] tiền MƠ HỒ (khoản chưa gắn dòng nào ở đơn nhiều dòng) ⇒ KHÔNG kết luận thiếu tiền, KHÔNG ghi dòng chiều ngược", async () => {
    const DON = `${T}don-29`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }, { id: ITEM_B, studentId: HV_B }] });
    const a = await thu(DON, ITEM_A, TIEN, DA_XAC_NHAN);
    await hichCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", NOW);
    expect(await quyenCua(DON)).toHaveLength(1);
    // Khoản của dòng A bị từ chối, và một khoản CONFIRMED khác KHÔNG gắn dòng nào xuất hiện ⇒ không chứng minh được dòng A thiếu.
    await db.payment.update({ where: { id: a.id }, data: { accountantStatus: "REJECTED" } });
    await thu(DON, null, TIEN, DA_XAC_NHAN);
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", SAU);
    expect(await xuLyCua(DON), "mơ hồ ⇒ không đổi gì").toHaveLength(0);
  });

  // ═══ 6 · XÁC NHẬN TRƯỚC KHI CÓ GHI DANH (deadlock CHUA_GHI_DANH, chủ dự án 11/10/2026) ═════════════════════════════════

  it("[NOI-DB-30] khách MỚI, đơn SCOPE, cờ BẬT: kế toán xác nhận khoản CHƯA gắn ghi danh được ⇒ KHÔNG Enrollment / buổi / sổ tiêu thụ / quyền học; dòng CHỜ; sau Chuyển đổi ⇒ cấp", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-30", 1);
    const DON = `${T}don-30`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    const khoan = await thu(DON, ITEM_A, TIEN, "PENDING");
    expect(khoan.enrollmentId).toBeNull();
    const truoc = {
      gd: await db.enrollment.count(),
      buoi: await db.classSession.count(),
      usage: await db.studyEntitlementUsage.count(),
      quyen: await db.studyEntitlement.count(),
    };

    const r = await confirmPayment({ paymentId: khoan.id, confirmedById: KE_TOAN });
    expect(r.ok, "cờ BẬT + đơn SCOPE ⇒ xác nhận trước được").toBe(true);
    const sau = await db.payment.findUniqueOrThrow({ where: { id: khoan.id }, include: { receipts: true } });
    expect(sau.accountantStatus).toBe(DA_XAC_NHAN);
    expect(sau.enrollmentId, "vẫn chưa ghi danh").toBeNull();
    expect(sau.receipts.map((x) => [x.status, x.enrollmentId])).toEqual([["ACTIVE", null]]);

    await giaoSuKien("payment.confirmed", DON);
    expect({
      gd: await db.enrollment.count(),
      buoi: await db.classSession.count(),
      usage: await db.studyEntitlementUsage.count(),
      quyen: await db.studyEntitlement.count(),
    }, "KHÔNG thêm lớp, KHÔNG buổi, KHÔNG sổ tiêu thụ, KHÔNG quyền học active").toEqual(truoc);
    expect((await choCua(DON)).map((c) => c.trangThai), "tiền đã xác nhận, chờ Chuyển đổi").toEqual(["OPEN"]);

    await giaLapConvert(conIds[0]!, KHOA, "xac-nhan-truoc-30");
    await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DON)).map((q) => [q.orderItemId, q.status])).toEqual([[ITEM_A, "AWAITING_PLACEMENT"]]);
    expect((await choCua(DON))[0]!.trangThai).toBe("DA_XU_LY");
  });

  it("[NOI-DB-31] khách CŨ (đã biết học viên, chưa ghi danh khoá này): xác nhận trước ⇒ cấp quyền học AWAITING_PLACEMENT NGAY, vẫn KHÔNG Enrollment / buổi", async () => {
    const DON = `${T}don-31`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, studentId: HV_B }] });
    const khoan = await thu(DON, ITEM_A, TIEN, "PENDING");
    const gdTruoc = await db.enrollment.count();
    const r = await confirmPayment({ paymentId: khoan.id, confirmedById: KE_TOAN });
    expect(r.ok).toBe(true);
    await giaoSuKien("payment.confirmed", DON);
    expect((await quyenCua(DON)).map((q) => [q.studentId, q.status, q.enrollmentId, q.classId])).toEqual([[HV_B, "AWAITING_PLACEMENT", null, null]]);
    expect(await db.enrollment.count()).toBe(gdTruoc);
  });

  it("[NOI-DB-32] ĐỐI CHỨNG cổng giữ nguyên chữ: cờ TẮT / chưa đặt / đơn THƯỜNG cờ BẬT / đơn đã HUỶ ⇒ khoản chưa gắn ghi danh VẪN bị từ chối (CHUA_GHI_DANH); tập `donChoXacNhanTruocGhiDanh` chỉ có đơn SCOPE+BẬT", async () => {
    const SCOPE = `${T}don-32s`;
    const THUONG = `${T}don-32t`;
    const HUY = `${T}don-32h`;
    await dungDon({ id: SCOPE, dong: [{ id: ITEM_A }] });
    await dungDon({ id: THUONG, dong: [{ id: ITEM_B, metadata: { courseId: KHOA, soBuoi: 48 }, studentId: HV_B }] });
    await dungDon({ id: HUY, status: "CANCELLED", dong: [{ id: `${ITEM_A}-h` }] });
    expect([...(await donChoXacNhanTruocGhiDanh([SCOPE, THUONG, HUY, "khong-co-don", ""]))].sort(), "SCOPE + cờ BẬT").toEqual([SCOPE]);

    const khoanThuong = await thu(THUONG, ITEM_B, TIEN, "PENDING");
    expect((await confirmPayment({ paymentId: khoanThuong.id, confirmedById: KE_TOAN })).ok, "đơn thường, cờ BẬT").toBe(false);
    const khoanHuy = await thu(HUY, `${ITEM_A}-h`, TIEN, "PENDING");
    expect((await confirmPayment({ paymentId: khoanHuy.id, confirmedById: KE_TOAN })).ok, "đơn đã huỷ").toBe(false);

    const khoanScope = await thu(SCOPE, ITEM_A, TIEN, "PENDING");
    for (const [ten, dat] of [["tắt hẳn", async () => datCo(OU1, false)], ["chưa đặt", async () => datCo(OU1, null)]] as const) {
      await dat();
      expect([...(await donChoXacNhanTruocGhiDanh([SCOPE]))], ten).toEqual([]);
      const r = await confirmPayment({ paymentId: khoanScope.id, confirmedById: KE_TOAN });
      expect(r.ok, `đơn SCOPE, cờ ${ten}`).toBe(false);
      expect((await db.payment.findUniqueOrThrow({ where: { id: khoanScope.id } })).accountantStatus, ten).toBe("PENDING");
    }
    // Đối chứng dương cho cả ba: bật cờ ⇒ đúng khoản đó xác nhận được.
    await datCo(OU1, true);
    expect((await confirmPayment({ paymentId: khoanScope.id, confirmedById: KE_TOAN })).ok).toBe(true);
  });

  it("[NOI-DB-33] CHUYỂN ĐỔI sau khi đã xác nhận trước ghi danh: `linkRecordedPaymentsToEnrollments` KHÔNG ném và KHÔNG chạm khoản CONFIRMED của đơn SCOPE; khoản PENDING cùng lead vẫn được gắn ghi danh; đơn THƯỜNG gặp khoản CONFIRMED chưa ghi danh vẫn bị chốt chặn NÉM như cũ", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-33", 1);
    const SCOPE = `${T}don-33s`;
    const CHO_GAN = `${T}don-33g`;
    await dungDon({ id: SCOPE, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await dungDon({ id: CHO_GAN, leadId, dong: [{ id: ITEM_B, studentId: null, metadata: { courseId: KHOA, soBuoi: 48 } }] });
    const daXacNhan = await thu(SCOPE, ITEM_A, TIEN, DA_XAC_NHAN); // xác nhận TRƯỚC ghi danh (cờ BẬT)
    const choGan = await thu(CHO_GAN, ITEM_B, TIEN, "PENDING");
    const hv = await giaLapConvert(conIds[0]!, KHOA, "link-33");
    const gd = `${T}gd-link-33`;

    const kq = await db.$transaction((tx) =>
      linkRecordedPaymentsToEnrollments(tx, {
        leadId,
        ghiDanh: [{ enrollmentId: gd, studentId: hv, courseId: KHOA, finalPrice: TIEN }],
        actor: { id: KE_TOAN, name: "Kế toán fixture" },
      }),
    );
    expect(kq.linked, "khoản PENDING vẫn được gắn").toBe(1);
    const sauXacNhan = await db.payment.findUniqueOrThrow({ where: { id: daXacNhan.id } });
    expect({ amount: sauXacNhan.amount, enrollmentId: sauXacNhan.enrollmentId, accountantStatus: sauXacNhan.accountantStatus }, "khoản CONFIRMED nằm yên").toEqual({
      amount: TIEN,
      enrollmentId: null,
      accountantStatus: DA_XAC_NHAN,
    });
    expect((await db.payment.findUniqueOrThrow({ where: { id: choGan.id } })).enrollmentId).toBe(gd);

    // Chốt chặn CŨ giữ nguyên với đơn THƯỜNG: khoản CONFIRMED chưa ghi danh ⇒ NÉM (không bao giờ sửa amount của khoản đã đối soát).
    const THUONG = `${T}don-33t`;
    await dungDon({ id: THUONG, leadId, dong: [{ id: `${ITEM_B}-t`, studentId: null, metadata: { courseId: KHOA, soBuoi: 48 } }] });
    await thu(THUONG, `${ITEM_B}-t`, TIEN, DA_XAC_NHAN);
    await expect(
      db.$transaction((tx) =>
        linkRecordedPaymentsToEnrollments(tx, {
          leadId,
          ghiDanh: [{ enrollmentId: gd, studentId: hv, courseId: KHOA, finalPrice: TIEN }],
          actor: { id: KE_TOAN, name: "Kế toán fixture" },
        }),
      ),
    ).rejects.toThrow(/ĐÃ XÁC NHẬN/);
  });
  // ═══ 7 · LƯỚI BỔ SUNG SAU LƯỢT CẤY ĐỘC LẬP (12/10/2026) — mỗi ca dưới đây ĐÓNG một phép cấy từng XANH GIẢ ═════════════════════════

  it("[NOI-DB-34] CƠ SỞ CHƯA ÁNH XẠ OrgUnit ⇒ KHÔNG BAO GIỜ nới cổng ghi danh (fail-closed) và KHÔNG cấp quyền học — cấy `: true` ở `xac-nhan-truoc.ts` từng 0 ca đỏ", async () => {
    const lone = await db.center.upsert({
      where: { slug: `${T}co-so-mo-coi` },
      create: { code: `${T}MC`, name: `${T}cơ sở mồ côi`, slug: `${T}co-so-mo-coi`, address: "fixture" },
      update: {},
    });
    try {
      expect(await db.orgUnit.count({ where: { centerId: lone.id } }), "fixture: cơ sở này KHÔNG có OrgUnit").toBe(0);
      const DON = `${T}don-34`;
      await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
      await db.order.update({ where: { id: DON }, data: { centerId: lone.id } });
      expect([...(await donChoXacNhanTruocGhiDanh([DON]))], "cơ sở không ánh xạ ⇒ không nới").toEqual([]);
      const khoan = await thu(DON, ITEM_A, TIEN, "PENDING");
      expect((await confirmPayment({ paymentId: khoan.id, confirmedById: KE_TOAN })).ok, "cổng CHUA_GHI_DANH giữ nguyên chữ").toBe(false);
      expect((await db.payment.findUniqueOrThrow({ where: { id: khoan.id } })).accountantStatus).toBe("PENDING");
      // Đối chứng dương: cùng đơn ấy chuyển về cơ sở có ánh xạ + cờ BẬT thì được nới.
      await db.order.update({ where: { id: DON }, data: { centerId: CS1 } });
      expect([...(await donChoXacNhanTruocGhiDanh([DON]))]).toEqual([DON]);
      // Quyền học: cơ sở chưa ánh xạ ⇒ dừng trước mọi phép ghi.
      await db.order.update({ where: { id: DON }, data: { centerId: lone.id } });
      await db.payment.update({ where: { id: khoan.id }, data: { accountantStatus: DA_XAC_NHAN } });
      const truoc = await demHang();
      const kq = await xetCapQuyenHocChoDon(DON, "KE_TOAN_XAC_NHAN", NOW, "CAP");
      expect(kq.boQua).toBe("KHONG_CO_CO_SO");
      expect(await demHang()).toEqual(truoc);
    } finally {
      await donDep();
      await db.center.deleteMany({ where: { id: lone.id } });
    }
  });

  it("[NOI-DB-35] hích theo LEAD bỏ qua đơn ĐÃ XOÁ MỀM (đối chứng dương: đơn sống cùng lead được cấp). Ghi chú: `deletedAt: null` trong `hichCapQuyenHocChoLead` DƯ — hook soft-delete của `db` đã lọc Order; ca này ghim HÀNH VI chứ không ghim chữ", async () => {
    const { leadId } = await dungLead("khach-35", 1);
    const SONG = `${T}don-35s`;
    const XOA = `${T}don-35x`;
    await dungDon({ id: SONG, leadId, dong: [{ id: ITEM_A }] });
    await dungDon({ id: XOA, leadId, dong: [{ id: ITEM_B }] });
    await thuNganHang(SONG, ITEM_A, TIEN, "txn-35s");
    await thuNganHang(XOA, ITEM_B, TIEN, "txn-35x");
    await db.order.update({ where: { id: XOA }, data: { deletedAt: NOW } });
    try {
      await hichCapQuyenHocChoLead(leadId, "CHUYEN_DOI", SAU);
      expect((await quyenCua(SONG)).map((q) => q.orderItemId), "đối chứng dương: đơn còn sống được cấp").toEqual([ITEM_A]);
      expect(await quyenCua(XOA), "đơn đã xoá mềm KHÔNG được cấp qua đường lead").toHaveLength(0);
      expect(await choCua(XOA)).toHaveLength(0);
    } finally {
      // `db` ẩn đơn đã xoá mềm khỏi `findMany` của donDep ⇒ phải mở lại để dọn được (không thì dòng phân bổ mồ côi chặn xoá giao dịch).
      await db.order.update({ where: { id: XOA }, data: { deletedAt: null } });
    }
  });

  it("[NOI-DB-36] NGHIÊNG VỀ THẬN TRỌNG: sổ cái TRỐNG nhưng cache `consumedSessions` > 0 ⇒ TREO_DUYET_TAY, không CAN_THU_HOI — tiêu đề [NOI-DB-22] hứa ca này mà thân ca không có; cấy bỏ nhánh cache từng 0 ca đỏ", async () => {
    const DON = `${T}don-36`;
    const { khoan, quyen } = await donDaCapQuyen(DON);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: quyen.id } }), "fixture: sổ cái trống").toBe(0);
    await db.studyEntitlement.update({ where: { id: quyen.id }, data: { consumedSessions: 2 } });
    await rejectPaymentThat(khoan.id);
    await giaoSuKien("payment.rejected", DON);
    expect((await xuLyCua(DON)).map((x) => [x.loai, x.trangThai])).toEqual([["TREO_DUYET_TAY", "OPEN"]]);
  });

  it("[NOI-DB-37] cầu nối con lead KHÔNG đếm hồ sơ / ghi danh đã XOÁ MỀM — hồ sơ xoá mềm không làm dòng mơ hồ, và hồ sơ xoá mềm DUY NHẤT không nhận quyền học. (Student KHÔNG nằm trong SOFT_DELETE_MODELS nên `deletedAt: null` của nhánh hồ sơ là chốt DUY NHẤT; Enrollment thì hook đã lọc)", async () => {
    // (a) hồ sơ xoá mềm + hồ sơ sống cùng con ⇒ chọn hồ sơ sống (không mơ hồ).
    const a = await dungLead("khach-37a", 1);
    const DA = `${T}don-37a`;
    await dungDon({ id: DA, leadId: a.leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: a.conIds[0] }] });
    await thuNganHang(DA, ITEM_A, TIEN, "txn-37a");
    const song = await giaLapConvert(a.conIds[0]!, KHOA, "song-37a");
    await db.student.create({ data: { id: `${T}hv-xoa-37a`, name: `${T}xoa-37a`, centerId: CS1, status: "ACTIVE", leadChildId: a.conIds[0], deletedAt: NOW } });
    await hichCapQuyenHocChoDon(DA, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DA)).map((q) => q.studentId), "hồ sơ xoá mềm không làm mơ hồ").toEqual([song]);

    // (b) ghi danh xoá mềm của học viên KHÁC cùng con + khoá ⇒ không làm mơ hồ.
    const b = await dungLead("khach-37b", 1);
    const DB_ = `${T}don-37b`;
    await dungDon({ id: DB_, leadId: b.leadId, dong: [{ id: ITEM_B, studentId: null, leadChildId: b.conIds[0] }] });
    await thuNganHang(DB_, ITEM_B, TIEN, "txn-37b");
    const songB = await giaLapConvert(b.conIds[0]!, KHOA, "song-37b");
    const khac = (await db.student.create({ data: { id: `${T}hv-khac-37b`, name: `${T}khac-37b`, centerId: CS1, status: "ACTIVE" } })).id;
    await db.enrollment.create({
      data: { id: `${T}gd-xoa-37b`, studentId: khac, classId: LOP_CU, courseId: KHOA, centerId: CS1, status: "STUDYING", leadChildId: b.conIds[0], deletedAt: NOW },
    });
    await hichCapQuyenHocChoDon(DB_, "CHUYEN_DOI", SAU);
    expect((await quyenCua(DB_)).map((q) => q.studentId), "ghi danh xoá mềm không làm mơ hồ").toEqual([songB]);

    // (c) CHỈ có hồ sơ xoá mềm ⇒ chưa có học viên ⇒ chờ, không cấp.
    const c = await dungLead("khach-37c", 1);
    const DC = `${T}don-37c`;
    await dungDon({ id: DC, leadId: c.leadId, dong: [{ id: `${ITEM_A}-c`, studentId: null, leadChildId: c.conIds[0] }] });
    await thuNganHang(DC, `${ITEM_A}-c`, TIEN, "txn-37c");
    await db.student.create({ data: { id: `${T}hv-xoa-37c`, name: `${T}xoa-37c`, centerId: CS1, status: "ACTIVE", leadChildId: c.conIds[0], deletedAt: NOW } });
    await hichCapQuyenHocChoDon(DC, "CHUYEN_DOI", SAU);
    expect(await quyenCua(DC)).toHaveLength(0);
    expect((await choCua(DC)).map((x) => x.trangThai)).toEqual(["OPEN"]);
  });

  it("[NOI-DB-38] quyền học của dòng đã bị HUỶ (VOIDED) mà dòng CHỜ còn mở ⇒ dòng chờ đóng HUY, KHÔNG hồi sinh quyền học — cấy bỏ nhánh đóng từng 0 ca đỏ", async () => {
    const { leadId, conIds } = await dungLead("khach-38", 1);
    const DON = `${T}don-38`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-38");
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    expect((await choCua(DON)).map((x) => x.trangThai), "fixture: dòng chờ đã được ghi").toEqual(["OPEN"]);
    await giaLapConvert(conIds[0]!, KHOA, "voided-38");
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", SAU);
    const [q] = await quyenCua(DON);
    expect(q, "fixture: đã cấp").toBeDefined();
    // Trạng thái lạc: người vận hành huỷ quyền học, rồi dòng chờ bị mở lại bằng tay.
    await db.studyEntitlement.update({ where: { id: q!.id }, data: { status: "VOIDED" } });
    await db.studyEntitlementXuLy.updateMany({ where: { orderId: DON }, data: { trangThai: "OPEN", resolvedAt: null, resolvedNote: null } });
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", SAU);
    expect((await quyenCua(DON)).map((x) => [x.id, x.status]), "không hồi sinh").toEqual([[q!.id, "VOIDED"]]);
    expect((await choCua(DON)).map((x) => x.trangThai)).toEqual(["HUY"]);
  });
  it("[NOI-DB-39] CHUYỂN ĐỔI không bỏ sót khoản CHƯA XÁC NHẬN cùng đơn SCOPE với khoản đã xác nhận trước: khoản CONFIRMED nằm yên, khoản PENDING cùng dòng VẪN được gắn ghi danh — cấy loại cả khoản PENDING của đơn SCOPE từng 0 ca đỏ", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-39", 1);
    const DON = `${T}don-39`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    const nua = Math.floor(TIEN / 2);
    const daXacNhan = await thu(DON, ITEM_A, nua, DA_XAC_NHAN);
    const chuaXacNhan = await thu(DON, ITEM_A, TIEN - nua, "PENDING");
    const hv = await giaLapConvert(conIds[0]!, KHOA, "link-39");
    const gd = `${T}gd-link-39`;
    const kq = await db.$transaction((tx) =>
      linkRecordedPaymentsToEnrollments(tx, {
        leadId,
        ghiDanh: [{ enrollmentId: gd, studentId: hv, courseId: KHOA, finalPrice: TIEN }],
        actor: { id: KE_TOAN, name: "Kế toán fixture" },
      }),
    );
    expect(kq.linked, "đúng khoản PENDING được gắn").toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: chuaXacNhan.id } })).enrollmentId, "khoản PENDING cùng đơn SCOPE được gắn ghi danh").toBe(gd);
    const sau = await db.payment.findUniqueOrThrow({ where: { id: daXacNhan.id } });
    expect({ amount: sau.amount, enrollmentId: sau.enrollmentId }, "khoản CONFIRMED nằm yên").toEqual({ amount: nua, enrollmentId: null });
  });

  it("[NOI-DB-40] quyền học CÒN SỐNG mà dòng CHỜ còn mở (trạng thái lạc) ⇒ dòng chờ đóng DA_XU_LY, không cấp thêm quyền thứ hai — cấy bỏ lời đóng ở nhánh 'đã có quyền học' từng 0 ca đỏ", async () => {
    const { leadId, conIds } = await dungLead("khach-moi-40", 1);
    const DON = `${T}don-40`;
    await dungDon({ id: DON, leadId, dong: [{ id: ITEM_A, studentId: null, leadChildId: conIds[0] }] });
    await thuNganHang(DON, ITEM_A, TIEN, "txn-40");
    await hichCapQuyenHocChoDon(DON, "WEBHOOK_CU", NOW);
    await giaLapConvert(conIds[0]!, KHOA, "song-40");
    await hichCapQuyenHocChoDon(DON, "CHUYEN_DOI", SAU);
    const [q] = await quyenCua(DON);
    expect(q, "fixture: đã cấp").toBeDefined();
    await db.studyEntitlementXuLy.updateMany({ where: { orderId: DON }, data: { trangThai: "OPEN", resolvedAt: null, resolvedNote: null } });
    await hichCapQuyenHocChoDon(DON, "GAN_TAY", SAU);
    expect((await quyenCua(DON)).map((x) => x.id), "không cấp thêm").toEqual([q!.id]);
    expect((await choCua(DON)).map((x) => x.trangThai)).toEqual(["DA_XU_LY"]);
  });
});
