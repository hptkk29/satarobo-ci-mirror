// tests/finance/pos-vong5.test.ts — RÀ ĐỐI KHÁNG VÒNG 5 (30/09/2026). Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// `pnpm test:unit` trần sẽ SKIP. Không gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id —
// cùng khuôn `tests/finance/pos-vong3.test.ts`.
//
// Lỗi đã xác nhận ở lượt rà (docs/pos-the-smartpos.md mục "Rà đối kháng vòng 5"):
//   [V5-0x] Huỷ đơn — đường VOID đợt thứ sáu — không khoá đơn, không soát phiếu gộp.
//   [V5-2x] Gỡ gắn thẻ hoàn MỘT PHẦN: phiếu OPEN được lấp bằng gắn tay; tín hiệu tới SAU lượt gỡ.
//           (Q-M 30/09/2026: gỡ gắn thẻ luôn ĐÓNG phiếu — `[V5-21]` `[V5-21b]` `[V5-22]` đổi đối chứng,
//           xem `tests/finance/pos-vong6.test.ts`.)
//   [V5-3x] Lượt gỡ gắn khép phiếu 0đ vô điều kiện và im lặng.
//   [V5-4x] Lưu kế hoạch mức đơn trên đơn thu theo con; đổi SỐ đợt đang nằm trong phiếu gộp.
//   [V5-5x] Đợt đủ tiền nhờ DUNG SAI làm tròn không thành "phiếu 0đ".
//   [V5-6x] SePay gửi lại webhook của giao dịch ĐÃ BỎ QUA ⇒ "MATCH_TXN SUCCESS".
//
// Đi đúng cửa đời thật: SePay qua `ingestPayosWebhook` / route, thẻ qua `nhapLoPos`, gỡ gắn qua
// `goGanTheoCon`, gắn tay qua `ganTienTheoCon`, thu theo mã qua `thuTheoPhieuGop`, lưu kế hoạch qua
// `recordInstallmentPlan`. Huỷ đơn: phần tiền là `voidTienKhiHuyDonTrongTx` — CHÍNH hàm action gọi,
// dưới khoá đơn là câu đầu (lưới `[KDK-W4]` ghim action).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docPhieuGopDangMo, taoPhieuGop, thuTheoPhieuGop } from "@/lib/finance/phieu-gop";
import { ganTienTheoCon, goGanTheoCon, khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { getOrderPaymentRequests } from "@/lib/payments/payment-request";
import { dungMemo } from "@/lib/payments/memo-ck";
import { recordInstallmentPlan } from "@/lib/orders/installments";
import { POST as POST_SEPAY } from "@/app/api/public/webhook/sepay/route";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import type { DongHuyPos, DongPos } from "@/lib/payments/pos/kieu";
// Các ca "nói trước khớp việc máy làm" CỐ Ý import helper của bản vá.
import { voidTienKhiHuyDonTrongTx } from "@/lib/orders/huy-don-tien";
import { canhBaoTruocVoidDot, thongDiepPhieuKhiHuyDon } from "@/lib/finance/soat-phieu-gop";
import { phieuSeChamKhiLuuKeHoach, LY_DO_DON_THU_THEO_CON } from "@/lib/payments/phieu-se-huy-ke-hoach";

if (!RUN_DB_TESTS) console.warn(`[V5] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-posv5-";
const PFX = "FXPOSVN";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture vòng 5" };

const USER = `${T}user`;
const CENTER = `${T}center`;
const OU_CENTER = `${T}ou-center`;
const DON = `${T}don`;
const MA_DON = "ORD-269930-000955";
const MEMO_MA_DON = "ORD269930000955 NOP HOC PHI";
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const R0 = `${T}dot-0`;
const MAY = `${PFX}MAY01`;
const KHOA_CU_A = `${PFX}KEYA01`;
/** Giao dịch dựng sẵn cho ca ĐUA — trigger ngủ chỉ bắt đúng id này. */
const BT_DUA = `${T}bt-dua`;

const HOC_PHI_A = 6_336_000;
const HOC_PHI_B = 7_128_000;
const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000
const SDT = "0905444999";
const GIO_QUET = "2026-09-21T10:12:13+07:00";

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
const maSepay = () => `${T}sepay-${++soLan}`;

async function xoaTriggerNgu() {
  await db.$executeRaw`DROP TRIGGER IF EXISTS "fx_v5_ngu_trg" ON "PaymentAllocation"`;
  await db.$executeRaw`DROP FUNCTION IF EXISTS "fx_v5_ngu"()`;
}

/** Trigger làm câu INSERT PaymentAllocation của BT_DUA ngủ 0,8 s — mở cửa sổ đua SAU mọi cổng. */
async function taoTriggerNgu() {
  await xoaTriggerNgu();
  await db.$executeRaw`CREATE FUNCTION "fx_v5_ngu"() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW."bankTransactionId" = 'fx-posv5-bt-dua' THEN PERFORM pg_sleep(0.8); END IF;
      RETURN NEW;
    END $f$`;
  await db.$executeRaw`CREATE TRIGGER "fx_v5_ngu_trg" BEFORE INSERT ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION "fx_v5_ngu"()`;
}

/** Chờ tới khi có một phiên đang ngủ trong trigger — đối chứng dương: cửa sổ đua THẬT SỰ mở. */
async function choDangNgu(): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE wait_event = 'PgSleep'`;
    if (Number(r[0]?.n ?? 0) > 0) return true;
    await cho(20);
  }
  return false;
}

async function don() {
  await db.auditLog.deleteMany({ where: { actorId: ACTOR.id } });
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  await db.auditLog.deleteMany({ where: { entityType: "BankTransaction", entityId: BT_DUA } });
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
  await db.bankTransaction.deleteMany({ where: { id: BT_DUA } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.orgUnit.deleteMany({ where: { id: OU_CENTER } });
  await db.center.deleteMany({ where: { id: CENTER } });
  await db.user.deleteMany({ where: { id: USER } });
}

/** `toanDon: true` ⇒ đơn chỉ có R0 (thu toàn đơn, số TONG). Mặc định ⇒ hai đợt theo con A/B. */
async function dungFixture(opt: { toanDon?: boolean } = {}) {
  await don();
  await db.user.create({
    data: { id: USER, name: "Kế toán HO fixture V5", email: `${USER}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] },
  });
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture V5", slug: `${T}co-so`, address: "114 Hoàng Diệu" },
  });
  await db.orgUnit.create({
    data: { id: OU_CENTER, type: "CENTER", code: `${PFX}OU`, name: "Đơn vị fixture V5", centerId: CENTER, path: "/fxposvn-ou/", depth: 0 },
  });
  await db.posTerminal.create({ data: { maThietBi: MAY, maQuay: "Q1", centerId: CENTER } });
  await db.order.create({
    data: {
      id: DON,
      code: MA_DON,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture V5",
      customerPhone: SDT,
      totalAmount: opt.toanDon ? TONG : HOC_PHI_A + HOC_PHI_B,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A V5", HOC_PHI_A],
    [B, "Bé B V5", HOC_PHI_B],
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
      data: { id, orderId: DON, orderItemId: item, centerId: CENTER, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: thuTu, matchKey: khoa },
    });
  }
}

async function phatPhieu(ids: string[] = [DOT_A, DOT_B]): Promise<{ ma: string; billId: string }> {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
  return { ma: r.ma, billId: r.billId };
}

const memo = (ma: string) => dungMemo({ hoTen: "Bé A V5", sdt: SDT, ma });

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
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture-v5.xlsx", importedById: USER } });
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
const tongPhanBoDot = async (paymentRequestId: string) =>
  (await db.paymentAllocation.aggregate({ where: { paymentRequestId }, _sum: { amount: true } }))._sum.amount ?? 0;
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Phần TIỀN của nút Huỷ đơn — đúng thứ tự action: khoá đơn là câu đầu (`[KDK-W4]`). */
function huyDon(opt: { khoa: boolean }) {
  return db.$transaction(
    async (tx) => {
      if (opt.khoa) await khoaDonTrongTx(tx, DON);
      await tx.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });
      return voidTienKhiHuyDonTrongTx(tx, DON);
    },
    { timeout: 20_000 },
  );
}

async function sepayRoute(body: Record<string, unknown>, referenceCode: string) {
  process.env.SEPAY_WEBHOOK_API_KEY = "sepay-test-key-v5";
  const res = await POST_SEPAY(
    new NextRequest("https://satarobo.vn/api/public/webhook/sepay", {
      method: "POST",
      headers: { authorization: "Apikey sepay-test-key-v5", "content-type": "application/json" },
      body: JSON.stringify({
        gateway: "TCB",
        transactionDate: "2026-09-21 10:00:00",
        accountNumber: "0123456789",
        transferType: "in",
        referenceCode,
        ...body,
      }),
    }),
  );
  const tra = (await res.json()) as { handled?: boolean };
  const log = await db.integrationLog.findMany({
    where: { provider: "SEPAY", requestPayload: { path: ["referenceCode"], equals: referenceCode } },
    select: { action: true, status: true, errorMessage: true },
  });
  await db.integrationLog.deleteMany({ where: { provider: "SEPAY", requestPayload: { path: ["referenceCode"], equals: referenceCode } } });
  return { tra, log };
}

describe.skipIf(!RUN_DB_TESTS)("[V5] rà đối kháng vòng 5 — huỷ đơn, gỡ gắn thẻ, kế hoạch, dung sai, SePay", () => {
  beforeEach(() => dungFixture());
  afterAll(async () => {
    await xoaTriggerNgu();
    await don();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // HUỶ ĐƠN
  // ═════════════════════════════════════════════════════════════════════════

  it("[V5-00] huỷ đơn có phiếu gộp OPEN ⇒ phiếu HUỶ (soát), trang không còn QR, câu báo nêu mã; quét lại KHÔNG rót", async () => {
    const { ma, billId } = await phatPhieu();
    const soat = await huyDon({ khoa: true });
    expect((await phieu(billId)).status).toBe("VOID");
    expect(await docPhieuGopDangMo(DON), "trang đơn đã huỷ không còn in QR").toBeNull();
    expect(thongDiepPhieuKhiHuyDon(soat)).toContain(`Phiếu gộp ${ma} đã HUỶ`);

    const lai = await banSepay(memo(ma), TONG);
    expect(lai.status).not.toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[V5-03] dữ liệu cũ: phiếu OPEN còn sót trên đơn ĐÃ HUỶ (huỷ trước bản vá) ⇒ trang KHÔNG in QR", async () => {
    await phatPhieu();
    await db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });
    expect(await docPhieuGopDangMo(DON)).toBeNull();
  });

  it("[V5-01] đua: tiền về đúng mã (thuTheoPhieuGop THẬT, đang giữ khoá, đã qua cổng) ‖ huỷ đơn GIỮ KHOÁ ⇒ tuần tự: thu trước, huỷ sau; không tiền nào vào đợt VOID", async () => {
    const { ma, billId } = await phatPhieu();
    await db.bankTransaction.create({
      data: { id: BT_DUA, provider: "SEPAY", providerTxnId: `${T}dua-1`, amount: TONG, transferredAt: new Date("2026-09-21T03:00:00Z"), status: "UNMATCHED", centerId: CENTER },
    });
    await taoTriggerNgu();
    try {
      let thuXong = 0;
      const thu = thuTheoPhieuGop({ bankTransactionId: BT_DUA, provider: "SEPAY", providerTxnId: `${T}dua-1`, noiDung: memo(ma), soTienVe: TONG, ngayThu: new Date() }).finally(
        () => (thuXong = Date.now()),
      );
      expect(await choDangNgu(), "đối chứng: lượt thu đang ngủ SAU mọi cổng").toBe(true);
      let huyXong = 0;
      const huy = huyDon({ khoa: true }).finally(() => (huyXong = Date.now()));
      const [kqThu, soat] = await Promise.all([thu, huy]);

      expect(kqThu.xuLy && kqThu.ketQua).toBe("DA_CHIA");
      expect(huyXong, "huỷ phải CHỜ khoá đơn tới khi lượt thu commit").toBeGreaterThanOrEqual(thuXong);
      const rotVaoDotVoid =
        (await db.paymentAllocation.aggregate({ where: { paymentRequest: { orderId: DON, status: "VOID" } }, _sum: { amount: true } }))._sum
          .amount ?? 0;
      expect(rotVaoDotVoid, "không đồng nào nằm trong đợt VOID").toBe(0);
      expect((await phieu(billId)).status, "phiếu đã thu đủ giữ PAID").toBe("PAID");
      expect(soat, "không phiếu nào bị soát 'đóng (đã nhận một phần)'").toEqual([]);
      expect((await db.order.findUniqueOrThrow({ where: { id: DON } })).status).toBe("CANCELLED");
    } finally {
      await xoaTriggerNgu();
    }
  });

  it("[V5-02] phòng thủ: một đường VOID đợt QUÊN khoá chen vào giữa lượt thu ⇒ lượt thu NÉM + chạy lại ⇒ không rót, giao dịch về hàng chờ", async () => {
    // Trước bản vá (đo ở lượt rà): DA_CHIA 6.732.000, giao dịch MATCHED, 2 dòng Payment trên đơn đã
    // huỷ, phiếu CLOSED "đã nhận một phần" — nhánh `updateMany PAID` đổi 0 dòng bị bỏ qua im lặng.
    const { ma, billId } = await phatPhieu();
    await db.bankTransaction.create({
      data: { id: BT_DUA, provider: "SEPAY", providerTxnId: `${T}dua-2`, amount: TONG, transferredAt: new Date("2026-09-21T03:00:00Z"), status: "UNMATCHED", centerId: CENTER },
    });
    await taoTriggerNgu();
    try {
      const thu = thuTheoPhieuGop({ bankTransactionId: BT_DUA, provider: "SEPAY", providerTxnId: `${T}dua-2`, noiDung: memo(ma), soTienVe: TONG, ngayThu: new Date() });
      expect(await choDangNgu(), "đối chứng: cửa sổ đua mở").toBe(true);
      await huyDon({ khoa: false });
      const kq = await thu;

      expect(kq.xuLy && kq.ketQua).toBe("CHUA_CHIA");
      const bt = await db.bankTransaction.findUniqueOrThrow({ where: { id: BT_DUA } });
      expect(bt.status).toBe("UNMATCHED");
      expect((await db.paymentAllocation.aggregate({ where: { bankTransactionId: BT_DUA }, _sum: { amount: true } }))._sum.amount ?? 0).toBe(0);
      expect(await tongPaymentDon(), "không ghi Payment trên đơn đã huỷ").toBe(0);
      expect((await phieu(billId)).status).toBe("VOID");
    } finally {
      await xoaTriggerNgu();
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // GỠ GẮN THẺ HOÀN MỘT PHẦN
  // ═════════════════════════════════════════════════════════════════════════

  it("[V5-20] quẹt KHÔNG mã → gắn tay vào đợt của phiếu OPEN (0đ) → hoàn một phần → gỡ gắn ⇒ phiếu ĐÓNG + NÓI RA; quét mã cũ KHÔNG khớp", async () => {
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
    await lo([hoanMotPhan(goc)]);

    const go = await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "hoàn một phần — điều chỉnh", actor: ACTOR });
    expect(go.ok).toBe(true);
    if (!go.ok) return;
    expect(go.trangThaiGiaoDich).toBe("IGNORED");
    expect(go.phieuGop.map((p) => [p.ma, p.hanhDong]), "toast nói ra").toEqual([[x.ma, "DONG"]]);
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON)).toBeNull();
    expect((await banSepay(memo(x.ma), TONG)).status, "mã cũ không được thu trọn số gộp lần hai").not.toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(0);
  });

  // ĐỔI VÌ Q-M (chủ dự án chốt 30/09/2026 — "gỡ gắn giao dịch THẺ luôn ĐÓNG phiếu gộp"): ba ca dưới từng
  // ghim đối chứng "chưa tín hiệu ⇒ MỞ LẠI" rồi để `dongPhieuMoLaiKhiHoanSauGo` đóng phiếu khi tín hiệu tới
  // sau. Nay lượt gỡ ĐÓNG ngay (Q-M), tín hiệu tới sau không còn phiếu mở lại nào để đóng — hàm kia đã gỡ
  // (mã chết). Trạng thái CUỐI mà các ca canh (phiếu ĐÓNG, mã cũ không thu, 0 Payment) giữ nguyên.
  it("[V5-21] quẹt CÓ mã → gỡ gắn (chưa tín hiệu ⇒ Q-M: ĐÓNG ngay) → hôm sau dòng hoàn MỘT PHẦN ⇒ phiếu vẫn ĐÓNG; quét lại KHÔNG khớp", async () => {
    const x = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${x.ma}` })]);
    const btId = (await posRow(goc)).bankTransactionId!;
    const go = await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "chia lại cho hai bé", actor: ACTOR });
    expect(go.ok && go.phieuGop.map((p) => p.hanhDong), "Q-M: chưa tín hiệu vẫn ĐÓNG").toEqual(["DONG"]);

    await lo([hoanMotPhan(goc)]);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: btId } })).status).toBe("IGNORED");
    expect((await phieu(x.billId)).status, "phiếu đóng lúc gỡ — không mở lại").toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON)).toBeNull();
    expect((await banSepay(memo(x.ma), TONG)).status).not.toBe("MATCHED");
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[V5-21b] tín hiệu tới sau là hủy TOÀN PHẦN ⇒ phiếu vẫn ĐÓNG (bản vòng 5: 'giữ luật cũ, phiếu MỞ' — đổi vì Q-M)", async () => {
    const x = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${x.ma}` })]);
    const btId = (await posRow(goc)).bankTransactionId!;
    expect((await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "chia lại", actor: ACTOR })).ok).toBe(true);
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG })]);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: btId } })).status).toBe("IGNORED");
    expect((await phieu(x.billId)).status).toBe("CLOSED");
  });

  it("[V5-22] như [V5-21] nhưng tín hiệu là CỘT 'Hoàn một phần' trên bản xuất lại của GỐC ⇒ phiếu vẫn ĐÓNG", async () => {
    const x = await phatPhieu();
    const goc = maGd();
    const dGoc = dong({ maGiaoDich: goc, dienGiai: `Be A ${SDT} ${x.ma}` });
    await lo([dGoc]);
    const btId = (await posRow(goc)).bankTransactionId!;
    expect((await goGanTheoCon({ bankTransactionId: btId, orderId: DON, lyDo: "chia lại", actor: ACTOR })).ok).toBe(true);
    expect((await phieu(x.billId)).status, "Q-M: đóng ngay lúc gỡ").toBe("CLOSED");

    await lo([{ ...dGoc, trangThaiHoanHuy: "Hoàn một phần" }]);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: btId } })).status).toBe("IGNORED");
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect((await banSepay(memo(x.ma), TONG)).status).not.toBe("MATCHED");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // KHÉP PHIẾU 0đ CHỈ KHI CẦN CHỖ — VÀ NÓI RA
  // ═════════════════════════════════════════════════════════════════════════

  it("[V5-30] X (thẻ) ĐÓNG vì hoàn một phần ⇒ phiếu Y OPEN 0đ KHÔNG bị khép; gỡ khoản lấp Y ⇒ Y hiện lại, mã Y thu được", async () => {
    const x = await phatPhieu([DOT_A]);
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, soTien: DOT_TIEN_A, dienGiai: `Be A ${SDT} ${x.ma}` })]);
    expect((await phieu(x.billId)).status, "đối chứng").toBe("PAID");
    const y = await phatPhieu([DOT_B]);
    const bt2 = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: maSepay(), amount: DOT_TIEN_B, transferredAt: new Date("2026-09-20T02:00:00Z"), status: "UNMATCHED" },
    });
    expect(
      (await ganTienTheoCon({ bankTransactionId: bt2.id, orderId: DON, dong: [{ paymentRequestId: DOT_B, soTien: DOT_TIEN_B }], actor: ACTOR, nguoiGan: { loai: "KE_TOAN" } })).ok,
    ).toBe(true);
    await lo([hoanMotPhan(goc, -500_000)]);

    const go = await goGanTheoCon({ bankTransactionId: (await posRow(goc)).bankTransactionId!, orderId: DON, lyDo: "hoàn một phần", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(x.billId)).status).toBe("CLOSED");
    expect((await phieu(y.billId)).status, "Y không ai cần chỗ ⇒ KHÔNG khép").toBe("OPEN");

    expect((await goGanTheoCon({ bankTransactionId: bt2.id, orderId: DON, lyDo: "gắn nhầm gia đình", actor: ACTOR })).ok).toBe(true);
    expect((await docPhieuGopDangMo(DON))?.ma, "Y hiện lại (luật [V3-20])").toBe(y.ma);
    expect((await banSepay(memo(y.ma), DOT_TIEN_B)).status).toBe("MATCHED");
  });

  it("[V5-31] khép phiếu 0đ để NHƯỜNG CHỖ mở lại ⇒ lượt gỡ NÓI RA phiếu đã khép (toast)", async () => {
    const x = await phatPhieu([DOT_A]);
    const t1 = maSepay();
    expect((await banSepay(memo(x.ma), DOT_TIEN_A, t1)).status).toBe("MATCHED");
    const y = await phatPhieu([DOT_B]);
    const bt2 = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: maSepay(), amount: DOT_TIEN_B, transferredAt: new Date("2026-09-20T02:00:00Z"), status: "UNMATCHED" },
    });
    expect(
      (await ganTienTheoCon({ bankTransactionId: bt2.id, orderId: DON, dong: [{ paymentRequestId: DOT_B, soTien: DOT_TIEN_B }], actor: ACTOR, nguoiGan: { loai: "KE_TOAN" } })).ok,
    ).toBe(true);

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "khách chuyển nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);
    if (!go.ok) return;
    expect((await phieu(x.billId)).status).toBe("OPEN");
    expect((await phieu(y.billId)).status).toBe("CLOSED");
    expect(go.phieuGop.map((p) => [p.ma, p.hanhDong]).sort()).toEqual([[x.ma, "MO_LAI"], [y.ma, "DONG"]].sort());
  });

  // ═════════════════════════════════════════════════════════════════════════
  // KẾ HOẠCH TRẢ GÓP
  // ═════════════════════════════════════════════════════════════════════════

  it("[V5-40] đơn đang thu THEO CON ⇒ lưu kế hoạch mức đơn bị TỪ CHỐI, không đợt nào đổi, phiếu gộp nguyên", async () => {
    const { billId } = await phatPhieu();
    const kq = await recordInstallmentPlan({
      orderId: DON,
      dots: [
        { amount: 1_000_000, daThu: false, dueDate: new Date("2026-10-15T00:00:00+07:00") },
        { amount: HOC_PHI_A + HOC_PHI_B - 1_000_000, daThu: false, dueDate: new Date("2026-11-15T00:00:00+07:00") },
      ],
      actorId: null,
    });
    expect(kq).toEqual({ ok: false, error: LY_DO_DON_THU_THEO_CON });
    const dot = await db.paymentRequest.findMany({ where: { orderId: DON }, orderBy: { id: "asc" }, select: { id: true, amountDue: true, status: true } });
    expect(dot).toEqual([
      { id: DOT_A, amountDue: DOT_TIEN_A, status: "PENDING" },
      { id: DOT_B, amountDue: DOT_TIEN_B, status: "PENDING" },
    ]);
    expect((await phieu(billId)).status).toBe("OPEN");
    expect(await db.orderInstallment.count({ where: { orderId: DON } })).toBe(0);
  });

  it("[V5-41] đổi SỐ đợt đang nằm trong phiếu gộp ⇒ màn NÓI TRƯỚC đúng mã, máy HUỶ phiếu, câu sau cùng mã; mã cũ không thu số cũ", async () => {
    await dungFixture({ toanDon: true });
    const hai = (a: number, b: number) => [
      { amount: a, daThu: false, dueDate: new Date("2026-10-15T00:00:00+07:00") },
      { amount: b, daThu: false, dueDate: new Date("2026-11-15T00:00:00+07:00") },
    ];
    expect((await recordInstallmentPlan({ orderId: DON, dots: hai(TONG / 2, TONG / 2), actorId: null })).ok, "đối chứng").toBe(true);
    const d1 = await db.paymentRequest.findFirstOrThrow({ where: { orderId: DON, installmentNo: 1, orderItemId: null } });
    const { ma, billId } = await phatPhieu([d1.id]);

    const dotsMoi = hai(2_000_000, TONG - 2_000_000);
    const cham = phieuSeChamKhiLuuKeHoach({ phieu: await getOrderPaymentRequests(DON), dots: dotsMoi });
    const noiTruoc = canhBaoTruocVoidDot(await docPhieuGopDangMo(DON), cham.seHuy, cham.doiSo);
    expect(noiTruoc?.ma, "nói TRƯỚC đúng mã").toBe(ma);
    expect(noiTruoc?.dich).toBe("VOID");

    const kq = await recordInstallmentPlan({ orderId: DON, dots: dotsMoi, actorId: null });
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect((await phieu(billId)).status, "máy thật sự huỷ").toBe("VOID");
    expect(kq.thongDiepPhieu).toContain(`Phiếu gộp ${ma} đã HUỶ`);
    expect(await docPhieuGopDangMo(DON)).toBeNull();
    expect((await banSepay(memo(ma), TONG / 2)).status, "QR cũ (số cũ) không được khớp").not.toBe("MATCHED");
    // Phát lại được mã mới đúng số mới.
    await phatPhieu([d1.id]);
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(2_000_000);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // DUNG SAI LÀM TRÒN
  // ═════════════════════════════════════════════════════════════════════════

  it("[V5-50] đợt đủ tiền nhờ dung sai (thiếu 2.000 qua mã đời cũ) ⇒ phiếu gộp của đợt không còn 'đang mở', phát được phiếu cho đợt khác", async () => {
    const y = await phatPhieu([DOT_A]);
    expect((await banSepay(`${KHOA_CU_A} NOP HOC PHI`, DOT_TIEN_A - 2_000)).status, "đối chứng: đường cũ khớp").toBe("MATCHED");
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: DOT_A } })).status, "đối chứng: PAID nhờ dung sai").toBe("PAID");
    expect(await docPhieuGopDangMo(DON), "không in QR 2.000đ cho một đợt ĐÃ ĐỦ").toBeNull();
    const moi = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_B], actor: ACTOR });
    expect(moi.ok, "phiếu cũ không được kẹt OPEN chặn phát phiếu").toBe(true);
    expect((await phieu(y.billId)).status).toBe("CLOSED");
  });

  it("[V5-51] nhánh anh em: đợt PAID nhờ dung sai KHÔNG bị khoản sau rót thêm (thu lại phần đã tha)", async () => {
    expect((await banSepay(`${KHOA_CU_A} NOP HOC PHI`, DOT_TIEN_A - 2_000)).status).toBe("MATCHED");
    expect((await banSepay(`${KHOA_CU_A} NOP HOC PHI`, 2_000)).status).toBe("MATCHED");
    expect(await tongPhanBoDot(DOT_A), "không rót thêm vào đợt đã đủ").toBe(DOT_TIEN_A - 2_000);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SEPAY GỬI LẠI WEBHOOK CỦA GIAO DỊCH ĐÃ BỎ QUA
  // ═════════════════════════════════════════════════════════════════════════

  it("[V5-60] route SePay: giao dịch đã BỎ QUA (sau gỡ gắn) được gửi lại ⇒ SKIPPED 'đã được bỏ qua', KHÔNG 'MATCH_TXN SUCCESS'", async () => {
    const { ma } = await phatPhieu();
    const t1 = maSepay();
    expect((await banSepay(memo(ma), TONG, t1)).status).toBe("MATCHED");
    const id1 = (await btSepay(t1)).id;
    expect((await goGanTheoCon({ bankTransactionId: id1, orderId: DON, lyDo: "khách chuyển nhầm — sẽ hoàn", actor: ACTOR })).ok).toBe(true);
    await db.bankTransaction.update({ where: { id: id1 }, data: { status: "IGNORED", unmatchedNote: "Bỏ qua: đã hoàn cho khách" } });

    const { tra, log } = await sepayRoute({ id: 990501, content: memo(ma), transferAmount: TONG }, t1);
    expect((await btSepay(t1)).status, "đối chứng").toBe("IGNORED");
    expect(log.filter((l) => l.status === "SUCCESS")).toEqual([]);
    expect(log.some((l) => l.status === "SKIPPED" && (l.errorMessage ?? "").includes("đã được bỏ qua"))).toBe(true);
    expect(tra.handled).toBe(false);
  });

  it("[V5-60b] nhánh CONFIRM (nội dung mang mã ORD): giao dịch đã BỎ QUA ⇒ CONFIRM_ORDER SKIPPED, đơn KHÔNG chốt", async () => {
    await dungFixture({ toanDon: true });
    const t2 = maSepay();
    await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: t2, amount: TONG, transferredAt: new Date("2026-09-21T03:00:00Z"), status: "IGNORED", unmatchedNote: "Bỏ qua: tiền nhà" },
    });
    const { tra, log } = await sepayRoute({ id: 990502, content: MEMO_MA_DON, transferAmount: TONG }, t2);
    expect(log.filter((l) => l.status === "SUCCESS")).toEqual([]);
    expect(log.some((l) => l.action === "CONFIRM_ORDER" && l.status === "SKIPPED")).toBe(true);
    expect(tra.handled).toBe(false);
    expect((await db.order.findUniqueOrThrow({ where: { id: DON } })).status).toBe("PENDING_PAYMENT");
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[V5-60c] nhánh CONFIRM: giao dịch VỪA GỠ GẮN ⇒ CONFIRM_ORDER SKIPPED 'Đã gỡ gắn' (cổng vòng 4 trước giờ không ca nào đi qua)", async () => {
    await dungFixture({ toanDon: true });
    const t3 = maSepay();
    await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: t3, amount: TONG, transferredAt: new Date("2026-09-21T03:00:00Z"), status: "UNMATCHED", unmatchedNote: "Đã gỡ gắn: nhầm đơn" },
    });
    const { tra, log } = await sepayRoute({ id: 990503, content: MEMO_MA_DON, transferAmount: TONG }, t3);
    expect(log.filter((l) => l.status === "SUCCESS")).toEqual([]);
    expect(log.some((l) => l.action === "CONFIRM_ORDER" && l.status === "SKIPPED" && (l.errorMessage ?? "").includes("Đã gỡ gắn"))).toBe(true);
    expect(tra.handled).toBe(false);
    expect((await btSepay(t3)).status).toBe("UNMATCHED");
    expect(await tongPaymentDon()).toBe(0);
  });
});
