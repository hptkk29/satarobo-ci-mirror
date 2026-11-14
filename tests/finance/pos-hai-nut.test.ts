// tests/finance/pos-hai-nut.test.ts — HAI NÚT QR / THẺ POS CHUNG MỘT MÃ + CỔNG HUỶ PHIẾU GỘP. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-gd1.test.ts`).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §1.6 · TỰ QUYẾT V1/V2/V6. Đi qua ĐÚNG cửa đời thật: tạo phiếu
// bằng `moPhieuPos` / `taoPhieuGop` (chính hàm action gọi), huỷ bằng `huyPhieuGop`, file bằng `nhapLoPos`.
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm có `now` đều được truyền mốc tuyệt đối. `NOW` cố ý ở QUÁ KHỨ so với
// đồng hồ thật để `min(createdAt thật của phiếu gộp, NOW)` luôn là `NOW` (khuôn pos-gd1).
//
// ⚠️ Ca "bị từ chối" luôn kèm ảnh chụp TRƯỚC/SAU của phiếu gộp · phiếu thẻ · đợt thu · dòng phiếu · nhật ký:
// luật rollback (CLAUDE.md) — cổng phải đứng trước phép ghi đầu tiên; "từ chối nhưng đã ghi" là lỗi thật đã
// từng xảy ra ở `goGanTheoCon`.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  docPhieuGopDangMo,
  doiTrangThaiPhieuTrongTx,
  dongPhieuGop,
  huyPhieuGop,
  phatHoacDungLaiPhieuGop,
  taoPhieuGop,
} from "@/lib/finance/phieu-gop";
import { LOI_HUY_KHI_CHUA_KET_LUAN as LOI_CHUA_KET_LUAN } from "@/lib/payments/pos/phieu-pos-luat";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { dungHocMotCon } from "@/lib/finance/dung-hoc-con";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { xuLyKetQuaPos, type TriggeredBy } from "@/lib/payments/pos/xu-ly-ket-qua";
import { trangThaiQrDot } from "@/lib/payments/qr-theo-dot";

if (!RUN_DB_TESTS) console.warn(`[HN1-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos1hn-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS1HN";

const KT = `${T}kt`; // người nhập file (khoá ngoại của lô import)
const SALE = `${T}sale`; // người lập đơn + tạo phiếu
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const MAY1 = `${PFX}MAY01`;
const MAY2 = `${PFX}MAY02`;
const SDT_PH = "0399812399";
const ACTOR = { id: SALE, name: "Sale fixture HN1" };

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B;

/** Lúc tạo phiếu thẻ. */
const NOW = new Date("2026-10-06T10:00:00Z");
/** Giờ quẹt (giờ VN) — SAU lúc tạo phiếu. */
const GIO_QUET = "2026-10-06T17:31:35+07:00";
const PHUT = 60_000;
const GIO = 60 * PHUT;
/** Lúc bấm Kiểm tra / lúc sale bấm Huỷ khi phiếu thẻ CÒN HẠN. */
const KIEM = new Date(NOW.getTime() + 40 * PHUT);
const CON_HAN = new Date(NOW.getTime() + 41 * PHUT);
const QUA_HAN = new Date(NOW.getTime() + 25 * GIO);

const LOI_CHO_QUET = "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước";
const LOI_CHO_KE_TOAN = "Giao dịch thẻ của mã này còn chờ kế toán xử lý — xử lý xong mới huỷ được phiếu";

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { providerTxnId: { startsWith: PFX } };

async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], equals: DON } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: { orderId: DON } } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: DON } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: [KT, SALE] } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: [KT, SALE] } } });
  await db.auditLog.deleteMany({
    where: { OR: [{ entityType: "Order", entityId: DON }, { actorId: { in: [KT, SALE] } }] },
  });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.creditBalance.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: LOC_BT });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: [KT, SALE] } } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: [KT, SALE] } }, { phone: { in: [SDT_PH, "84399812399"] } }] } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", "Kế toán fixture HN1"],
    [SALE, "SALES_CSM", "Sale fixture HN1"],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  for (const [id, ten] of [
    [CS1, "CS1 fixture POS1HN"],
    [CS2, "CS2 fixture POS1HN"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: "QTTFBKATK", centerId: CS2 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269979-000199",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture POS1HN",
      customerPhone: SDT_PH,
      totalAmount: TONG,
      centerId: CS1,
      createdById: SALE,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A HN1", DOT_TIEN_A],
    [B, "Bé B HN1", DOT_TIEN_B],
  ] as const) {
    await db.orderItem.create({
      data: { id, orderId: DON, type: "COURSE_ENROLLMENT", itemName: ten, quantity: 1, unitPrice: gia, totalPrice: gia },
    });
  }
  for (const [id, item, tien, thuTu] of [
    [DOT_A, A, DOT_TIEN_A, 1],
    [DOT_B, B, DOT_TIEN_B, 2],
  ] as const) {
    await db.paymentRequest.create({
      data: { id, orderId: DON, orderItemId: item, centerId: CS1, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: thuTu },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** Nút "Xuất QR" của một dòng đợt: phát phiếu gộp 1 dòng. */
async function phatPhieu(ids: string[] = [DOT_A]) {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}

/** Nút "Thẻ POS" của một dòng đợt. */
async function moPhieu(o: { now?: Date; dot?: string } = {}) {
  const r = await moPhieuPos({ orderId: DON, paymentRequestId: o.dot ?? DOT_A, actor: ACTOR, now: o.now ?? NOW });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  return r.phieu;
}

/** Nút "Huỷ phiếu" của phiếu gộp (lý do để trống — huỷ không đòi lý do, chốt 24/09). */
const huy = (billId: string, now: Date) => huyPhieuGop({ orderId: DON, billId, lyDo: "", actor: ACTOR, now });

const phieuPos = (id: string) => db.posPaymentIntent.findUniqueOrThrow({ where: { id } });
const phieuGopDb = (id: string) => db.paymentBill.findUniqueOrThrow({ where: { id } });

/** Ảnh chụp mọi thứ một lượt huỷ có thể đổi. `updatedAt` nằm trong đó ⇒ một phép ghi vô hình cũng làm nó lệch. */
async function chup(): Promise<string> {
  const [bill, intents, dots, lines, audit] = await Promise.all([
    db.paymentBill.findMany({ where: { orderId: DON }, orderBy: { id: "asc" } }),
    db.posPaymentIntent.findMany({ where: { paymentBill: { orderId: DON } }, orderBy: { id: "asc" } }),
    db.paymentRequest.findMany({ where: { orderId: DON }, orderBy: { id: "asc" } }),
    db.paymentBillLine.findMany({ where: { bill: { orderId: DON } }, orderBy: { id: "asc" } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: DON } }),
  ]);
  return JSON.stringify({ bill, intents, dots, lines, audit });
}

function paid(p: Partial<PosCheckResult> & { providerTxnId: string; dienGiai: string }): PosCheckResult {
  return {
    kind: "PAID",
    amount: DOT_TIEN_A,
    paidAt: GIO_QUET,
    approvalCode: "123456",
    cardMasked: "411111******1111",
    terminalCode: MAY1,
    ...p,
  };
}

function xuLy(intentId: string, ketQua: PosCheckResult, triggeredBy: TriggeredBy = "SALE", now: Date = KIEM) {
  return xuLyKetQuaPos({ intentId, ketQua, triggeredBy, now, nguonDuLieu: "FAKE" });
}

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TONG,
    thoiGian: GIO_QUET,
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: "998877665544",
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: "QTT45XWQT",
    maThietBi: MAY1,
    soTheMasked: "411111******1111",
    loaiThe: "VISA",
    maHachToan: null,
    phiGiaoDich: null,
    ...p,
  };
}

/** Một lượt import (đúng thứ màn làm: mở lượt, ghi lô, đánh dấu XONG). */
async function nhapFile(dongs: DongPos[]): Promise<KetQuaLoPos> {
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture.xlsx", importedById: KT, soLoTong: 1 } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: [], nguoiNhapId: KT });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  await db.posImportBatch.update({ where: { id: batch.id }, data: { soLoXong: 1, trangThai: "XONG" } });
  return kq;
}

const btThe = (ma: string) =>
  db.bankTransaction.findUnique({
    where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: ma } },
  });

// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[HN1-DB] hai nút chung một mã", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN1-DB-01] QR trước rồi Thẻ ⇒ MỘT PaymentBill; phiếu thẻ mang CHÍNH mã của phiếu gộp", async () => {
    const g = await phatPhieu([DOT_A]);
    const p = await moPhieu({ dot: DOT_A });
    expect(await db.paymentBill.count({ where: { orderId: DON } }), "nút thứ hai dùng lại, không phát mới").toBe(1);
    expect(p.code5).toBe(g.ma);
    const bill = await phieuGopDb(g.billId);
    expect(bill.matchKey, "mã của phiếu gộp").toBe(g.ma);
    const mo = await docPhieuGopDangMo(DON);
    expect(mo?.billId).toBe(g.billId);
    expect(mo?.ma, "màn đọc mã QR ở đây").toBe(p.code5);
    const dbPhieu = await phieuPos(p.intentId);
    expect(dbPhieu.paymentBillId).toBe(g.billId);
    expect(dbPhieu.code5, "màn đọc mã ghi chú POS ở đây").toBe(bill.matchKey);
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(1);
  });

  it("[HN1-DB-02] Thẻ trước rồi QR ⇒ vẫn MỘT PaymentBill; dòng đợt chuyển sang 'mã của đợt này'; phát thêm bị từ chối", async () => {
    const p = await moPhieu({ dot: DOT_A });
    const mo = await docPhieuGopDangMo(DON);
    expect(mo?.ma, "mã QR = mã phiếu thẻ").toBe(p.code5);
    // Dòng đợt giờ ở trạng thái "mã của đợt này" ⇒ màn vẽ nút QR bật/tắt, KHÔNG nút phát.
    const tt = trangThaiQrDot({
      bat: true,
      dongPhieuMo: (mo?.dong ?? []).map((d) => ({ paymentRequestId: d.paymentRequestId, nhan: d.ten })),
      paymentRequestId: DOT_A,
    });
    expect(tt.kieu).toBe("MOI_CUA_DOT_NAY");
    // Nếu một nút thứ hai vẫn cố phát phiếu cho đúng đợt đó ⇒ DB/cổng từ chối, không thêm phiếu.
    const them = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(them.ok).toBe(false);
    expect(await db.paymentBill.count({ where: { orderId: DON } })).toBe(1);
  });

  it("[HN1-DB-03] huỷ phiếu gộp khi phiếu thẻ ĐANG CHỜ ⇒ từ chối đúng câu, KHÔNG đổi một dòng nào", async () => {
    const g = await phatPhieu([DOT_A]);
    const p = await moPhieu({ dot: DOT_A });
    const truoc = await chup();
    const r = await huy(g.billId, CON_HAN);
    expect(r).toEqual({ ok: false, error: LOI_CHO_QUET });
    expect(await chup(), "cổng đứng TRƯỚC phép ghi đầu tiên: phiếu gộp · phiếu thẻ · đợt · dòng · nhật ký không đổi").toBe(truoc);
    expect((await phieuGopDb(g.billId)).status).toBe("OPEN");
    expect((await phieuPos(p.intentId)).status).toBe("CHO_QUET");
  });

  it("[HN1-DB-04a] ĐỐI CHỨNG DƯƠNG: phiếu gộp KHÔNG có phiếu thẻ ⇒ huỷ được", async () => {
    const g = await phatPhieu([DOT_A]);
    const r = await huy(g.billId, CON_HAN);
    expect(r.ok).toBe(true);
    expect((await phieuGopDb(g.billId)).status).toBe("VOID");
  });

  it("[HN1-DB-04b] ĐỐI CHỨNG DƯƠNG: phiếu thẻ đã HẾT HẠN (quá 24 giờ) ⇒ huỷ được", async () => {
    const g = await phatPhieu([DOT_A]);
    await moPhieu({ dot: DOT_A });
    // Còn hạn: chặn. Quá hạn: cho. Cùng phiếu, đổi đúng một yếu tố (đồng hồ).
    expect((await huy(g.billId, CON_HAN)).ok).toBe(false);
    const r = await huy(g.billId, QUA_HAN);
    expect(r.ok).toBe(true);
    expect((await phieuGopDb(g.billId)).status).toBe("VOID");
  });

  it("[HN1-DB-05] THAT_BAI vẫn là phiếu MỞ (khách quẹt lại với cùng mã) ⇒ cũng chặn", async () => {
    const g = await phatPhieu([DOT_A]);
    const p = await moPhieu({ dot: DOT_A });
    const kq = await xuLy(p.intentId, { kind: "FAILED", reasonCode: "USER_CANCELLED", providerTxnId: maGd() });
    expect(kq.status).toBe("THAT_BAI");
    const r = await huy(g.billId, CON_HAN);
    expect(r).toEqual({ ok: false, error: LOI_CHO_QUET });
    expect((await phieuGopDb(g.billId)).status).toBe("OPEN");
  });

  it("[HN1-DB-06] thẻ CHỜ KẾ TOÁN (LECH_TIEN, giao dịch còn ở hàng chờ) ⇒ chặn bằng câu riêng; kế toán xử lý xong ⇒ huỷ được", async () => {
    const g = await phatPhieu([DOT_A]);
    const p = await moPhieu({ dot: DOT_A });
    const lech = maGd();
    const kq = await xuLy(p.intentId, paid({ providerTxnId: lech, dienGiai: g.ma, amount: DOT_TIEN_A - 1 }));
    expect(kq.status, "máy thu lệch số ⇒ LECH_TIEN, giao dịch nằm hàng chờ").toBe("LECH_TIEN");
    const truoc = await chup();
    const r = await huy(g.billId, CON_HAN);
    expect(r).toEqual({ ok: false, error: LOI_CHO_KE_TOAN });
    expect(await chup(), "bị từ chối thì không ghi gì").toBe(truoc);
    // Đối chứng dương: kế toán bỏ qua giao dịch (rời hàng chờ) ⇒ huỷ được.
    await db.bankTransaction.update({ where: { id: (await btThe(lech))!.id }, data: { status: "IGNORED" } });
    const sau = await huy(g.billId, new Date(CON_HAN.getTime() + PHUT));
    expect(sau.ok, "đối chứng dương").toBe(true);
    expect((await phieuGopDb(g.billId)).status).toBe("VOID");
  });

  it("[HN1-DB-07] giao dịch thẻ mang MÃ phiếu nằm hàng chờ, phiếu thẻ đã quá hạn ⇒ VẪN chặn (T21 theo mã)", async () => {
    const g = await phatPhieu([DOT_A]);
    await moPhieu({ dot: DOT_A });
    // Quẹt ở máy CS2 (Q-E chặn khớp) ⇒ UNMATCHED, mang mã của phiếu gộp. Phiếu thẻ không nhận được nó.
    const m = maGd();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: MAY2 })]);
    expect((await btThe(m))?.status).toBe("UNMATCHED");
    // Phiếu thẻ đã QUÁ HẠN: nếu chỉ nhìn phiếu thẻ thì không còn gì "đang mở".
    const r = await huy(g.billId, QUA_HAN);
    expect(r).toEqual({ ok: false, error: LOI_CHO_KE_TOAN });
    expect((await phieuGopDb(g.billId)).status).toBe("OPEN");
    // Đối chứng dương: giao dịch rời hàng chờ ⇒ huỷ được.
    await db.bankTransaction.update({ where: { id: (await btThe(m))!.id }, data: { status: "IGNORED" } });
    expect((await huy(g.billId, QUA_HAN)).ok).toBe(true);
  });

  it("[HN1-DB-08] sự thật máy chủ `docTheDangMoCuaPhieuGop`: null → DANG_CHO → null (quá hạn) → CHO_KE_TOAN, theo đồng hồ truyền vào", async () => {
    // Nạp động: trên mã TRƯỚC bản vá module chưa có — chỉ ca này đỏ, các ca hành vi bên trên vẫn nói rõ từng chỗ.
    const { docTheDangMoCuaPhieuGop } = await import("@/lib/payments/pos/the-dang-mo");
    const hoi = (now: Date) => docTheDangMoCuaPhieuGop(db, { orderId: DON, now });
    expect(await hoi(NOW), "chưa có phiếu gộp").toBeNull();
    const g = await phatPhieu([DOT_A]);
    expect(await hoi(NOW), "có phiếu gộp, chưa có phiếu thẻ").toBeNull();
    await moPhieu({ dot: DOT_A });
    expect(await hoi(CON_HAN)).toBe("DANG_CHO");
    expect(await hoi(QUA_HAN), "quá hạn ⇒ không còn mở").toBeNull();
    // Giao dịch mang mã ở hàng chờ ⇒ chờ kế toán, kể cả khi phiếu thẻ đã quá hạn.
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, maThietBi: MAY2 })]);
    expect(await hoi(QUA_HAN)).toBe("CHO_KE_TOAN");
    expect(await hoi(CON_HAN), "chờ kế toán thắng đang chờ").toBe("CHO_KE_TOAN");
  });

  it("[HN1-DB-09] ĐƯỜNG KHÁC (dừng học) KHÔNG bị chặn bởi thẻ mở (V1 giữ) — và [VIỆC 6] nay HUỶ KÈM phiếu thẻ mở cùng phiếu gộp, trong MỘT transaction", async () => {
    // ĐÃ ĐẢO ở Việc 6 (mục 3, chủ dự án chốt 10/10/2026: "Dừng học: huỷ kèm phiếu thẻ đang mở trong cùng transaction với việc huỷ phiếu gộp"). Bản cũ ghi NHẬN hiện trạng: dừng học huỷ phiếu
    // gộp mà để phiếu thẻ MỞ ở lại ("màn nói 'phiếu gộp đã đóng'") — kèm lời dặn "không ai dời cổng cho gọn". LÝ LẼ của lời dặn vẫn đúng và còn nguyên: dừng học là quyết toán của hệ thống, KHÔNG bị cổng
    // thẻ của nút "Huỷ phiếu" chặn (cổng ở `huyPhieuGop`, không ở `doiTrangThaiPhieuTrongTx` — lưới `[HN1-W4]`); cái ĐẢO là phiếu thẻ không còn bị bỏ lại. Đủ bộ ca ở `pos-dung-hoc-huy-the.test.ts`.
    const g = await phatPhieu([DOT_A]);
    const p = await moPhieu({ dot: DOT_A });
    // Đối chứng: NÚT huỷ phiếu gộp vẫn bị chặn khi thẻ đang chờ — luật 7 của Việc 1 không đổi.
    expect((await huy(g.billId, CON_HAN)).ok, "nút 'Huỷ phiếu' bị chặn").toBe(false);
    expect((await phieuGopDb(g.billId)).status).toBe("OPEN");
    // Dừng học (cùng thao tác mà `dungHocConAction` làm) KHÔNG bị chặn…
    const r = await dungHocMotCon({ orderId: DON, orderItemId: A, lyDo: "PH_CHU_DONG", buoiCuoiId: null, ghiChu: null, phanDu: [], actor: ACTOR, now: CON_HAN });
    expect(r.ok, `dừng học phải thành công: ${!r.ok ? r.error : ""}`).toBe(true);
    expect((await phieuGopDb(g.billId)).status).toBe("VOID");
    // …và NAY huỷ kèm phiếu thẻ: không còn phiếu thẻ mở trên một mã đã chết.
    expect((await phieuPos(p.intentId)).status, "phiếu thẻ HUY cùng phiếu gộp").toBe("HUY");
    expect(r.ok && r.soPhieuTheDaHuy).toBe(1);
  });

  it("[HN1-DB-09b] hàm cấp thấp `doiTrangThaiPhieuTrongTx` vẫn KHÔNG mang cổng thẻ và KHÔNG biết phiếu thẻ (V1) — việc huỷ kèm phiếu thẻ của dừng học nằm ở tầng TRÊN nó", async () => {
    // Giữ phần hành vi của ca cũ: gọi thẳng hàm đổi trạng thái (không qua dừng học) vẫn VOID được phiếu gộp có thẻ mở và KHÔNG đụng phiếu thẻ. Đặt cổng thẻ vào hàm này sẽ để lại đợt VOID mà phiếu OPEN
    // (dừng học gọi nó SAU phép ghi đầu tiên); đặt việc huỷ phiếu thẻ vào đây sẽ đổi hành vi của MỌI đường khác dùng nó (đóng phiếu của kế toán…), điều chủ dự án chưa chốt (R-6.3a).
    const g = await phatPhieu([DOT_A]);
    const p = await moPhieu({ dot: DOT_A });
    const r = await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, DON);
      return doiTrangThaiPhieuTrongTx(tx, { orderId: DON, billId: g.billId, lyDo: "Dừng học: Bé A HN1", actor: ACTOR }, "VOID");
    });
    expect(r.ok).toBe(true);
    expect((await phieuGopDb(g.billId)).status).toBe("VOID");
    expect((await phieuPos(p.intentId)).status, "hàm cấp thấp chỉ đổi phiếu gộp").toBe("CHO_QUET");
  });

  it("[HN1-DB-10] ĐỢT KHÁC không lách được: phiếu thẻ của đợt A đang chờ ⇒ đợt B không phát được mã, không mở được thẻ", async () => {
    await phatPhieu([DOT_A]);
    await moPhieu({ dot: DOT_A });
    const truoc = await db.paymentBill.count({ where: { orderId: DON } });
    const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_B, actor: ACTOR, now: CON_HAN });
    expect(r.ok).toBe(false);
    const q = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_B], actor: ACTOR });
    expect(q.ok).toBe(false);
    expect(await db.paymentBill.count({ where: { orderId: DON } }), "vẫn một mã sống").toBe(truoc);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG VIỆC 1 (09/10/2026) — docs/pos-hai-nut-khai-may.md §1.11
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[HN2-DB] rà đối kháng việc 1", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Nút 'Xuất QR' ở phía máy chủ — chính hàm `taoPhieuGopAction` gọi. */
  const xuatQr = (ids: string[], now: Date = NOW) => phatHoacDungLaiPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR, now });

  it.each(["PROVIDER_ERROR", "PAID", "PAID_AMOUNT_MISMATCH"] as const)(
    "[HN2-DB-01] thẻ QUÁ HẠN mà lượt kiểm gần nhất là %s (chưa kết luận) ⇒ vẫn KHOÁ huỷ, không đổi một dòng nào",
    async (kind) => {
      const g = await phatPhieu([DOT_A]);
      const p = await moPhieu({ dot: DOT_A });
      await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { lastResultKind: kind } });
      const { docTheDangMoCuaPhieuGop } = await import("@/lib/payments/pos/the-dang-mo");
      expect(await docTheDangMoCuaPhieuGop(db, { orderId: DON, now: QUA_HAN })).toBe("CHUA_KET_LUAN");
      const truoc = await chup();
      const r = await huy(g.billId, QUA_HAN);
      expect(r).toEqual({ ok: false, error: LOI_CHUA_KET_LUAN });
      expect(await chup(), "cổng đứng TRƯỚC phép ghi đầu tiên").toBe(truoc);
      expect((await phieuGopDb(g.billId)).status).toBe("OPEN");
    },
  );

  it.each([null, "NOT_FOUND", "FAILED"] as const)(
    "[HN2-DB-01b] ĐỐI CHỨNG DƯƠNG: cùng thẻ quá hạn nhưng kết quả gần nhất là %s (kết luận được) ⇒ huỷ được",
    async (kind) => {
      const g = await phatPhieu([DOT_A]);
      const p = await moPhieu({ dot: DOT_A });
      await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { lastResultKind: kind } });
      const r = await huy(g.billId, QUA_HAN);
      expect(r.ok).toBe(true);
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
    },
  );

  it("[HN2-DB-02] THẺ trước rồi 'Xuất QR' (tab cũ / đồng nghiệp bấm sau) ⇒ DÙNG LẠI mã, không báo 'huỷ hoặc đóng phiếu đó trước'", async () => {
    const p = await moPhieu({ dot: DOT_A });
    const q = await xuatQr([DOT_A]);
    expect(q.ok, "bản cũ: 'Đơn này đã có một phiếu gộp đang mở — huỷ hoặc đóng phiếu đó trước'").toBe(true);
    if (!q.ok) return;
    expect(q.dungLai).toBe(true);
    expect(q.ma, "cùng mã với phiếu thẻ").toBe(p.code5);
    expect(await db.paymentBill.count({ where: { orderId: DON } })).toBe(1);
    expect(q.tongTien).toBe(DOT_TIEN_A);
  });

  it("[HN2-DB-02b] ĐỐI CHỨNG DƯƠNG: chưa có phiếu nào ⇒ 'Xuất QR' PHÁT mới (dungLai = false)", async () => {
    const q = await xuatQr([DOT_A]);
    expect(q.ok && q.dungLai).toBe(false);
    expect(await db.paymentBill.count({ where: { orderId: DON } })).toBe(1);
  });

  it("[HN2-DB-03] ĐUA: hai nút cùng đợt bấm đồng thời ⇒ cả hai thành công, MỘT PaymentBill, cùng một mã (lặp 8 lượt)", async () => {
    for (let lan = 0; lan < 8; lan++) {
      await dungFixture();
      const [qr, the] = await Promise.all([
        xuatQr([DOT_A]),
        moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: NOW }),
      ]);
      expect(qr.ok, `lượt ${lan}: nút QR — ${qr.ok ? "" : qr.error}`).toBe(true);
      expect(the.ok, `lượt ${lan}: nút Thẻ — ${the.ok ? "" : the.error}`).toBe(true);
      if (!qr.ok || !the.ok) return;
      expect(await db.paymentBill.count({ where: { orderId: DON } }), `lượt ${lan}`).toBe(1);
      expect(the.phieu.code5, `lượt ${lan}: cùng một mã`).toBe(qr.ma);
    }
  });

  it("[HN2-DB-04] đợt KHÁC đang giữ mã mà thẻ đang chờ ⇒ cả hai nút nhận câu 'đang chờ quẹt thẻ… chưa huỷ được', KHÔNG 'đóng hoặc huỷ mã đó'", async () => {
    await phatPhieu([DOT_A]);
    await moPhieu({ dot: DOT_A });
    const q = await xuatQr([DOT_B], CON_HAN);
    expect(q.ok).toBe(false);
    if (q.ok) return;
    expect(q.error).toContain("đang chờ quẹt thẻ");
    expect(q.error).toContain("chưa huỷ được");
    expect(q.error).not.toContain("đóng hoặc huỷ mã đó rồi xuất lại");
    const the = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_B, actor: ACTOR, now: CON_HAN });
    expect(the.ok).toBe(false);
    if (the.ok) return;
    expect(the.error).toContain("đang chờ quẹt thẻ");
    expect(the.error).not.toContain("đóng hoặc huỷ mã đó rồi xuất lại");
    expect(await db.paymentBill.count({ where: { orderId: DON } }), "vẫn một mã sống").toBe(1);
  });

  it("[HN2-DB-04b] ĐỐI CHỨNG DƯƠNG: đợt khác giữ mã mà KHÔNG có thẻ ⇒ câu cũ 'đóng hoặc huỷ' (lối thoát có thật)", async () => {
    await phatPhieu([DOT_A]);
    const q = await xuatQr([DOT_B], CON_HAN);
    expect(!q.ok && q.error).toContain("đóng hoặc huỷ mã đó rồi xuất lại");
  });

  it("[HN2-DB-05] `taoPhieuGop` trần: bị chỉ mục 'một đơn một phiếu mở' từ chối ⇒ mang cờ `daCoPhieuMo`; lỗi KHÁC thì không", async () => {
    await phatPhieu([DOT_A]);
    const them = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(them).toMatchObject({ ok: false, daCoPhieuMo: true });
    expect(!them.ok && them.error).toContain("đã có một phiếu gộp đang mở");
    // Đối chứng: lỗi khác (đợt không tồn tại) không được mượn cờ này — người gọi sẽ "dùng lại" nhầm.
    const khac = await taoPhieuGop({ orderId: DON, paymentRequestIds: ["khong-ton-tai"], actor: ACTOR });
    expect(khac.ok).toBe(false);
    expect("daCoPhieuMo" in khac).toBe(false);
  });

  it("[HN2-DB-06] dùng lại KHÔNG lách cổng khác: đợt không còn mở / không thuộc đơn vẫn bị từ chối bằng câu gốc", async () => {
    await phatPhieu([DOT_A]);
    const q = await xuatQr(["khong-ton-tai"]);
    expect(q.ok).toBe(false);
    expect(!q.ok && q.error).toContain("không tồn tại");
    expect(await db.paymentBill.count({ where: { orderId: DON } })).toBe(1);
  });

  it("[HN2-DB-07] 'Đóng phiếu' khi chưa nhận đồng nào: câu không còn vòng tròn 'dùng Huỷ phiếu' vô điều kiện", async () => {
    const g = await phatPhieu([DOT_A]);
    await moPhieu({ dot: DOT_A });
    const r = await dongPhieuGop({ orderId: DON, billId: g.billId, lyDo: "thử", actor: ACTOR });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("chưa có gì để đóng");
    expect(r.error, "nói rõ phiếu đang chờ thẻ thì chưa huỷ được").toContain("chờ quẹt thẻ");
  });
});
