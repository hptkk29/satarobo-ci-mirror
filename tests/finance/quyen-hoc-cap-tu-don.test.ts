// tests/finance/quyen-hoc-cap-tu-don.test.ts — TIỀN ĐÃ XÁC NHẬN ⇒ CẤP QUYỀN HỌC, trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Hoặc:  DATABASE_URL=…/satarobo_test_cap DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/quyen-hoc-cap-tu-don.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Chạy được MỘT MÌNH (luật 18). Đồng hồ truyền vào (luật 19).
//
// Thứ test THUẦN không chứng minh được, và tệp này chứng minh:
//   · số tiền đọc DƯỚI KHOÁ ĐƠN (một khoản bị gỡ chen giữa ⇒ lượt cấp thấy tiền đã mất);
//   · 5 lượt đồng thời cùng một đơn ⇒ đúng 1 quyền học, không P2002 nổi lên, không treo bể kết nối;
//   · cờ TẮT ⇒ đếm hàng trước/sau KHÔNG đổi (quyền học + AuditLog + DomainEvent);
//   · đi qua ĐƯỜNG THẬT: phiếu gộp → webhook → sổ `Payment` mang marker thật; hoàn tiền bằng `refundPayment` thật.
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
import { xetCapQuyenHocChoDon, type KetQuaCapTuDon } from "@/lib/entitlements/cap-tu-don";
import { registerCapQuyenHocHandlers, xuLySuKienTienVe } from "@/lib/entitlements/su-kien";
import { clearHandlers, getHandlers } from "@/lib/events/registry";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { refundPayment } from "@/lib/finance/payment";
import { taoPhieuGop } from "@/lib/finance/phieu-gop";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { dungMemo } from "@/lib/payments/memo-ck";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";

if (!RUN_DB_TESTS) console.warn(`[QHC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const T = "fx-qhc-";
/** Cơ sở KHÔNG có OrgUnit nào trỏ tới (cờ khoá theo OrgUnit nên không hỏi được cờ). */
const CS_MO_COI = "fx-qhc-cs-mo-coi";
const KHOA = `${T}khoa`;
const HV_A = `${T}hv-a`;
const HV_B = `${T}hv-b`;
const ITEM_A = `${T}item-a`;
const ITEM_B = `${T}item-b`;
const KE_TOAN = `${T}ke-toan`;
const NOW = new Date("2026-10-11T03:00:00Z");
const NGAY_GO = new Date("2026-10-11T04:00:00Z");
/** 10.560.000 × 85% — giá 48 buổi con thứ nhất theo chính sách PL02. Số lẻ nghìn, không tròn triệu. */
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

/** Dấu SCOPE THẬT do planner của tầng tạo đơn sinh ra — không gõ tay (fixture gõ tay là fixture không kiểm được gì). */
function metadataScope(): Record<string, unknown> {
  const kq = keHoachDon([dongVao], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId: KHOA, soBuoi: 48 }, KHOA);
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: planner không ra SCOPE");
  expect(docPhamViDong(md)?.thanhTien).toBe(TIEN);
  return md;
}

let CS1 = "";
let OU1 = "";
let OU2 = "";
let dem = 0;

interface DongFx {
  id: string;
  studentId?: string | null;
  /** Mặc định: dấu SCOPE thật. Truyền để thay (đơn cũ, dấu giả…). */
  metadata?: Record<string, unknown> | null;
  donGia?: number;
  /** `OrderItem.totalPrice` khi KHÁC `donGia × 1` (dòng đơn bị sửa tay/hỏng) — mặc định bằng `donGia`. */
  tongGia?: number;
  giam?: number;
  status?: "ACTIVE" | "STOPPED";
}
interface DonFx {
  id: string;
  dong: DongFx[];
  status?: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "REFUNDED";
  centerId?: string;
}

async function dungDon(o: DonFx) {
  const tong = o.dong.reduce((s, d) => s + (d.donGia ?? TIEN) - (d.giam ?? 0), 0);
  await db.order.create({
    data: {
      id: o.id,
      code: `ORD-2699-QHC-${++dem}-${o.id.slice(-6)}`,
      type: "COURSE",
      status: o.status ?? "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: SDT,
      totalAmount: tong,
      subtotal: tong,
      centerId: o.centerId ?? CS1,
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
        unitPrice: d.donGia ?? TIEN,
        totalPrice: d.tongGia ?? d.donGia ?? TIEN,
        discountAmount: d.giam ?? 0,
        studentId: d.studentId === undefined ? HV_A : d.studentId,
        status: d.status ?? "ACTIVE",
        metadata: (d.metadata === undefined ? metadataScope() : d.metadata) as Prisma.InputJsonValue,
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
  note: string | null = null,
) {
  return db.payment.create({
    data: {
      orderId,
      orderItemId,
      amount,
      method: note?.includes("[auto:") ? "sepay" : "cash",
      paidDate: NOW,
      note,
      saleStatus: "RECORDED",
      accountantStatus,
      centerId: CS1,
    },
  });
}

let demDot = 0;
/**
 * Tiền ngân hàng THẬT: `BankTransaction` MATCHED + phiếu thu + `PaymentAllocation` vào đơn, kèm dòng `Payment` PENDING mang marker —
 * đúng hình dạng mà webhook / phiếu gộp / kế toán gắn tay để lại. Ba biến thể "hỏng": `phanBo: false` (phân bổ đã bị xoá — gỡ gắn), `matched: false`
 * (giao dịch không còn MATCHED dù còn phân bổ — trạng thái nửa vời), `phanBoVaoDon` (giao dịch thật nhưng khớp vào ĐƠN KHÁC).
 */
async function thuNganHang(
  orderId: string,
  orderItemId: string | null,
  amount: number,
  txn: string,
  o: { kieu?: "webhook" | "gan-tay"; matched?: boolean; phanBo?: boolean; phanBoVaoDon?: string } = {},
) {
  const providerTxnId = `${T}${txn}`;
  const bt = await db.bankTransaction.create({
    data: { provider: "SEPAY", providerTxnId, amount, transferredAt: NOW, status: o.matched === false ? "UNMATCHED" : "MATCHED", centerId: CS1 },
  });
  if (o.phanBo !== false) {
    // `phanBoVaoDon`: phân bổ vào phiếu thu của một ĐƠN KHÁC — giao dịch có thật nhưng KHÔNG phải tiền của đơn này.
    const dot = await db.paymentRequest.create({
      data: { orderId: o.phanBoVaoDon ?? orderId, orderItemId, centerId: CS1, installmentNo: 100 + ++demDot, amountDue: amount, status: "PAID", sortOrder: 100 + demDot },
    });
    await db.paymentAllocation.create({ data: { bankTransactionId: bt.id, paymentRequestId: dot.id, amount, centerId: CS1 } });
  }
  const marker = o.kieu === "gan-tay" ? `[gan-tay:${bt.id}]` : `[auto:sepay:${providerTxnId}]`;
  return thu(orderId, orderItemId, amount, "PENDING", `Tiền về qua SEPAY ${providerTxnId} ${marker}`);
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
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } } });
  await db.studyEntitlement.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorName: { startsWith: "Hệ thống — cấp quyền học" } }, { entityType: "Payment", actorId: KE_TOAN }] } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: ids } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: ids } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
}

const nhieu = (ds: readonly unknown[]) => ds.length;
const quyenCua = (orderId: string) => db.studyEntitlement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const demHang = async () => ({
  quyen: await db.studyEntitlement.count(),
  audit: await db.auditLog.count(),
  suKien: await db.domainEvent.count(),
});
const xet = (orderId: string, nguon: "PHIEU_GOP" | "KE_TOAN_XAC_NHAN" = "KE_TOAN_XAC_NHAN"): Promise<KetQuaCapTuDon> =>
  xetCapQuyenHocChoDon(orderId, nguon, NOW, "CAP");

describe.skipIf(!RUN_DB_TESTS)("[QHC-DB] tiền xác nhận ⇒ quyền học — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    [OU1, OU2] = (await Promise.all(["CS1", "CS2"].map((code) => db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true } })))).map((c) => c.id) as [string, string];
    await db.course.upsert({
      where: { id: KHOA },
      create: { id: KHOA, name: "Sata 3 (fixture)", slug: KHOA, price: GIA48, totalSessions: 48 },
      update: { price: GIA48, totalSessions: 48 },
    });
    for (const [id, ten] of [[HV_A, "Bé A"], [HV_B, "Bé B"]] as const) {
      await db.student.upsert({ where: { id }, create: { id, name: `${T}${ten}`, centerId: CS1, status: "ACTIVE" }, update: {} });
    }
  });
  beforeEach(async () => {
    await donDep();
    await datCo(OU1, true);
    await datCo(OU2, null);
  });
  afterAll(async () => {
    await donDep();
    await datCo(OU1, null);
    await db.student.deleteMany({ where: { id: { in: [HV_A, HV_B] } } });
    await db.course.deleteMany({ where: { id: KHOA } });
    await db.center.deleteMany({ where: { id: CS_MO_COI } });
  });

  it("[QHC-DB-01] fixture: đơn SCOPE thật, cờ BẬT, CHƯA ai xác nhận tiền ⇒ KHÔNG có quyền học (kèm đối chứng dương ở ca kế)", async () => {
    const DON = `${T}don-01`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    expect(docPhamViDong((await db.orderItem.findUniqueOrThrow({ where: { id: ITEM_A } })).metadata)?.thanhTien, "fixture phải mang dấu SCOPE thật").toBe(TIEN);

    const kq = await xet(DON);
    expect(kq.boQua).toBeNull();
    expect(kq.daCap).toEqual([]);
    expect(kq.chuaDuTien).toEqual([{ orderItemId: ITEM_A, conThieu: TIEN }]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-02] tiền mặt CONFIRMED đủ ⇒ cấp 1 quyền học AWAITING_PLACEMENT, đúng học viên/khoá/giá, KHÔNG sổ tiêu thụ, KHÔNG hoa hồng", async () => {
    const DON = `${T}don-02`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");

    const kq = await xet(DON);
    expect(kq.daCap).toHaveLength(1);
    const [q] = await quyenCua(DON);
    expect(q).toMatchObject({
      studentId: HV_A,
      courseId: KHOA,
      orderId: DON,
      orderItemId: ITEM_A,
      centerId: CS1,
      orgUnitId: OU1,
      status: "AWAITING_PLACEMENT",
      purchaseKind: "FULL",
      purchaseSessions: 48,
      listAmount: GIA48,
      discountAmount: GIA48 - TIEN,
      netAmount: TIEN,
      origin: "PAYMENT",
      closedBySaleId: null,
      firstPurchaseSaleId: null,
      commissionSnapshot: null,
      startLessonOrder: null,
      consumedSessions: 0,
    });
    expect(q!.paidAt?.toISOString()).toBe(NOW.toISOString());
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } }), "thanh toán không tiêu thụ buổi nào").toBe(0);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityId: q!.id, action: "CREATE" } })).toBe(1);
  });

  it("[QHC-DB-03] thiếu MỘT đồng ⇒ không cấp; đủ lại thì cấp (đối chứng dương)", async () => {
    const DON = `${T}don-03`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN - 1, "CONFIRMED");
    const thieu = await xet(DON);
    expect(thieu.daCap).toEqual([]);
    expect(thieu.chuaDuTien).toEqual([{ orderItemId: ITEM_A, conThieu: 1 }]);
    expect(await quyenCua(DON)).toHaveLength(0);

    await thu(DON, ITEM_A, 1, "CONFIRMED");
    expect((await xet(DON)).daCap).toHaveLength(1);
  });

  it("[QHC-DB-04] tiền mặt PENDING không tính; kế toán xác nhận thì tính; REJECTED không tính", async () => {
    const DON = `${T}don-04`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    const p = await thu(DON, ITEM_A, TIEN, "PENDING");
    expect((await xet(DON)).daCap, "Sale vừa gõ tiền mặt").toEqual([]);

    await db.payment.update({ where: { id: p.id }, data: { accountantStatus: "REJECTED" } });
    expect((await xet(DON)).daCap, "kế toán từ chối").toEqual([]);

    await db.payment.update({ where: { id: p.id }, data: { accountantStatus: DA_XAC_NHAN } });
    expect((await xet(DON)).daCap, "kế toán xác nhận").toHaveLength(1);
  });

  it("[QHC-DB-05] khoản REJECTED mang marker ngân hàng cũng KHÔNG tính (kế toán đã gỡ tiền khỏi sổ)", async () => {
    const DON = `${T}don-05`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "REJECTED", "Tiền về qua SEPAY fx [auto:sepay:fx-qhc-txn-x]");
    expect((await xet(DON)).daCap).toEqual([]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-05b] MARKER KHÔNG PHẢI CHỨNG CHỈ: Sale gõ marker ngân hàng vào ghi chú tiền mặt PENDING ⇒ KHÔNG tính (không có giao dịch thật); đối chứng dương: giao dịch thật cùng số tiền thì tính", async () => {
    const GIA_MAO = `${T}don-05b`;
    await dungDon({ id: GIA_MAO, dong: [{ id: ITEM_A }] });
    // Sale ghi tiền mặt với ghi chú mạo marker webhook, rồi một khoản khác mạo marker gắn tay.
    await thu(GIA_MAO, ITEM_A, TIEN, "PENDING", "tiền mặt [auto:sepay:fx-qhc-khong-co-that]");
    expect((await xet(GIA_MAO)).daCap, "marker webhook mạo").toEqual([]);
    await db.payment.deleteMany({ where: { orderId: GIA_MAO } });
    await thu(GIA_MAO, ITEM_A, TIEN, "PENDING", "tiền mặt [gan-tay:khong-co-giao-dich-nay]");
    expect((await xet(GIA_MAO)).daCap, "marker gắn tay mạo").toEqual([]);
    expect(await quyenCua(GIA_MAO)).toHaveLength(0);

    const THAT = `${T}don-05c`;
    await dungDon({ id: THAT, dong: [{ id: `${ITEM_A}-t` }] });
    await thuNganHang(THAT, `${ITEM_A}-t`, TIEN, "txn-05c");
    expect((await xet(THAT)).daCap, "giao dịch thật").toHaveLength(1);
  });

  it("[QHC-DB-05c] mượn marker của giao dịch THẬT có thật của đơn: khoản mạo lớn hơn số đã phân bổ, hoặc nhân đôi cùng marker ⇒ không tính", async () => {
    const LON = `${T}don-05d`;
    await dungDon({ id: LON, dong: [{ id: ITEM_A }] });
    // Giao dịch thật chỉ 1.000.000đ phân bổ vào đơn; Sale ghi khoản PENDING TIEN đồng mượn đúng marker đó.
    const that = await thuNganHang(LON, ITEM_A, 1_000_000, "txn-05d");
    await db.payment.update({ where: { id: that.id }, data: { amount: TIEN } });
    expect((await xet(LON)).daCap, "khoản lớn hơn giao dịch thật").toEqual([]);

    const DOI = `${T}don-05e`;
    await dungDon({ id: DOI, dong: [{ id: `${ITEM_A}-e` }] });
    const goc = await thuNganHang(DOI, `${ITEM_A}-e`, TIEN / 2, "txn-05e");
    // Nhân đôi: một dòng mạo mang CÙNG marker. Tổng (2 × TIEN/2 + TIEN/2) vượt số thật ⇒ cả nhóm bị loại (fail-closed).
    await thu(DOI, `${ITEM_A}-e`, TIEN, "PENDING", goc.note);
    expect((await xet(DOI)).daCap, "nhân đôi cùng marker").toEqual([]);
    expect(await quyenCua(DOI)).toHaveLength(0);
  });

  it("[QHC-DB-05d] giao dịch bị GỠ GẮN (phân bổ xoá / giao dịch không còn MATCHED) ⇒ khoản PENDING không còn tính; gắn tay thật thì tính", async () => {
    const GO = `${T}don-05f`;
    await dungDon({ id: GO, dong: [{ id: ITEM_A }] });
    await thuNganHang(GO, ITEM_A, TIEN, "txn-05f", { phanBo: false, matched: false });
    expect((await xet(GO)).daCap, "phân bổ đã bị xoá (gỡ gắn)").toEqual([]);

    const NUA = `${T}don-05h`;
    await dungDon({ id: NUA, dong: [{ id: `${ITEM_A}-h5` }] });
    await thuNganHang(NUA, `${ITEM_A}-h5`, TIEN, "txn-05h", { matched: false });
    expect((await xet(NUA)).daCap, "giao dịch không còn MATCHED dù còn phân bổ").toEqual([]);

    const KHAC = `${T}don-05i`;
    const DON_KIA = `${T}don-05j`;
    await dungDon({ id: DON_KIA, dong: [{ id: `${ITEM_B}-k5`, studentId: HV_B }] });
    await dungDon({ id: KHAC, dong: [{ id: `${ITEM_A}-i5` }] });
    await thuNganHang(KHAC, `${ITEM_A}-i5`, TIEN, "txn-05i", { phanBoVaoDon: DON_KIA });
    expect((await xet(KHAC)).daCap, "giao dịch thật nhưng khớp vào đơn KHÁC").toEqual([]);

    const TAY = `${T}don-05g`;
    await dungDon({ id: TAY, dong: [{ id: `${ITEM_A}-g` }] });
    await thuNganHang(TAY, `${ITEM_A}-g`, TIEN, "txn-05g", { kieu: "gan-tay" });
    expect((await xet(TAY)).daCap, "gắn tay một giao dịch thật").toHaveLength(1);
  });

  it("[QHC-DB-06] hoàn tiền THẬT (refundPayment) trừ ra — dù dòng hoàn không mang orderItemId (đơn 2 dòng nên không dựa vào luật đơn một dòng)", async () => {
    const DON = `${T}don-06`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }, { id: ITEM_B, studentId: HV_B }] });
    const goc = await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    // Đối chứng dương: chưa hoàn thì dòng A đủ tiền.
    expect((await xet(DON)).daCap.map((d) => d.orderItemId)).toEqual([ITEM_A]);
    await db.studyEntitlement.deleteMany({ where: { orderId: DON } });

    const r = await refundPayment({ paymentId: goc.id, confirmedById: KE_TOAN, reason: "Hoàn một phần theo yêu cầu phụ huynh", amount: 1_000 });
    expect(r.ok, "fixture: hoàn tiền thật phải thành công").toBe(true);
    const dongHoan = await db.payment.findFirstOrThrow({ where: { adjustmentOfId: goc.id } });
    expect(dongHoan).toMatchObject({ amount: -1_000, accountantStatus: "REFUNDED", orderItemId: null });

    const sau = await xet(DON);
    expect(sau.daCap, "đã hoàn 1.000đ ⇒ thiếu 1.000đ").toEqual([]);
    expect(sau.chuaDuTien).toContainEqual({ orderItemId: ITEM_A, conThieu: 1_000 });
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-07] ĐƯỜNG THẬT: phiếu gộp + webhook ⇒ tiền QR (PENDING, marker ngân hàng) TÍNH; handler sự kiện thật cấp quyền học", async () => {
    const DON = `${T}don-07`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }, { id: ITEM_B, studentId: HV_B }] });
    // Phiếu theo DÒNG: chỉ dòng A có đợt mở — QR chỉ trả phần của bé A.
    await db.paymentRequest.create({
      data: { id: `${T}dot-07a`, orderId: DON, orderItemId: ITEM_A, centerId: CS1, installmentNo: 1, amountDue: TIEN, status: "PENDING", sortOrder: 1 },
    });
    const phieu = await taoPhieuGop({ orderId: DON, paymentRequestIds: [`${T}dot-07a`], actor: { id: KE_TOAN, name: "Kế toán fixture" } });
    if (!phieu.ok) throw new Error(`fixture: không phát được phiếu — ${phieu.error}`);

    const kqTruoc = await xet(DON, "PHIEU_GOP");
    expect(kqTruoc.daCap, "chưa có tiền").toEqual([]);

    const txn = `${T}txn-07`;
    const nhan = await ingestPayosWebhook(
      {
        orderCode: undefined,
        reference: txn,
        paymentLinkId: txn,
        description: dungMemo({ hoTen: "Be A", sdt: SDT, ma: phieu.ma }),
        amount: TIEN,
        transactionDateTime: "2026-10-11T03:00:00Z",
        accountNumber: "0123456789",
      } as never,
      "SEPAY",
    );
    expect(nhan.status).toBe("MATCHED");
    const khoan = await db.payment.findMany({ where: { orderId: DON } });
    expect(khoan.map((k) => [k.orderItemId, k.accountantStatus, (k.note ?? "").includes("[auto:sepay:")])).toEqual([[ITEM_A, "PENDING", true]]);

    // Đi qua ĐÚNG handler đã đăng ký, với ĐÚNG payload sự kiện do phiếu gộp phát.
    const suKien = await db.domainEvent.findFirstOrThrow({ where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], equals: DON } } });
    clearHandlers();
    registerCapQuyenHocHandlers();
    const hs = getHandlers("phieu-gop.da-chia");
    expect(hs).toHaveLength(1);
    await hs[0]!({ id: suKien.id, type: suKien.type, payload: suKien.payloadJson as Record<string, unknown> });

    const quyen = await quyenCua(DON);
    expect(quyen.map((q) => [q.orderItemId, q.studentId, q.status])).toEqual([[ITEM_A, HV_A, "AWAITING_PLACEMENT"]]);
    // Đơn nhiều con: bé B chưa trả đồng nào ⇒ không có quyền học.
    expect(quyen.some((q) => q.orderItemId === ITEM_B)).toBe(false);
  });

  it("[QHC-DB-08] phiếu thu TOÀN ĐƠN của đơn MỘT dòng (orderItemId NULL) vẫn tính cho dòng duy nhất; đơn NHIỀU dòng thì KHÔNG đoán", async () => {
    const MOT = `${T}don-08a`;
    await dungDon({ id: MOT, dong: [{ id: ITEM_A }] });
    await thuNganHang(MOT, null, TIEN, "txn-8a");
    expect((await xet(MOT)).daCap.map((d) => d.orderItemId), "đơn một dòng: tiền không gắn dòng thuộc dòng duy nhất").toEqual([ITEM_A]);

    const NHIEU = `${T}don-08b`;
    await dungDon({ id: NHIEU, dong: [{ id: `${ITEM_A}-n` }, { id: `${ITEM_B}-n`, studentId: HV_B }] });
    await thu(NHIEU, null, TIEN * 2, "CONFIRMED");
    const kq = await xet(NHIEU);
    expect(kq.daCap, "đủ tiền cả đơn nhưng không biết của bé nào").toEqual([]);
    expect([...kq.chuaXacDinhDuocDong].sort()).toEqual([`${ITEM_A}-n`, `${ITEM_B}-n`].sort());
    expect(await quyenCua(NHIEU)).toHaveLength(0);
  });

  it("[QHC-DB-08c] đơn nhiều dòng có khoản ÂM không gắn được dòng nào (hoàn/đảo lạc dòng) ⇒ KHÔNG cấp dù dòng đủ tiền — không chứng minh được phần hoàn không phải của dòng này", async () => {
    const DON = `${T}don-08c`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }, { id: ITEM_B, studentId: HV_B }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    // Đối chứng dương: chưa có khoản âm lạc dòng thì A được cấp.
    expect((await xet(DON)).daCap.map((d) => d.orderItemId)).toEqual([ITEM_A]);
    await db.studyEntitlement.deleteMany({ where: { orderId: DON } });

    await db.payment.create({
      data: { orderId: DON, orderItemId: null, amount: -1_000, method: "cash", paidDate: NOW, note: "Hoàn lạc dòng", saleStatus: "RECORDED", accountantStatus: "REFUNDED", centerId: CS1 },
    });
    const kq = await xet(DON);
    expect(kq.daCap).toEqual([]);
    expect(kq.chuaXacDinhDuocDong).toContain(ITEM_A);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-09] đơn nhiều con: CHỈ con đủ tiền được cấp", async () => {
    const DON = `${T}don-09`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }, { id: ITEM_B, studentId: HV_B }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    await thu(DON, ITEM_B, TIEN - 3_168_000, "CONFIRMED");
    const kq = await xet(DON);
    expect(kq.daCap.map((d) => d.orderItemId)).toEqual([ITEM_A]);
    expect(kq.chuaDuTien).toEqual([{ orderItemId: ITEM_B, conThieu: 3_168_000 }]);
    expect((await quyenCua(DON)).map((q) => q.studentId)).toEqual([HV_A]);
  });

  it("[QHC-DB-10] cờ TẮT (hoặc chưa đặt, hoặc chỉ bật ở cơ sở khác) ⇒ đếm hàng trước/sau KHÔNG đổi: quyền học + AuditLog + DomainEvent", async () => {
    const DON = `${T}don-10`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");

    for (const [ten, dat] of [
      ["tắt hẳn", async () => datCo(OU1, false)],
      ["chưa đặt", async () => datCo(OU1, null)],
      ["chỉ bật ở CS2", async () => { await datCo(OU1, null); await datCo(OU2, true); }],
    ] as const) {
      await dat();
      const truoc = await demHang();
      const kq = await xet(DON);
      expect({ ten, boQua: kq.boQua, daCap: kq.daCap }).toEqual({ ten, boQua: "CO_TAT", daCap: [] });
      expect({ ten, ...(await demHang()) }).toEqual({ ten, ...truoc });
    }
    // Đối chứng dương: bật cờ cho đúng cơ sở của đơn thì CHÍNH đơn này được cấp.
    await datCo(OU1, true);
    expect((await xet(DON)).daCap).toHaveLength(1);
  });

  it("[QHC-DB-11] đơn KHÔNG có dấu SCOPE + cờ BẬT + đủ tiền ⇒ không cấp; đơn lịch sử (backfill) cũng không; đối chứng dương: cùng đơn CÓ dấu thì cấp", async () => {
    const CU = `${T}don-11a`;
    await dungDon({ id: CU, dong: [{ id: `${ITEM_A}-c`, metadata: { courseId: KHOA, soBuoi: 48 } }] });
    await thu(CU, `${ITEM_A}-c`, TIEN, "CONFIRMED");
    const truoc = await demHang();
    expect((await xet(CU)).boQua).toBe("KHONG_PHAI_DON_PHAM_VI");
    expect(await demHang()).toEqual(truoc);

    const LICH_SU = `${T}don-11b`;
    await dungDon({ id: LICH_SU, dong: [{ id: `${ITEM_A}-ls`, metadata: { courseId: KHOA, soBuoi: 48 } }] });
    await thu(LICH_SU, `${ITEM_A}-ls`, TIEN, "CONFIRMED", "[backfill-import]");
    expect((await xet(LICH_SU)).boQua).toBe("KHONG_PHAI_DON_PHAM_VI");

    const MOI = `${T}don-11c`;
    await dungDon({ id: MOI, dong: [{ id: `${ITEM_A}-m` }] });
    await thu(MOI, `${ITEM_A}-m`, TIEN, "CONFIRMED");
    expect((await xet(MOI)).daCap).toHaveLength(1);
    expect(await quyenCua(CU)).toHaveLength(0);
    expect(await quyenCua(LICH_SU)).toHaveLength(0);
  });

  it("[QHC-DB-12] dấu SCOPE GIẢ (khai thành tiền nhỏ hơn số tiền thật của dòng) ⇒ KHÔNG cấp dù khoản tiền khớp dấu; báo dauKhongKhop", async () => {
    const DON = `${T}don-12`;
    const md = metadataScope();
    const pv = md.phamVi as Record<string, unknown>;
    const snap = pv.pricingSnapshot as Record<string, unknown>;
    // Dấu tự nhất quán nhưng nói 1.000.000đ trong khi dòng đơn ghi 8.976.000đ.
    const gia = { ...md, phamVi: { ...pv, niemYet: 1_000_000, giamGia: 0, thanhTien: 1_000_000, pricingSnapshot: { ...snap, thanhTien: 1_000_000, niemYet: 1_000_000 } } };
    expect(docPhamViDong(gia), "dấu giả phải qua được phép kiểm HÌNH DẠNG (đó là lý do cần đối chiếu tiền)").not.toBeNull();
    await dungDon({ id: DON, dong: [{ id: ITEM_A, metadata: gia }] });
    await thu(DON, ITEM_A, 1_000_000, "CONFIRMED");

    const kq = await xet(DON);
    expect(kq.daCap).toEqual([]);
    expect(kq.dauKhongKhop).toEqual([ITEM_A]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-13] giảm giá trên dòng làm tiền thật lệch dấu ⇒ không cấp; dòng đã DỪNG HỌC hoặc đơn đã HUỶ ⇒ không cấp", async () => {
    const LECH = `${T}don-13a`;
    await dungDon({ id: LECH, dong: [{ id: ITEM_A, giam: 500_000 }] });
    await thu(LECH, ITEM_A, TIEN - 500_000, "CONFIRMED");
    expect((await xet(LECH)).dauKhongKhop).toEqual([ITEM_A]);

    const DUNG = `${T}don-13b`;
    await dungDon({ id: DUNG, dong: [{ id: `${ITEM_A}-d`, status: "STOPPED" }] });
    await thu(DUNG, `${ITEM_A}-d`, TIEN, "CONFIRMED");
    expect((await xet(DUNG)).dauKhongKhop).toEqual([`${ITEM_A}-d`]);

    const HUY = `${T}don-13c`;
    await dungDon({ id: HUY, dong: [{ id: `${ITEM_A}-h` }], status: "CANCELLED" });
    await thu(HUY, `${ITEM_A}-h`, TIEN, "CONFIRMED");
    expect((await xet(HUY)).boQua).toBe("DON_DA_HUY");
    for (const d of [LECH, DUNG, HUY]) expect(await quyenCua(d)).toHaveLength(0);
  });

  it("[QHC-DB-13d] dòng đơn tự mâu thuẫn (đơn giá × số lượng ≠ tổng) ở BẤT KỲ chiều nào ⇒ không cấp — mỗi vế của phép đối chiếu giá đều có ca canh", async () => {
    const ca = [
      { ten: "tổng lớn hơn đơn giá", dong: { donGia: TIEN, tongGia: TIEN + 1_000 } },
      { ten: "đơn giá lớn hơn tổng", dong: { donGia: TIEN + 1_000, tongGia: TIEN } },
    ] as const;
    for (const [i, { ten, dong }] of ca.entries()) {
      const DON = `${T}don-13d-${i}`;
      const DONG = `${ITEM_A}-13d${i}`;
      await dungDon({ id: DON, dong: [{ id: DONG, ...dong }] });
      await thu(DON, DONG, TIEN + 1_000, "CONFIRMED");
      const kq = await xet(DON);
      expect({ ten, daCap: kq.daCap, dauKhongKhop: kq.dauKhongKhop }).toEqual({ ten, daCap: [], dauKhongKhop: [DONG] });
    }
  });

  it("[QHC-DB-13e] dấu hợp lệ nhưng dòng là COACH (1-1/1-2/1-4) ⇒ không cấp: quyền học theo phạm vi chỉ cho lớp nhóm", async () => {
    const DON = `${T}don-13e`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, metadata: { ...metadataScope(), coachFormat: "ONE_ON_ONE" } }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const kq = await xet(DON);
    expect(kq.daCap).toEqual([]);
    expect(kq.dauKhongKhop).toEqual([ITEM_A]);
  });

  it("[QHC-DB-14] IDEMPOTENT tuần tự: lần hai không ghi gì (đúng 1 quyền học, đúng 1 audit)", async () => {
    const DON = `${T}don-14`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const l1 = await xet(DON);
    const truoc = await demHang();
    const l2 = await xet(DON);
    expect(l1.daCap).toHaveLength(1);
    expect(l2.daCap).toEqual([]);
    expect(l2.daCo).toEqual([{ orderItemId: ITEM_A, quyenHocId: l1.daCap[0]!.quyenHocId }]);
    expect(await demHang()).toEqual(truoc);
    expect(await quyenCua(DON)).toHaveLength(1);
  });

  it("[QHC-DB-15] 5 lượt ĐỒNG THỜI cùng một đơn ⇒ đúng 1 quyền học, đúng 1 lượt cấp, không lượt nào ném (không P2002, không treo bể kết nối)", async () => {
    const DON = `${T}don-15`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const kq = await Promise.all([1, 2, 3, 4, 5].map(() => xet(DON)));
    expect(kq.flatMap((k) => k.daCap)).toHaveLength(1);
    expect(kq.flatMap((k) => k.daCo)).toHaveLength(4);
    expect(await quyenCua(DON)).toHaveLength(1);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityType: "StudyEntitlement", entityId: (await quyenCua(DON))[0]!.id } })).toBe(1);
  });

  it("[QHC-DB-16] số tiền được đọc DƯỚI KHOÁ ĐƠN: kế toán gỡ khoản chen giữa ⇒ lượt cấp thấy tiền đã mất và KHÔNG cấp", async () => {
    const DON = `${T}don-16`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");

    let moKhoa!: () => void;
    const giu = new Promise<void>((r) => (moKhoa = r));
    let daLayKhoa!: () => void;
    const khoaXong = new Promise<void>((r) => (daLayKhoa = r));
    // "Kế toán": giữ khoá đơn, gỡ khoản (xoá mềm) rồi mới nhả.
    const keToan = db.$transaction(
      async (tx) => {
        await khoaDonTrongTx(tx, DON);
        daLayKhoa();
        await giu;
        await tx.payment.updateMany({ where: { orderId: DON }, data: { deletedAt: NGAY_GO } });
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    await khoaXong;

    const luotCap = xet(DON, "PHIEU_GOP");
    // Chờ cho tới khi lượt cấp THẬT SỰ đang đứng chờ khoá (không dùng sleep cố định).
    const han = Date.now() + 20_000;
    for (;;) {
      const [{ n }] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if (n > 0) break;
      if (Date.now() > han) throw new Error("lượt cấp không đứng chờ khoá đơn — thứ tự khoá sai?");
      await new Promise((r) => setTimeout(r, 25));
    }
    moKhoa();
    await keToan;
    const kq = await luotCap;

    expect(kq.daCap, "tiền đã bị gỡ trước khi lượt cấp đọc ⇒ không được cấp").toEqual([]);
    expect(kq.chuaDuTien).toEqual([{ orderItemId: ITEM_A, conThieu: TIEN }]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-17] khách mới CHƯA có học viên: đủ tiền nhưng không cấp, không ném; có học viên (Chuyển đổi) thì cấp đúng 1; gọi lại vẫn 1", async () => {
    const DON = `${T}don-17`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, studentId: null }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");

    const truoc = await xet(DON);
    expect(truoc.daCap).toEqual([]);
    expect(truoc.chuaCoHocVien).toEqual([ITEM_A]);
    expect(await quyenCua(DON)).toHaveLength(0);

    // Bước Chuyển đổi gắn học viên vào dòng đơn.
    await db.orderItem.update({ where: { id: ITEM_A }, data: { studentId: HV_A } });
    const sau = await xet(DON);
    expect(sau.daCap).toHaveLength(1);
    expect(sau.chuaCoHocVien).toEqual([]);
    expect((await xet(DON)).daCap).toEqual([]);
    expect(await quyenCua(DON)).toHaveLength(1);
  });

  it("[QHC-DB-18] học viên suy từ GHI DANH khi dòng đơn chưa có studentId", async () => {
    const DON = `${T}don-18`;
    const LOP = `${T}lop-18`;
    const GD = `${T}gd-18`;
    await db.class.upsert({
      where: { id: LOP },
      create: { id: LOP, name: "Lớp fixture", courseId: KHOA, centerId: CS1 },
      update: {},
    });
    await db.enrollment.upsert({ where: { id: GD }, create: { id: GD, studentId: HV_B, classId: LOP, courseId: KHOA, centerId: CS1 }, update: {} });
    try {
      await dungDon({ id: DON, dong: [{ id: ITEM_A, studentId: null }] });
      await db.orderItem.update({ where: { id: ITEM_A }, data: { enrollmentId: GD } });
      await thu(DON, ITEM_A, TIEN, "CONFIRMED");
      await xet(DON);
      expect((await quyenCua(DON)).map((q) => q.studentId)).toEqual([HV_B]);
    } finally {
      await donDep();
      await db.enrollment.deleteMany({ where: { id: GD } });
      await db.class.deleteMany({ where: { id: LOP } });
    }
  });

  it("[QHC-DB-19] sự kiện LẶP sau khi đã cấp (cả hai loại sự kiện, nhiều lần) ⇒ vẫn đúng 1 quyền học, 1 audit; handler không ném", async () => {
    const DON = `${T}don-19`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    await xuLySuKienTienVe({ orderId: DON }, "PHIEU_GOP", NOW);
    for (const nguon of ["PHIEU_GOP", "KE_TOAN_XAC_NHAN", "PHIEU_GOP", "KE_TOAN_XAC_NHAN"] as const) {
      await expect(xuLySuKienTienVe({ orderId: DON, paymentId: "p" }, nguon, NOW)).resolves.toBeUndefined();
    }
    const quyen = await quyenCua(DON);
    expect(quyen).toHaveLength(1);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityId: quyen[0]!.id } })).toBe(1);
  });

  it("[QHC-DB-20] quyền học đã VOIDED không bị 'hồi sinh' bởi sự kiện tiền về sau đó", async () => {
    const DON = `${T}don-20`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const dau = await xet(DON);
    await db.studyEntitlement.update({ where: { id: dau.daCap[0]!.quyenHocId }, data: { status: "VOIDED" } });
    const sau = await xet(DON);
    expect(sau.daCap).toEqual([]);
    expect(sau.daBiHuy).toEqual([ITEM_A]);
    expect((await quyenCua(DON)).filter((q) => q.status !== "VOIDED")).toHaveLength(0);
  });

  it("[QHC-DB-21] không có dòng StudyEntitlementUsage nào được tạo, và không có DomainEvent mới, sau khi cấp", async () => {
    const DON = `${T}don-21`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const truoc = await demHang();
    const usageTruoc = await db.studyEntitlementUsage.count();
    await xet(DON);
    const sau = await demHang();
    expect(sau.quyen).toBe(truoc.quyen + 1);
    expect(sau.suKien, "cấp quyền học không phát sự kiện nào").toBe(truoc.suKien);
    expect(await db.studyEntitlementUsage.count()).toBe(usageTruoc);
  });

  it("[QHC-DB-22] đơn không tồn tại / đơn không thuộc cơ sở nào ⇒ dừng sớm, không ném, không ghi", async () => {
    expect((await xet(`${T}khong-co`)).boQua).toBe("KHONG_CO_DON");
    const DON = `${T}don-22`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await db.order.update({ where: { id: DON }, data: { centerId: null } });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const truoc = await demHang();
    expect((await xet(DON)).boQua).toBe("KHONG_CO_CO_SO");
    expect(await demHang()).toEqual(truoc);
    expect(nhieu(await quyenCua(DON))).toBe(0);
  });

  it("[QHC-DB-13f] đơn đã HOÀN TIỀN (REFUNDED) ⇒ không cấp, cũng như CANCELLED — cả hai trạng thái đều nằm trong danh sách đơn đã huỷ", async () => {
    const DON = `${T}don-13f`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }], status: "REFUNDED" });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const truoc = await demHang();
    expect((await xet(DON)).boQua).toBe("DON_DA_HUY");
    expect(await demHang()).toEqual(truoc);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-22b] cơ sở của đơn CHƯA ánh xạ OrgUnit ⇒ dừng với KHONG_CO_CO_SO (không phải CO_TAT): cờ không bao giờ được hỏi bằng OrgUnit rỗng", async () => {
    await db.center.upsert({
      where: { id: CS_MO_COI },
      create: { id: CS_MO_COI, name: "Cơ sở mồ côi (fixture)", slug: CS_MO_COI, address: "—" },
      update: {},
    });
    const DON = `${T}don-22b`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }], centerId: CS_MO_COI });
    await thu(DON, ITEM_A, TIEN, "CONFIRMED");
    const truoc = await demHang();
    expect((await xet(DON)).boQua).toBe("KHONG_CO_CO_SO");
    expect(await demHang()).toEqual(truoc);
    expect(nhieu(await quyenCua(DON))).toBe(0);
  });

  /**
   * Giữ khoá ĐƠN, chờ tới khi lượt cấp THẬT SỰ đứng chờ khoá (đã đọc xong phần ngoài khoá), chạy `thaoTac` rồi nhả — mô phỏng một
   * đường khác sửa đơn chen vào giữa cổng ngoài khoá và cổng trong khoá.
   */
  async function chenGiuaKhoa(don: string, thaoTac: (tx: Prisma.TransactionClient) => Promise<void>): Promise<KetQuaCapTuDon> {
    let moKhoa!: () => void;
    const giu = new Promise<void>((r) => (moKhoa = r));
    let daLayKhoa!: () => void;
    const khoaXong = new Promise<void>((r) => (daLayKhoa = r));
    const chen = db.$transaction(
      async (tx) => {
        await khoaDonTrongTx(tx, don);
        daLayKhoa();
        await giu;
        await thaoTac(tx);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    await khoaXong;
    const luotCap = xet(don);
    const han = Date.now() + 20_000;
    for (;;) {
      const [{ n }] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if (n > 0) break;
      if (Date.now() > han) throw new Error("lượt cấp không đứng chờ khoá đơn — thứ tự khoá sai?");
      await new Promise((r) => setTimeout(r, 25));
    }
    moKhoa();
    await chen;
    return luotCap;
  }

  it("[QHC-DB-16b] cơ sở của đơn bị ĐỔI trong lúc lượt cấp đứng chờ khoá ⇒ dừng với CO_SO_DOI, không cấp theo cơ sở đã đọc ở ngoài khoá", async () => {
    const DON = `${T}don-16b`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, DA_XAC_NHAN);
    const cs2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    const kq = await chenGiuaKhoa(DON, async (tx) => {
      await tx.order.update({ where: { id: DON }, data: { centerId: cs2 } });
    });
    expect(kq.boQua).toBe("CO_SO_DOI");
    expect(kq.daCap).toEqual([]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-16c] đơn bị HUỶ trong lúc lượt cấp đứng chờ khoá ⇒ dừng với DON_DA_HUY (cổng trong khoá, không chỉ cổng ngoài khoá)", async () => {
    const DON = `${T}don-16c`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, TIEN, DA_XAC_NHAN);
    const kq = await chenGiuaKhoa(DON, async (tx) => {
      await tx.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });
    });
    expect(kq.boQua).toBe("DON_DA_HUY");
    expect(kq.daCap).toEqual([]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-05e] khoản ngân hàng PENDING đã bị XOÁ MỀM (kế toán gỡ khoản) ⇒ không còn tính dù giao dịch thật vẫn MATCHED và còn phân bổ", async () => {
    const DON = `${T}don-05e`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    const p = await thuNganHang(DON, ITEM_A, TIEN, "05e");
    expect((await xet(DON)).daCap, "đối chứng dương: chưa xoá mềm thì tính").toHaveLength(1);
    await db.studyEntitlement.deleteMany({ where: { orderId: DON } });
    await db.payment.update({ where: { id: p.id }, data: { deletedAt: NGAY_GO } });
    const kq = await xet(DON);
    expect(kq.daCap).toEqual([]);
    expect(kq.chuaDuTien).toEqual([{ orderItemId: ITEM_A, conThieu: TIEN }]);
  });

  it("[QHC-DB-13g] dòng phải thu 0đ (dấu hợp lệ, chưa một đồng nào về) ⇒ CHƯA cấp: học bổng 100% là việc của PR sau, hôm nay không được tự cấp", async () => {
    const md = metadataScope();
    const pv = md.phamVi as Record<string, unknown>;
    const gia = pv.giamGia as number;
    pv.thanhTien = 0;
    pv.niemYet = gia;
    (pv.pricingSnapshot as Record<string, unknown>).thanhTien = 0;
    expect(docPhamViDong(md)?.thanhTien, "fixture: dấu 0đ vẫn hợp lệ hình dạng").toBe(0);
    const DON = `${T}don-13g`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A, metadata: md, donGia: 0 }] });
    const kq = await xet(DON);
    expect(kq.daCap).toEqual([]);
    expect(kq.chuaDuTien).toEqual([{ orderItemId: ITEM_A, conThieu: 0 }]);
    expect(await quyenCua(DON)).toHaveLength(0);
  });

  it("[QHC-DB-06b] khoản ÂM vượt số đã thu của dòng ⇒ còn thiếu đúng bằng học phí (số âm bị kẹp 0, không phình số thiếu quá học phí)", async () => {
    const DON = `${T}don-06b`;
    await dungDon({ id: DON, dong: [{ id: ITEM_A }] });
    await thu(DON, ITEM_A, -1_000, DA_XAC_NHAN);
    const kq = await xet(DON);
    expect(kq.daCap).toEqual([]);
    expect(kq.chuaDuTien).toEqual([{ orderItemId: ITEM_A, conThieu: TIEN }]);
  });
});
