// tests/finance/go-gan-gan-lai.test.ts — GỠ GẮN rồi GẮN LẠI một giao dịch webhook. Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants")
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// LỖ ĐANG VÁ — đo trên `origin/test` 3c5f9562, hở cả trên prod
//
// `allocateToOrder` ghi sổ cũ (`Payment`) sau một phép kiểm trùng theo marker
// `[auto:<provider>:<txn>]`. Bản cũ hỏi *"đơn có dòng nào mang marker này không"* — KHÔNG hỏi
// dòng ấy còn giữ tiền hay đã bị ĐẢO. Ba cú bấm mà kế toán vẫn bấm:
//
//   1. SePay 6.000.000đ về đơn O   ⇒ P1 +6tr (PAYMENT, marker)        · phân bổ 6tr
//   2. Gỡ gắn (`goGanTheoCon`)       ⇒ P2 −6tr (ADJUSTMENT, đảo P1)    · phân bổ bị xoá, T về UNMATCHED
//   3. Gắn lại vào CÙNG đơn O       ⇒ phép kiểm thấy P1 ⇒ BỎ QUA       · phân bổ 6tr
//
// Kết cục: Ledger-B (phân bổ / đợt) nói ĐÃ THU 6tr, Ledger-A (Σ `Payment`) nói 0 ⇒ công nợ
// báo còn nợ nguyên 6tr trong khi tiền đã nằm trong tài khoản và đợt đã PAID. Không lỗi nào báo.
//
// Chú thích cũ ở `payos-ingest.ts` nói phép kiểm trùng "chỉ khác null khi cùng providerTxnId
// vào lần hai, mà lượt ấy đã bị cổng `fresh` chặn". Đúng với webhook retry — SAI với gỡ→gắn
// lại: `goGanTheoCon` đưa T về UNMATCHED nên cổng `fresh` MỞ, và phép kiểm trùng là thứ duy
// nhất còn quyết định có ghi sổ cũ hay không.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO ĐI QUA ĐÚNG HAI CỬA THẬT
//
// Lượt rót đầu đi qua `ingestPayosWebhook` (cửa SePay gọi), để dòng P1 mang ĐÚNG marker do
// webhook sinh — gõ tay marker trong fixture là kiểm một chuỗi mình tự đặt. Lượt gắn lại gọi
// `allocateToOrder` với đúng tham số mà `ganGiaoDichVaoDon` (`/admin/bien-dong-so-du`, nhánh cờ
// TẮT) truyền: server action ấy chỉ thêm cổng quyền phía trước, không đụng tiền.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { goGanTheoCon } from "@/lib/finance/ghi-tien-don";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { sumRecorded } from "@/lib/finance/ghi-nhan";
import { allocateToOrder, ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { TIEN_THUA_CHUA_XU_LY } from "@/lib/finance/tien-thua";

if (!RUN_DB_TESTS) console.warn(`[GGL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ggl-";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture" };
const PROVIDER = "SEPAY";

const CENTER = `${T}center`;
/** Đơn nhận tiền, rồi bị gỡ, rồi nhận LẠI. */
const DON = `${T}don`;
/** Đối chứng dương: giao dịch gỡ khỏi `DON` rồi gắn sang đơn này. */
const DON_KHAC = `${T}don-khac`;
/** Ca ghim tiền dư: đơn MỘT đợt, tiền về dư. */
const DON_DU = `${T}don-du`;
/** Đối chứng cho [GGL-05c]: một giao dịch KHÁC cũng đóng dư — gỡ giao dịch kia không được đụng nó. */
const DON_DU_2 = `${T}don-du-2`;
const MOI_DON = [DON, DON_KHAC, DON_DU, DON_DU_2];

/** Đợt 1 = đúng số tiền về; đợt 2 còn mở ⇒ đơn KHÔNG tất toán, không kéo side-effect chốt đơn. */
const DOT_1 = 6_000_000;
const DOT_2 = 4_000_000;
const TIEN_VE = DOT_1;
/** Tiền dư thật của ca ghim: 6.200.000 về cho đợt 6.000.000. */
const TIEN_DU = 200_000;

let soTxn = 0;
const maTxn = () => `${T}ref-${++soTxn}`;

async function don() {
  await db.creditBalance.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: MOI_DON } } } });
  await db.payment.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.order.deleteMany({ where: { id: { in: MOI_DON } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

/**
 * Một đơn LUỒNG CŨ (đợt `orderItemId` NULL — cơ sở chưa bật `billing.flexV1Enabled`), MỘT
 * dòng hàng, các đợt cho sẵn. `matchKey` của đợt 1 là thứ nội dung CK mang.
 */
async function dungDon(opts: {
  id: string;
  code: string;
  maKhop: string;
  dot: readonly number[];
  /** ⚠️ Ca tiền dư TẤT TOÁN đơn ⇒ chạy đường tự cấp tài khoản PH + ZNS sau commit. SĐT trống
   *  làm hai đường ấy im (chúng không thuộc thứ ca này đo, và để lại `User` rác trên DB nháp). */
  sdt: string;
}) {
  const tong = opts.dot.reduce((s, x) => s + x, 0);
  await db.order.create({
    data: {
      id: opts.id,
      code: opts.code,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture GGL",
      customerPhone: opts.sdt,
      totalAmount: tong,
      centerId: CENTER,
    },
  });
  await db.orderItem.create({
    data: {
      id: `${opts.id}-item`,
      orderId: opts.id,
      type: "COURSE_ENROLLMENT",
      itemName: "Bé fixture GGL",
      quantity: 1,
      unitPrice: tong,
      totalPrice: tong,
    },
  });
  for (const [i, soTien] of opts.dot.entries()) {
    await db.paymentRequest.create({
      data: {
        id: `${opts.id}-dot${i + 1}`,
        orderId: opts.id,
        orderItemId: null,
        installmentNo: i + 1,
        amountDue: soTien,
        status: "PENDING",
        sortOrder: i + 1,
        matchKey: i === 0 ? opts.maKhop : null,
        centerId: CENTER,
      },
    });
  }
}

async function dungNen() {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "GGL cơ sở", slug: `${T}slug`, address: "không có thật" },
  });
  await dungDon({ id: DON, code: "ORD-269907-000001", maKhop: "GGLKEY001", dot: [DOT_1, DOT_2], sdt: "0999000571" });
  await dungDon({ id: DON_KHAC, code: "ORD-269907-000002", maKhop: "GGLKEY002", dot: [DOT_1, DOT_2], sdt: "0999000572" });
  await dungDon({ id: DON_DU, code: "ORD-269907-000003", maKhop: "GGLKEY003", dot: [DOT_1], sdt: "" });
  await dungDon({ id: DON_DU_2, code: "ORD-269907-000004", maKhop: "GGLKEY004", dot: [DOT_1], sdt: "" });
}

/** Tiền về qua ĐÚNG cửa SePay đi — nội dung CK mang `matchKey` của đợt 1. */
async function tienVeQuaSepay(maKhop: string, soTien: number): Promise<string> {
  const kq = await ingestPayosWebhook(
    {
      orderCode: undefined,
      reference: maTxn(),
      description: `${maKhop} HOC PHI`,
      amount: soTien,
      transactionDateTime: "2699-05-01T03:00:00Z",
      accountNumber: "0123456789",
    },
    PROVIDER,
  );
  if (kq.status !== "MATCHED") throw new Error(`fixture: webhook không rót được — ${kq.status}`);
  return kq.bankTransactionId;
}

/**
 * Gắn tay y như `ganGiaoDichVaoDon` (nhánh cờ TẮT): đọc đợt mở SỚM NHẤT của đơn rồi giao cho
 * `allocateToOrder` lo waterfall + sổ cũ. Chép đúng `select` của action — thiếu một cột là
 * kiểm một đơn khác với đơn thật.
 */
async function ganTayNhuManBienDong(bankTransactionId: string, orderId: string) {
  const txn = await db.bankTransaction.findUniqueOrThrow({
    where: { id: bankTransactionId },
    select: { amount: true, provider: true, providerTxnId: true, content: true },
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
      paymentRequests: {
        where: { status: { in: ["PENDING", "PARTIAL"] } },
        orderBy: [{ sortOrder: "asc" }, { installmentNo: "asc" }],
        take: 1,
        select: { id: true },
      },
    },
  });
  const phieu = order.paymentRequests[0];
  if (!phieu) throw new Error("fixture: đơn không còn đợt nào đang chờ");
  return allocateToOrder({
    bankTransactionId,
    order,
    amount: txn.amount,
    provider: txn.provider,
    providerTxnId: txn.providerTxnId,
    target: { paymentRequestId: phieu.id, orderId: order.id, via: "manual" },
    data: { description: txn.content ?? undefined, amount: txn.amount, reference: txn.providerTxnId },
  });
}

function goGan(bankTransactionId: string, orderId: string) {
  return goGanTheoCon({ bankTransactionId, orderId, lyDo: "Gắn nhầm, gắn lại", actor: ACTOR });
}

/** LEDGER-A — Σ mọi dòng `Payment` còn sống của đơn (gốc + bút toán đảo). */
async function soCu(orderId: string): Promise<number> {
  const r = await db.payment.aggregate({ where: { orderId, deletedAt: null }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

/** LEDGER-B — Σ phân bổ vào các đợt của đơn. */
async function soMoi(orderId: string): Promise<number> {
  const r = await db.paymentAllocation.aggregate({
    where: { paymentRequest: { orderId } },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

/** Dòng THU còn sống mà CHƯA có bút toán đảo nào trỏ về — tức dòng một lượt gỡ sẽ đi đảo. */
function dongThuChuaDao(orderId: string) {
  return db.payment.findMany({
    where: {
      orderId,
      deletedAt: null,
      paymentType: "PAYMENT",
      adjustments: { none: { paymentType: "ADJUSTMENT", deletedAt: null } },
    },
    select: { id: true, amount: true },
  });
}

describe.skipIf(!RUN_DB_TESTS)("[GGL] gỡ gắn → gắn lại — sổ cũ phải ghi lại", () => {
  beforeEach(dungNen);
  afterAll(don);

  it("[GGL-01] gỡ rồi gắn lại CÙNG đơn ⇒ HAI sổ cùng nói 6.000.000đ", async () => {
    const txn = await tienVeQuaSepay("GGLKEY001", TIEN_VE);
    // Kiểm FIXTURE trước: thiếu vế này thì một webhook không rót gì cũng làm các vế dưới
    // "đúng" theo kiểu 0 = 0.
    expect(await soCu(DON)).toBe(TIEN_VE);
    expect(await soMoi(DON)).toBe(TIEN_VE);

    const go = await goGan(txn, DON);
    expect(go.ok).toBe(true);
    if (go.ok) expect(go.soDongDao).toBe(1);
    expect(await soCu(DON)).toBe(0);
    expect(await soMoi(DON)).toBe(0);

    const lai = await ganTayNhuManBienDong(txn, DON);
    expect(lai.status).toBe("MATCHED");

    // LEDGER-B — lượt gắn lại rót đủ, đợt 1 PAID.
    expect(await soMoi(DON)).toBe(TIEN_VE);
    const dot1 = await db.paymentRequest.findUniqueOrThrow({ where: { id: `${DON}-dot1` } });
    expect(dot1.status).toBe("PAID");

    // ⚠️ LEDGER-A — vế ĐỎ trên mã cũ: phép kiểm trùng thấy P1 (đã đảo) và bỏ qua ⇒ 0.
    expect(await soCu(DON), "Σ Payment sống phải bằng số tiền đã rót lại").toBe(TIEN_VE);
    // Trục B (số in trên QR · đối khớp · ZNS học phí) đọc đúng sổ này — đo luôn bằng hàm thật.
    expect(await sumRecorded(DON)).toBe(TIEN_VE);

    // Đúng MỘT dòng thu còn giữ tiền — không phải P1 "sống lại", không phải hai dòng.
    const chuaDao = await dongThuChuaDao(DON);
    expect(chuaDao).toHaveLength(1);
    expect(chuaDao[0]!.amount).toBe(TIEN_VE);

    // Hai sổ khớp nhau.
    expect(await soCu(DON)).toBe(await soMoi(DON));
  });

  it("[GGL-02] ĐỐI CHỨNG DƯƠNG: gỡ rồi gắn sang đơn KHÁC ⇒ đơn khác nhận đủ, đơn cũ về 0", async () => {
    // Ca này xanh cả trước lẫn sau bản vá — phép kiểm trùng lọc theo `orderId`, đơn khác chưa
    // có dòng nào mang marker. Nó chứng minh đường gắn lại chạy được (nên [GGL-01] đỏ vì phép
    // kiểm trùng, không vì fixture), và bản vá không làm hỏng ca đang đúng.
    const txn = await tienVeQuaSepay("GGLKEY001", TIEN_VE);
    const go = await goGan(txn, DON);
    expect(go.ok).toBe(true);

    const sang = await ganTayNhuManBienDong(txn, DON_KHAC);
    expect(sang.status).toBe("MATCHED");

    expect(await soCu(DON_KHAC)).toBe(TIEN_VE);
    expect(await soMoi(DON_KHAC)).toBe(TIEN_VE);
    expect(await dongThuChuaDao(DON_KHAC)).toHaveLength(1);

    expect(await soCu(DON)).toBe(0);
    expect(await soMoi(DON)).toBe(0);
    expect(await dongThuChuaDao(DON)).toHaveLength(0);
  });

  it("[GGL-03] HAI vòng gỡ→gắn trên cùng đơn ⇒ vẫn đúng 6.000.000đ, không cộng dồn", async () => {
    // Vòng hai là chỗ một bản vá "coi mọi dòng cũ là đã đảo" sẽ ghi đôi: lúc đó đơn có P1 (đã
    // đảo) + P3 (đã đảo ở vòng hai) — cả hai phải được bỏ qua, và phải đẻ đúng MỘT dòng mới.
    const txn = await tienVeQuaSepay("GGLKEY001", TIEN_VE);
    for (const vong of [1, 2]) {
      const go = await goGan(txn, DON);
      expect(go.ok, `gỡ vòng ${vong}`).toBe(true);
      if (go.ok) expect(go.soDongDao, `gỡ vòng ${vong}`).toBe(1);
      expect(await soCu(DON), `sau gỡ vòng ${vong}`).toBe(0);

      const lai = await ganTayNhuManBienDong(txn, DON);
      expect(lai.status, `gắn lại vòng ${vong}`).toBe("MATCHED");
      expect(await soCu(DON), `sau gắn lại vòng ${vong}`).toBe(TIEN_VE);
      expect(await soMoi(DON), `sau gắn lại vòng ${vong}`).toBe(TIEN_VE);
    }
    expect(await dongThuChuaDao(DON)).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ĐIỀU CHỈNH MỘT PHẦN KHÔNG PHẢI ĐẢO
  //
  // Bút toán `ADJUSTMENT` trỏ `adjustmentOfId` về dòng gốc có HAI nghĩa: đảo trọn (gỡ gắn,
  // tách khoản — `amount = −gốc`) và điều chỉnh một phần (`adjustPayment` — DELTA bất kỳ).
  // Một phép kiểm trùng hỏi *"dòng gốc có bút toán con nào chưa"* sẽ coi khoản đã điều chỉnh
  // là đã đảo — trong khi nó vẫn đang giữ tiền.
  //
  // Và ca ấy CÓ THẬT vì `goGanTheoCon` bỏ qua dòng đã có bất kỳ `ADJUSTMENT` nào
  // (`daDao > 0 → continue`): gỡ một khoản đã điều chỉnh để nguyên dòng gốc, sổ cũ còn
  // 5.900.000 (lỗ riêng, ghim ở [GGL-04b]). Gắn lại trên nền đó mà ghi thêm 6.000.000 là sổ
  // cũ báo 11.900.000 cho một giao dịch 6.000.000.
  //
  // Đường thật dẫn tới trạng thái này: kế toán xác nhận (sinh phiếu thu) → điều chỉnh −100.000
  // → thu hồi phiếu thu (VOID — cổng gỡ chỉ chặn phiếu ACTIVE, xem [GDC-c3]) → gỡ gắn. Fixture
  // dựng thẳng hình dạng hai dòng mà `adjustPayment` ghi ra, không đi qua ba màn kia.
  // ───────────────────────────────────────────────────────────────────────────
  async function dungKhoanDaDieuChinh(): Promise<string> {
    const txn = await tienVeQuaSepay("GGLKEY001", TIEN_VE);
    const goc = await db.payment.findFirstOrThrow({
      where: { orderId: DON, paymentType: "PAYMENT", deletedAt: null },
      select: { id: true, method: true, saleStatus: true },
    });
    await db.payment.update({
      where: { id: goc.id },
      data: { accountantStatus: KHOAN_DA_XAC_NHAN.accountantStatus },
    });
    await db.payment.create({
      data: {
        orderId: DON,
        amount: -100_000,
        method: goc.method,
        paidDate: new Date("2699-05-02T03:00:00Z"),
        note: "Điều chỉnh: phụ huynh được giảm 100.000đ",
        saleStatus: goc.saleStatus,
        accountantStatus: KHOAN_DA_XAC_NHAN.accountantStatus,
        paymentType: "ADJUSTMENT",
        adjustmentOfId: goc.id,
        centerId: CENTER,
      },
    });
    return txn;
  }

  it("[GGL-04] khoản đã ĐIỀU CHỈNH một phần: gắn lại KHÔNG đẩy sổ cũ vượt số tiền giao dịch", async () => {
    const txn = await dungKhoanDaDieuChinh();
    expect(await soCu(DON)).toBe(TIEN_VE - 100_000);

    const go = await goGan(txn, DON);
    expect(go.ok).toBe(true);
    const lai = await ganTayNhuManBienDong(txn, DON);
    expect(lai.status).toBe("MATCHED");

    // Bất biến, không phụ thuộc [GGL-04b] đã vá hay chưa: một giao dịch 6.000.000 KHÔNG BAO
    // GIỜ làm sổ cũ của đơn ghi quá 6.000.000. Hôm nay ra 5.900.000 (dòng gốc chưa đảo vẫn
    // được coi là còn giữ tiền ⇒ không ghi thêm); vá [GGL-04b] xong sẽ ra 6.000.000.
    expect(await soCu(DON)).toBeLessThanOrEqual(TIEN_VE);
  });

  it.fails("[GGL-04b] GHIM — gỡ gắn khoản đã điều chỉnh một phần phải đưa sổ cũ về 0", async () => {
    // Lỗ đo được, CHƯA vá (cần chủ dự án chốt cách đảo): `goGanTheoCon` coi "có một
    // `ADJUSTMENT` còn sống" là "đã đảo" và bỏ qua dòng gốc ⇒ phân bổ bị xoá, giao dịch về
    // hàng chờ, còn sổ cũ vẫn giữ 5.900.000 — đúng con "gỡ NỬA VỜI" mà khối chú thích ở
    // `goGanTheoCon` viết ra để chặn. Gắn giao dịch sang đơn khác sau đó là ghi một khoản
    // tiền vào HAI đơn. Vá xong ca này XANH ⇒ Vitest báo lỗi ⇒ gỡ `.fails`.
    const txn = await dungKhoanDaDieuChinh();
    const go = await goGan(txn, DON);
    expect(go.ok).toBe(true);
    expect(await soMoi(DON)).toBe(0);
    expect(await soCu(DON)).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TIỀN DƯ — gỡ gắn phải "xử lý" dòng `CreditBalance` của đúng giao dịch ấy
  //
  // `allocateToOrder` ghi phần dư sang `CreditBalance` (gắn `bankTransactionId`) khi mọi đợt đã
  // đủ. Bản cũ của `goGanTheoCon` xoá phân bổ + đảo `Payment` nhưng KHÔNG đụng dòng tiền dư ⇒
  // gắn lại cùng giao dịch là ghi tiền dư LẦN HAI (đo: 400.000 thay vì 200.000).
  // Chủ dự án chốt 29/09/2026: KHI GỠ, dòng tiền dư chưa xử lý của giao dịch được ĐÁNH DẤU
  // "đã xử lý — do gỡ gắn" (`settledAt` + `settledById` + `settledReason`) — KHÔNG xoá, KHÔNG
  // ghi dòng âm.
  // ───────────────────────────────────────────────────────────────────────────
  async function tienDuChuaXuLy(bankTransactionId: string): Promise<number> {
    const r = await db.creditBalance.aggregate({
      where: { bankTransactionId, ...TIEN_THUA_CHUA_XU_LY },
      _sum: { amount: true },
    });
    return r._sum.amount ?? 0;
  }

  it("[GGL-05] FIXTURE của ca ghim: 6.200.000 cho đợt 6.000.000 ⇒ dư đúng 200.000, gỡ được", async () => {
    // Ca thường, KHÔNG `.fails`: nó chứng minh mọi bước dựng của [GGL-05b] chạy được. Thiếu
    // nó thì [GGL-05b] "xanh" cả khi fixture ném lỗi — `.fails` nuốt mọi lỗi như nhau.
    const txn = await tienVeQuaSepay("GGLKEY003", DOT_1 + TIEN_DU);
    expect(await tienDuChuaXuLy(txn)).toBe(TIEN_DU);
    const go = await goGan(txn, DON_DU);
    expect(go.ok).toBe(true);
    const lai = await ganTayNhuManBienDong(txn, DON_DU);
    expect(lai.status).toBe("MATCHED");
    // Sổ tiền đợt khớp sau gắn lại — phần này đã đúng nhờ bản vá phép kiểm trùng.
    expect(await soCu(DON_DU)).toBe(DOT_1);
    expect(await soMoi(DON_DU)).toBe(DOT_1);
  });

  it("[GGL-05b] gỡ→gắn lại giao dịch đóng DƯ: tiền dư chưa xử lý vẫn đúng 200.000", async () => {
    const txn = await tienVeQuaSepay("GGLKEY003", DOT_1 + TIEN_DU);
    const go = await goGan(txn, DON_DU);
    expect(go.ok).toBe(true);
    const lai = await ganTayNhuManBienDong(txn, DON_DU);
    expect(lai.status).toBe("MATCHED");
    // Mã cũ ra 400.000: dòng dư của lượt đầu còn nguyên + lượt gắn lại ghi thêm một dòng.
    expect(await tienDuChuaXuLy(txn)).toBe(TIEN_DU);
    // Không xoá, không dòng âm: đúng HAI dòng dương (lượt đầu đã xử lý + lượt gắn lại).
    const dong = await db.creditBalance.findMany({ where: { bankTransactionId: txn }, select: { amount: true } });
    expect(dong.map((d) => d.amount)).toEqual([TIEN_DU, TIEN_DU]);
  });

  it("[GGL-05c] gỡ gắn ⇒ dòng tiền dư bị ĐÁNH DẤU (lúc · người · lý do), rời khối chưa xử lý; giao dịch KHÁC không bị đụng", async () => {
    const txn = await tienVeQuaSepay("GGLKEY003", DOT_1 + TIEN_DU);
    // Đối chứng: giao dịch thứ hai, đơn khác, cũng đóng dư.
    const txnKhac = await tienVeQuaSepay("GGLKEY004", DOT_1 + TIEN_DU);
    const [cu] = await db.creditBalance.findMany({ where: { bankTransactionId: txn } });
    const [khac] = await db.creditBalance.findMany({ where: { bankTransactionId: txnKhac } });
    // FIXTURE: cả hai dòng có thật và CHƯA xử lý — thiếu vế này thì các vế dưới đúng kiểu 0 = 0.
    expect(cu?.amount).toBe(TIEN_DU);
    expect(khac?.amount).toBe(TIEN_DU);
    expect(cu?.settledAt).toBeNull();
    expect(khac?.settledAt).toBeNull();

    const truocGo = Date.now();
    const go = await goGan(txn, DON_DU);
    expect(go.ok).toBe(true);

    const sau = await db.creditBalance.findUniqueOrThrow({ where: { id: cu!.id } });
    expect(sau.amount, "không sửa số tiền, không bù dòng âm").toBe(TIEN_DU);
    expect(sau.settledAt).not.toBeNull();
    expect(sau.settledAt!.getTime()).toBeGreaterThanOrEqual(truocGo - 1000);
    expect(sau.settledById).toBe(ACTOR.id);
    expect(sau.settledReason).toContain("gỡ gắn");
    expect(sau.settledReason).toContain("Gắn nhầm, gắn lại");
    expect(await db.creditBalance.count({ where: { bankTransactionId: txn } }), "không xoá dòng nào").toBe(1);

    // Khối "Tiền thừa chưa xử lý" (`/bien-dong-so-du`) đọc đúng điều kiện này.
    const khoi = await db.creditBalance.findMany({
      where: { orderId: { in: [DON_DU, DON_DU_2] }, ...TIEN_THUA_CHUA_XU_LY },
      select: { id: true },
    });
    expect(khoi.map((k) => k.id)).toEqual([khac!.id]);

    // ĐỐI CHỨNG — dòng của giao dịch khác y nguyên.
    const khacSau = await db.creditBalance.findUniqueOrThrow({ where: { id: khac!.id } });
    expect(khacSau.settledAt).toBeNull();
    expect(khacSau.settledById).toBeNull();
    expect(khacSau.settledReason).toBeNull();
  });
});
