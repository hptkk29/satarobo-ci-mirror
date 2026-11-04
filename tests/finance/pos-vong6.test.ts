// tests/finance/pos-vong6.test.ts — HAI QUYẾT ĐỊNH của chủ dự án 30/09/2026 (Q-L, Q-M). Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// `pnpm test:unit` trần sẽ SKIP. Không gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id — cùng
// khuôn `tests/finance/pos-vong5.test.ts`.
//
//   Q-L [V6-L*] — MIỄN GIẢM cho bé KHÔNG có đợt theo con (đơn thu toàn đơn R0 / đợt mức đơn):
//         "Huỷ mã cũ, phát lại". Phiếu cấp đơn chưa nhận tiền mà phần miễn chạm tới ⇒ VOID + soát phiếu
//         gộp + dựng lại bằng hàm sẵn có; phiếu đã có tiền ⇒ CHẶN. Đối chứng dương: bé có đợt theo con.
//   Q-M [V6-M*] — GỠ GẮN giao dịch THẺ POS: "luôn ĐÓNG phiếu gộp", kể cả khi chưa có tín hiệu hủy/hoàn.
//         Đối chứng dương: SePay giữ luật cũ (mở lại).
//
// Đi đúng cửa đời thật: miễn giảm qua `mienGiamNoChoCon` (CHÍNH hàm `mienGiamNoAction` gọi), lưu kế hoạch
// qua `recordInstallmentPlan`, SePay qua `ingestPayosWebhook`, thẻ qua `nhapLoPos`, gỡ gắn qua
// `goGanTheoCon`, gắn tay qua `ganTienTheoCon`. Các ca "nói trước khớp việc máy làm" CỐ Ý dùng hàm thuần
// của bản vá trên ĐÚNG dữ liệu trang đơn đọc (`getOrderPaymentRequests` + kế hoạch).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docPhieuGopDangMo, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { ganTienTheoCon, goGanTheoCon } from "@/lib/finance/ghi-tien-don";
import { mienGiamNoChoCon } from "@/lib/finance/mien-giam-db";
import { noTheoCon } from "@/lib/finance/debt";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { getOrderPaymentRequests, paymentMatchKey } from "@/lib/payments/payment-request";
import { computeDueNow } from "@/lib/payments/due-now";
import { kiemKeHoachDot } from "@/lib/payments/ke-hoach-dot";
import { dungMemo } from "@/lib/payments/memo-ck";
import { recordInstallmentPlan } from "@/lib/orders/installments";
import { CACH_HAP_THU, type CachHapThu } from "@/lib/orders/chinh-sach-uu-dai";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import type { DongHuyPos, DongPos } from "@/lib/payments/pos/kieu";
import { canhBaoTruocVoidDot } from "@/lib/finance/soat-phieu-gop";
import { thongDiepGoGan } from "@/lib/finance/thong-diep-go-gan";
// Hàm thuần của bản vá — ca "nói trước" gọi đúng hàm màn gọi.
import {
  LY_DO_MIEN_BE_DA_DUNG_CAP_DON,
  dotSeHuyKhiMienGiam,
  keHoachMienGiam,
  loiMienR0CoTien,
} from "@/lib/finance/mien-giam";

if (!RUN_DB_TESTS) console.warn(`[V6] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-posv6-";
const PFX = "FXPOSVS";
const ACTOR = { id: `${T}actor`, name: "QLCS fixture vòng 6" };

const USER = `${T}user`;
const CENTER = `${T}center`;
const OU_CENTER = `${T}ou-center`;
const DON = `${T}don`;
const MA_DON = "ORD-269930-000966";
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const R0 = `${T}dot-0`;
const MAY = `${PFX}MAY01`;

/** Học phí THẬT của hai bé (số không tròn — hình dạng dữ liệu thật). Đơn = Σ dòng. */
const HOC_PHI_A = 6_336_000;
const HOC_PHI_B = 7_128_000;
const TONG_HOC_PHI = HOC_PHI_A + HOC_PHI_B; // 13.464.000
/** Đợt THEO CON đang mở (một nửa học phí mỗi bé) — khuôn vòng 5. */
const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG_DOT = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000
const MIEN = 1_000_000;
const SDT = "0905666999";
const GIO_QUET = "2026-09-21T10:12:13+07:00";
const H1 = new Date("2026-10-15T00:00:00+07:00");
const H2 = new Date("2026-11-15T00:00:00+07:00");

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
const maSepay = () => `${T}sepay-${++soLan}`;

async function don() {
  await db.auditLog.deleteMany({ where: { actorId: ACTOR.id } });
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: { providerTxnId: { startsWith: PFX } } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: { providerTxnId: { startsWith: T } } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: USER } });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.creditBalance.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderInstallment.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: PFX } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.orgUnit.deleteMany({ where: { id: OU_CENTER } });
  await db.center.deleteMany({ where: { id: CENTER } });
  await db.user.deleteMany({ where: { id: USER } });
}

/**
 * `THEO_CON` (mặc định) ⇒ mỗi bé một đợt theo con đang mở (DOT_A / DOT_B, khuôn vòng 5).
 * `TOAN_DON` ⇒ đơn chỉ có phiếu thu toàn đơn R0 = Σ học phí, mang mã đời cũ `…D0` như `ensureFullOrderRequest` đặt.
 */
async function dungFixture(opt: { kieu?: "THEO_CON" | "TOAN_DON" } = {}) {
  await don();
  await db.user.create({
    data: { id: USER, name: "Kế toán HO fixture V6", email: `${USER}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] },
  });
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture V6", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" },
  });
  await db.orgUnit.create({
    data: { id: OU_CENTER, type: "CENTER", code: `${PFX}OU`, name: "Đơn vị fixture V6", centerId: CENTER, path: "/fxposvs-ou/", depth: 0 },
  });
  await db.posTerminal.create({ data: { maThietBi: MAY, maQuay: "Q1", centerId: CENTER } });
  await db.order.create({
    data: {
      id: DON,
      code: MA_DON,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture V6",
      customerPhone: SDT,
      subtotal: TONG_HOC_PHI,
      discountAmount: 0,
      totalAmount: TONG_HOC_PHI,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A V6", HOC_PHI_A],
    [B, "Bé B V6", HOC_PHI_B],
  ] as const) {
    await db.orderItem.create({
      data: { id, orderId: DON, type: "COURSE_ENROLLMENT", itemName: ten, quantity: 1, unitPrice: gia, totalPrice: gia },
    });
  }
  if (opt.kieu === "TOAN_DON") {
    await db.paymentRequest.create({
      data: {
        id: R0,
        orderId: DON,
        centerId: CENTER,
        installmentNo: 0,
        amountDue: TONG_HOC_PHI,
        status: "PENDING",
        sortOrder: 0,
        matchKey: paymentMatchKey(MA_DON, 0),
      },
    });
    return;
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

/** Đơn thu theo đợt ĐƠN: từ R0, lưu kế hoạch hai đợt (đi đúng `recordInstallmentPlan`). */
async function keHoachHaiDot(dot1: number, dot2: number) {
  await dungFixture({ kieu: "TOAN_DON" });
  const kq = await recordInstallmentPlan({
    orderId: DON,
    dots: [
      { amount: dot1, daThu: false, dueDate: H1 },
      { amount: dot2, daThu: false, dueDate: H2 },
    ],
    actorId: null,
  });
  if (!kq.ok) throw new Error(`fixture: lưu kế hoạch lỗi — ${kq.error}`);
  const dot = await db.paymentRequest.findMany({ where: { orderId: DON, orderItemId: null, installmentNo: { gt: 0 } }, orderBy: { installmentNo: "asc" } });
  return { d1: dot[0]!, d2: dot[1]! };
}

async function phatPhieu(ids: string[] = [DOT_A, DOT_B]): Promise<{ ma: string; billId: string }> {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
  return { ma: r.ma, billId: r.billId };
}

const memo = (ma: string) => dungMemo({ hoTen: "Bé A V6", sdt: SDT, ma });

function banSepay(noiDung: string, soTien: number, txnId: string = maSepay()) {
  return ingestPayosWebhook(
    {
      orderCode: undefined,
      reference: txnId,
      paymentLinkId: txnId,
      description: noiDung,
      amount: soTien,
      transactionDateTime: "2026-09-21T03:00:00Z",
      accountNumber: "0123456789",
    } as never,
    "SEPAY",
  );
}

const btSepay = (txnId: string) =>
  db.bankTransaction.findUniqueOrThrow({ where: { provider_providerTxnId: { provider: "SEPAY", providerTxnId: txnId } } });

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TONG_DOT,
    thoiGian: GIO_QUET,
    dienGiai: "",
    maChuanChi: "654321",
    maGiaoDichThe: "112233445566",
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

const tom = (d: DongPos): DongHuyPos => ({
  maGiaoDich: d.maGiaoDich,
  loaiGiaoDich: d.loaiGiaoDich,
  trangThai: d.trangThai,
  soTien: d.soTien,
  maGiaoDichGoc: d.maGiaoDichGoc,
  trangThaiHoanHuy: d.trangThaiHoanHuy,
});

async function lo(dongs: DongPos[], dongHuyCuaFile: DongPos[] = []): Promise<KetQuaLoPos> {
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture-v6.xlsx", importedById: USER } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: dongHuyCuaFile.map(tom), nguoiNhapId: USER });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  return kq;
}

const hoanMotPhan = (goc: string, soTien = -1_000_000) =>
  dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien, trangThaiHoanHuy: "Hoàn một phần" });

const posRow = (ma: string) =>
  db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: ma }, include: { bankTransaction: true } });
const phieu = (billId: string) => db.paymentBill.findUniqueOrThrow({ where: { id: billId } });
const tongPaymentDon = async () =>
  (await db.payment.aggregate({ where: { orderId: DON, deletedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0;
const demNhatKy = (action: string) => db.auditLog.count({ where: { entityType: "Order", entityId: DON, action } });

function mien(orderItemId: string, soTien: number, hapThu: CachHapThu = CACH_HAP_THU.DOT_XA_NHAT) {
  return mienGiamNoChoCon({
    orderId: DON,
    orderItemId,
    soTien,
    lyDo: "Hoàn cảnh gia đình, QLCS duyệt",
    hapThu,
    tranPhanTram: 100,
    actor: ACTOR,
  });
}

/** Lời NÓI TRƯỚC — ĐÚNG dữ liệu trang đơn truyền cho form miễn giảm (`page.tsx`). */
async function noiTruoc(orderItemId: string, soTien: number, hapThu: CachHapThu = CACH_HAP_THU.DOT_XA_NHAT) {
  const phieuThu = (await getOrderPaymentRequests(DON)).map((r) => ({
    id: r.id,
    orderItemId: r.orderItemId,
    installmentNo: r.installmentNo,
    amountDue: r.amountDue,
    dueDate: r.dueDate,
    status: r.status,
    daRot: r.allocated,
  }));
  const keHoachDon = await db.orderInstallment.findMany({ where: { orderId: DON }, select: { soDot: true, amount: true, status: true } });
  // Rà vòng 6 — ĐÚNG hai số trang truyền: `soTheoCon.conNoDon` + `order.totalAmount`.
  const conNoDon = (await noTheoCon(DON)).conNoDon;
  const tongDon = (await db.order.findUniqueOrThrow({ where: { id: DON }, select: { totalAmount: true } })).totalAmount;
  const kh = keHoachMienGiam({ orderItemId, phieuThu, keHoachDon, canGiam: soTien, cach: hapThu, daDungHoc: false, conNoDon, tongDon });
  return { kh, canhBao: canhBaoTruocVoidDot(await docPhieuGopDangMo(DON), dotSeHuyKhiMienGiam(kh)) };
}

/** Ảnh chụp những thứ một lượt miễn giảm BỊ CHẶN không được đụng. */
async function anhChup() {
  return {
    dong: await db.orderItem.findMany({ where: { orderId: DON }, orderBy: { id: "asc" } }),
    don: await db.order.findUniqueOrThrow({ where: { id: DON }, select: { subtotal: true, discountAmount: true, totalAmount: true } }),
    phieuThu: await db.paymentRequest.findMany({ where: { orderId: DON }, orderBy: { id: "asc" }, select: { id: true, amountDue: true, status: true } }),
    keHoach: await db.orderInstallment.findMany({ where: { orderId: DON }, orderBy: { soDot: "asc" }, select: { soDot: true, amount: true, status: true } }),
    phieuGop: await db.paymentBill.findMany({ where: { orderId: DON }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    nhatKy: await demNhatKy("MIEN_GIAM_NO"),
  };
}

describe.skipIf(!RUN_DB_TESTS)("[V6] Q-L miễn giảm cấp đơn · Q-M gỡ gắn thẻ luôn đóng phiếu", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  // ═════════════════════════════════════════════════════════════════════════
  // Q-L — MIỄN GIẢM CHO BÉ KHÔNG CÓ ĐỢT THEO CON
  // ═════════════════════════════════════════════════════════════════════════

  it("[V6-L01] thu TOÀN ĐƠN + phiếu gộp trên R0: nói trước đúng mã ⇒ máy HUỶ mã, dựng lại R0 theo số mới; mã cũ không thu; mã mới thu đúng số mới; công nợ = số mới", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    const x = await phatPhieu([R0]);

    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh, "đối chứng: Q-L trừ vào phiếu toàn đơn").toMatchObject({ cach: "CAP_DON", toanDon: true });
    expect(truoc.canhBao?.tieuDe, "nói TRƯỚC đúng mã").toBe(`Mã phiếu ${x.ma} của cả nhà sẽ bị HUỶ`);
    expect(truoc.canhBao?.chiTiet).toContain("phát mã mới cho phần còn nợ");

    const r = await mien(A, MIEN);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect((await phieu(x.billId)).status, "máy thật sự huỷ mã cũ").toBe("VOID");
    expect(r.thongDiepPhieu, "câu SAU cùng mã").toContain(`Phiếu gộp ${x.ma} đã HUỶ`);
    expect(r.thongDiepCapDon).toBe(
      "Phiếu thu toàn đơn dựng lại: 12.464.000đ — mã QR cũ hết hiệu lực, phát mã mới cho số còn nợ.",
    );
    expect(r.chuaHapThu, "không còn phần 'QR vẫn đòi số cũ'").toBe(0);
    // R0 dựng lại bằng `ensureFullOrderRequest`: CHÍNH phiếu số 0 (định danh + mã đời cũ bền), số mới.
    expect(await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 }, select: { status: true, amountDue: true, matchKey: true } })).toEqual({
      status: "PENDING",
      amountDue: TONG_HOC_PHI - MIEN,
      matchKey: paymentMatchKey(MA_DON, 0),
    });
    expect(await docPhieuGopDangMo(DON), "trang không còn in QR số cũ").toBeNull();

    // Công nợ / số phải thu = SỐ MỚI ở mọi chỗ đọc.
    const donSau = await db.order.findUniqueOrThrow({ where: { id: DON } });
    expect(donSau.totalAmount).toBe(TONG_HOC_PHI - MIEN);
    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.orderItemId === A)?.phaiThu).toBe(HOC_PHI_A - MIEN);
    expect(so.tongPhaiThu).toBe(TONG_HOC_PHI - MIEN);
    expect(so.conNoDon).toBe(TONG_HOC_PHI - MIEN);
    expect(so.tongDotDangMoDon, "Σ phiếu đang mở = đúng còn nợ, không đòi thừa").toBe(TONG_HOC_PHI - MIEN);
    expect(computeDueNow({ totalAmount: donSau.totalAmount, paidAmount: 0, installments: [] }).amount).toBe(TONG_HOC_PHI - MIEN);
    expect((await getOrderPaymentRequests(DON)).find((p) => p.id === R0)?.outstanding).toBe(TONG_HOC_PHI - MIEN);

    // Mã cũ (số cũ) KHÔNG thu; phát mã mới ⇒ đúng số mới, thu được.
    expect((await banSepay(memo(x.ma), TONG_HOC_PHI)).status, "QR cũ không được khớp").not.toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(0);
    const y = await phatPhieu([R0]);
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(TONG_HOC_PHI - MIEN);
    expect((await banSepay(memo(y.ma), TONG_HOC_PHI - MIEN)).status).toBe("MATCHED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).status).toBe("PAID");
    expect(await tongPaymentDon()).toBe(TONG_HOC_PHI - MIEN);
  });

  it("[V6-L02] thu toàn đơn KHÔNG có phiếu gộp, còn QR đời cũ ACTIVE ⇒ R0 dựng lại số mới, QR cũ hết hiệu lực; không câu phiếu gộp", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    await db.qrSession.create({
      data: {
        id: `${T}qr-r0`,
        paymentRequestId: R0,
        status: "ACTIVE",
        amountShown: TONG_HOC_PHI,
        expiresAt: new Date("2699-12-31T00:00:00Z"),
        centerId: CENTER,
      },
    });
    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.canhBao, "không phiếu gộp ⇒ không có mã của cả nhà để nói").toBeNull();

    const r = await mien(A, MIEN);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.thongDiepPhieu).toBeNull();
    expect(r.thongDiepCapDon).toContain("Phiếu thu toàn đơn dựng lại: 12.464.000đ");
    expect((await db.qrSession.findUniqueOrThrow({ where: { id: `${T}qr-r0` } })).status, "QR in số cũ phải chết").toBe("EXPIRED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).amountDue).toBe(TONG_HOC_PHI - MIEN);
  });

  it("[V6-L03] R0 ĐÃ nhận một phần (mã đời cũ D0) ⇒ CHẶN — nói trước cùng câu, KHÔNG ghi gì (luật cấm sửa số phiếu đã có tiền)", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    const x = await phatPhieu([R0]);
    expect((await banSepay(`${paymentMatchKey(MA_DON, 0)} NOP HOC PHI`, 2_000_000)).status, "đối chứng: mã đời cũ khớp R0").toBe("MATCHED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).status, "đối chứng").toBe("PARTIAL");

    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh).toEqual({ cach: "CHAN", loi: loiMienR0CoTien(2_000_000) });
    const chup = await anhChup();

    const r = await mien(A, MIEN);
    expect(r).toEqual({ ok: false, error: loiMienR0CoTien(2_000_000) });
    expect(await anhChup(), "bị chặn ⇒ không một phép ghi nào").toEqual(chup);
    expect((await phieu(x.billId)).status).toBe("OPEN");
  });

  it("[V6-L04] thu theo ĐỢT ĐƠN + phiếu gộp trên đợt 2: nói trước đúng mã ⇒ máy HUỶ mã, sửa kế hoạch + dựng lại đợt 2 theo số mới; kế hoạch vẫn khớp tổng đơn; mã mới thu đúng số mới", async () => {
    const { d1, d2 } = await keHoachHaiDot(TONG_HOC_PHI / 2, TONG_HOC_PHI / 2);
    const x = await phatPhieu([d2.id]);

    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh.cach === "CAP_DON" ? truoc.kh.ke.doi : null, "xa nhất ⇒ đợt 2").toEqual([
      { id: d2.id, installmentNo: 2, soCu: TONG_HOC_PHI / 2, soMoi: TONG_HOC_PHI / 2 - MIEN },
    ]);
    expect(truoc.canhBao?.tieuDe).toBe(`Mã phiếu ${x.ma} của cả nhà sẽ bị HUỶ`);

    const r = await mien(A, MIEN);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect((await phieu(x.billId)).status).toBe("VOID");
    expect(r.thongDiepPhieu).toContain(`Phiếu gộp ${x.ma} đã HUỶ`);
    expect(r.thongDiepCapDon).toBe(
      "Đợt của đơn dựng lại: Đợt 2 → 5.732.000đ — mã QR cũ hết hiệu lực, phát mã mới cho số còn nợ.",
    );
    // Dựng lại bằng CHÍNH `materializeInstallmentRequests`: cùng phiếu số 2, số mới; đợt 1 không đụng.
    const sau = await db.paymentRequest.findMany({ where: { orderId: DON, orderItemId: null }, orderBy: { installmentNo: "asc" }, select: { id: true, installmentNo: true, amountDue: true, status: true } });
    expect(sau).toEqual([
      { id: R0, installmentNo: 0, amountDue: TONG_HOC_PHI, status: "VOID" },
      { id: d1.id, installmentNo: 1, amountDue: TONG_HOC_PHI / 2, status: "PENDING" },
      { id: d2.id, installmentNo: 2, amountDue: TONG_HOC_PHI / 2 - MIEN, status: "PENDING" },
    ]);
    // Kế hoạch (nguồn của `computeDueNow` + ô "Sửa kế hoạch") khớp tổng đơn mới — lưu lại không vỡ.
    const donSau = await db.order.findUniqueOrThrow({ where: { id: DON } });
    const keHoach = await db.orderInstallment.findMany({ where: { orderId: DON }, orderBy: { soDot: "asc" } });
    expect(keHoach.map((k) => [k.soDot, k.amount])).toEqual([
      [1, TONG_HOC_PHI / 2],
      [2, TONG_HOC_PHI / 2 - MIEN],
    ]);
    expect(donSau.totalAmount).toBe(TONG_HOC_PHI - MIEN);
    expect(kiemKeHoachDot(keHoach.map((k) => ({ amount: k.amount, daThu: k.status === "PAID", dueDate: k.dueDate })), donSau.totalAmount).ok).toBe(true);
    expect(computeDueNow({ totalAmount: donSau.totalAmount, paidAmount: 0, installments: keHoach }).amount, "đợt sớm nhất chưa thu").toBe(TONG_HOC_PHI / 2);
    const so = await noTheoCon(DON);
    expect(so.tongPhaiThu).toBe(TONG_HOC_PHI - MIEN);
    expect(so.tongDotDangMoDon, "Σ đợt đang mở = đúng còn nợ").toBe(TONG_HOC_PHI - MIEN);

    expect((await banSepay(memo(x.ma), TONG_HOC_PHI / 2)).status, "mã cũ số cũ không khớp").not.toBe("MATCHED");
    const y = await phatPhieu([d2.id]);
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(TONG_HOC_PHI / 2 - MIEN);
    expect((await banSepay(memo(y.ma), TONG_HOC_PHI / 2 - MIEN)).status).toBe("MATCHED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: d2.id } })).status).toBe("PAID");
  });

  it("[V6-L05] đợt đơn: đợt 1 ĐÃ nhận tiền ⇒ KHÔNG VOID nó; miễn vượt phần đợt chưa có tiền gánh ⇒ CHẶN không ghi gì; miễn vừa đủ ⇒ đợt 2 huỷ (miễn hết), kế hoạch bỏ đợt 2, không phiếu 0đ", async () => {
    const { d1, d2 } = await keHoachHaiDot(TONG_HOC_PHI - MIEN, MIEN);
    expect((await banSepay(`${paymentMatchKey(MA_DON, 1)} NOP HOC PHI`, 1_000_000)).status, "đối chứng").toBe("MATCHED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: d1.id } })).status, "đối chứng").toBe("PARTIAL");

    // 2.000.000 > phần đợt 2 (chưa có tiền) gánh được ⇒ CHẶN — trần nói đúng, lý do nêu đợt đã có tiền.
    const truocChan = await noiTruoc(A, 2_000_000, CACH_HAP_THU.DOT_GAN_NHAT);
    expect(truocChan.kh.cach).toBe("CHAN");
    const chup = await anhChup();
    const chan = await mien(A, 2_000_000, CACH_HAP_THU.DOT_GAN_NHAT);
    expect(chan.ok).toBe(false);
    expect(chan.ok ? "" : chan.error).toBe(truocChan.kh.cach === "CHAN" ? truocChan.kh.loi : "?");
    expect(chan.ok ? "" : chan.error).toContain("tối đa 1.000.000đ");
    expect(chan.ok ? "" : chan.error).toContain("Đợt 1 đã nhận 1.000.000đ");
    expect(await anhChup(), "bị chặn ⇒ không một phép ghi nào").toEqual(chup);

    // Vừa đủ ⇒ đợt 2 về 0đ: phiếu ở lại VOID (không sống lại thành phiếu 0đ chặn chốt đơn), kế hoạch bỏ đợt 2.
    const r = await mien(A, MIEN, CACH_HAP_THU.DOT_GAN_NHAT);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.thongDiepCapDon).toBe("Đợt của đơn dựng lại: Đợt 2 huỷ (miễn hết) — mã QR cũ hết hiệu lực, phát mã mới cho số còn nợ.");
    expect(await db.paymentRequest.findUniqueOrThrow({ where: { id: d1.id }, select: { amountDue: true, status: true } }), "đợt ĐÃ có tiền không bị chạm").toEqual({
      amountDue: TONG_HOC_PHI - MIEN,
      status: "PARTIAL",
    });
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: d2.id } })).status).toBe("VOID");
    expect(await db.paymentRequest.count({ where: { orderId: DON, status: { not: "VOID" }, amountDue: 0 } }), "không phiếu 0đ nào sống").toBe(0);
    const keHoach = await db.orderInstallment.findMany({ where: { orderId: DON }, orderBy: { soDot: "asc" } });
    expect(keHoach.map((k) => [k.soDot, k.amount])).toEqual([[1, TONG_HOC_PHI - MIEN]]);
    expect((await db.order.findUniqueOrThrow({ where: { id: DON } })).totalAmount).toBe(TONG_HOC_PHI - MIEN);
  });

  it("[V6-L06] bé ĐÃ DỪNG trên đơn thu toàn đơn ⇒ CHẶN (phiếu của đơn không theo quyết toán của bé), không ghi gì", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    await db.orderItem.update({ where: { id: A }, data: { status: "STOPPED", usedValue: 4_000_000, stoppedAt: new Date("2026-09-20T03:00:00Z") } });
    const chup = await anhChup();
    const r = await mien(A, MIEN);
    expect(r).toEqual({ ok: false, error: LY_DO_MIEN_BE_DA_DUNG_CAP_DON });
    expect(await anhChup()).toEqual(chup);
  });

  it("[V6-L07] không phiếu nào đòi phần nợ này (đơn thu theo con, bé A chưa có đợt) ⇒ miễn được, không VOID gì, không câu 'QR vẫn đòi số cũ'", async () => {
    await db.paymentRequest.delete({ where: { id: DOT_A } });
    const r = await mien(A, MIEN);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ soDotDaDoi: 0, chuaHapThu: 0, thongDiepPhieu: null, thongDiepCapDon: null });
    expect(await db.paymentRequest.findUniqueOrThrow({ where: { id: DOT_B }, select: { amountDue: true, status: true } })).toEqual({ amountDue: DOT_TIEN_B, status: "PENDING" });
    expect((await noTheoCon(DON)).con.find((c) => c.orderItemId === A)?.phaiThu).toBe(HOC_PHI_A - MIEN);
  });

  it("[V6-L08] đối chứng dương: bé CÓ đợt theo con ⇒ luật cũ — đợt của bé VOID + TẠO LẠI (theo con) số mới; mã cả nhà HUỶ; kế hoạch/R0 không đụng", async () => {
    const x = await phatPhieu();
    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh.cach).toBe("THEO_CON");
    expect(truoc.canhBao?.tieuDe).toBe(`Mã phiếu ${x.ma} của cả nhà sẽ bị HUỶ`);
    const r = await mien(A, MIEN);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ soDotDaDoi: 1, chuaHapThu: 0, thongDiepCapDon: null });
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: DOT_A } })).status).toBe("VOID");
    expect(await db.paymentRequest.findFirst({ where: { orderItemId: A, status: "PENDING" }, select: { installmentNo: true, amountDue: true } })).toEqual({
      installmentNo: 2,
      amountDue: DOT_TIEN_A - MIEN,
    });
    expect((await phieu(x.billId)).status).toBe("VOID");
    expect(await db.paymentRequest.count({ where: { orderId: DON, orderItemId: null } }), "không đẻ phiếu cấp đơn").toBe(0);
    expect(await db.orderInstallment.count({ where: { orderId: DON } })).toBe(0);
  });

  // ── Rà đối kháng vòng 6 ────────────────────────────────────────────────────

  it("[V6-L09] R0 ĐÃ THU ĐỦ (mã đời cũ D0, kế toán chưa xác nhận) mà bé vẫn 'còn nợ' ⇒ CHẶN theo vế ĐƠN, không ghi gì — trước bản vá: im lặng, đơn thừa 1.000.000", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    expect((await banSepay(`${paymentMatchKey(MA_DON, 0)} NOP HOC PHI`, TONG_HOC_PHI)).status, "đối chứng").toBe("MATCHED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).status, "đối chứng: R0 PAID").toBe("PAID");
    const so = await noTheoCon(DON);
    expect(so.con.find((c) => c.orderItemId === A)?.conNo, "đối chứng: bé A vẫn 'còn nợ' ⇒ nút Miễn giảm hiện").toBe(HOC_PHI_A);
    expect(so.conNoDon, "đối chứng: đơn đã về đủ").toBe(0);

    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh.cach, "nói trước: CHẶN").toBe("CHAN");
    const chup = await anhChup();
    const r = await mien(A, MIEN);
    expect(r).toEqual({ ok: false, error: truoc.kh.cach === "CHAN" ? truoc.kh.loi : "?" });
    expect(r.ok ? "" : r.error).toContain("hoàn tiền");
    expect(await anhChup(), "bị chặn ⇒ không một phép ghi nào").toEqual(chup);
    expect(await tongPaymentDon()).toBe(TONG_HOC_PHI);
  });

  it("[V6-L10] kế hoạch MỘT đợt 'đã thu' (sổ A có trọn khoản, R0 vẫn PENDING) ⇒ CHẶN — không dựng R0 12.464.000 'số còn nợ' trên đơn đã thu đủ", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    const kq = await recordInstallmentPlan({ orderId: DON, dots: [{ amount: TONG_HOC_PHI, daThu: true, dueDate: H1 }], actorId: null });
    expect(kq.ok, kq.error ?? "").toBe(true);
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).status, "đối chứng: R0 vẫn PENDING").toBe("PENDING");
    expect(await tongPaymentDon(), "đối chứng: sổ A có trọn khoản").toBe(TONG_HOC_PHI);
    expect((await noTheoCon(DON)).conNoDon, "đối chứng").toBe(0);

    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh.cach).toBe("CHAN");
    const chup = await anhChup();
    const r = await mien(A, MIEN);
    expect(r.ok).toBe(false);
    expect(await anhChup()).toEqual(chup);
  });

  it("[V6-L11] R0 LỆCH tổng đơn (sau 'Thêm con': R0 6.336.000, đơn 13.464.000) ⇒ nói trước đúng số máy ghi (TĂNG lên 12.464.000), nhật ký một nguồn; miễn 7.000.000 cho bé B không bị chặn bằng lý do bịa", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    // Đúng dấu vết `themConVaoDon`: tổng đơn = Σ dòng, R0 không đụng.
    await db.paymentRequest.update({ where: { id: R0 }, data: { amountDue: HOC_PHI_A } });

    const choB = await noiTruoc(B, 7_000_000);
    expect(choB.kh.cach, "trước bản vá: CHẶN 'phần còn lại rơi vào phiếu ĐÃ nhận tiền' — không phiếu nào nhận đồng nào").toBe("CAP_DON");

    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh.cach === "CAP_DON" ? truoc.kh.ke.doi : null).toEqual([
      { id: R0, installmentNo: 0, soCu: HOC_PHI_A, soMoi: TONG_HOC_PHI - MIEN },
    ]);
    const r = await mien(A, MIEN);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.thongDiepCapDon).toContain("Phiếu thu toàn đơn dựng lại: 12.464.000đ");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).amountDue, "máy ghi ĐÚNG số đã nói trước").toBe(TONG_HOC_PHI - MIEN);
    const vet = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "MIEN_GIAM_NO" }, select: { newValues: true } });
    const nv = vet.newValues as { doiDot: { soMoi: number }[]; capDon: { dot: { soMoi: number }[] } };
    expect(nv.doiDot.map((d) => d.soMoi), "nhật ký: một nguồn số").toEqual(nv.capDon.dot.map((d) => d.soMoi));
  });

  it("[V6-L12] tổng đơn LỆCH Σ dòng ⇒ số máy sẽ ghi khác số đã nói trước ⇒ THROW (rollback), không một phép ghi nào", async () => {
    await dungFixture({ kieu: "TOAN_DON" });
    await db.order.update({ where: { id: DON }, data: { totalAmount: TONG_HOC_PHI + 100 } });
    const truoc = await noiTruoc(A, MIEN);
    expect(truoc.kh.cach === "CAP_DON" ? truoc.kh.ke.doi.map((d) => d.soMoi) : null, "nói trước theo tổng đơn").toEqual([TONG_HOC_PHI + 100 - MIEN]);
    const chup = await anhChup();
    const r = await mien(A, MIEN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("lệch số đã báo trước");
    expect(await anhChup(), "throw ⇒ rollback cả lượt").toEqual(chup);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Q-M — GỠ GẮN GIAO DỊCH THẺ LUÔN ĐÓNG PHIẾU GỘP
  // ═════════════════════════════════════════════════════════════════════════

  it("[V6-M01] thẻ TỰ KHỚP → gỡ gắn CHƯA tín hiệu ⇒ phiếu ĐÓNG (không MỞ LẠI), câu nói 'mã X đã ĐÓNG — phát mã mới'; quẹt lại / chuyển khoản mã cũ KHÔNG khớp; mã mới thu được", async () => {
    const x = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${x.ma}` })]);
    const g = await posRow(goc);
    expect(g.matchStatus, "đối chứng").toBe("TU_KHOP");

    const go = await goGanTheoCon({ bankTransactionId: g.bankTransactionId!, orderId: DON, lyDo: "quẹt nhầm đơn", actor: ACTOR });
    expect(go.ok).toBe(true);
    if (!go.ok) return;
    expect(go.trangThaiGiaoDich, "chưa tín hiệu ⇒ giao dịch về hàng chờ").toBe("UNMATCHED");
    expect(go.phieuGop.map((p) => [p.ma, p.hanhDong])).toEqual([[x.ma, "DONG"]]);
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect(thongDiepGoGan(go)).toContain(`Phiếu gộp: mã ${x.ma} đã ĐÓNG — phát mã mới nếu cần thu lại.`);
    expect(await demNhatKy("PHIEU_GOP_MO_LAI")).toBe(0);
    const vet = await db.auditLog.findFirst({ where: { entityType: "Order", entityId: DON, action: "PHIEU_GOP_CLOSED" }, select: { reason: true } });
    expect(vet?.reason ?? "").toContain("(Q-M)");
    expect(await docPhieuGopDangMo(DON)).toBeNull();

    // Mã cũ không thu nữa — cả quẹt thẻ lẫn chuyển khoản.
    const lai = maGd();
    await lo([dong({ maGiaoDich: lai, dienGiai: `Be A ${SDT} ${x.ma}` })]);
    expect((await posRow(lai)).matchStatus).toBe("CAN_XU_LY");
    expect((await banSepay(memo(x.ma), TONG_DOT)).status).not.toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(0);

    // Phát mã mới ⇒ quẹt mã mới tự khớp.
    const y = await phatPhieu();
    const moi = maGd();
    await lo([dong({ maGiaoDich: moi, dienGiai: `Be A ${SDT} ${y.ma}` })]);
    expect((await posRow(moi)).matchStatus).toBe("TU_KHOP");
    expect(await tongPaymentDon()).toBe(TONG_DOT);
  });

  it("[V6-M02] đối chứng dương: chuyển khoản SePay → gỡ gắn ⇒ phiếu MỞ LẠI (luật cũ), câu nói 'mở lại'", async () => {
    const x = await phatPhieu();
    const t1 = maSepay();
    expect((await banSepay(memo(x.ma), TONG_DOT, t1)).status).toBe("MATCHED");
    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "khớp nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);
    if (!go.ok) return;
    expect(go.phieuGop.map((p) => [p.ma, p.hanhDong])).toEqual([[x.ma, "MO_LAI"]]);
    expect((await phieu(x.billId)).status).toBe("OPEN");
    expect(thongDiepGoGan(go)).toContain(`Phiếu gộp ${x.ma} mở lại`);
  });

  it("[V6-M03] thẻ KHÔNG mã → gắn tay lấp phiếu OPEN (0đ) → gỡ gắn CHƯA tín hiệu ⇒ phiếu ĐÓNG + NÓI RA (phiếu hiện lại cũng là mở lại); mã cũ không thu", async () => {
    const x = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma" })]);
    const btId = (await posRow(goc)).bankTransactionId!;
    const gan = await ganTienTheoCon({
      bankTransactionId: btId,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
      nguoiGan: { loai: "KE_TOAN" },
    });
    expect(gan.ok, "đối chứng fixture").toBe(true);
    expect(await docPhieuGopDangMo(DON), "đối chứng: phiếu 0đ bị màn giấu").toBeNull();

    const go = await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "gắn nhầm gia đình", actor: ACTOR });
    expect(go.ok).toBe(true);
    if (!go.ok) return;
    expect(go.trangThaiGiaoDich).toBe("UNMATCHED");
    expect(go.phieuGop.map((p) => [p.ma, p.hanhDong]), "toast nói ra").toEqual([[x.ma, "DONG"]]);
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON)).toBeNull();
    expect((await banSepay(memo(x.ma), TONG_DOT)).status, "mã cũ không thu trọn số gộp").not.toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[V6-M04] thẻ → gỡ gắn (Q-M: ĐÓNG ngay) → hôm sau hoàn MỘT PHẦN (dòng hoàn, rồi cột của gốc) ⇒ giao dịch IGNORED, phiếu vẫn ĐÓNG, import KHÔNG đụng phiếu gộp nào", async () => {
    const x = await phatPhieu();
    const goc = maGd();
    const dGoc = dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${x.ma}` });
    await lo([dGoc]);
    const btId = (await posRow(goc)).bankTransactionId!;
    const go = await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "chia lại cho hai bé", actor: ACTOR });
    expect(go.ok && go.phieuGop.map((p) => p.hanhDong), "Q-M: đóng ngay lúc gỡ").toEqual(["DONG"]);
    const nhatKyPhieu = async () =>
      db.auditLog.count({ where: { entityType: "Order", entityId: DON, action: { in: ["PHIEU_GOP_CLOSED", "PHIEU_GOP_MO_LAI", "PHIEU_GOP_VOID"] } } });
    const truoc = await nhatKyPhieu();

    await lo([hoanMotPhan(goc)]);
    await lo([{ ...dGoc, trangThaiHoanHuy: "Hoàn một phần" }]);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: btId } })).status).toBe("IGNORED");
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect(await nhatKyPhieu(), "import không phải đóng lại phiếu nào — không còn phiếu mở lại").toBe(truoc);
    expect((await banSepay(memo(x.ma), TONG_DOT)).status).not.toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[V6-M05] rà vòng 6 — thẻ gắn tay MỘT PHẦN, phiếu phát SAU đó (không tính số của thẻ) → gỡ gắn ⇒ phiếu vẫn OPEN, đúng số; phụ huynh chuyển đúng mã đúng số ⇒ MATCHED", async () => {
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma", soTien: 1_000_000 })]);
    const btId = (await posRow(goc)).bankTransactionId!;
    const gan = await ganTienTheoCon({ bankTransactionId: btId, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: 1_000_000 }], actor: ACTOR, nguoiGan: { loai: "KE_TOAN" } });
    expect(gan.ok, "đối chứng fixture").toBe(true);
    const x = await phatPhieu();
    const qr = TONG_DOT - 1_000_000; // 5.732.000 — dòng A = phần còn thiếu lúc phát
    expect((await docPhieuGopDangMo(DON))?.tongTien, "đối chứng: QR không tính số của thẻ").toBe(qr);

    const go = await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "gắn nhầm bé", actor: ACTOR });
    expect(go.ok).toBe(true);
    if (!go.ok) return;
    expect(go.phieuGop, "phiếu không đòi thêm đồng nào ⇒ không đụng").toEqual([]);
    expect((await phieu(x.billId)).status).toBe("OPEN");
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(qr);
    expect((await banSepay(memo(x.ma), qr)).status, "khoản đúng mã đúng số KHÔNG rơi vào hàng chờ").toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(qr);
  });
});
