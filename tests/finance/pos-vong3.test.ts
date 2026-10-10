// tests/finance/pos-vong3.test.ts — RÀ ĐỐI KHÁNG VÒNG 3 (30/09/2026). Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// `pnpm test:unit` trần sẽ SKIP. Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo
// tiền tố id — cùng khuôn `tests/finance/pos-no-so-tien.test.ts`.
//
// Các lỗi đã xác nhận ở lượt rà (docs/pos-the-smartpos.md mục "Rà đối kháng vòng 3"):
//
//   [V3-0x] phiếu gộp mở lại/còn mở trên một đợt đã VOID ⇒ khách bị thu hai lần, tiền rót vào
//           đợt VOID (lưu kế hoạch trả góp VOID đợt "thu toàn đơn" mà không đụng phiếu gộp).
//   [V3-1x] SePay gửi lại webhook của CHÍNH giao dịch vừa gỡ gắn ⇒ tự khớp lại, lý do gỡ bị xoá.
//   [V3-2x] gỡ gắn rồi gắn tay lại đúng các đợt ⇒ phiếu kẹt OPEN 0đ, chặn phát phiếu mới.
//   [V3-3x] nợ 3 mới vá một nửa: dòng POS gốc nhận cơ sở theo máy, BankTransaction vẫn NULL.
//   [V3-4x] đua gỡ gắn ‖ import dòng hủy ⇒ giao dịch về UNMATCHED đủ số gộp.
//
// Đi qua ĐÚNG cửa của đời thật: SePay qua `ingestPayosWebhook`, thẻ qua `nhapLoPos`, gỡ gắn qua
// `goGanTheoCon`, gắn tay qua `ganTienTheoCon`, lưu kế hoạch qua `materializeInstallmentRequests`.
// Test KHÔNG import helper mới của bản vá — trước bản vá tệp vẫn nạp được, từng ca đỏ đúng chỗ.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docPhieuGopDangMo, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { ganTienTheoCon, goGanTheoCon, huyDotChoCon } from "@/lib/finance/ghi-tien-don";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import {
  getOrderPaymentRequests,
  materializeInstallmentRequests,
  revertInstallmentRequests,
} from "@/lib/payments/payment-request";
import { dungMemo } from "@/lib/payments/memo-ck";
import { recordInstallmentPlan } from "@/lib/orders/installments";
import { NextRequest } from "next/server";
import { POST as POST_SEPAY } from "@/app/api/public/webhook/sepay/route";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import type { DongHuyPos, DongPos } from "@/lib/payments/pos/kieu";
// Rà vòng 4 — "nói trước" và "nói sau" (luật 12). Các ca `[V4-NT-*]` CỐ Ý import helper của bản
// vá: thứ chúng chứng minh là LỜI NÓI TRƯỚC KHỚP ĐÚNG VIỆC MÁY LÀM trên Postgres thật.
import { approveOrder, rejectOrder } from "@/lib/orders/approval";
import { phieuSeHuyKhiLuuKeHoach } from "@/lib/payments/phieu-se-huy-ke-hoach";
import { canhBaoTruocVoidDot } from "@/lib/finance/soat-phieu-gop";
import { keHoachHapThu, CACH_HAP_THU } from "@/lib/orders/chinh-sach-uu-dai";
import { noTheoCon } from "@/lib/finance/debt";
import { mienGiamNoChoCon } from "@/lib/finance/mien-giam-db";

if (!RUN_DB_TESTS) console.warn(`[V3] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-posv3-";
/** `maGiaoDich` / `maThietBi` chỉ nhận chữ/số ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOSVT";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture vòng 3" };

const USER = `${T}user`;
const CENTER = `${T}center`;
/** OrgUnit của CENTER — id CỐ ĐỊNH: cache ghi kép (`centerToOrgUnit`) giữ kết quả theo tiến trình. */
const OU_CENTER = `${T}ou-center`;
const DON = `${T}don`;
const MA_DON = "ORD-269930-000933";
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
/** Đợt "thu toàn đơn" (installmentNo 0) — chỉ có ở fixture kiểu `toanDon`. */
const R0 = `${T}dot-0`;
const MAY = `${PFX}MAY01`;
/** Khoá QR đời CŨ của DOT_A (nhánh (a) `matchKey` của đường cũ). */
const KHOA_CU_A = `${PFX}KEYA01`;

const HOC_PHI_A = 6_336_000;
const HOC_PHI_B = 7_128_000;
const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000
const SDT = "0905333999";
const GIO_QUET = "2026-09-21T10:12:13+07:00";

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
 * Nền chung. `toanDon: true` ⇒ đơn chỉ có MỘT đợt "thu toàn đơn" R0 (installmentNo 0, số TONG) —
 * hình dạng của đơn mới tạo chưa lập kế hoạch trả góp. Mặc định ⇒ hai đợt theo con A/B.
 */
async function dungFixture(opt: { toanDon?: boolean } = {}) {
  await don();
  await db.user.create({
    data: { id: USER, name: "Kế toán HO fixture V3", email: `${USER}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] },
  });
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture V3", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" },
  });
  await db.orgUnit.create({
    data: { id: OU_CENTER, type: "CENTER", code: `${PFX}OU`, name: "Đơn vị fixture V3", centerId: CENTER, path: "/fxposvt-ou/", depth: 0 },
  });
  await db.posTerminal.create({ data: { maThietBi: MAY, maQuay: "Q1", centerId: CENTER } });
  await db.order.create({
    data: {
      id: DON,
      code: MA_DON,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture V3",
      customerPhone: SDT,
      totalAmount: opt.toanDon ? TONG : HOC_PHI_A + HOC_PHI_B,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A V3", HOC_PHI_A],
    [B, "Bé B V3", HOC_PHI_B],
  ] as const) {
    await db.orderItem.create({
      data: { id, orderId: DON, type: "COURSE_ENROLLMENT", itemName: ten, quantity: 1, unitPrice: gia, totalPrice: gia },
    });
  }
  if (opt.toanDon) {
    await db.paymentRequest.create({
      data: { id: R0, orderId: DON, centerId: CENTER, installmentNo: 0, amountDue: TONG, status: "PENDING", sortOrder: 0 },
    });
    return;
  }
  for (const [id, item, tien, thuTu, khoa] of [
    [DOT_A, A, DOT_TIEN_A, 1, KHOA_CU_A],
    [DOT_B, B, DOT_TIEN_B, 2, null],
  ] as const) {
    await db.paymentRequest.create({
      data: {
        id,
        orderId: DON,
        orderItemId: item,
        centerId: CENTER,
        installmentNo: 1,
        amountDue: tien,
        status: "PENDING",
        sortOrder: thuTu,
        matchKey: khoa,
      },
    });
  }
}

async function phatPhieu(ids: string[] = [DOT_A, DOT_B]): Promise<{ ma: string; billId: string }> {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
  return { ma: r.ma, billId: r.billId };
}

const memo = (ma: string) => dungMemo({ hoTen: "Bé A V3", sdt: SDT, ma });

/** Bắn một giao dịch chuyển khoản vào ĐÚNG cửa SePay đi. */
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
    soTien: TONG,
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
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture-v3.xlsx", importedById: USER } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: dongHuyCuaFile.map(tom), nguoiNhapId: USER });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  return kq;
}

const posRow = (ma: string) =>
  db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: ma }, include: { bankTransaction: true } });
const phieu = (billId: string) => db.paymentBill.findUniqueOrThrow({ where: { id: billId } });
const tongPaymentDon = async () =>
  (await db.payment.aggregate({ where: { orderId: DON, deletedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0;
const tongPhanBoDot = async (paymentRequestId: string) =>
  (await db.paymentAllocation.aggregate({ where: { paymentRequestId }, _sum: { amount: true } }))._sum.amount ?? 0;
const tongPhanBoGd = async (bankTransactionId: string) =>
  (await db.paymentAllocation.aggregate({ where: { bankTransactionId }, _sum: { amount: true } }))._sum.amount ?? 0;

/** Lưu kế hoạch trả góp hai đợt (bằng đúng hàm mà ba đường gọi dùng — sau cổng R-02). */
async function luuKeHoachHaiDot() {
  await db.orderInstallment.createMany({
    data: [
      { orderId: DON, soDot: 1, amount: TONG / 2 },
      { orderId: DON, soDot: 2, amount: TONG / 2 },
    ],
  });
  await db.$transaction((tx) => materializeInstallmentRequests(tx, DON, ACTOR));
}

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN_DB_TESTS)("[V3] rà đối kháng vòng 3 — sổ tiền quanh gỡ gắn / phiếu gộp / thẻ POS", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  // ═════════════════════════════════════════════════════════════════════════
  // PHIẾU GỘP TRÊN ĐỢT ĐÃ VOID
  // ═════════════════════════════════════════════════════════════════════════

  it("[V3-01] gỡ gắn ⇒ phiếu R0 mở lại ⇒ lưu kế hoạch (R0 VOID) ⇒ phiếu KHÔNG còn mở, quét lại mã cũ KHÔNG rót vào R0", async () => {
    await dungFixture({ toanDon: true });
    const { ma, billId } = await phatPhieu([R0]);
    const t1 = maSepay();
    expect((await banSepay(memo(ma), TONG, t1)).status, "đối chứng fixture").toBe("MATCHED");

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "chia lại", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(billId)).status, "đối chứng: phiếu mở lại trước khi lưu kế hoạch").toBe("OPEN");

    // Đúng lời R-02 bảo kế toán làm: gỡ rồi lập lại kế hoạch.
    await luuKeHoachHaiDot();
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).status).toBe("VOID");

    expect((await phieu(billId)).status, "phiếu trỏ đợt VOID mà còn OPEN = mời khách trả lần hai").not.toBe("OPEN");
    expect(await docPhieuGopDangMo(DON), "trang đơn không được mời trả phiếu trên đợt đã huỷ").toBeNull();

    // Phụ huynh quét lại mã cũ đúng số ⇒ KHÔNG tự khớp.
    const t2 = maSepay();
    const lai = await banSepay(memo(ma), TONG, t2);
    expect(lai.status).toBe("UNMATCHED");
    expect(await tongPhanBoDot(R0), "phân bổ vào R0 (VOID)").toBe(0);
    expect(await tongPaymentDon(), "Σ Payment ròng (T1 đã đảo)").toBe(0);
  });

  it("[V3-02] thứ tự ngược: R0 VOID khi phiếu còn PAID ⇒ gỡ gắn KHÔNG mở lại (đóng), quét lại KHÔNG rót vào R0", async () => {
    await dungFixture({ toanDon: true });
    const { ma, billId } = await phatPhieu([R0]);
    const t1 = maSepay();
    expect((await banSepay(memo(ma), TONG, t1)).status).toBe("MATCHED");
    // Gọi thẳng hàm VOID (không qua cổng R-02) — dữ liệu cũ / đường gọi khác.
    await luuKeHoachHaiDot();
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).status).toBe("VOID");

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "chia lại", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(billId)).status, "phiếu trên đợt VOID không được MỞ LẠI").toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON)).toBeNull();

    const lai = await banSepay(memo(ma), TONG);
    expect(lai.status).toBe("UNMATCHED");
    expect(await tongPhanBoDot(R0)).toBe(0);
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[V3-03] chặn tại chỗ tiêu tiền: phiếu OPEN có dòng trỏ đợt VOID (ghi thẳng DB) ⇒ tiền đúng số KHÔNG rót, giao dịch UNMATCHED có lý do", async () => {
    const { ma, billId } = await phatPhieu();
    // Mô phỏng một đường VOID đợt không đụng phiếu (dữ liệu cũ, SQL tay).
    await db.paymentRequest.update({ where: { id: DOT_A }, data: { status: "VOID" } });
    expect((await phieu(billId)).status, "đối chứng fixture").toBe("OPEN");

    const t = maSepay();
    const r = await banSepay(memo(ma), TONG, t);
    expect(r.status).toBe("UNMATCHED");
    expect(await tongPhanBoDot(DOT_A), "không rót vào đợt VOID").toBe(0);
    expect(await tongPhanBoDot(DOT_B), "ăn cả hoặc không ăn gì").toBe(0);
    expect(await tongPaymentDon()).toBe(0);
    expect((await btSepay(t)).unmatchedNote ?? "").toMatch(/huỷ/i);
  });

  it("[V3-04] huỷ một đợt đang nằm trong phiếu gộp (chưa nhận đồng nào) ⇒ phiếu VOID, không còn 'đang mở'", async () => {
    const { ma, billId } = await phatPhieu();
    const r = await huyDotChoCon({ orderId: DON, paymentRequestId: DOT_B, centerId: CENTER, actor: ACTOR });
    expect(r.ok, "đối chứng fixture").toBe(true);
    expect((await phieu(billId)).status).toBe("VOID");
    // Rà vòng 4 (luật 12): kết quả phải NÓI phiếu của cả gia đình vừa bị huỷ — không chỉ "Đã huỷ đợt".
    expect(r.ok ? r.thongDiepPhieu : null, "người bấm phải biết phiếu gộp đã huỷ").toContain(`Phiếu gộp ${ma} đã HUỶ`);
    expect(await docPhieuGopDangMo(DON)).toBeNull();
    // Phát lại được phiếu cho đợt còn mở (chỉ mục một-phiếu-mở không còn bị chiếm).
    const moi = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(moi.ok).toBe(true);
  });

  it("[V3-05] từ chối kế hoạch (revert) VOID đợt theo kế hoạch đang nằm trong phiếu OPEN ⇒ phiếu VOID", async () => {
    await dungFixture({ toanDon: true });
    await luuKeHoachHaiDot();
    const dot1 = await db.paymentRequest.findFirstOrThrow({ where: { orderId: DON, installmentNo: 1 } });
    const { billId } = await phatPhieu([dot1.id]);
    await db.$transaction((tx) => revertInstallmentRequests(tx, DON, ACTOR));
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: dot1.id } })).status).toBe("VOID");
    expect((await phieu(billId)).status).toBe("VOID");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // WEBHOOK GỬI LẠI SAU GỠ GẮN
  // ═════════════════════════════════════════════════════════════════════════

  it("[V3-10] SePay phiếu gộp: gửi lại webhook của CHÍNH giao dịch đã gỡ gắn ⇒ vẫn UNMATCHED, giữ lý do gỡ, không rót", async () => {
    const { ma, billId } = await phatPhieu();
    const t1 = maSepay();
    expect((await banSepay(memo(ma), TONG, t1)).status).toBe("MATCHED");
    const id1 = (await btSepay(t1)).id;
    const go = await goGanTheoCon({ bankTransactionId: id1, orderId: DON, lyDo: "khách chuyển nhầm — sẽ hoàn", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(billId)).status, "đối chứng: phiếu mở lại").toBe("OPEN");

    const guiLai = await banSepay(memo(ma), TONG, t1);
    expect(guiLai.status).not.toBe("MATCHED");
    const bt = await btSepay(t1);
    expect(bt.status).toBe("UNMATCHED");
    expect(bt.unmatchedNote).toBe("Đã gỡ gắn: khách chuyển nhầm — sẽ hoàn");
    expect(await tongPhanBoGd(id1)).toBe(0);
    expect(await tongPaymentDon(), "Σ Payment ròng").toBe(0);
    expect((await phieu(billId)).status, "phiếu vẫn chờ tiền THẬT").toBe("OPEN");
  });

  it("[V3-11] SePay mã đời CŨ (matchKey đợt): gửi lại webhook sau gỡ gắn ⇒ vẫn UNMATCHED, giữ lý do gỡ", async () => {
    const t1 = maSepay();
    const r1 = await banSepay(`${KHOA_CU_A} NOP HOC PHI`, DOT_TIEN_A, t1);
    expect(r1.status, "đối chứng fixture: đường cũ khớp").toBe("MATCHED");
    const id1 = (await btSepay(t1)).id;
    const go = await goGanTheoCon({ bankTransactionId: id1, orderId: DON, lyDo: "nhầm đơn", actor: ACTOR });
    expect(go.ok).toBe(true);

    const guiLai = await banSepay(`${KHOA_CU_A} NOP HOC PHI`, DOT_TIEN_A, t1);
    expect(guiLai.status).not.toBe("MATCHED");
    const bt = await btSepay(t1);
    expect(bt.status).toBe("UNMATCHED");
    expect(bt.unmatchedNote).toBe("Đã gỡ gắn: nhầm đơn");
    expect(await tongPhanBoGd(id1)).toBe(0);
  });

  it("[V3-13] route SePay: gửi lại webhook của giao dịch ĐÃ GỠ GẮN ⇒ nhật ký SKIPPED 'Đã gỡ gắn', KHÔNG 'MATCH_TXN SUCCESS'", async () => {
    // Rà vòng 4 (luật 12): cổng gỡ gắn trả DUPLICATE, route gộp DUPLICATE với MATCHED ⇒ màn nhật ký
    // SePay in "Đã khớp phiếu thu — không cần xử lý tay" cho giao dịch đang UNMATCHED ở hàng chờ.
    const { ma } = await phatPhieu();
    const t1 = maSepay();
    expect((await banSepay(memo(ma), TONG, t1)).status).toBe("MATCHED");
    expect((await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "gắn nhầm", actor: ACTOR })).ok).toBe(true);

    process.env.SEPAY_WEBHOOK_API_KEY = "sepay-test-key-v3";
    const res = await POST_SEPAY(
      new NextRequest("https://satarobo.vn/api/public/webhook/sepay", {
        method: "POST",
        headers: { authorization: "Apikey sepay-test-key-v3", "content-type": "application/json" },
        body: JSON.stringify({
          id: 990001,
          gateway: "TCB",
          transactionDate: "2026-09-21 10:00:00",
          accountNumber: "0123456789",
          content: memo(ma),
          transferType: "in",
          transferAmount: TONG,
          referenceCode: t1,
        }),
      }),
    );
    const body = (await res.json()) as { handled?: boolean };
    const log = await db.integrationLog.findMany({
      where: { provider: "SEPAY", requestPayload: { path: ["referenceCode"], equals: t1 } },
      select: { action: true, status: true, errorMessage: true },
    });
    await db.integrationLog.deleteMany({ where: { provider: "SEPAY", requestPayload: { path: ["referenceCode"], equals: t1 } } });

    expect((await btSepay(t1)).status, "đối chứng: giao dịch vẫn ở hàng chờ").toBe("UNMATCHED");
    expect(log.filter((l) => l.status === "SUCCESS"), "không có dòng SUCCESS nào cho giao dịch đang UNMATCHED").toEqual([]);
    expect(log.some((l) => l.status === "SKIPPED" && (l.errorMessage ?? "").includes("Đã gỡ gắn"))).toBe(true);
    expect(body.handled, "route không được nói 'đã xử lý'").toBe(false);
  });

  it("[V3-12] đối chứng dương: gắn tay LẠI giao dịch đã gỡ vẫn làm được (cổng chỉ chặn webhook)", async () => {
    const { ma } = await phatPhieu();
    const t1 = maSepay();
    await banSepay(memo(ma), TONG, t1);
    const id1 = (await btSepay(t1)).id;
    expect((await goGanTheoCon({ bankTransactionId: id1, orderId: DON, lyDo: "chia lại", actor: ACTOR })).ok).toBe(true);
    const gan = await ganTienTheoCon({
      bankTransactionId: id1,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
      nguoiGan: { loai: "KE_TOAN" },
    });
    expect(gan.ok).toBe(true);
    expect((await btSepay(t1)).status).toBe("MATCHED");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // PHIẾU OPEN 0đ
  // ═════════════════════════════════════════════════════════════════════════

  it("[V3-20] gỡ gắn ⇒ phiếu mở lại ⇒ gắn tay lại đúng các đợt ⇒ KHÔNG còn 'phiếu đang mở' 0đ; gỡ lần nữa ⇒ phiếu hiện lại đúng số", async () => {
    const { ma, billId } = await phatPhieu();
    const t1 = maSepay();
    await banSepay(memo(ma), TONG, t1);
    const id1 = (await btSepay(t1)).id;
    expect((await goGanTheoCon({ bankTransactionId: id1, orderId: DON, lyDo: "chia lại", actor: ACTOR })).ok).toBe(true);
    expect((await phieu(billId)).status, "đối chứng").toBe("OPEN");
    const ganLai = () =>
      ganTienTheoCon({
        bankTransactionId: id1,
        orderId: DON,
        dong: [
          { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
          { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
        ],
        actor: ACTOR,
        nguoiGan: { loai: "KE_TOAN" },
      });
    expect((await ganLai()).ok).toBe(true);
    expect(await docPhieuGopDangMo(DON), "không còn 'phiếu đang mở' 0đ").toBeNull();

    // Đảo được: gỡ khoản gắn tay ⇒ phiếu hiện lại đúng số (vì thế KHÔNG tự đặt PAID — PAID là
    // trạng thái lượt gỡ không mở lại được, xem `[POS-DB-21b]`).
    expect((await goGanTheoCon({ bankTransactionId: id1, orderId: DON, lyDo: "gắn nhầm lần hai", actor: ACTOR })).ok).toBe(true);
    const mo = await docPhieuGopDangMo(DON);
    expect(mo?.ma).toBe(ma);
    expect(mo?.tongTien).toBe(TONG);
  });

  it("[V3-21] phiếu OPEN chưa ai trả, đợt của nó được lấp bằng gắn tay ⇒ không hiện 0đ, phát được phiếu mới cho đợt khác (phiếu cũ ĐÓNG)", async () => {
    const x = await phatPhieu([DOT_A]);
    const bt1 = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: maSepay(), amount: DOT_TIEN_A, transferredAt: new Date("2026-09-20T02:00:00Z"), status: "UNMATCHED" },
    });
    expect(
      (await ganTienTheoCon({ bankTransactionId: bt1.id, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: DOT_TIEN_A }], actor: ACTOR, nguoiGan: { loai: "KE_TOAN" } })).ok,
    ).toBe(true);
    expect(await docPhieuGopDangMo(DON), "phiếu 0đ không phải 'phiếu đang mở'").toBeNull();

    const moi = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_B], actor: ACTOR });
    expect(moi.ok, "chỉ mục một-phiếu-mở không được kẹt vì phiếu 0đ").toBe(true);
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(DOT_TIEN_B);
  });

  it("[V3-23] gỡ gắn phiếu X đã trả, trong khi phiếu Y OPEN 0đ (bị màn giấu) ⇒ X MỞ LẠI (không ĐÓNG), Y được khép, mã X thu lại đúng số", async () => {
    // Rà vòng 4: luật gỡ gắn đếm cả phiếu OPEN 0đ là "phiếu mở khác" ⇒ ĐÓNG X, câu nhật ký nói có
    // phiếu mở trong khi màn không có ⇒ QR X đã giao khách thành mã chết.
    const x = await phatPhieu([DOT_A]);
    const t1 = maSepay();
    expect((await banSepay(memo(x.ma), DOT_TIEN_A, t1)).status, "đối chứng fixture").toBe("MATCHED");
    expect((await phieu(x.billId)).status).toBe("PAID");
    const y = await phatPhieu([DOT_B]);
    // Đợt B đủ tiền qua đường khác (gắn tay) ⇒ Y OPEN 0đ, màn giấu.
    const bt2 = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: maSepay(), amount: DOT_TIEN_B, transferredAt: new Date("2026-09-20T02:00:00Z"), status: "UNMATCHED" },
    });
    expect(
      (await ganTienTheoCon({ bankTransactionId: bt2.id, orderId: DON, dong: [{ paymentRequestId: DOT_B, soTien: DOT_TIEN_B }], actor: ACTOR, nguoiGan: { loai: "KE_TOAN" } })).ok,
    ).toBe(true);
    expect((await phieu(y.billId)).status, "đối chứng: Y vẫn OPEN trong DB").toBe("OPEN");
    expect(await docPhieuGopDangMo(DON), "đối chứng: màn không hiện phiếu mở nào").toBeNull();

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "khách chuyển nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(x.billId)).status, "X phải MỞ LẠI — Y 0đ không phải 'phiếu mở khác'").toBe("OPEN");
    expect((await phieu(y.billId)).status, "Y 0đ đã nhận tiền ⇒ khép ĐÓNG").toBe("CLOSED");
    expect((await docPhieuGopDangMo(DON))?.ma).toBe(x.ma);

    const lai = await banSepay(memo(x.ma), DOT_TIEN_A);
    expect(lai.status, "trả lại đúng mã X, đúng số ⇒ khớp").toBe("MATCHED");
  });

  it("[V3-23b] đối chứng: Y còn phải thu THẬT (thấy trên màn) ⇒ gỡ gắn X vẫn ĐÓNG X (đúng luật một-phiếu-mở)", async () => {
    const x = await phatPhieu([DOT_A]);
    const t1 = maSepay();
    expect((await banSepay(memo(x.ma), DOT_TIEN_A, t1)).status).toBe("MATCHED");
    const y = await phatPhieu([DOT_B]);
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(DOT_TIEN_B);

    expect((await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "khách chuyển nhầm", actor: ACTOR })).ok).toBe(true);
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect((await phieu(y.billId)).status).toBe("OPEN");
  });

  it("[V3-22] đối chứng: phiếu lấp MỘT PHẦN từ đường khác vẫn là 'phiếu đang mở' với số còn lại, và vẫn chặn phiếu thứ hai", async () => {
    await phatPhieu();
    const bt1 = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: maSepay(), amount: DOT_TIEN_A, transferredAt: new Date("2026-09-20T02:00:00Z"), status: "UNMATCHED" },
    });
    expect(
      (await ganTienTheoCon({ bankTransactionId: bt1.id, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: DOT_TIEN_A }], actor: ACTOR, nguoiGan: { loai: "KE_TOAN" } })).ok,
    ).toBe(true);
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(DOT_TIEN_B);
    const moi = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_B], actor: ACTOR });
    expect(moi.ok).toBe(false);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // CƠ SỞ CỦA BANKTRANSACTION GỐC (nợ 3, vế còn lại)
  // ═════════════════════════════════════════════════════════════════════════

  it("[V3-30] gốc NULL (máy chưa khai) → khai máy → file CHỈ dòng hủy ⇒ BankTransaction gốc IGNORED + cơ sở theo máy", async () => {
    const mayLa = `${PFX}MAYLA1`;
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma", maThietBi: mayLa })]);
    expect((await posRow(goc)).bankTransaction?.centerId, "đối chứng fixture").toBeNull();
    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER } });
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG, maThietBi: mayLa })]);
    const r = await posRow(goc);
    expect(r.bankTransaction?.status).toBe("IGNORED");
    expect(r.bankTransaction?.centerId, "NULL ⇒ mọi cơ sở đọc được").toBe(CENTER);
    expect(r.bankTransaction?.orgUnitId, "ghi kép").toBe(OU_CENTER);
  });

  it("[V3-31] như trên với dòng hoàn MỘT PHẦN ⇒ BankTransaction gốc IGNORED + cơ sở theo máy", async () => {
    const mayLa = `${PFX}MAYLA2`;
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma", maThietBi: mayLa })]);
    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER } });
    await lo([
      dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần", maThietBi: mayLa }),
    ]);
    const r = await posRow(goc);
    expect(r.bankTransaction?.status).toBe("IGNORED");
    expect(r.bankTransaction?.centerId).toBe(CENTER);
    expect(r.bankTransaction?.orgUnitId).toBe(OU_CENTER);
  });

  it("[V3-32] nhánh anh em: gốc NULL → khai máy → file có CẢ gốc lẫn dòng hủy ⇒ BankTransaction gốc IGNORED + cơ sở theo máy", async () => {
    const mayLa = `${PFX}MAYLA3`;
    const goc = maGd();
    const dGoc = dong({ maGiaoDich: goc, dienGiai: "khong ma", maThietBi: mayLa });
    await lo([dGoc]);
    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER } });
    const dHuy = dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG, maThietBi: mayLa });
    await lo([dGoc, dHuy], [dHuy]);
    const r = await posRow(goc);
    expect(r.bankTransaction?.status).toBe("IGNORED");
    expect(r.centerId).toBe(CENTER);
    expect(r.bankTransaction?.centerId).toBe(CENTER);
    expect(r.bankTransaction?.orgUnitId).toBe(OU_CENTER);
  });

  it("[V3-33] đối chứng: gốc đã có cơ sở ⇒ dòng hủy KHÔNG đổi cơ sở của BankTransaction", async () => {
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma" })]);
    expect((await posRow(goc)).bankTransaction?.centerId).toBe(CENTER);
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG })]);
    const r = await posRow(goc);
    expect(r.bankTransaction?.status).toBe("IGNORED");
    expect(r.bankTransaction?.centerId).toBe(CENTER);
  });

  it("[V3-06] đua: tiền về đúng mã (giữ khoá đơn, đã qua cổng đợt VOID) ‖ lưu kế hoạch ⇒ KHÔNG rót vào đợt VOID, phiếu KHÔNG bị ghi 'chưa nhận đồng nào'", async () => {
    // Rà vòng 4: lưu kế hoạch (`recordInstallmentPlan`) VOID R0 + soát phiếu mà KHÔNG giữ khoá đơn,
    // trong khi `thuTheoPhieuGop` giữ khoá đơn ⇒ hai bên không loại trừ nhau. Lượt thu đã đọc R0
    // PENDING (qua cổng (c)) rồi mới rót ⇒ tiền nằm trong đợt VOID, R1+R2 đòi lại đủ học phí.
    await dungFixture({ toanDon: true });
    const { billId } = await phatPhieu([R0]);
    const txn = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: maSepay(), amount: TONG, transferredAt: new Date(), status: "UNMATCHED", centerId: CENTER },
    });

    // "Lượt thu" giả: giữ ĐÚNG khoá đơn mà `thuTheoPhieuGop` giữ, đã đọc R0 còn PENDING, chờ rồi rót.
    let moKhoa!: () => void;
    const choMo = new Promise<void>((r) => (moKhoa = r));
    let daGiu!: () => void;
    const giu = new Promise<void>((r) => (daGiu = r));
    const thuGia = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DON})::bigint)`;
        const r0 = await tx.paymentRequest.findUniqueOrThrow({ where: { id: R0 } });
        expect(r0.status, "đối chứng: lượt thu thấy R0 còn sống").toBe("PENDING");
        daGiu();
        await choMo;
        await tx.paymentAllocation.create({ data: { bankTransactionId: txn.id, paymentRequestId: R0, amount: TONG, centerId: CENTER } });
        await tx.paymentRequest.update({ where: { id: R0 }, data: { status: "PAID" } });
        await tx.paymentBill.updateMany({ where: { id: billId, status: "OPEN" }, data: { status: "PAID" } });
        await tx.bankTransaction.update({ where: { id: txn.id }, data: { status: "MATCHED" } });
      },
      { timeout: 20_000 },
    );
    await giu;

    let xong = false;
    const keHoach = recordInstallmentPlan({
      orderId: DON,
      dots: [
        { amount: TONG / 2, daThu: false, dueDate: new Date("2026-10-15T00:00:00+07:00") },
        { amount: TONG / 2, daThu: false, dueDate: new Date("2026-11-15T00:00:00+07:00") },
      ],
      actorId: null,
    }).finally(() => (xong = true));
    // Cho lượt lưu kế hoạch một cửa sổ để chạy trọn NẾU nó không chờ khoá đơn.
    for (let i = 0; i < 75 && !xong; i++) await cho(20);
    moKhoa();
    await thuGia;
    const kq = await keHoach;

    const rotVaoDotVoid =
      (await db.paymentAllocation.aggregate({ where: { paymentRequest: { orderId: DON, status: "VOID" } }, _sum: { amount: true } }))._sum
        .amount ?? 0;
    expect(rotVaoDotVoid, "tiền đã về không được nằm trong đợt VOID").toBe(0);
    const conDoi =
      (await db.paymentRequest.aggregate({ where: { orderId: DON, status: { in: ["PENDING", "PARTIAL"] } }, _sum: { amountDue: true } }))._sum
        .amountDue ?? 0;
    expect(conDoi, "đã nhận đủ TONG mà đợt mới vẫn đòi ⇒ khách trả hai lần").toBe(0);
    expect(kq.ok, "kế hoạch phải bị R-02 chặn vì phiếu toàn đơn đã có tiền").toBe(false);
    expect((await phieu(billId)).status, "phiếu đã nhận đủ không được ghi VOID").toBe("PAID");
    const huyNham = await db.auditLog.count({ where: { entityType: "Order", entityId: DON, action: "PHIEU_GOP_VOID" } });
    expect(huyNham, "không có nhật ký 'huỷ phiếu (chưa nhận đồng nào)'").toBe(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ĐUA GỠ GẮN ‖ IMPORT DÒNG HỦY
  // ═════════════════════════════════════════════════════════════════════════

  it("[V3-40] đua: lượt gỡ gắn đang giữ giao dịch (đã đọc 'chưa có dòng hủy') ‖ import dòng hủy ⇒ giao dịch cuối KHÔNG ở UNMATCHED", async () => {
    const { ma } = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${ma}` })]);
    const g = await posRow(goc);
    expect(g.bankTransaction?.status, "đối chứng fixture").toBe("MATCHED");
    const btId = g.bankTransactionId!;
    const huy = maGd();

    // "Lượt gỡ gắn" giả: giữ khoá DÒNG giao dịch (như `goGanTheoCon` sau bản vá), đã đọc xong tín
    // hiệu (chưa thấy dòng hủy), chờ import chạy tới rồi mới ghi UNMATCHED + commit.
    let moKhoa!: () => void;
    const choMo = new Promise<void>((r) => (moKhoa = r));
    let daGiu!: () => void;
    const giu = new Promise<void>((r) => (daGiu = r));
    const goGia = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "BankTransaction" WHERE id = ${btId} FOR UPDATE`;
        daGiu();
        await choMo;
        await tx.bankTransaction.update({ where: { id: btId }, data: { status: "UNMATCHED", unmatchedNote: "Đã gỡ gắn: đua" } });
      },
      { timeout: 20_000 },
    );
    await giu;

    const nhap = lo([dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG })]);
    // Chờ import ghi xong dòng hủy (nó ở ngoài khoá) rồi mới cho lượt gỡ commit.
    for (let i = 0; i < 100; i++) {
      if (await db.posCardTransaction.findUnique({ where: { maGiaoDich: huy }, select: { id: true } })) break;
      await cho(20);
    }
    moKhoa();
    await goGia;
    await nhap;

    const r = await posRow(goc);
    expect(r.bankTransaction?.status, "tiền đã hoàn về thẻ — không được nằm lại hàng chờ đủ số gộp").toBe("IGNORED");
  });

  // Rà vòng 4 — nhánh anh em của [V3-40]: tín hiệu tới từ CỘT Hoàn/Hủy của chính dòng gốc (bản xuất
  // lại), không từ dòng hủy. Nhánh "ĐÃ KHOÁ" của import lấy trạng thái giao dịch từ ảnh chụp ĐẦU LÔ
  // (MATCHED) ⇒ chỉ ghi cột, không đọc lại dưới khoá ⇒ giao dịch vừa gỡ nằm lại UNMATCHED đủ số gộp.
  for (const [ma, cot, lyDo] of [
    ["V3-41", "Hủy toàn phần", "hủy toàn phần"],
    ["V3-41b", "Hoàn một phần", "hoàn một phần"],
  ] as const) {
    it(`[${ma}] đua: lượt gỡ gắn đang giữ giao dịch ‖ import bản xuất lại của GỐC mang cột '${cot}' ⇒ giao dịch cuối KHÔNG ở UNMATCHED (${lyDo})`, async () => {
      const { ma: maPhieu } = await phatPhieu();
      const goc = maGd();
      await lo([dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${maPhieu}` })]);
      const g = await posRow(goc);
      expect(g.bankTransaction?.status, "đối chứng fixture").toBe("MATCHED");
      const btId = g.bankTransactionId!;

      let moKhoa!: () => void;
      const choMo = new Promise<void>((r) => (moKhoa = r));
      let daGiu!: () => void;
      const giu = new Promise<void>((r) => (daGiu = r));
      const goGia = db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT 1 FROM "BankTransaction" WHERE id = ${btId} FOR UPDATE`;
          daGiu();
          await choMo;
          await tx.bankTransaction.update({ where: { id: btId }, data: { status: "UNMATCHED", unmatchedNote: "Đã gỡ gắn: đua cột" } });
        },
        { timeout: 20_000 },
      );
      await giu;

      const nhap = lo([dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${maPhieu}`, trangThaiHoanHuy: cot })]);
      // Chờ import ghi xong cột của gốc (ngoài khoá) rồi mới cho lượt gỡ commit.
      for (let i = 0; i < 100; i++) {
        const r = await db.posCardTransaction.findUnique({ where: { maGiaoDich: goc }, select: { trangThaiHoanHuy: true } });
        if (r?.trangThaiHoanHuy) break;
        await cho(20);
      }
      moKhoa();
      await goGia;
      await nhap;

      const r = await posRow(goc);
      expect(r.bankTransaction?.status, "thẻ đã hủy/hoàn — không được nằm lại hàng chờ đủ số gộp").toBe("IGNORED");
      const ganLai = await ganTienTheoCon({
        bankTransactionId: btId,
        orderId: DON,
        dong: [
          { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
          { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
        ],
        actor: ACTOR,
        nguoiGan: { loai: "KE_TOAN" },
      });
      expect(ganLai.ok, "không gắn tay lại được khoản đã hủy/hoàn").toBe(false);
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RÀ VÒNG 4 — HUỶ/ĐÓNG PHIẾU GỘP CỦA CẢ NHÀ PHẢI ĐƯỢC NÓI RA (luật 12)
  // ═════════════════════════════════════════════════════════════════════════

  const QLCS = { id: USER, name: "QLCS fixture V4", role: "SUPER_ADMIN" as const, roles: ["SUPER_ADMIN" as const] };
  const HAN = new Date("2026-10-30T00:00:00+07:00");

  /** Tập id phiếu thu đang VOID của đơn — để so "nói trước" với "máy làm". */
  const dangVoid = async () =>
    new Set((await db.paymentRequest.findMany({ where: { orderId: DON, status: "VOID" }, select: { id: true } })).map((r) => r.id));

  /** Đơn toàn đơn + phiếu gộp trên R0 + kế hoạch hai đợt CHỜ DUYỆT (chưa áp lên sổ phiếu). */
  async function donChoDuyet(): Promise<string> {
    await dungFixture({ toanDon: true });
    const { ma } = await phatPhieu([R0]);
    await db.order.update({ where: { id: DON }, data: { installmentApprovalStatus: "PENDING_APPROVAL" } });
    await db.orderInstallment.createMany({
      data: [
        { orderId: DON, soDot: 1, amount: TONG / 2, dueDate: HAN },
        { orderId: DON, soDot: 2, amount: TONG / 2, dueDate: HAN },
      ],
    });
    return ma;
  }

  it("[V4-NT-01] lưu kế hoạch: lời NÓI TRƯỚC (màn sửa kế hoạch) đúng mã + đúng tập phiếu mà `recordInstallmentPlan` VOID; lời nói SAU nêu cùng mã", async () => {
    await dungFixture({ toanDon: true });
    const { ma, billId } = await phatPhieu([R0]);
    const dots = [
      { amount: TONG / 2, daThu: false, dueDate: HAN },
      { amount: TONG / 2, daThu: false, dueDate: HAN },
    ];

    // Màn đọc đúng hai nguồn của trang đơn: phiếu gộp đang mở + sổ phiếu thu.
    const seHuy = phieuSeHuyKhiLuuKeHoach({ phieu: await getOrderPaymentRequests(DON), dots });
    const truoc = canhBaoTruocVoidDot(await docPhieuGopDangMo(DON), seHuy);
    expect(truoc?.tieuDe).toBe(`Mã phiếu ${ma} của cả nhà sẽ bị HUỶ`);

    const truocVoid = await dangVoid();
    const r = await recordInstallmentPlan({ orderId: DON, dots, actorId: USER });
    expect(r.ok, r.error).toBe(true);
    const moiVoid = [...(await dangVoid())].filter((id) => !truocVoid.has(id));
    expect(moiVoid.sort(), "nói trước đúng TẬP phiếu máy VOID").toEqual([...seHuy].sort());
    expect((await phieu(billId)).status).toBe("VOID");
    expect(r.thongDiepPhieu).toContain(`Phiếu gộp ${ma} đã HUỶ`);
  });

  it("[V4-NT-01b] đối chứng: kế hoạch mọi đợt ĐÃ THU không áp lên sổ phiếu ⇒ không nói trước, không huỷ phiếu", async () => {
    await dungFixture({ toanDon: true });
    const { billId } = await phatPhieu([R0]);
    const dots = [{ amount: TONG, daThu: true, dueDate: null }];
    const seHuy = phieuSeHuyKhiLuuKeHoach({ phieu: await getOrderPaymentRequests(DON), dots });
    expect(canhBaoTruocVoidDot(await docPhieuGopDangMo(DON), seHuy)).toBeNull();
    // Không gọi `recordInstallmentPlan` thật ở đây: khai "đã thu" 6.732.000đ mà sổ không có đồng
    // nào thì cổng `khaiDaThuVuotSo` chặn (đúng luật) — phiếu vì thế cũng không đổi.
    expect((await phieu(billId)).status).toBe("OPEN");
  });

  it("[V4-NT-02] miễn giảm: lời NÓI TRƯỚC (keHoachHapThu trên `noTheoCon`) đúng mã + đúng đợt `mienGiamNoChoCon` VOID", async () => {
    const { ma, billId } = await phatPhieu();
    const hapThu = CACH_HAP_THU.DOT_XA_NHAT;
    const soTien = 1_000_000;

    const so = await noTheoCon(DON);
    const conA = so.con.find((c) => c.orderItemId === A)!;
    const seHuy = keHoachHapThu({ dot: conA.dotDangMo, canGiam: soTien, cach: hapThu }).doi.map((d) => d.id);
    expect(seHuy, "đối chứng fixture: miễn giảm chạm đợt của bé A").toEqual([DOT_A]);
    const truoc = canhBaoTruocVoidDot(await docPhieuGopDangMo(DON), seHuy);
    expect(truoc?.tieuDe).toBe(`Mã phiếu ${ma} của cả nhà sẽ bị HUỶ`);

    const truocVoid = await dangVoid();
    const r = await mienGiamNoChoCon({
      orderId: DON,
      orderItemId: A,
      soTien,
      lyDo: "hoàn cảnh gia đình",
      hapThu,
      tranPhanTram: 100,
      actor: ACTOR,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const moiVoid = [...(await dangVoid())].filter((id) => !truocVoid.has(id));
    expect(moiVoid.sort()).toEqual([...seHuy].sort());
    expect((await phieu(billId)).status).toBe("VOID");
    expect(r.ok ? r.thongDiepPhieu : null).toContain(`Phiếu gộp ${ma} đã HUỶ`);
  });

  it("[V4-NT-03] duyệt đơn (approveOrder) VOID phiếu toàn đơn nằm trong phiếu gộp ⇒ kết quả NÓI phiếu của cả nhà đã HUỶ", async () => {
    const ma = await donChoDuyet();
    const r = await approveOrder({ orderId: DON, actor: QLCS });
    expect(r.ok, r.error).toBe(true);
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: R0 } })).status).toBe("VOID");
    expect(r.thongDiepPhieu, "toast chỉ nói 'Đã duyệt đơn' là lỗi câm").toContain(`Phiếu gộp ${ma} đã HUỶ`);
  });

  it("[V4-NT-03b] đối chứng: duyệt đơn KHÔNG có phiếu gộp ⇒ không câu cảnh báo nào", async () => {
    await dungFixture({ toanDon: true });
    await db.order.update({ where: { id: DON }, data: { installmentApprovalStatus: "PENDING_APPROVAL" } });
    await db.orderInstallment.createMany({ data: [{ orderId: DON, soDot: 1, amount: TONG, dueDate: HAN }] });
    const r = await approveOrder({ orderId: DON, actor: QLCS });
    expect(r.ok, r.error).toBe(true);
    expect(r.thongDiepPhieu ?? null).toBeNull();
  });

  it("[V4-NT-04] từ chối đơn (rejectOrder) VOID đợt theo kế hoạch nằm trong phiếu gộp ⇒ kết quả NÓI phiếu đã HUỶ", async () => {
    await dungFixture({ toanDon: true });
    await luuKeHoachHaiDot();
    const dot1 = await db.paymentRequest.findFirstOrThrow({ where: { orderId: DON, installmentNo: 1 } });
    const { ma, billId } = await phatPhieu([dot1.id]);
    await db.order.update({ where: { id: DON }, data: { installmentApprovalStatus: "PENDING_APPROVAL" } });
    const r = await rejectOrder({ orderId: DON, actor: QLCS, reason: "chia lại đợt" });
    expect(r.ok, r.error).toBe(true);
    expect((await phieu(billId)).status).toBe("VOID");
    expect(r.thongDiepPhieu).toContain(`Phiếu gộp ${ma} đã HUỶ`);
  });
});
