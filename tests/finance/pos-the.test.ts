// tests/finance/pos-the.test.ts — NHẬP GIAO DỊCH THẺ SmartPOS vào sổ tiền. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// `pnpm test:unit` trần sẽ SKIP. Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo
// tiền tố id — cùng khuôn `tests/finance/phieu-gop.test.ts`.
//
// Thiết kế: `docs/pos-the-smartpos.md`. Đi qua `nhapLoPos` (đúng cửa mà màn import đi), không
// gọi thẳng `thuTheoPhieuGop` — thứ cần kiểm là DÂY NỐI giữa dòng file và sổ tiền.
//
// Fixture cố ý KHÔNG tròn số và có HAI con (một phiếu gộp ⇒ hai dòng `Payment`), giờ quẹt thẻ
// cách xa `now` để `paidDate = now` không thể trùng may với giờ quẹt.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { taoPhieuGop, thuTheoPhieuGop } from "@/lib/finance/phieu-gop";
import { ganTienTheoCon, goGanTheoCon } from "@/lib/finance/ghi-tien-don";
import { allocateToOrder } from "@/lib/payments/payos-ingest";
import { dongCanhBaoHuyPos } from "@/lib/payments/pos/dong-canh-bao-pos";
import { hoanViSoThuTu } from "@/lib/payments/cap-phat-ma";
import { sinhMa } from "@/lib/payments/ma-phieu";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongHuyPos, type DongPos } from "@/lib/payments/pos/kieu";
import {
  DUOI_CHAN_HOAN_MOT_PHAN,
  LY_DO_CHAN_HOAN_MOT_PHAN,
  LY_DO_HOAN_XEM_GOC,
  loaiCanhBaoPos,
} from "@/lib/payments/pos/phan-loai-pos";

if (!RUN_DB_TESTS) console.warn(`[POS-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-posdb-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOSDB";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture POS" };

const USER = `${T}user`;
const CENTER = `${T}center`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const MAY = "FXPOSDBMAY01";
// Đơn THỨ HAI — cho ca đua "tự khớp đơn A ‖ gắn tay đơn B".
const DON2 = `${T}don2`;
const B2 = `${T}item-b2`;
const DOT2 = `${T}dot2`;
// Cơ sở THỨ HAI + máy của nó — cho ca chặn quẹt chéo `[POS-DB-22]`.
const CENTER2 = `${T}center2`;
const MAY2 = "FXPOSDBMAY02";

const HOC_PHI_A = 6_336_000;
const HOC_PHI_B = 7_128_000;
const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG_PHIEU = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000

/** Giờ quẹt thẻ (giờ VN). Cố ý là QUÁ KHỨ xa — `paidDate = now` sẽ lộ ra ngay. */
const GIO_QUET = "2026-09-20T17:31:35+07:00";

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;

async function don() {
  await db.auditLog.deleteMany({ where: { actorId: ACTOR.id } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON2 } } });
  await db.payment.deleteMany({ where: { orderId: DON2 } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON2 } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.orderItem.deleteMany({ where: { orderId: DON2 } });
  await db.order.deleteMany({ where: { id: DON2 } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: USER } });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: { providerTxnId: { startsWith: PFX } } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: { in: [CENTER, CENTER2] } } });
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  await db.user.deleteMany({ where: { id: USER } });
}

async function dungFixture() {
  await don();
  await db.user.create({
    data: { id: USER, name: "Kế toán HO fixture", email: `${USER}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] },
  });
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture POS", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" },
  });
  await db.posTerminal.create({ data: { maThietBi: MAY, maQuay: "Q1", centerId: CENTER } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269929-000777",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture POS",
      customerPhone: "0328545229",
      totalAmount: HOC_PHI_A + HOC_PHI_B,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A POS", HOC_PHI_A],
    [B, "Bé B POS", HOC_PHI_B],
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
      data: { id, orderId: DON, orderItemId: item, centerId: CENTER, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: thuTu },
    });
  }
}

async function phatPhieu(): Promise<string> {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A, DOT_B], actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
  return r.ma;
}

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TONG_PHIEU,
    thoiGian: GIO_QUET,
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: "998877665544",
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: "Q1",
    maThietBi: MAY,
    soTheMasked: "411111******1111",
    loaiThe: "VISA",
    maHachToan: null,
    phiGiaoDich: null,
    ...p,
  };
}

/** Bản tóm của dòng hủy — đúng thứ màn import (`catLoPos`) gửi kèm mỗi lô. */
const tom = (d: DongPos): DongHuyPos => ({
  maGiaoDich: d.maGiaoDich,
  loaiGiaoDich: d.loaiGiaoDich,
  trangThai: d.trangThai,
  soTien: d.soTien,
  maGiaoDichGoc: d.maGiaoDichGoc,
  trangThaiHoanHuy: d.trangThaiHoanHuy,
});

async function lo(dongs: DongPos[], dongHuyCuaFile: DongPos[] = []): Promise<KetQuaLoPos> {
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture.xlsx", importedById: USER } });
  const kq = await nhapLoPos({
    batchId: batch.id,
    lo: 1,
    dong: dongs,
    dongHuyCuaFile: dongHuyCuaFile.map(tom),
    nguoiNhapId: USER,
  });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  return kq;
}

const posRow = (ma: string) =>
  db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: ma }, include: { bankTransaction: true } });
const soPayment = () => db.payment.count({ where: { orderId: DON } });
const soPhanBo = () => db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } });
const tongPaymentDon = async () =>
  (await db.payment.aggregate({ where: { orderId: DON, deletedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0;

describe.skipIf(!RUN_DB_TESTS)("[POS-DB] nhập giao dịch thẻ SmartPOS — DB thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS-DB-01] khớp ĐÚNG SỐ ⇒ TU_KHOP, Payment card_pos + marker, paidDate = GIỜ QUẸT, phiếu PAID", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    const kq = await lo([dong({ maGiaoDich: m, dienGiai: `Kiet 0328545229 ${ma}` })]);
    expect(kq).toMatchObject({ moi: 1, capNhat: 0, tuKhop: 1, canXuLy: 0, boQua: 0 });

    const r = await posRow(m);
    expect(r.matchStatus).toBe("TU_KHOP");
    expect(r.maPhieu).toBe(ma);
    expect(r.centerId).toBe(CENTER);
    expect(r.bankTransaction?.provider).toBe(PROVIDER_THE_POS);
    expect(r.bankTransaction?.status).toBe("MATCHED");
    expect(r.bankTransaction?.amount).toBe(TONG_PHIEU);
    // rawPayload KHÔNG mang số thẻ.
    expect(JSON.stringify(r.bankTransaction?.rawPayload)).not.toContain("411111");

    const khoan = await db.payment.findMany({ where: { orderId: DON }, orderBy: { amount: "asc" } });
    expect(khoan.map((k) => k.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
    expect(khoan.every((k) => k.method === "card_pos")).toBe(true);
    expect(khoan.every((k) => (k.note ?? "").includes(`[auto:card_pos:${m}]`))).toBe(true);
    const gioQuet = new Date(GIO_QUET).getTime();
    expect(khoan.map((k) => k.paidDate?.getTime()), "ngày thu = giờ quẹt thẻ, KHÔNG phải now").toEqual([gioQuet, gioQuet]);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("PAID");
  });

  it("[POS-DB-02a] ghi chú có SĐT + 300 ký tự rác ⇒ vẫn khớp", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    const rac = "ghi chu them ".repeat(24).slice(0, 300);
    await lo([dong({ maGiaoDich: m, dienGiai: `Kiet 0328545229 ${ma} ${rac}` })]);
    expect((await posRow(m)).matchStatus).toBe("TU_KHOP");
    expect(await soPayment()).toBe(2);
  });

  it("[POS-DB-02b] mã viết THƯỜNG, dính dấu câu ⇒ vẫn khớp", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: `hoc phi (${ma.toLowerCase()}).` })]);
    expect((await posRow(m)).matchStatus).toBe("TU_KHOP");
    expect(await soPayment()).toBe(2);
  });

  it("[POS-DB-02c] mã DÍNH liền chữ `abc<MA>xyz` ⇒ CAN_XU_LY, không Payment", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: `abc${ma}xyz` })]);
    const r = await posRow(m);
    expect(r.matchStatus).toBe("CAN_XU_LY");
    expect(r.matchReason).toContain("Không có mã phiếu");
    expect(r.bankTransaction?.status).toBe("UNMATCHED");
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-03] HAI mã hợp lệ ⇒ CAN_XU_LY, không Payment", async () => {
    const ma = await phatPhieu();
    const maKhac = sinhMa(hoanViSoThuTu(4_242));
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: `${ma} ${maKhac}` })]);
    const r = await posRow(m);
    expect(r.matchStatus).toBe("CAN_XU_LY");
    expect(r.matchReason).toContain("2 mã phiếu");
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-04] lệch 1đ ⇒ CAN_XU_LY (LECH_SO), giao dịch UNMATCHED, không Payment", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: ma, soTien: TONG_PHIEU - 1 })]);
    const r = await posRow(m);
    expect(r.matchStatus).toBe("CAN_XU_LY");
    expect(r.matchReason).toContain("LECH_SO");
    expect(r.bankTransaction?.status).toBe("UNMATCHED");
    expect(r.bankTransaction?.unmatchedNote).toContain("LECH_SO");
    expect(await soPayment()).toBe(0);
    expect(await soPhanBo()).toBe(0);
  });

  it("[POS-DB-05] import cùng lô HAI lần ⇒ 0 dòng POS mới, 0 Payment mới, 0 giao dịch mới", async () => {
    const ma = await phatPhieu();
    const dongs = [
      dong({ maGiaoDich: maGd(), dienGiai: ma }),
      dong({ maGiaoDich: maGd(), dienGiai: "khong co ma" }),
      dong({ maGiaoDich: maGd(), trangThai: "Thất bại" }),
    ];
    const lan1 = await lo(dongs);
    expect(lan1).toMatchObject({ moi: 3, tuKhop: 1, canXuLy: 1, boQua: 1 });
    const pos1 = await db.posCardTransaction.count({ where: { maGiaoDich: { startsWith: PFX } } });
    const bt1 = await db.bankTransaction.count({ where: { providerTxnId: { startsWith: PFX } } });
    const pay1 = await soPayment();

    const lan2 = await lo(dongs);
    expect(lan2.moi).toBe(0);
    expect(lan2.capNhat).toBe(3);
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: { startsWith: PFX } } })).toBe(pos1);
    expect(await db.bankTransaction.count({ where: { providerTxnId: { startsWith: PFX } } })).toBe(bt1);
    expect(await soPayment()).toBe(pay1);
    expect(pay1).toBe(2);
  });

  it("[POS-DB-06] import lại có Mã hạch toán + Phí ⇒ dòng TU_KHOP chỉ đổi cột kết toán", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: ma })]);
    const truoc = await posRow(m);

    await lo([dong({ maGiaoDich: m, dienGiai: "DA SUA GHI CHU", soTien: 1, maHachToan: "HT2609", phiGiaoDich: 73_310 })]);
    const sau = await posRow(m);
    expect(sau.maHachToan).toBe("HT2609");
    expect(sau.phiGiaoDich).toBe(73_310);
    expect(sau.dienGiai, "cột gốc giữ nguyên").toBe(truoc.dienGiai);
    expect(sau.soTien).toBe(truoc.soTien);
    expect(sau.matchStatus).toBe("TU_KHOP");
    expect(sau.importBatchId, "lô tạo ra dòng không đổi").toBe(truoc.importBatchId);
    expect(sau.lastImportBatchId).not.toBe(truoc.lastImportBatchId);
    expect(sau.bankTransaction?.amount).toBe(TONG_PHIEU);
    expect(await soPayment()).toBe(2);
  });

  it("[POS-DB-07] HỦY sau khi đã ghi nhận ⇒ cảnh báo, sổ tiền KHÔNG đổi, không Payment âm", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    const soTruoc = await soPayment();
    const tongTruoc = (await db.payment.aggregate({ where: { orderId: DON }, _sum: { amount: true } }))._sum.amount;
    const pbTruoc = await soPhanBo();

    const huy = maGd();
    await lo([dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU })]);

    const rHuy = await posRow(huy);
    expect(rHuy.matchStatus).toBe("CAN_XU_LY");
    expect(rHuy.matchReason).toBe("Giao dịch thẻ bị hủy sau khi đã ghi nhận");
    expect(rHuy.bankTransactionId, "dòng hủy không bao giờ sinh giao dịch").toBeNull();
    const rGoc = await posRow(goc);
    expect(rGoc.canhBaoHuy).toBe(true);
    expect(rGoc.bankTransaction?.status).toBe("MATCHED");

    expect(await soPayment()).toBe(soTruoc);
    expect((await db.payment.aggregate({ where: { orderId: DON }, _sum: { amount: true } }))._sum.amount).toBe(tongTruoc);
    expect(await soPhanBo()).toBe(pbTruoc);
    expect(await db.payment.count({ where: { orderId: DON, amount: { lt: 0 } } })).toBe(0);
  });

  it("[POS-DB-08] Thanh toán + Hủy CÙNG lô ⇒ gốc BO_QUA, không giao dịch sống, 0 Payment", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    const huy = maGd();
    // Dòng hủy đứng TRƯỚC trong file — tầng nhập tự xử lý thanh toán trước.
    const kq = await lo([
      dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU }),
      dong({ maGiaoDich: goc, dienGiai: ma }),
    ]);
    expect(kq.tuKhop).toBe(0);
    const rGoc = await posRow(goc);
    expect(rGoc.matchStatus).toBe("BO_QUA");
    expect(rGoc.bankTransaction === null || rGoc.bankTransaction.status === "IGNORED").toBe(true);
    expect((await posRow(huy)).matchStatus).toBe("BO_QUA");
    expect(await soPayment()).toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("OPEN");
  });

  it("[POS-DB-08b] cặp rơi vào HAI lô (dòng hủy của cả file gửi kèm) ⇒ gốc vẫn BO_QUA, 0 Payment", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    const huy = maGd();
    const dHuy = dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU });
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })], [dHuy]);
    await lo([dHuy]);
    expect((await posRow(goc)).matchStatus).toBe("BO_QUA");
    expect((await posRow(huy)).matchStatus).toBe("BO_QUA");
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-08c] import lại RIÊNG dòng gốc đã bị hủy (file ngày khác) ⇒ KHÔNG ghi tiền", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    const huy = maGd();
    await lo([
      dong({ maGiaoDich: goc, dienGiai: ma }),
      dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU }),
    ]);
    // File sau chỉ có dòng gốc, cột Hoàn/Hủy trống, không có dòng hủy nào gửi kèm.
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    expect((await posRow(goc)).matchStatus).toBe("BO_QUA");
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-09] thiết bị chưa khai ⇒ CAN_XU_LY, giao dịch UNMATCHED không cơ sở; khai máy rồi import lại ⇒ TU_KHOP", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    const mayLa = `${PFX}MAYLA`;
    const d = dong({ maGiaoDich: m, dienGiai: ma, maThietBi: mayLa });
    await lo([d]);
    const r1 = await posRow(m);
    expect(r1.matchStatus).toBe("CAN_XU_LY");
    expect(r1.matchReason).toBe("Thiết bị chưa gán cơ sở");
    expect(r1.centerId).toBeNull();
    expect(r1.bankTransaction?.status).toBe("UNMATCHED");
    expect(r1.bankTransaction?.centerId).toBeNull();
    expect(await soPayment()).toBe(0);

    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER } });
    const kq = await lo([d]);
    expect(kq).toMatchObject({ moi: 0, capNhat: 1, tuKhop: 1 });
    const r2 = await posRow(m);
    expect(r2.matchStatus).toBe("TU_KHOP");
    expect(r2.centerId).toBe(CENTER);
    expect(r2.bankTransactionId, "giao dịch cũ được dùng lại").toBe(r1.bankTransactionId);
    expect(await soPayment()).toBe(2);
  });

  it("[POS-DB-10] Thất bại / Đang xử lý ⇒ BO_QUA, không giao dịch", async () => {
    const ma = await phatPhieu();
    const m1 = maGd();
    const m2 = maGd();
    const kq = await lo([
      dong({ maGiaoDich: m1, dienGiai: ma, trangThai: "Thất bại" }),
      dong({ maGiaoDich: m2, dienGiai: ma, trangThai: "Đang xử lý" }),
    ]);
    expect(kq.boQua).toBe(2);
    for (const m of [m1, m2]) {
      const r = await posRow(m);
      expect(r.matchStatus).toBe("BO_QUA");
      expect(r.bankTransactionId).toBeNull();
    }
    expect(await db.bankTransaction.count({ where: { providerTxnId: { in: [m1, m2] } } })).toBe(0);
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-11] CAN_XU_LY gắn tay qua ganTienTheoCon ⇒ paidDate = giờ quẹt; import lại KHÔNG khớp lại", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: "khong ghi ma" })]);
    const r1 = await posRow(m);
    expect(r1.matchStatus).toBe("CAN_XU_LY");

    const gan = await ganTienTheoCon({
      bankTransactionId: r1.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
    });
    expect(gan.ok).toBe(true);
    const khoan = await db.payment.findMany({ where: { orderId: DON } });
    expect(khoan).toHaveLength(2);
    const gioQuet = new Date(GIO_QUET).getTime();
    expect(khoan.every((k) => k.paidDate?.getTime() === gioQuet), "gắn tay cũng lấy giờ quẹt").toBe(true);

    // Import lại — lần này ghi chú CÓ mã hợp lệ. Giao dịch đã MATCHED ⇒ khoá, không khớp lần hai.
    await lo([dong({ maGiaoDich: m, dienGiai: ma })]);
    expect(await soPayment()).toBe(2);
    expect((await posRow(m)).bankTransaction?.status).toBe("MATCHED");
  });

  it("[POS-DB-12] mã hợp lệ nhưng KHÔNG có phiếu ⇒ CAN_XU_LY, không Payment", async () => {
    await phatPhieu();
    const maLa = sinhMa(hoanViSoThuTu(4_243));
    expect(await db.paymentBill.count({ where: { matchKey: maLa } })).toBe(0);
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: `HP ${maLa}` })]);
    const r = await posRow(m);
    expect(r.matchStatus).toBe("CAN_XU_LY");
    expect(r.matchReason).toBe(`Mã ${maLa} không tra ra phiếu thu nào`);
    expect(r.bankTransaction?.status).toBe("UNMATCHED");
    expect(r.bankTransaction?.unmatchedNote).toBe(`Mã ${maLa} không tra ra phiếu thu nào`);
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-13] bộ đếm của lô cộng dồn (increment) qua nhiều lượt", async () => {
    const ma = await phatPhieu();
    const batch = await db.posImportBatch.create({ data: { tenFile: "hai-lo.zip", importedById: USER } });
    await nhapLoPos({ batchId: batch.id, lo: 1, dong: [dong({ maGiaoDich: maGd(), dienGiai: ma })], dongHuyCuaFile: [], nguoiNhapId: USER });
    await nhapLoPos({
      batchId: batch.id,
      lo: 2,
      dong: [dong({ maGiaoDich: maGd(), trangThai: "Thất bại" }), dong({ maGiaoDich: maGd(), dienGiai: "x" })],
      dongHuyCuaFile: [],
      nguoiNhapId: USER,
    });
    const b = await db.posImportBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(b).toMatchObject({ soDong: 3, soMoi: 3, soCapNhat: 0, soTuKhop: 1, soCanXuLy: 1, soBoQua: 1, soLoi: 0 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Rà đối kháng 29/09 — mỗi ca dưới là MỘT lỗi đã tái hiện trên DB thật.
  // ─────────────────────────────────────────────────────────────────────────

  const tongPayment = async (orderId: string) =>
    (await db.payment.aggregate({ where: { orderId, deletedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0;
  const tongPhanBoCuaGd = async (bankTransactionId: string) =>
    (await db.paymentAllocation.aggregate({ where: { bankTransactionId }, _sum: { amount: true } }))._sum.amount ?? 0;

  it("[POS-DB-14] dòng Hủy THẤT BẠI trỏ gốc (gửi kèm như màn import) ⇒ gốc vẫn TU_KHOP, tiền vào sổ", async () => {
    // Mã TRƯỚC bản vá: client gửi `maGocBiHuy` = mọi dòng loại ≠ "Thanh toán" có mã gốc, KHÔNG
    // xét Trạng thái ⇒ server tin nguyên ⇒ gốc BO_QUA, 0 BankTransaction, 0 Payment.
    const ma = await phatPhieu();
    const goc = maGd();
    const huyLoi = dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", trangThai: "Thất bại", maGiaoDichGoc: goc, soTien: -TONG_PHIEU });
    // Khác lô (dòng hủy chỉ đi kèm) và cùng lô đều phải cho cùng một kết quả.
    const kq = await lo([dong({ maGiaoDich: goc, dienGiai: ma })], [huyLoi]);
    expect(kq.tuKhop).toBe(1);
    expect((await posRow(goc)).matchStatus).toBe("TU_KHOP");
    await lo([huyLoi], []);
    expect((await posRow(huyLoi.maGiaoDich)).matchStatus).toBe("BO_QUA");
    const rGoc = await posRow(goc);
    expect(rGoc.canhBaoHuy, "hủy thất bại không được bật cảnh báo").toBe(false);
    expect(rGoc.bankTransaction?.status).toBe("MATCHED");
    expect(await soPayment()).toBe(2);
  });

  // ── [POS-DB-15a..c] ĐỔI 30/09/2026 theo Q-G ("Không dùng — chặn tự động"). Bản 29/09 ghim gốc
  // Ở LẠI hàng chờ UNMATCHED để gắn tay số ròng — nhưng gắn tay bị buộc Σ = số GỘP, nên luật đó
  // mời sổ ghi thừa đúng số đã hoàn. Nay: gốc chưa ghi nhận ⇒ IGNORED + cảnh báo trên gốc.
  it("[POS-DB-15a] hoàn MỘT PHẦN ở file sau (gốc đang chờ) ⇒ gốc IGNORED + cảnh báo (Q-G), KHÔNG còn trong hàng chờ", async () => {
    await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "quen ghi ma" })]);
    expect((await posRow(goc)).bankTransaction?.status).toBe("UNMATCHED");

    const hoan = maGd();
    const kq = await lo([
      dong({ maGiaoDich: goc, dienGiai: "quen ghi ma", trangThaiHoanHuy: "Hoàn một phần" }),
      dong({ maGiaoDich: hoan, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" }),
    ]);
    const rGoc = await posRow(goc);
    expect(rGoc.bankTransaction?.status, "số GỘP không được nằm trong hàng chờ gắn tay").toBe("IGNORED");
    expect(rGoc.bankTransaction?.unmatchedNote).toBe(LY_DO_CHAN_HOAN_MOT_PHAN);
    expect(rGoc.matchStatus).toBe("CAN_XU_LY");
    expect(rGoc.canhBaoHuy).toBe(true);
    expect(rGoc.canhBaoDaXuLyLuc).toBeNull();
    expect(loaiCanhBaoPos(rGoc.matchReason)).toBe("HOAN_MOT_PHAN");
    expect((await posRow(hoan)).matchReason).toBe(LY_DO_HOAN_XEM_GOC);
    expect(kq.canXuLy).toBe(2);
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-15b] gốc (mã đúng số) + hoàn một phần CÙNG file ⇒ gốc có giao dịch IGNORED (Q-G), KHÔNG tự khớp", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    const hoan = maGd();
    await lo([
      dong({ maGiaoDich: hoan, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" }),
      dong({ maGiaoDich: goc, dienGiai: ma }),
    ]);
    const rGoc = await posRow(goc);
    expect(rGoc.bankTransaction, "gốc vẫn có giao dịch — dấu vết của tiền thật").not.toBeNull();
    expect(rGoc.bankTransaction?.status).toBe("IGNORED");
    expect(rGoc.matchStatus).toBe("CAN_XU_LY");
    expect(rGoc.canhBaoHuy).toBe(true);
    expect(await soPayment(), "số đã lệch phiếu — không được tự khớp").toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("OPEN");

    // Import lại RIÊNG gốc (file ngày khác, cột Hoàn/Hủy trống) ⇒ vẫn không tự khớp.
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    expect((await posRow(goc)).bankTransaction?.status).toBe("IGNORED");
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-15c] file sau CHỈ có dòng hoàn một phần ⇒ gốc IGNORED + cảnh báo; dòng hoàn chờ cùng cảnh báo (Q-G)", async () => {
    await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "quen ghi ma" })]);
    const hoan = maGd();
    await lo([dong({ maGiaoDich: hoan, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000 })]);
    const rGoc = await posRow(goc);
    expect(rGoc.bankTransaction?.status).toBe("IGNORED");
    expect(rGoc.canhBaoHuy).toBe(true);
    expect(rGoc.matchReason).toContain(hoan);
    const rHoan = await posRow(hoan);
    expect(rHoan.matchStatus).toBe("CAN_XU_LY");
    expect(rHoan.matchReason).toBe(LY_DO_HOAN_XEM_GOC);
    // Import lại dòng hoàn ⇒ ổn định, không nhân đôi lý do.
    await lo([dong({ maGiaoDich: hoan, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000 })]);
    expect((await posRow(goc)).matchReason).toBe(rGoc.matchReason);
    expect((await posRow(hoan)).matchStatus).toBe("CAN_XU_LY");
  });

  it("[POS-DB-16] đóng cảnh báo ⇒ dòng hoàn kết luận; lần hoàn THỨ HAI ⇒ cảnh báo MỞ LẠI", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    const hoan1 = maGd();
    await lo([dong({ maGiaoDich: hoan1, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -500_000 })]);
    const g1 = await posRow(goc);
    expect(g1.canhBaoHuy).toBe(true);
    expect((await posRow(hoan1)).matchStatus).toBe("CAN_XU_LY");

    const dong1 = await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "Đã hoàn 500k", luc: new Date() });
    expect(dong1, "dòng hoàn 1 được kết luận cùng lượt đóng").toBe(1);
    expect((await posRow(hoan1)).matchStatus).toBe("BO_QUA");
    const canXuLy = () => db.posCardTransaction.count({ where: { maGiaoDich: { startsWith: PFX }, matchStatus: "CAN_XU_LY", bankTransactionId: null } });
    expect(await canXuLy(), "hàng chờ POS về 0").toBe(0);

    // Import lại dòng hoàn 1 ⇒ không bật lại gì.
    await lo([dong({ maGiaoDich: hoan1, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -500_000 })]);
    expect((await posRow(goc)).canhBaoDaXuLyLuc).not.toBeNull();

    const hoan2 = maGd();
    await lo([dong({ maGiaoDich: hoan2, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -700_000 })]);
    const g2 = await posRow(goc);
    expect(g2.canhBaoHuy).toBe(true);
    expect(g2.canhBaoDaXuLyLuc, "cảnh báo phải MỞ LẠI cho lần hoàn mới").toBeNull();
    expect(g2.matchReason).toContain(hoan2);
    expect(await canXuLy()).toBe(1);
    expect(await soPayment(), "không bao giờ tự đảo bút toán").toBe(2);
  });

  it("[POS-DB-17] dòng Hủy ở lô 1, gốc ở lô 2 ⇒ dòng Hủy KHÔNG kẹt 'Chưa thấy gốc'", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    const huy = maGd();
    const dHuy = dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU });
    await lo([dHuy]);
    expect((await posRow(huy)).matchReason).toContain("Chưa thấy giao dịch gốc");
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })], [dHuy]);
    expect((await posRow(goc)).matchStatus).toBe("BO_QUA");
    const rHuy = await posRow(huy);
    expect(rHuy.matchStatus).toBe("BO_QUA");
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-18] máy chưa khai + gắn tay vào đơn ⇒ dòng POS gốc nhận cơ sở của giao dịch khi bị hủy", async () => {
    const m = maGd();
    const mayLa = `${PFX}MAYLA2`;
    await lo([dong({ maGiaoDich: m, dienGiai: "khong ma", maThietBi: mayLa })]);
    const r1 = await posRow(m);
    expect(r1.centerId).toBeNull();
    const gan = await ganTienTheoCon({
      bankTransactionId: r1.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
    });
    expect(gan.ok).toBe(true);
    expect((await posRow(m)).bankTransaction?.centerId).toBe(CENTER);

    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: m, soTien: -TONG_PHIEU, maThietBi: mayLa })]);
    const r2 = await posRow(m);
    expect(r2.canhBaoHuy).toBe(true);
    expect(r2.centerId, "NULL ⇒ mọi cơ sở thấy mã đơn + tên khách của cơ sở này").toBe(CENTER);
  });

  it("[POS-DB-19] ĐUA: import lại tự khớp đơn A ‖ gắn tay cùng giao dịch vào đơn B ⇒ tiền ghi MỘT lần", async () => {
    let doi = 0;
    for (let lan = 0; lan < 6; lan++) {
      await dungFixture();
      await db.order.create({
        data: {
          id: DON2,
          code: "ORD-269929-000778",
          type: "COURSE",
          status: "PENDING_PAYMENT",
          customerName: "Phụ huynh fixture POS 2",
          customerPhone: "0328545230",
          totalAmount: TONG_PHIEU,
          centerId: CENTER,
        },
      });
      await db.orderItem.create({
        data: { id: B2, orderId: DON2, type: "COURSE_ENROLLMENT", itemName: "Bé C POS", quantity: 1, unitPrice: TONG_PHIEU, totalPrice: TONG_PHIEU },
      });
      await db.paymentRequest.create({
        data: { id: DOT2, orderId: DON2, orderItemId: B2, centerId: CENTER, installmentNo: 1, amountDue: TONG_PHIEU, status: "PENDING", sortOrder: 1 },
      });
      const ma = await phatPhieu();
      const m = maGd();
      await lo([dong({ maGiaoDich: m, dienGiai: "quen ma" })]);
      const btId = (await posRow(m)).bankTransactionId!;

      const batch = await db.posImportBatch.create({ data: { tenFile: "dua.xlsx", importedById: USER } });
      const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await Promise.all([
        nhapLoPos({ batchId: batch.id, lo: 1, dong: [dong({ maGiaoDich: m, dienGiai: ma })], dongHuyCuaFile: [], nguoiNhapId: USER }),
        cho(lan * 3).then(() =>
          ganTienTheoCon({
            bankTransactionId: btId,
            orderId: DON2,
            dong: [{ paymentRequestId: DOT2, soTien: TONG_PHIEU }],
            actor: ACTOR,
          }),
        ),
      ]);
      const pb = await tongPhanBoCuaGd(btId);
      const pay = (await tongPayment(DON)) + (await tongPayment(DON2));
      if (pb > TONG_PHIEU || pay > TONG_PHIEU) doi += 1;
      expect(pb, `lượt ${lan}: phân bổ của MỘT giao dịch`).toBe(TONG_PHIEU);
      expect(pay, `lượt ${lan}: tổng Payment hai đơn`).toBe(TONG_PHIEU);
    }
    expect(doi).toBe(0);
  });

  it("[POS-DB-19b] ĐUA: 'Rót vào đơn' A (allocateToOrder) ‖ gắn tay cùng giao dịch vào đơn B ⇒ tiền ghi MỘT lần", async () => {
    // Canh dòng `khoaGiaoDichTrongTx(tx, bankTransactionId)` trong `allocateToOrder`: khoá đơn
    // (advisory) không chặn lượt gắn cùng giao dịch vào ĐƠN KHÁC; thiếu khoá dòng ⇒ cả hai đọc
    // UNMATCHED rồi cùng ghi ⇒ tiền đôi. `[POS-DB-19]` đi qua `thuTheoPhieuGop`, không qua đây.
    let doi = 0;
    for (let lan = 0; lan < 8; lan++) {
      await dungFixture();
      await db.order.create({
        data: {
          id: DON2,
          code: "ORD-269929-000779",
          type: "COURSE",
          status: "PENDING_PAYMENT",
          customerName: "Phụ huynh fixture POS 2",
          customerPhone: "0328545230",
          totalAmount: TONG_PHIEU,
          centerId: CENTER,
        },
      });
      await db.orderItem.create({
        data: { id: B2, orderId: DON2, type: "COURSE_ENROLLMENT", itemName: "Bé C POS", quantity: 1, unitPrice: TONG_PHIEU, totalPrice: TONG_PHIEU },
      });
      await db.paymentRequest.create({
        data: { id: DOT2, orderId: DON2, orderItemId: B2, centerId: CENTER, installmentNo: 1, amountDue: TONG_PHIEU, status: "PENDING", sortOrder: 1 },
      });
      const m = maGd();
      await lo([dong({ maGiaoDich: m, dienGiai: "quen ma" })]);
      const btId = (await posRow(m)).bankTransactionId!;
      const order = await db.order.findUniqueOrThrow({
        where: { id: DON },
        select: { id: true, code: true, status: true, centerId: true, orgUnitId: true, studentId: true, leadId: true, student: { select: { id: true, parentUserId: true } } },
      });
      const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Lệch nhau theo lượt để mỗi bên đều có lượt vào trước.
      const truoc = lan % 2 === 0;
      await Promise.all([
        cho(truoc ? 0 : lan).then(() =>
          allocateToOrder({
            bankTransactionId: btId,
            order,
            amount: TONG_PHIEU,
            provider: PROVIDER_THE_POS,
            providerTxnId: m,
            target: { paymentRequestId: DOT_A, orderId: DON, via: "manual" },
            data: { description: "rot tay", amount: TONG_PHIEU, reference: m },
          }).catch(() => null),
        ),
        cho(truoc ? lan : 0).then(() =>
          ganTienTheoCon({
            bankTransactionId: btId,
            orderId: DON2,
            dong: [{ paymentRequestId: DOT2, soTien: TONG_PHIEU }],
            actor: ACTOR,
          }),
        ),
      ]);
      const pb = await tongPhanBoCuaGd(btId);
      const pay = (await tongPayment(DON)) + (await tongPayment(DON2));
      if (pb > TONG_PHIEU || pay > TONG_PHIEU) doi += 1;
    }
    expect(doi, "số lượt ghi tiền ĐÔI").toBe(0);
  });

  it("[POS-DB-20] gỡ gắn rồi import lại ⇒ KHÔNG tự khớp lại, KHÔNG xoá lý do gỡ, dòng POS về CAN_XU_LY", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: ma })]);
    const r1 = await posRow(m);
    expect(r1.matchStatus).toBe("TU_KHOP");
    const go = await goGanTheoCon({ bankTransactionId: r1.bankTransactionId!, orderId: DON, lyDo: "gắn nhầm phiếu", actor: ACTOR });
    expect(go.ok).toBe(true);

    await lo([dong({ maGiaoDich: m, dienGiai: ma, maHachToan: "HT01" })]);
    const r2 = await posRow(m);
    expect(r2.bankTransaction?.status).toBe("UNMATCHED");
    expect(r2.bankTransaction?.unmatchedNote).toBe("Đã gỡ gắn: gắn nhầm phiếu");
    expect(r2.matchStatus).toBe("CAN_XU_LY");
    expect(r2.maHachToan).toBe("HT01");
    expect(await tongPayment(DON), "sổ A ròng = 0 sau gỡ, không ghi thêm").toBe(0);
  });

  it("[POS-DB-21] gỡ gắn rồi 'Rót vào đơn' lại CÙNG đơn ⇒ Σ Payment ròng = Σ phân bổ", async () => {
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: ma })]);
    const btId = (await posRow(m)).bankTransactionId!;
    const go = await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "đối soát lại", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect(await tongPayment(DON)).toBe(0);

    const order = await db.order.findUniqueOrThrow({
      where: { id: DON },
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
    const kq = await allocateToOrder({
      bankTransactionId: btId,
      order,
      amount: TONG_PHIEU,
      provider: PROVIDER_THE_POS,
      providerTxnId: m,
      target: { paymentRequestId: DOT_A, orderId: DON, via: "manual" },
      data: { description: ma, amount: TONG_PHIEU, reference: m },
    });
    expect(kq.status).toBe("MATCHED");
    const pb = await tongPhanBoCuaGd(btId);
    expect(pb).toBeGreaterThan(0);
    expect(await tongPayment(DON), "sổ A phải bằng sổ B").toBe(pb);
  });

  it("[POS-DB-21b] 'Rót vào đơn' → gỡ gắn → phát mã mới ⇒ thuTheoPhieuGop (CÙNG giao dịch) ghi Payment, sổ A = sổ B", async () => {
    // Canh bộ lọc marker của `thuTheoPhieuGop` (chỉ đếm dòng PAYMENT chưa bị đảo). `[POS-DB-21]`
    // chỉ khoá đường `allocateToOrder`. Bộ lọc CŨ (`note contains marker`, không xét bút toán đảo)
    // thấy dòng đã đảo ⇒ bỏ ghi `Payment` ⇒ sổ A ròng 0 trong khi sổ B đã thu.
    //
    // ĐỔI VÌ Q-M (30/09/2026): bản cũ đi qua "mã phiếu gộp về lại (phiếu vẫn OPEN)" — gỡ gắn THẺ nay
    // luôn ĐÓNG phiếu mà tiền của nó đang lấp (phiếu 0đ hiện lại cũng là mở lại). Lý lẽ của ca (bộ lọc
    // marker) giữ nguyên: CÙNG giao dịch thẻ, sau lượt gỡ, trả một phiếu MỚI — marker cũ đã bị đảo.
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: "quen ma" })]);
    const btId = (await posRow(m)).bankTransactionId!;
    const order = await db.order.findUniqueOrThrow({
      where: { id: DON },
      select: { id: true, code: true, status: true, centerId: true, orgUnitId: true, studentId: true, leadId: true, student: { select: { id: true, parentUserId: true } } },
    });
    const rot = await allocateToOrder({
      bankTransactionId: btId,
      order,
      amount: TONG_PHIEU,
      provider: PROVIDER_THE_POS,
      providerTxnId: m,
      target: { paymentRequestId: DOT_A, orderId: DON, via: "manual" },
      data: { description: "rot tay", amount: TONG_PHIEU, reference: m },
    });
    expect(rot.status).toBe("MATCHED");
    const go = await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "rót nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect(await tongPayment(DON)).toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON, matchKey: ma } })).status, "Q-M: thẻ ⇒ phiếu ĐÓNG").toBe("CLOSED");
    const maMoi = await phatPhieu();

    const r = await thuTheoPhieuGop({
      bankTransactionId: btId,
      provider: PROVIDER_THE_POS,
      providerTxnId: m,
      noiDung: maMoi,
      soTienVe: TONG_PHIEU,
      ngayThu: new Date(GIO_QUET),
    });
    expect(r).toMatchObject({ xuLy: true, ketQua: "DA_CHIA" });
    const pb = await tongPhanBoCuaGd(btId);
    expect(pb).toBe(TONG_PHIEU);
    expect(await tongPayment(DON), "sổ A phải bằng sổ B").toBe(pb);
  });

  it("[POS-DB-26] dòng lỗi GIỮA khớp tiền và câu ghi kết quả ⇒ import lại chữa dòng POS về TU_KHOP, không ghi tiền lần hai", async () => {
    // Dựng đúng trạng thái sau khi `thuTheoPhieuGop` đã ghi tiền mà câu `posCardTransaction.update`
    // cuối lượt ném lỗi (rớt kết nối / hết pool): giao dịch MATCHED, dòng POS kẹt "Đang khớp phiếu".
    // Mã TRƯỚC bản vá: nhánh ĐÃ KHOÁ chỉ cập nhật cột kết toán ⇒ kẹt CAN_XU_LY vĩnh viễn.
    const ma = await phatPhieu();
    const m = maGd();
    await lo([dong({ maGiaoDich: m, dienGiai: ma })]);
    await db.posCardTransaction.update({
      where: { maGiaoDich: m },
      data: { matchStatus: "CAN_XU_LY", matchReason: `Đang khớp phiếu ${ma}` },
    });
    await lo([dong({ maGiaoDich: m, dienGiai: ma, maHachToan: "HT09" })]);
    const r = await posRow(m);
    expect(r.matchStatus).toBe("TU_KHOP");
    expect(r.matchReason).toBe("Đã ghi nhận");
    expect(r.maHachToan).toBe("HT09");
    expect(await soPayment()).toBe(2);
  });

  it("[POS-DB-22] QUẸT CHÉO: máy cơ sở khác + mã phiếu của đơn cơ sở này ⇒ CAN_XU_LY, 0 Payment, phiếu OPEN", async () => {
    // Chủ dự án chốt 29/09/2026 (Q-E): "không có trường hợp đó xảy ra nên chặn quẹt chéo luôn".
    await db.center.create({
      data: { id: CENTER2, name: "Cơ sở fixture POS 2", slug: `${T}co-so-2`, address: "114 Hoàng Diệu" },
    });
    await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: "Q2", centerId: CENTER2 } });
    const ma = await phatPhieu();

    const cheo = maGd();
    const kq = await lo([dong({ maGiaoDich: cheo, dienGiai: `Kiet 0328545229 ${ma}`, maThietBi: MAY2 })]);
    expect(kq).toMatchObject({ tuKhop: 0, canXuLy: 1 });
    const r = await posRow(cheo);
    const lyDo = `Máy POS thuộc Cơ sở fixture POS 2 nhưng mã ${ma} là phiếu của đơn ở cơ sở khác — không tự khớp quẹt chéo`;
    expect(r.matchStatus).toBe("CAN_XU_LY");
    expect(r.matchReason).toBe(lyDo);
    expect(r.matchReason, "không lộ mã đơn").not.toContain("ORD-");
    expect(r.matchReason, "không lộ tên khách").not.toContain("Phụ huynh");
    expect(r.centerId).toBe(CENTER2);
    expect(r.bankTransaction?.status).toBe("UNMATCHED");
    expect(r.bankTransaction?.unmatchedNote).toBe(lyDo);
    expect(r.bankTransaction?.centerId).toBe(CENTER2);
    expect(await soPayment()).toBe(0);
    expect(await soPhanBo()).toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("OPEN");

    // Đối chứng dương: CÙNG mã, quẹt ở máy CÙNG cơ sở với đơn ⇒ tự khớp.
    const dung = maGd();
    const kq2 = await lo([dong({ maGiaoDich: dung, dienGiai: `Kiet 0328545229 ${ma}` })]);
    expect(kq2).toMatchObject({ tuKhop: 1, canXuLy: 0 });
    expect((await posRow(dung)).matchStatus).toBe("TU_KHOP");
    expect(await soPayment()).toBe(2);
    // Giao dịch quẹt chéo vẫn nằm trong hàng chờ để người quyết (gắn tay giữ nguyên).
    expect((await posRow(cheo)).bankTransaction?.status).toBe("UNMATCHED");
  });

  it("[POS-DB-23] hủy TOÀN PHẦN sau ghi nhận → gỡ gắn → đóng cảnh báo ⇒ giao dịch gốc IGNORED, không gắn tay lại được", async () => {
    // Mã TRƯỚC bản vá: `dongCanhBaoHuyPos` chỉ đổi dòng hủy sang BO_QUA, không đụng giao dịch
    // gốc ⇒ khoản ngân hàng đã trả lại thẻ nằm lại hàng chờ UNMATCHED đủ 6.732.000đ, gắn tay
    // lại được (Σ Payment ròng của đơn = 6.732.000đ cho một giao dịch đã hủy).
    const ma = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    const g1 = await posRow(goc);
    expect(g1.bankTransaction?.status).toBe("MATCHED");

    const huy = dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU });
    await lo([huy]);
    expect((await posRow(goc)).canhBaoHuy).toBe(true);

    // Đúng quy trình ở docs: gỡ gắn TRƯỚC, rồi đóng cảnh báo.
    const go = await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "khách hủy thẻ", actor: ACTOR });
    expect(go.ok).toBe(true);
    const n = await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "đã gỡ gắn", luc: new Date() });
    expect(n).toBe(1);

    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status, "khoản đã hoàn về thẻ phải RA KHỎI hàng chờ").toBe("IGNORED");
    expect(g2.matchStatus).toBe("BO_QUA");
    expect((await posRow(huy.maGiaoDich)).matchStatus).toBe("BO_QUA");

    // Import lại file ngày hủy ⇒ vẫn thế.
    await lo([huy]);
    expect((await posRow(goc)).bankTransaction?.status).toBe("IGNORED");

    const gan = await ganTienTheoCon({
      bankTransactionId: g1.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
    });
    expect(gan.ok, "gắn tay một giao dịch ĐÃ HỦY phải bị từ chối").toBe(false);
    expect(await tongPayment(DON)).toBe(0);
  });

  // ĐỔI 30/09/2026 theo Q-G: bản 29/09 ghim giao dịch Ở LẠI hàng chờ UNMATCHED (số GỘP 6.732.000đ)
  // — đúng thứ Q-G cấm: gắn tay lại được số gộp. Nay lượt đóng đưa nó ra (IGNORED).
  it("[POS-DB-23c] hoàn MỘT PHẦN sau ghi nhận → gỡ gắn → đóng ⇒ giao dịch gốc IGNORED, gắn tay số gộp bị từ chối (Q-G)", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    const g1 = await posRow(goc);
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" })]);
    const go = await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "hoàn một phần", actor: ACTOR });
    expect(go.ok).toBe(true);
    await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "đã gỡ gắn", luc: new Date() });
    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status, "số GỘP không được về lại hàng chờ").toBe("IGNORED");
    expect(g2.bankTransaction?.unmatchedNote, "giữ lý do gỡ gắn của kế toán").toMatch(/^Đã gỡ gắn: /);
    expect(g2.bankTransaction?.unmatchedNote).toContain(DUOI_CHAN_HOAN_MOT_PHAN);
    expect(g2.matchStatus).toBe("BO_QUA");
    const gan = await ganTienTheoCon({
      bankTransactionId: g1.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
    });
    expect(gan.ok).toBe(false);
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[POS-DB-24] đóng cảnh báo ⇒ ghi chú kế toán KHÔNG chép sang dòng hủy (dòng hủy NULL cơ sở, mọi cơ sở đọc)", async () => {
    // Mã TRƯỚC bản vá: matchReason dòng hủy = `Đã xử lý cùng cảnh báo của <gốc>: <ghiChu>`,
    // mà placeholder mời ghi mã đơn ⇒ mã đơn lộ trên dòng `centerId` NULL.
    const m = maGd();
    const mayLa = `${PFX}MAYLA3`;
    await lo([dong({ maGiaoDich: m, dienGiai: "khong ma", maThietBi: mayLa })]);
    const r1 = await posRow(m);
    const gan = await ganTienTheoCon({
      bankTransactionId: r1.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
    });
    expect(gan.ok).toBe(true);
    const huy = maGd();
    await lo([dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: m, soTien: -TONG_PHIEU, maThietBi: mayLa })]);
    const ghiChu = "đã gỡ gắn khỏi đơn ORD-269929-000777, hoàn tiền mặt cho PH";
    await dongCanhBaoHuyPos({ id: r1.id, maGiaoDich: m, nguoiDongId: USER, ghiChu, luc: new Date() });
    const rHuy = await posRow(huy);
    expect(rHuy.centerId).toBeNull();
    expect(rHuy.matchStatus).toBe("BO_QUA");
    expect(rHuy.matchReason).toBe(`Đã xử lý cùng cảnh báo của ${m}`);
    expect((await posRow(m)).canhBaoGhiChu, "ghi chú ở lại trên GỐC (theo cơ sở đơn)").toBe(ghiChu);
  });

  it("[POS-DB-25] hoàn MỘT PHẦN trỏ vào gốc đã BO_QUA (không giao dịch) ⇒ dòng hoàn BO_QUA, không kẹt hàng chờ", async () => {
    // Hoàn nhiều lần cộng thành toàn phần, file xuất SAU cả hai lần hoàn: gốc mang "Hoàn toàn
    // phần" (luật 3 ⇒ BO_QUA, không giao dịch), dòng hoàn mang "Hoàn một phần". Mã TRƯỚC bản vá:
    // dòng hoàn ra CAN_XU_LY "Hoàn một phần — xử lý tay" mãi mãi — không có lối đóng.
    const ma = await phatPhieu();
    const goc = maGd();
    const hoan = maGd();
    const dHoan = dong({ maGiaoDich: hoan, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" });
    await lo([dong({ maGiaoDich: goc, dienGiai: ma, trangThaiHoanHuy: "Hoàn toàn phần" }), dHoan]);
    const rGoc = await posRow(goc);
    expect(rGoc.matchStatus).toBe("BO_QUA");
    expect(rGoc.bankTransactionId).toBeNull();
    expect((await posRow(hoan)).matchStatus).toBe("BO_QUA");
    const kq = await lo([dHoan]);
    expect(kq.canXuLy).toBe(0);
    expect((await posRow(hoan)).matchStatus).toBe("BO_QUA");
    expect(await soPayment()).toBe(0);
  });

  // ── [POS-DB-27..29] Q-G 30/09/2026 — HOÀN MỘT PHẦN: "Không dùng — chặn tự động". ─────────────
  it("[POS-DB-27] gốc CHƯA ghi nhận + hoàn một phần ⇒ giao dịch IGNORED, ganTienTheoCon từ chối số gộp, cảnh báo mở; đóng ⇒ kết luận", async () => {
    await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khach quen ghi ma" })]);
    const g0 = await posRow(goc);
    expect(g0.bankTransaction?.status, "đối chứng fixture: gốc đang chờ gắn tay").toBe("UNMATCHED");

    const hoan = maGd();
    const kq = await lo([dong({ maGiaoDich: hoan, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" })]);
    expect(kq).toMatchObject({ moi: 1, canXuLy: 1, boQua: 0 });

    const g1 = await posRow(goc);
    expect(g1.bankTransaction?.status).toBe("IGNORED");
    expect(g1.bankTransaction?.unmatchedNote).toBe(LY_DO_CHAN_HOAN_MOT_PHAN);
    expect(g1.matchStatus).toBe("CAN_XU_LY");
    expect(g1.matchReason).toContain(LY_DO_CHAN_HOAN_MOT_PHAN);
    expect(g1.canhBaoHuy, "cảnh báo MỞ ở khu đỏ").toBe(true);
    expect(g1.canhBaoDaXuLyLuc).toBeNull();
    expect((await posRow(hoan)).matchReason).toBe(LY_DO_HOAN_XEM_GOC);

    // Gắn tay SỐ GỘP (Σ = 6.732.000đ) ⇒ bị từ chối — mục tiêu của Q-G.
    const gan = await ganTienTheoCon({
      bankTransactionId: g0.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
    });
    expect(gan.ok, "gắn tay số gộp phải bị từ chối").toBe(false);
    expect(await soPayment()).toBe(0);
    expect(await soPhanBo()).toBe(0);

    // Đóng cảnh báo (tự do, có ghi chú) ⇒ dòng hoàn + gốc kết luận, giao dịch vẫn IGNORED.
    const n = await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "đã ghi điều chỉnh số ròng", luc: new Date() });
    expect(n).toBe(1);
    const g2 = await posRow(goc);
    expect(g2.matchStatus).toBe("BO_QUA");
    expect(g2.canhBaoDaXuLyLuc).not.toBeNull();
    expect(g2.bankTransaction?.status).toBe("IGNORED");
    expect((await posRow(hoan)).matchStatus).toBe("BO_QUA");
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-27b] gốc CHƯA có giao dịch: gốc mang cột 'Hoàn một phần' (không dòng hoàn) ⇒ giao dịch tạo ra ĐÃ IGNORED, cảnh báo mở", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    const kq = await lo([dong({ maGiaoDich: goc, dienGiai: ma, trangThaiHoanHuy: "Hoàn một phần" })]);
    expect(kq).toMatchObject({ moi: 1, tuKhop: 0, canXuLy: 1 });
    const g = await posRow(goc);
    expect(g.bankTransaction?.status).toBe("IGNORED");
    expect(g.canhBaoHuy).toBe(true);
    expect(await soPayment(), "mã đúng số phiếu nhưng không được tự khớp").toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("OPEN");
  });

  it("[POS-DB-28] gốc ĐÃ ghi nhận + hoàn một phần ⇒ cảnh báo 'hủy sau ghi nhận', Payment KHÔNG đổi, giao dịch vẫn MATCHED", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    expect((await posRow(goc)).bankTransaction?.status).toBe("MATCHED");
    const soTruoc = await soPayment();
    const tongTruoc = await tongPaymentDon();
    expect(tongTruoc, "đối chứng fixture: tiền đã vào sổ").toBe(TONG_PHIEU);

    const hoan = maGd();
    await lo([dong({ maGiaoDich: hoan, loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" })]);
    const g = await posRow(goc);
    expect(g.bankTransaction?.status).toBe("MATCHED");
    expect(g.canhBaoHuy).toBe(true);
    expect(loaiCanhBaoPos(g.matchReason)).toBe("HUY_SAU_GHI_NHAN");
    expect((await posRow(hoan)).matchStatus).toBe("CAN_XU_LY");
    expect(await soPayment()).toBe(soTruoc);
    expect(await tongPaymentDon()).toBe(tongTruoc);
    expect(await db.payment.count({ where: { orderId: DON, amount: { lt: 0 } } })).toBe(0);
  });

  it("[POS-DB-29] dòng loại 'Hủy' mà cột ghi 'Hủy một phần' (số = gốc) ⇒ đi nhánh MỘT PHẦN, không phải hủy toàn phần", async () => {
    await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma" })]);
    const huy = maGd();
    await lo([dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU, trangThaiHoanHuy: "Hủy một phần" })]);
    const g = await posRow(goc);
    expect(g.bankTransaction?.status).toBe("IGNORED");
    expect(g.matchStatus, "hủy toàn phần sẽ ra BO_QUA không cảnh báo").toBe("CAN_XU_LY");
    expect(g.canhBaoHuy).toBe(true);
    expect(loaiCanhBaoPos(g.matchReason)).toBe("HOAN_MOT_PHAN");
    expect((await posRow(huy)).matchReason).toBe(LY_DO_HOAN_XEM_GOC);
  });

  it("[POS-DB-29b] dòng 'Hủy' cột trống nhưng số ≠ −số gốc ⇒ MỘT PHẦN (cả trong cùng lô với gốc)", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    const huy = maGd();
    await lo([
      dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -1_000_000 }),
      dong({ maGiaoDich: goc, dienGiai: ma }),
    ]);
    const g = await posRow(goc);
    expect(g.matchStatus, "hủy lệch số không được bỏ qua như toàn phần").toBe("CAN_XU_LY");
    expect(g.bankTransaction?.status).toBe("IGNORED");
    expect(g.canhBaoHuy).toBe(true);
    expect((await posRow(huy)).matchReason).toBe(LY_DO_HOAN_XEM_GOC);
    expect(await soPayment()).toBe(0);
  });

  it("[POS-DB-23b] đóng cảnh báo khi giao dịch gốc CÒN ghi nhận ⇒ KHÔNG đụng giao dịch (đối chứng)", async () => {
    const ma = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG_PHIEU })]);
    const g1 = await posRow(goc);
    await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "đã hoàn tiền mặt", luc: new Date() });
    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status).toBe("MATCHED");
    expect(g2.matchStatus).toBe("TU_KHOP");
    expect(await tongPayment(DON)).toBe(TONG_PHIEU);
  });
});
