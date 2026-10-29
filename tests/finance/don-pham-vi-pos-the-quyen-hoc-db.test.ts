// tests/finance/don-pham-vi-pos-the-quyen-hoc-db.test.ts — ĐƯỜNG THẺ POS ⇒ QUYỀN HỌC của đơn theo PHẠM VI HỌC (SCOPE), trên Postgres THẬT.
//
// Chạy:  pnpm exec vitest run -c vitest.db.config.ts tests/finance/don-pham-vi-pos-the-quyen-hoc-db.test.ts
//        (DATABASE_URL/DIRECT_URL trỏ MỘT database tên chứa `satarobo_test`, vd `satarobo_test_cd2`)
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố `fx-cd2p-` / mã giao dịch `CD2P…`. Mỗi ca tự dựng đơn của mình
// (chạy MỘT MÌNH vẫn xanh — luật 18). Đồng hồ truyền vào (luật 19). Số tiền lẻ nghìn.
//
// ── VÌ SAO TỆP NÀY TỒN TẠI ──────────────────────────────────────────────────────────────────────────────────────────
// Trước tệp này `git grep` các test của đường thẻ POS (`nhapLoPos`, `moPhieuPos`, `khopGiaoDichThe`, `PosPaymentIntent`) ra 0 ca nào đi
// tới `StudyEntitlement`; ngược lại các test quyền học (`quyen-hoc-noi-duong-tien`, `quyen-hoc-cap-tu-don`) tự ghi `Payment` bằng tay
// hoặc gọi `allocateToOrder`. Hai nửa của chuỗi "khách quẹt thẻ ⇒ có quyền học" mỗi nửa đã xanh, chưa ai nối hai nửa.
//
// ── CHUỖI ĐƯỢC ĐO (mã THẬT, không giả lập tầng nào của nó) ──────────────────────────────────────────────────────────
//   đơn SCOPE (dấu do planner thật sinh) → `moPhieuPos` (phát phiếu gộp 5 ký tự + mở phiếu thẻ) → dòng giao dịch SmartPOS (đọc qua
//   `docFilePos` từ zip fixture, chỉ đổi số tiền/mã) → `nhapLoPos` / `khopGiaoDichThe` → `thuTheoPhieuGop` (khoá đơn, ghi `Payment` +
//   `PaymentAllocation`, `publishEvent("phieu-gop.da-chia")` TRONG transaction) → hàng đợi DomainEvent → handler của quyền học
//   (`registerCapQuyenHocHandlers`) → `hichCapQuyenHocChoDon` → `xetCapQuyenHocChoDon`.
//
// ⚠️ vitest KHÔNG chạy dispatcher của outbox. Test ĐỌC dòng `DomainEvent` mà `thuTheoPhieuGop` thật sự ghi và đưa NGUYÊN payload đó vào
// handler đã đăng ký (luật 9: không tự dựng payload). Nếu chỉ chạy `nhapLoPos` rồi thấy "không có quyền học" thì chưa kết luận được gì:
// quyền học chỉ sinh ra khi sự kiện được GIAO. Ca [CD2-POS-01] đo cả hai mốc (trước/sau khi giao) để ranh giới đó hiện ra.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

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
import { registerCapQuyenHocHandlers } from "@/lib/entitlements/su-kien";
import { hichCapQuyenHocChoDon } from "@/lib/entitlements/hich";
import { clearHandlers, getHandlers } from "@/lib/events/registry";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { khopGiaoDichThe, nhapLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { docFilePos } from "@/lib/payments/pos/doc-file-pos";
import { PROVIDER_THE_POS, dongHuyPosSchema, dongPosNhapSchema, type DongPos } from "@/lib/payments/pos/kieu";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, xemTruocKeHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { MAY_CS1 } from "@/tests/fixtures/pos/smartpos-that";
import { GD3, dungZipGd3 } from "@/tests/fixtures/pos/smartpos-gd3";

if (!RUN_DB_TESTS) console.warn(`[CD2P-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-cd2p-";
/** Mọi mã giao dịch của tệp này bắt đầu bằng đây (schema đòi `[0-9A-Za-z]{8,64}` nên không dùng được dấu `-`). */
const MA_TIEN_TO = "CD2P";
const KT = `${T}kt`;
const KHOA = `${T}khoa`;
const HV = `${T}hv`;
const ACTOR = { id: KT, name: "Kế toán fixture CD2P" };
const GIA48 = 10_560_000;
/** Thành tiền dòng SCOPE 48 buổi (con 1, sản phẩm 1) — planner thật tính, ghim lại ở `metadataScope`. */
const TIEN = 8_976_000;
const NOW = new Date("2026-10-05T03:00:00Z");
const SAU = new Date("2026-10-05T05:00:00Z");
const ZIP_TEN = "29092026_USER_TXN.zip";

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

/** Thành tiền dòng `soBuoi` buổi do planner THẬT tính (bản xem trước — không đối chiếu giá khách). KHÔNG gõ tay: đổi chính sách giá thì số này đổi theo. */
function thanhTienTheoSoBuoi(soBuoi: number): number {
  const kq = xemTruocKeHoachDon([{ ...dongVao, soBuoiMua: soBuoi, donGiaKhach: 0 }], BOI_CANH);
  if (kq.kieu !== "SCOPE") throw new Error(`fixture: planner không ra SCOPE cho ${soBuoi} buổi (${kq.kieu})`);
  return kq.dong[0]!.thanhTien;
}

/** Dấu SCOPE THẬT do planner của tầng tạo đơn sinh ra — không gõ tay. `soBuoi` ≠ 48 để tách "buổi ĐÃ MUA" khỏi `Course.totalSessions` (48). */
function metadataScope(soBuoi = 48): { md: Record<string, unknown>; tien: number } {
  const tien = thanhTienTheoSoBuoi(soBuoi);
  const kq = keHoachDon([{ ...dongVao, soBuoiMua: soBuoi, donGiaKhach: tien }], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId: KHOA, soBuoi }, KHOA);
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: planner không ra SCOPE");
  expect(docPhamViDong(md)?.thanhTien, "fixture: thành tiền planner").toBe(tien);
  if (soBuoi === 48) expect(tien, "fixture: giá 48 buổi").toBe(TIEN);
  return { md, tien };
}

let CS1 = "";
let OU1 = "";
let demDon = 0;
let demMa = 0;

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
  await db.auditLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: "Hệ thống — cấp quyền học" } }, { actorId: KT }, { entityType: "Order", entityId: { in: ids } }] },
  });
  await db.domainEvent.deleteMany({ where: { OR: ids.map((id) => ({ payloadJson: { path: ["orderId"], equals: id } })) } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: { in: ids } } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: MA_TIEN_TO } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.receipt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: { provider: PROVIDER_THE_POS, providerTxnId: { startsWith: MA_TIEN_TO } } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: ids } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: ids } } });
  await db.creditBalance.deleteMany({ where: { orderId: { in: ids } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.bankTransaction.deleteMany({ where: { provider: PROVIDER_THE_POS, providerTxnId: { startsWith: MA_TIEN_TO } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
}

/** Đơn SCOPE (hoặc đơn thường) 1 dòng + phiếu thu toàn đơn do `ensureFullOrderRequest` dựng — đúng thứ tạo đơn để lại. */
async function dungDon(o: { id: string; scope: boolean; soBuoi?: number }): Promise<{ orderId: string; itemId: string; requestId: string; tien: number }> {
  const itemId = `${o.id}-it`;
  const soBuoi = o.soBuoi ?? 48;
  const { md, tien } = o.scope ? metadataScope(soBuoi) : { md: { courseId: KHOA, soBuoi }, tien: TIEN };
  const code = `ORD-2699-CD2P-${++demDon}`;
  await db.order.create({
    data: {
      id: o.id,
      code,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: "0399000222",
      subtotal: tien,
      discountAmount: 0,
      totalAmount: tien,
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
      unitPrice: tien,
      totalPrice: tien,
      discountAmount: 0,
      studentId: HV,
      status: "ACTIVE",
      metadata: md as Prisma.InputJsonValue,
    },
  });
  const requestId = await db.$transaction((tx) => ensureFullOrderRequest(tx, { id: o.id, code, totalAmount: tien, centerId: CS1 }));
  if (!requestId) throw new Error("fixture: không dựng được phiếu thu toàn đơn");
  return { orderId: o.id, itemId, requestId, tien };
}

/** Sale bấm "Thu bằng thẻ POS" ⇒ phiếu gộp 5 ký tự + phiếu thẻ mở. Trả mã 5 ký tự. */
async function moPhieu(orderId: string, requestId: string): Promise<string> {
  const kq = await moPhieuPos({ orderId, paymentRequestId: requestId, actor: ACTOR, now: NOW });
  if (!kq.ok) throw new Error(`fixture: moPhieuPos từ chối — ${kq.error}`);
  return kq.phieu.code5;
}

/** Dòng giao dịch SmartPOS THẬT (đọc qua `docFilePos` từ zip fixture), mang `ma5` ở ô diễn giải, số tiền và mã giao dịch theo ý ca. */
async function dongThe(ma5: string, o: { soTien?: number; maGiaoDich?: string } = {}): Promise<DongPos> {
  const zip = await dungZipGd3({ thu: [ma5, "AAAAA", "AAAAA"], capHuy: "AAAAA", trongGhiChu: ["AAAAA", "AAAAA"] });
  const kq = await docFilePos(zip, ZIP_TEN);
  if (!kq.ok) throw new Error(`fixture: docFilePos từ chối — ${kq.loi}`);
  const goc = kq.dong.find((d) => d.maGiaoDich === GD3.thu[0]);
  if (!goc) throw new Error("fixture: không thấy dòng thu[0]");
  expect(goc.dienGiai, "fixture: diễn giải mang mã phiếu").toContain(ma5);
  return dongPosNhapSchema.parse({ ...goc, soTien: o.soTien ?? TIEN, maGiaoDich: o.maGiaoDich ?? `${MA_TIEN_TO}${String(++demMa).padStart(6, "0")}` });
}

const loSchema = z.object({ dong: z.array(dongPosNhapSchema), dongHuyCuaFile: z.array(dongHuyPosSchema) });

/** Nhập MỘT lô một dòng bằng ĐÚNG đường của màn (schema lối vào của action → `nhapLoPos`). */
async function nhapFile(dong: DongPos[]) {
  const batch = await db.posImportBatch.create({ data: { tenFile: ZIP_TEN, importedById: KT, soLoTong: 1 } });
  const p = loSchema.parse({ dong, dongHuyCuaFile: [] });
  return nhapLoPos({ batchId: batch.id, lo: 1, dong: p.dong, dongHuyCuaFile: p.dongHuyCuaFile, nguoiNhapId: KT });
}

/** Sự kiện `phieu-gop.da-chia` mà `thuTheoPhieuGop` THẬT đã ghi cho đơn — chưa giao. */
const suKienCua = (orderId: string) =>
  db.domainEvent.findMany({ where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], equals: orderId } }, orderBy: { createdAt: "asc" } });

/** Giao các sự kiện đó cho handler quyền học ĐÃ ĐĂNG KÝ, với NGUYÊN payload trong DB. Trả số sự kiện đã giao. */
async function giaoSuKien(orderId: string): Promise<number> {
  const evs = await suKienCua(orderId);
  for (const ev of evs) {
    const hs = getHandlers(ev.type);
    expect({ type: ev.type, soHandler: hs.length }, "chỉ handler quyền học được đăng ký ở bộ này").toEqual({ type: ev.type, soHandler: 1 });
    for (const h of hs) await h({ id: ev.id, type: ev.type, payload: (ev.payloadJson ?? {}) as Record<string, unknown> });
  }
  return evs.length;
}

/**
 * Handler quyền học và vỏ `hichCapQuyenHocChoDon` KHÔNG BAO GIỜ NÉM — lỗi chỉ được `console.error`. Nên một ca "ra đúng 1 quyền học" có thể xanh trong khi
 * phía sau lưng có lượt cấp đã nổ (vd P2002 của chỉ mục duy nhất bị lớp phòng thủ CUỐI cứu). Ca nào đo đua/lặp phải nghe lỗi được nuốt đó.
 */
function ngheLoiBiNuot() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return { khongLoi: () => expect(spy.mock.calls.map((c) => String(c[0])), "không lượt cấp nào nổ rồi bị nuốt").toEqual([]) };
}

const quyenCua = (orderId: string) => db.studyEntitlement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const demQuyenHoc = async () => ({
  quyen: await db.studyEntitlement.count({ where: { orderId: { startsWith: T } } }),
  cho: await db.studyEntitlementXuLy.count({ where: { orderId: { startsWith: T } } }),
  audit: await db.auditLog.count({ where: { module: "entitlements" } }),
});
const tienCua = async (orderId: string) => ({
  khoan: await db.payment.findMany({ where: { orderId }, select: { amount: true, method: true, accountantStatus: true, orderItemId: true } }),
  phanBo: await db.paymentAllocation.count({ where: { paymentRequest: { orderId } } }),
  phieu: (await db.paymentBill.findMany({ where: { orderId }, select: { status: true } })).map((p) => p.status),
});

describe.skipIf(!RUN_DB_TESTS)("[CD2P-DB] đường thẻ POS ⇒ quyền học của đơn SCOPE — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    await db.user.deleteMany({ where: { id: KT } });
    await db.user.create({ data: { id: KT, name: ACTOR.name, email: `${KT}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] } });
    await db.course.deleteMany({ where: { id: KHOA } });
    await db.course.create({ data: { id: KHOA, name: "Sata 3 (fixture CD2P)", slug: KHOA, price: GIA48, totalSessions: 48 } });
    await db.student.deleteMany({ where: { id: HV } });
    await db.student.create({ data: { id: HV, name: `${T}Bé A`, centerId: CS1, status: "ACTIVE" } });
    await db.posTerminal.deleteMany({ where: { maThietBi: MAY_CS1 } });
    await db.posTerminal.create({ data: { maThietBi: MAY_CS1, maQuay: "QTT45XWQT", centerId: CS1 } });
  });
  beforeEach(async () => {
    await donDep();
    await datCo(true);
    clearHandlers();
    registerCapQuyenHocHandlers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      await donDep();
      await datCo(null).catch(() => undefined);
      await db.posTerminal.deleteMany({ where: { maThietBi: MAY_CS1 } });
      await db.student.deleteMany({ where: { id: HV } });
      await db.course.deleteMany({ where: { id: KHOA } });
      await db.user.deleteMany({ where: { id: KT } });
    } finally {
      await disconnectDb();
    }
  });

  it("[CD2P-POS-01] CHUỖI ĐẦY ĐỦ: mở phiếu thẻ → nhập file → đủ tiền ⇒ Payment + phân bổ + sự kiện; quyền học chỉ ra đời SAU khi giao sự kiện, đúng MỘT, đúng số buổi", async () => {
    const { orderId, itemId, requestId } = await dungDon({ id: `${T}01`, scope: true });
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5);

    const kq = await nhapFile([d]);
    expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
    expect({ tuKhop: kq.tuKhop, canXuLy: kq.canXuLy }).toEqual({ tuKhop: 1, canXuLy: 0 });
    // Trạng thái trung gian — để ca không xanh vì lý do sai: dòng POS tự khớp, giao dịch ngân hàng MATCHED đúng số.
    const pos = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: d.maGiaoDich }, include: { bankTransaction: true } });
    expect(pos.matchStatus).toBe("TU_KHOP");
    expect(pos.maPhieu).toBe(ma5);
    expect(pos.bankTransaction).toMatchObject({ status: "MATCHED", amount: TIEN, provider: PROVIDER_THE_POS });
    const tien = await tienCua(orderId);
    // Khoản thẻ đi theo phiếu thu TOÀN ĐƠN (`orderItemId` null) — đơn một dòng nên `tienXacNhanTheoDong` gắn nó vào dòng duy nhất (luật `dongDuyNhat`).
    expect(tien.khoan).toEqual([{ amount: TIEN, method: "card_pos", accountantStatus: "PENDING", orderItemId: null }]);
    expect(tien.phanBo).toBe(1);
    expect(tien.phieu).toEqual(["PAID"]);

    // MỐC 1 — sự kiện đã nằm trong outbox, CHƯA ai giao: chưa có quyền học (ranh giới của vitest, cũng là của dispatcher chạy mỗi phút).
    const evs = await suKienCua(orderId);
    expect(evs).toHaveLength(1);
    expect(await quyenCua(orderId)).toHaveLength(0);

    // MỐC 2 — giao sự kiện thật cho handler thật.
    expect(await giaoSuKien(orderId)).toBe(1);
    const [q, ...conLai] = await quyenCua(orderId);
    expect(conLai, "đúng MỘT quyền học").toHaveLength(0);
    // `purchaseSessions` = số buổi đã MUA (48), lấy từ dấu SCOPE — không phải số buổi của khoá, không phỏng đoán.
    expect(q).toMatchObject({ studentId: HV, courseId: KHOA, orderItemId: itemId, status: "AWAITING_PLACEMENT", netAmount: TIEN, purchaseSessions: 48, consumedSessions: 0 });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } }), "chưa tiêu thụ buổi nào").toBe(0);
  });

  it("[CD2P-POS-02] IDEMPOTENT: giao sự kiện hai lần + nhập LẠI cùng file (lượt mới) ⇒ vẫn một Payment, một phân bổ, một sự kiện, MỘT quyền học", async () => {
    const { orderId, requestId } = await dungDon({ id: `${T}02`, scope: true });
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5);
    await nhapFile([d]);
    const nghe = ngheLoiBiNuot(); // chỉ nghe PHA CẤP QUYỀN — pha nhập POS có đường lỗi-đã-biết riêng của nó
    await giaoSuKien(orderId);
    await giaoSuKien(orderId); // cùng sự kiện, lần hai
    expect(await quyenCua(orderId)).toHaveLength(1);

    const truoc = { tien: await tienCua(orderId), su: (await suKienCua(orderId)).length, quyen: await demQuyenHoc() };
    const lai = await nhapFile([d]); // lượt nhập MỚI cùng dòng
    expect(lai.tuKhop, "dòng đã khoá — không khớp lần hai").toBe(0);
    expect(lai.capNhat).toBe(1);
    await giaoSuKien(orderId);
    expect({ tien: await tienCua(orderId), su: (await suKienCua(orderId)).length, quyen: await demQuyenHoc() }).toEqual(truoc);
    expect(await quyenCua(orderId)).toHaveLength(1);

    // GỬI LẠI CÙNG LÔ (cùng `batchId` + `lo` — trả lời bị mất trên đường về, V11): vẫn xử lý dòng (idempotent) nhưng KHÔNG cộng đôi số đếm của lượt.
    const batch = await db.posImportBatch.create({ data: { tenFile: ZIP_TEN, importedById: KT, soLoTong: 1 } });
    const p = loSchema.parse({ dong: [d], dongHuyCuaFile: [] });
    const lo = { batchId: batch.id, lo: 1, dong: p.dong, dongHuyCuaFile: p.dongHuyCuaFile, nguoiNhapId: KT };
    await nhapLoPos(lo);
    const dem1 = await db.posImportBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { soDong: true, soMoi: true, soCapNhat: true, soLoXong: true } });
    expect(dem1.soLoXong).toBe(1);
    await nhapLoPos(lo); // gửi lại y hệt
    const dem2 = await db.posImportBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { soDong: true, soMoi: true, soCapNhat: true, soLoXong: true } });
    expect(dem2, "gửi lại cùng lô không cộng đôi số đếm").toEqual(dem1);
    await giaoSuKien(orderId);
    expect({ tien: await tienCua(orderId), su: (await suKienCua(orderId)).length, quyen: await demQuyenHoc() }, "không Payment/sự kiện/quyền học mới").toEqual(truoc);
    expect(await quyenCua(orderId)).toHaveLength(1);
    nghe.khongLoi();
  });

  it("[CD2P-POS-03] CỜ TẮT (tắt hẳn / chưa đặt): tiền thẻ VẪN vào sổ, sự kiện VẪN phát, nhưng KHÔNG ghi gì vào quyền học / dòng chờ / AuditLog entitlements", async () => {
    for (const [ten, bat] of [["tắt hẳn", false], ["chưa đặt", null]] as const) {
      await donDep();
      await datCo(bat);
      const { orderId, requestId } = await dungDon({ id: `${T}03`, scope: true });
      const ma5 = await moPhieu(orderId, requestId);
      const d = await dongThe(ma5);
      const truoc = await demQuyenHoc();
      const kq = await nhapFile([d]);
      expect(kq.tuKhop, `${ten}: tiền vẫn khớp`).toBe(1);
      // ĐỐI CHỨNG DƯƠNG — tiền đã vào sổ thật, sự kiện đã phát: không có quyền học là do cờ chứ không phải do chuỗi gãy giữa chừng.
      const tien = await tienCua(orderId);
      expect({ ten, khoan: tien.khoan.length, phanBo: tien.phanBo, phieu: tien.phieu }).toEqual({ ten, khoan: 1, phanBo: 1, phieu: ["PAID"] });
      expect((await suKienCua(orderId)).length, `${ten}: sự kiện vẫn phát`).toBe(1);
      expect(await giaoSuKien(orderId)).toBe(1);
      expect({ ten, ...(await demQuyenHoc()) }).toEqual({ ten, ...truoc });
    }
  });

  it("[CD2P-POS-04] TIỀN THIẾU: quẹt ít hơn phiếu 1.000đ ⇒ matcher dừng ở LECH_TIEN (không Payment, không sự kiện), phiếu còn MỞ, KHÔNG quyền học — kể cả khi hích thẳng", async () => {
    const { orderId, requestId } = await dungDon({ id: `${T}04`, scope: true });
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5, { soTien: TIEN - 1_000 });
    const kq = await nhapFile([d]);
    expect({ tuKhop: kq.tuKhop, canXuLy: kq.canXuLy }).toEqual({ tuKhop: 0, canXuLy: 1 });
    // Trạng thái trung gian: dừng Ở MATCHER, không phải ở cổng quyền học.
    const pos = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: d.maGiaoDich }, include: { bankTransaction: true } });
    expect(pos.matchStatus).toBe("CAN_XU_LY");
    expect(pos.bankTransaction?.status).toBe("UNMATCHED");
    const tien = await tienCua(orderId);
    expect(tien.khoan).toEqual([]);
    expect(tien.phanBo).toBe(0);
    expect(tien.phieu).toEqual(["OPEN"]);
    expect(await suKienCua(orderId)).toHaveLength(0);
    // Hích thẳng (như cron/nút 'Thử cấp lại') cũng không cấp: không có đồng nào xác nhận.
    await hichCapQuyenHocChoDon(orderId, "HANG_DOI_THU_LAI", SAU);
    expect(await quyenCua(orderId)).toHaveLength(0);
  });

  it("[CD2P-POS-05] TIỀN THỪA: quẹt nhiều hơn phiếu 1.000đ ⇒ cùng kết cục (ăn cả hoặc không ăn gì), KHÔNG quyền học", async () => {
    const { orderId, requestId } = await dungDon({ id: `${T}05`, scope: true });
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5, { soTien: TIEN + 1_000 });
    const kq = await nhapFile([d]);
    expect({ tuKhop: kq.tuKhop, canXuLy: kq.canXuLy }).toEqual({ tuKhop: 0, canXuLy: 1 });
    const pos = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: d.maGiaoDich }, include: { bankTransaction: true } });
    expect(pos.matchStatus).toBe("CAN_XU_LY");
    expect(pos.bankTransaction?.status).toBe("UNMATCHED");
    expect((await tienCua(orderId)).khoan).toEqual([]);
    expect(await suKienCua(orderId)).toHaveLength(0);
    await hichCapQuyenHocChoDon(orderId, "HANG_DOI_THU_LAI", SAU);
    expect(await quyenCua(orderId)).toHaveLength(0);
  });

  it("[CD2P-POS-06] ĐỒNG THỜI: cùng một giao dịch thẻ vào qua HAI lô nhập + nút 'Kiểm tra' cùng lúc ⇒ một Payment; rồi 5 lượt giao sự kiện đồng thời ⇒ MỘT quyền học", async () => {
    const { orderId, requestId } = await dungDon({ id: `${T}06`, scope: true });
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5);
    const [a, b, c] = await Promise.all([nhapFile([d]), nhapFile([d]), khopGiaoDichThe({ d, nguonDuLieu: "SMARTPOS" })]);
    // Lượt THUA cuộc đua có thể báo MỘT dòng lỗi (đo 19/10/2026: ~1/4 lần, P2002 ở `bankTransaction.create` / `posCardTransaction.upsert` — hai lượt cùng
    // tạo dòng cho một giao dịch). Đó là hành vi có sẵn của lô nhập (`[POS1-RACE-01]` cũng không đòi `loi` rỗng) và KHÔNG chạm tiền; ca này chỉ đòi lỗi ấy
    // là lỗi của CHÍNH dòng này và tiền chỉ rót MỘT lần.
    for (const l of [...a.loi, ...b.loi]) expect(l.maGiaoDich).toBe(d.maGiaoDich);
    expect(a.tuKhop + b.tuKhop, "nhiều nhất MỘT lô tự khớp").toBeLessThanOrEqual(1);
    expect(c.tien, "nút 'Kiểm tra' cũng thấy tiền đã khoá hoặc tự khớp").not.toBeNull();
    // Chống đua của `thuTheoPhieuGop`: dù ba lượt tranh nhau, tiền chỉ rót MỘT lần.
    const tien = await tienCua(orderId);
    expect(tien.khoan).toHaveLength(1);
    expect(tien.phanBo).toBe(1);
    expect(tien.phieu).toEqual(["PAID"]);
    expect((await suKienCua(orderId)).length, "đúng một sự kiện (dedupeKey theo giao dịch × phiếu)").toBe(1);

    const nghe = ngheLoiBiNuot(); // chỉ nghe PHA CẤP QUYỀN
    await Promise.all(Array.from({ length: 5 }, () => giaoSuKien(orderId)));
    expect(await quyenCua(orderId)).toHaveLength(1);
    nghe.khongLoi();
  });

  it("[CD2P-POS-07] NÚT 'KIỂM TRA' (`khopGiaoDichThe`, không qua file): đủ tiền ⇒ quyền học sau khi giao sự kiện; rồi cùng giao dịch đi qua FILE ⇒ không Payment/quyền học thứ hai", async () => {
    const { orderId, requestId } = await dungDon({ id: `${T}07`, scope: true });
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5);
    const kq = await khopGiaoDichThe({ d, nguonDuLieu: "SMARTPOS" });
    expect(kq.trangThai).toBe("TU_KHOP");
    expect((await tienCua(orderId)).khoan).toHaveLength(1);
    expect(await giaoSuKien(orderId)).toBe(1);
    expect(await quyenCua(orderId)).toHaveLength(1);

    const truoc = { tien: await tienCua(orderId), su: (await suKienCua(orderId)).length };
    const f = await nhapFile([d]);
    expect(f.loi).toEqual([]);
    await giaoSuKien(orderId);
    expect({ tien: await tienCua(orderId), su: (await suKienCua(orderId)).length }).toEqual(truoc);
    expect(await quyenCua(orderId)).toHaveLength(1);
  });

  it("[CD2P-POS-08] ĐỐI CHỨNG — đơn THƯỜNG (không dấu SCOPE) + cờ BẬT: cùng chuỗi, tiền thẻ vào sổ, sự kiện được giao, KHÔNG quyền học (quyền học chỉ dành cho đơn SCOPE)", async () => {
    const { orderId, requestId } = await dungDon({ id: `${T}08`, scope: false });
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5);
    const truoc = await demQuyenHoc();
    expect((await nhapFile([d])).tuKhop).toBe(1);
    expect((await tienCua(orderId)).khoan).toHaveLength(1);
    expect(await giaoSuKien(orderId)).toBe(1);
    expect(await demQuyenHoc()).toEqual(truoc);
  });

  it("[CD2P-POS-09] SỐ BUỔI ĐÃ MUA ≠ SỐ BUỔI CỦA KHOÁ: mua 12 buổi của khoá 48 buổi, quẹt đúng thành tiền planner ⇒ quyền học 12 buổi (loại MILESTONE), không phải 48", async () => {
    const { orderId, itemId, requestId, tien } = await dungDon({ id: `${T}09`, scope: true, soBuoi: 12 });
    expect(tien, "fixture: giá 12 buổi khác giá 48 buổi").not.toBe(TIEN);
    expect(tien).toBeLessThan(TIEN);
    const ma5 = await moPhieu(orderId, requestId);
    const d = await dongThe(ma5, { soTien: tien });
    const kq = await nhapFile([d]);
    expect(kq.loi).toEqual([]);
    expect({ tuKhop: kq.tuKhop, canXuLy: kq.canXuLy }).toEqual({ tuKhop: 1, canXuLy: 0 });
    expect(await giaoSuKien(orderId)).toBe(1);
    const [q, ...conLai] = await quyenCua(orderId);
    expect(conLai).toHaveLength(0);
    expect(q).toMatchObject({ studentId: HV, courseId: KHOA, orderItemId: itemId, status: "AWAITING_PLACEMENT", netAmount: tien, purchaseSessions: 12, purchaseKind: "MILESTONE", consumedSessions: 0 });
    // Đối chứng: khoá vẫn là khoá 48 buổi — con số 12 đến từ dấu SCOPE của dòng, không từ `Course.totalSessions`.
    expect((await db.course.findUniqueOrThrow({ where: { id: KHOA }, select: { totalSessions: true } })).totalSessions).toBe(48);
  });
});
