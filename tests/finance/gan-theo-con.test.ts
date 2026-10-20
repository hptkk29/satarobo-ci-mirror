// tests/finance/gan-theo-con.test.ts — ĐƯỜNG GHI TIỀN THEO CON, trên Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants", một required check)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG THỂ LÀ TEST THUẦN
//
// Phần số học của phép chia đã có ở `lib/finance/chia-tien-theo-con.test.ts` và nó thuần.
// Thứ còn lại — và là thứ tiền thật phụ thuộc vào — thì không:
//   · trạng thái đợt PENDING → PARTIAL → PAID do `recomputeRequestStatuses` tính LẠI từ bảng
//     phân bổ, không ai set tay;
//   · bút toán đảo phải trung hoà ĐÚNG trục kế toán của dòng gốc;
//   · và `pg_advisory_xact_lock` chỉ tồn tại khi có Postgres — một mock sẽ "xanh" với đúng
//     cái nó không kiểm.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { noTheoCon } from "@/lib/finance/debt";
import { ganTienTheoCon, ghiTienChoDon, goGanTheoCon, taoDotChoCon } from "@/lib/finance/ghi-tien-don";

if (!RUN_DB_TESTS) console.warn(`[GTC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-gtc-";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture" };

const DON = `${T}don`;
const AN = `${T}item-an`;
const BINH = `${T}item-binh`;

/** Số thật trên prod: một giao dịch 5.016.000đ cho HAI con. */
const TIEN_HAI_CON = 5_016_000;

async function don() {
  await db.paymentAllocation.deleteMany({ where: { bankTransactionId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
}

/**
 * Đơn HAI CON, mỗi bé học phí 4.000.000đ, mỗi bé một đợt 4.000.000đ đang mở.
 * Một giao dịch 5.016.000đ nằm chờ.
 */
async function dungFixture(opts: { trangThaiDon?: "PENDING_PAYMENT" | "CANCELLED"; trangThaiTxn?: "UNMATCHED" | "IGNORED" } = {}) {
  await don();
  await db.order.create({
    data: {
      id: DON,
      code: `ORD-269902-000001`,
      type: "COURSE",
      status: opts.trangThaiDon ?? "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture",
      customerPhone: "0999000111",
      totalAmount: 8_000_000,
    },
  });
  for (const [id, ten] of [
    [AN, "Nguyễn Minh An"],
    [BINH, "Nguyễn Minh Bình"],
  ] as const) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        itemName: ten,
        quantity: 1,
        unitPrice: 4_000_000,
        totalPrice: 4_000_000,
      },
    });
    await db.paymentRequest.create({
      data: {
        id: `${id}-pr1`,
        orderId: DON,
        orderItemId: id,
        installmentNo: 1,
        amountDue: 4_000_000,
        status: "PENDING",
        sortOrder: 1,
      },
    });
  }
  await db.bankTransaction.create({
    data: {
      id: `${T}txn1`,
      provider: "SEPAY",
      providerTxnId: `${T}txn1`,
      amount: TIEN_HAI_CON,
      transferredAt: new Date("2699-02-01T03:00:00Z"),
      status: opts.trangThaiTxn ?? "UNMATCHED",
      content: "PH CHUYEN HOC PHI 2 BE",
    },
  });
}

const prAn = `${AN}-pr1`;
const prBinh = `${BINH}-pr1`;

describe.skipIf(!RUN_DB_TESTS)("[GTC] gắn giao dịch chia theo con — DB thật", () => {
  beforeEach(async () => {
    await dungFixture();
  });
  afterAll(don);

  it("[GTC-01] 5.016.000đ chia HAI con → mỗi bé một dòng Payment mang đúng `orderItemId`", async () => {
    const r = await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [
        { paymentRequestId: prAn, soTien: 2_508_000 },
        { paymentRequestId: prBinh, soTien: 2_508_000 },
      ],
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    const khoan = await db.payment.findMany({
      where: { orderId: DON, deletedAt: null },
      select: { orderItemId: true, amount: true, accountantStatus: true },
      orderBy: { orderItemId: "asc" },
    });
    expect(khoan).toHaveLength(2);
    // ⚠️ Đây là mấu chốt của cả PHIÊN A lẫn PHIÊN B: tiền phải mang tên BÉ NÀO, không phải
    // rơi vào một khoản chung rồi để công nợ từng con tự đoán.
    expect(new Set(khoan.map((k) => k.orderItemId))).toEqual(new Set([AN, BINH]));
    expect(khoan.every((k) => k.accountantStatus === "PENDING")).toBe(true);

    const txn = await db.bankTransaction.findUniqueOrThrow({ where: { id: `${T}txn1` } });
    expect(txn.status).toBe("MATCHED");

    // Σ phân bổ = đúng số tiền giao dịch (bất biến B2).
    const agg = await db.paymentAllocation.aggregate({
      where: { bankTransactionId: `${T}txn1` },
      _sum: { amount: true },
    });
    expect(agg._sum.amount).toBe(TIEN_HAI_CON);

    // Đợt chưa đóng đủ ⇒ PARTIAL, không phải PAID.
    const dot = await db.paymentRequest.findMany({ where: { orderId: DON }, select: { status: true } });
    expect(dot.every((d) => d.status === "PARTIAL")).toBe(true);
  });

  it("[GTC-02] BA giao dịch vào CÙNG một đợt: PARTIAL → PARTIAL → PAID", async () => {
    // Ca thật của chủ dự án: ORD-260910-000008 nhận ba lần chuyển khoản cho một đợt.
    for (let i = 2; i <= 4; i += 1) {
      await db.bankTransaction.create({
        data: {
          id: `${T}txn${i}`,
          provider: "SEPAY",
          providerTxnId: `${T}txn${i}`,
          amount: i === 4 ? 2_000_000 : 1_000_000,
          transferredAt: new Date("2699-02-0" + i + "T03:00:00Z"),
          status: "UNMATCHED",
        },
      });
    }

    const mong = ["PARTIAL", "PARTIAL", "PAID"];
    for (let i = 2; i <= 4; i += 1) {
      const r = await ganTienTheoCon({
        bankTransactionId: `${T}txn${i}`,
        orderId: DON,
        dong: [{ paymentRequestId: prAn, soTien: i === 4 ? 2_000_000 : 1_000_000 }],
        actor: ACTOR,
      });
      expect(r.ok, `lượt ${i}`).toBe(true);
      const pr = await db.paymentRequest.findUniqueOrThrow({ where: { id: prAn } });
      expect(pr.status, `lượt ${i}`).toBe(mong[i - 2]);
    }

    // 1tr + 1tr + 2tr = 4tr = đúng số phải thu của đợt.
    const agg = await db.paymentAllocation.aggregate({
      where: { paymentRequestId: prAn },
      _sum: { amount: true },
    });
    expect(agg._sum.amount).toBe(4_000_000);
  });

  it("[GTC-03] MỘT giao dịch chia cho HAI ĐỢT của cùng một con", async () => {
    await db.paymentRequest.create({
      data: {
        id: `${AN}-pr2`,
        orderId: DON,
        orderItemId: AN,
        installmentNo: 2,
        amountDue: 2_000_000,
        status: "PENDING",
        sortOrder: 2,
      },
    });
    // Đợt 1 hạ xuống 2.000.000: hai đợt cộng lại = 4.000.000 = ĐÚNG còn nợ của bé.
    //
    // ⚠️ Bản đầu của ca này chia 3.016.000 + 2.000.000 = 5.016.000 và nó ĐỎ — đúng như phải
    // đỏ: trần theo CON chặn lại, vì bé chỉ nợ 4.000.000. Ghi lại đây vì đó là bằng chứng
    // trần ấy có răng, không phải một vòng lặp trang trí (xem chú thích của `kiemChiaTheoCon`
    // nói rằng trần con là lớp phòng thủ thứ hai).
    await db.paymentRequest.update({ where: { id: prAn }, data: { amountDue: 2_000_000 } });
    await db.bankTransaction.create({
      data: {
        id: `${T}txn-4tr`,
        provider: "SEPAY",
        providerTxnId: `${T}txn-4tr`,
        amount: 4_000_000,
        transferredAt: new Date("2699-02-05T03:00:00Z"),
        status: "UNMATCHED",
      },
    });

    const r = await ganTienTheoCon({
      bankTransactionId: `${T}txn-4tr`,
      orderId: DON,
      dong: [
        { paymentRequestId: prAn, soTien: 2_000_000 },
        { paymentRequestId: `${AN}-pr2`, soTien: 2_000_000 },
      ],
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    const dot = await db.paymentRequest.findMany({
      where: { orderItemId: AN },
      select: { installmentNo: true, status: true },
      orderBy: { installmentNo: "asc" },
    });
    expect(dot.map((d) => d.status)).toEqual(["PAID", "PAID"]);

    // Hai đợt của MỘT bé ⇒ gộp thành MỘT dòng Payment, không phải hai.
    const khoan = await db.payment.findMany({ where: { orderId: DON, orderItemId: AN, deletedAt: null } });
    expect(khoan).toHaveLength(1);
    expect(khoan[0]!.amount).toBe(4_000_000);
  });

  it("[GTC-04] GỠ GẮN → giao dịch về UNMATCHED, nợ con quay lại, dòng gốc KHÔNG bị xoá", async () => {
    await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [
        { paymentRequestId: prAn, soTien: 2_508_000 },
        { paymentRequestId: prBinh, soTien: 2_508_000 },
      ],
      actor: ACTOR,
    });

    const r = await goGanTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      lyDo: "Gắn nhầm sang đơn của bé khác",
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tienDao).toBe(TIEN_HAI_CON);

    const txn = await db.bankTransaction.findUniqueOrThrow({ where: { id: `${T}txn1` } });
    expect(txn.status).toBe("UNMATCHED");
    expect(txn.unmatchedNote).toContain("Gắn nhầm");

    // Dây nối bị gỡ ⇒ đợt về PENDING.
    const dot = await db.paymentRequest.findMany({ where: { orderId: DON }, select: { status: true } });
    expect(dot.every((d) => d.status === "PENDING")).toBe(true);

    // ⚠️ Dòng thu GỐC còn nguyên (không xoá mềm), và có thêm bút toán đảo trung hoà nó.
    const goc = await db.payment.findMany({ where: { orderId: DON, paymentType: "PAYMENT", deletedAt: null } });
    const dao = await db.payment.findMany({ where: { orderId: DON, paymentType: "ADJUSTMENT", deletedAt: null } });
    expect(goc).toHaveLength(2);
    expect(dao).toHaveLength(2);
    expect(dao.every((d) => d.amount < 0)).toBe(true);
    expect(dao.every((d) => d.adjustmentOfId != null)).toBe(true);
    // ⚠️ Bút toán đảo phải mang ĐÚNG trục kế toán của dòng gốc. Trái dấu mà khác trục thì
    // tổng của trục kia không về 0 — công nợ hiển thị vẫn tụt dù tiền đã gỡ. Ca này thêm sau
    // một lượt cấy LỌT (đổi trục thành REJECTED mà không ca nào đỏ).
    const trucGoc = new Map(goc.map((g) => [g.id, g.accountantStatus]));
    for (const d of dao) {
      expect(d.accountantStatus, `đảo của ${d.adjustmentOfId}`).toBe(trucGoc.get(d.adjustmentOfId!));
    }
    // Tổng hai chiều triệt tiêu ⇒ công nợ của từng bé quay về đúng số cũ.
    expect(goc.reduce((s, x) => s + x.amount, 0) + dao.reduce((s, x) => s + x.amount, 0)).toBe(0);

    const so = await noTheoCon(DON);
    expect(so.con.map((c) => c.conNo)).toEqual([4_000_000, 4_000_000]);
  });

  it("[GTC-05] gỡ HAI LẦN không sinh bút toán đảo thứ hai", async () => {
    await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [
        { paymentRequestId: prAn, soTien: 2_508_000 },
        { paymentRequestId: prBinh, soTien: 2_508_000 },
      ],
      actor: ACTOR,
    });
    await goGanTheoCon({ bankTransactionId: `${T}txn1`, orderId: DON, lyDo: "lần 1", actor: ACTOR });
    const lai = await goGanTheoCon({ bankTransactionId: `${T}txn1`, orderId: DON, lyDo: "lần 2", actor: ACTOR });
    // Giao dịch đã UNMATCHED ⇒ không còn gì để gỡ.
    expect(lai.ok).toBe(false);
    const dao = await db.payment.count({ where: { orderId: DON, paymentType: "ADJUSTMENT", deletedAt: null } });
    expect(dao).toBe(2);
  });

  it("[GTC-05b] gắn HAI LẦN cùng một giao dịch → lần hai TỪ CHỐI (không rót đôi)", async () => {
    // Thêm sau một lượt cấy LỌT: bỏ cổng `status === "MATCHED"` mà không ca nào đỏ. Đây là ca
    // của hai người cùng bấm, hoặc một người bấm hai lần vì lần đầu trông như treo.
    const lan1 = await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [
        { paymentRequestId: prAn, soTien: 2_508_000 },
        { paymentRequestId: prBinh, soTien: 2_508_000 },
      ],
      actor: ACTOR,
    });
    expect(lan1.ok).toBe(true);

    const lan2 = await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [{ paymentRequestId: prAn, soTien: TIEN_HAI_CON }],
      actor: ACTOR,
    });
    expect(lan2.ok).toBe(false);
    if (!lan2.ok) expect(lan2.error).toContain("đã được gắn");

    // Σ phân bổ vẫn ĐÚNG một lần số tiền giao dịch — bất biến B2.
    const agg = await db.paymentAllocation.aggregate({
      where: { bankTransactionId: `${T}txn1` },
      _sum: { amount: true },
    });
    expect(agg._sum.amount).toBe(TIEN_HAI_CON);
    expect(await db.payment.count({ where: { orderId: DON, paymentType: "PAYMENT", deletedAt: null } })).toBe(2);
  });

  it("[GTC-09] khoá theo đơn LOẠI TRỪ LẪN NHAU — hai lệnh không bao giờ chồng nhau", async () => {
    // ⚠️ Ca [GTC-08] (hai lệnh tạo đợt song song) KHÔNG đủ để canh cái khoá: cấy bỏ hẳn
    // `khoaDonTrongTx` mà nó vẫn xanh, vì hai transaction tình cờ không kịp chồng nhau. Ca này
    // đo TRỰC TIẾP tính loại trừ: mỗi lượt vào ghi mốc, ngủ, rồi ghi mốc ra. Có khoá thì dãy
    // mốc phải là "vào-ra-vào-ra"; mất khoá thì thành "vào-vào-ra-ra".
    const moc: string[] = [];
    const lam = (ten: string) =>
      ghiTienChoDon(DON, async () => {
        moc.push(`${ten}-vào`);
        await new Promise((r) => setTimeout(r, 200));
        moc.push(`${ten}-ra`);
      });
    await Promise.all([lam("A"), lam("B")]);

    expect(moc).toHaveLength(4);
    // Lượt vào trước phải ra trước khi lượt sau vào — không quan tâm A hay B đi đầu.
    expect(moc[1]).toBe(moc[0]!.replace("vào", "ra"));
    expect(moc[3]).toBe(moc[2]!.replace("vào", "ra"));
  });

  it("[GTC-06] giao dịch IGNORED → TỪ CHỐI gắn", async () => {
    await db.bankTransaction.update({ where: { id: `${T}txn1` }, data: { status: "IGNORED" } });
    const r = await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [{ paymentRequestId: prAn, soTien: TIEN_HAI_CON }],
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Bỏ qua");
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: `${T}txn1` } })).toBe(0);
  });

  it("[GTC-07] đơn ĐÃ HUỶ → TỪ CHỐI gắn (gắn tay không phải cửa sau của luật đối khớp)", async () => {
    await dungFixture({ trangThaiDon: "CANCELLED" });
    const r = await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [{ paymentRequestId: prAn, soTien: TIEN_HAI_CON }],
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("không nhận tiền");
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: `${T}txn1` } })).toBe(0);
  });

  it("[GTC-08] HAI lệnh tạo đợt SONG SONG cùng một con → tổng KHÔNG vượt còn nợ", async () => {
    // ⚠️ Đây là ca sinh ra `ghiTienChoDon`. Bản PHIÊN A đọc công nợ NGOÀI transaction: cả hai
    // lệnh đọc `conNo = 4.000.000` và `đợt đang mở = 4.000.000` ... nên ca này cần một bé CHƯA
    // có đợt nào để hai lệnh cùng thấy "còn trống 4.000.000".
    await db.paymentRequest.deleteMany({ where: { orderItemId: AN } });

    const [a, b] = await Promise.all([
      taoDotChoCon({ orderId: DON, orderItemId: AN, soTien: 4_000_000, dueDate: null, centerId: null, actor: ACTOR }),
      taoDotChoCon({ orderId: DON, orderItemId: AN, soTien: 4_000_000, dueDate: null, centerId: null, actor: ACTOR }),
    ]);

    // Đúng MỘT lệnh được qua. Lệnh sau vào khoá, đọc lại, thấy đợt đang mở đã phủ hết nợ.
    const soQua = [a, b].filter((x) => x.ok).length;
    expect(soQua).toBe(1);

    const dot = await db.paymentRequest.findMany({
      where: { orderItemId: AN, status: { in: ["PENDING", "PARTIAL"] } },
      select: { amountDue: true },
    });
    const tong = dot.reduce((s, d) => s + d.amountDue, 0);
    // Nếu cả hai cùng qua thì đây là 8.000.000 — tức hai mã QR mỗi mã đòi đủ tiền.
    expect(tong).toBe(4_000_000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ĐƠN CŨ — đợt `orderItemId = NULL` (mọi đơn trước 16/09/2026)
//
// ⚠️ Nhóm này thêm 17/09 sau khi đo ra một lỗ: `dungDotDeChia` bản đầu chỉ đi qua `con[]` nên
// đợt NULL không bao giờ vào danh sách ⇒ màn gắn hiện 0 đợt cho đơn cũ, cổng từ chối chúng với
// câu "đợt không thuộc đơn này". Tức 24 giao dịch UNMATCHED của đơn cũ KHÔNG gắn được bằng màn
// mới — đúng tập việc mà PHIÊN B sinh ra để dọn.
// ═════════════════════════════════════════════════════════════════════════════

const TC = "fx-gtc-cu-";
const DON_CU = `${TC}don`;
const ITEM_CU_A = `${TC}item-a`;
const ITEM_CU_B = `${TC}item-b`;
const PR_CHUNG = `${TC}pr-chung`;
const PR_A = `${TC}pr-a`;

async function donCu() {
  await db.paymentAllocation.deleteMany({ where: { bankTransactionId: { startsWith: TC } } });
  await db.payment.deleteMany({ where: { orderId: DON_CU } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON_CU } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: TC } } });
  await db.orderItem.deleteMany({ where: { orderId: DON_CU } });
  await db.order.deleteMany({ where: { id: DON_CU } });
}

/**
 * Đơn kiểu CŨ: một đợt thu `orderItemId = NULL`.
 * `soCon = 1` ⇒ đơn một con (suy ra được); `2` ⇒ phải để sale chia.
 */
async function dungDonCu(soCon: 1 | 2, opts: { themDotCuaCon?: boolean } = {}) {
  await donCu();
  await db.order.create({
    data: {
      id: DON_CU,
      code: "ORD-269903-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh đơn cũ",
      customerPhone: "0999000222",
      totalAmount: soCon === 1 ? 3_000_000 : 6_000_000,
    },
  });
  const ten = [
    [ITEM_CU_A, "Lê Văn A"],
    [ITEM_CU_B, "Lê Thị B"],
  ] as const;
  for (const [id, n] of ten.slice(0, soCon)) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON_CU,
        type: "COURSE_ENROLLMENT",
        itemName: n,
        quantity: 1,
        unitPrice: 3_000_000,
        totalPrice: 3_000_000,
      },
    });
  }
  // Đợt của LUỒNG CŨ — không thuộc bé nào.
  await db.paymentRequest.create({
    data: {
      id: PR_CHUNG,
      orderId: DON_CU,
      orderItemId: null,
      installmentNo: 1,
      amountDue: 2_000_000,
      status: "PENDING",
      sortOrder: 1,
    },
  });
  if (opts.themDotCuaCon) {
    await db.paymentRequest.create({
      data: {
        id: PR_A,
        orderId: DON_CU,
        orderItemId: ITEM_CU_A,
        installmentNo: 1,
        amountDue: 1_000_000,
        status: "PENDING",
        sortOrder: 1,
      },
    });
  }
  await db.bankTransaction.create({
    data: {
      id: `${TC}txn`,
      provider: "SEPAY",
      providerTxnId: `${TC}txn`,
      amount: opts.themDotCuaCon ? 3_000_000 : 2_000_000,
      transferredAt: new Date("2699-03-01T03:00:00Z"),
      status: "UNMATCHED",
    },
  });
}

describe.skipIf(!RUN_DB_TESTS)("[GTC-CU] đơn cũ — đợt không thuộc bé nào", () => {
  afterAll(donCu);

  it("[GTC-10] đơn MỘT con: gắn vào đợt NULL → tiền ghi tên bé, và ĐỢT được nâng luôn", async () => {
    await dungDonCu(1);
    const r = await ganTienTheoCon({
      bankTransactionId: `${TC}txn`,
      orderId: DON_CU,
      dong: [{ paymentRequestId: PR_CHUNG, soTien: 2_000_000 }],
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    // Tiền mang tên bé — đây là thứ công nợ theo con đọc.
    const khoan = await db.payment.findMany({
      where: { orderId: DON_CU, deletedAt: null },
      select: { orderItemId: true, amount: true },
    });
    expect(khoan).toHaveLength(1);
    expect(khoan[0]!.orderItemId).toBe(ITEM_CU_A);

    // Và đợt cũng được nâng: để nó ở NULL trong khi tiền đã ghi tên bé là hai màn nói hai
    // chuyện — nó sẽ ở lại khối "Đợt chung (chưa chia con)" mãi.
    const pr = await db.paymentRequest.findUniqueOrThrow({ where: { id: PR_CHUNG } });
    expect(pr.orderItemId).toBe(ITEM_CU_A);
    expect(pr.status).toBe("PAID");

    const so = await noTheoCon(DON_CU);
    expect(so.dotChuaGanCon).toHaveLength(0);
  });

  it("[GTC-11] đơn HAI con: gắn vào đợt NULL → vẫn gắn được, nhưng KHÔNG đoán bé nào", async () => {
    await dungDonCu(2);
    const r = await ganTienTheoCon({
      bankTransactionId: `${TC}txn`,
      orderId: DON_CU,
      dong: [{ paymentRequestId: PR_CHUNG, soTien: 2_000_000 }],
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    // ⚠️ `orderItemId` phải là NULL. Đoán bừa là bé A hết nợ còn bé B vẫn bị gọi đòi tiền, và
    // không có dấu vết nào để lần ra vì sao.
    const khoan = await db.payment.findMany({
      where: { orderId: DON_CU, deletedAt: null },
      select: { orderItemId: true, amount: true },
    });
    expect(khoan).toHaveLength(1);
    expect(khoan[0]!.orderItemId).toBeNull();

    const pr = await db.paymentRequest.findUniqueOrThrow({ where: { id: PR_CHUNG } });
    expect(pr.orderItemId).toBeNull();

    // Không bé nào bị cộng tiền vào.
    const so = await noTheoCon(DON_CU);
    expect(so.con.every((c) => c.daThu === 0)).toBe(true);
  });

  it("[GTC-12] đơn LAI: chia CÙNG LÚC cho đợt của bé và đợt chung", async () => {
    // Ca thật: đơn cũ đã có đợt toàn-đơn, rồi sale tạo thêm đợt cho một bé sau khi bật cờ.
    await dungDonCu(2, { themDotCuaCon: true });
    const r = await ganTienTheoCon({
      bankTransactionId: `${TC}txn`,
      orderId: DON_CU,
      dong: [
        { paymentRequestId: PR_A, soTien: 1_000_000 },
        { paymentRequestId: PR_CHUNG, soTien: 2_000_000 },
      ],
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    const khoan = await db.payment.findMany({
      where: { orderId: DON_CU, deletedAt: null },
      select: { orderItemId: true, amount: true },
      orderBy: { amount: "asc" },
    });
    // HAI dòng: một mang tên bé A, một để NULL — không gộp, vì hai thứ khác nhau về nghĩa.
    expect(khoan).toHaveLength(2);
    expect(khoan.map((k) => [k.orderItemId, k.amount])).toEqual([
      [ITEM_CU_A, 1_000_000],
      [null, 2_000_000],
    ]);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[GTC-GO] gỡ gắn — nhật ký phải tự đủ để dựng lại", () => {
  beforeEach(async () => {
    await dungFixture();
  });
  afterAll(don);

  it("[GTC-13] AuditLog giữ ẢNH CHỤP ĐỦ của phân bổ đã xoá + id bút toán đảo", async () => {
    await ganTienTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      dong: [
        { paymentRequestId: prAn, soTien: 2_508_000 },
        { paymentRequestId: prBinh, soTien: 2_508_000 },
      ],
      actor: ACTOR,
    });
    const r = await goGanTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      lyDo: "Gắn nhầm sang đơn của bé khác",
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);

    const nk = await db.auditLog.findFirstOrThrow({
      where: { entityType: "BankTransaction", entityId: `${T}txn1`, action: "TXN_GO_GAN" },
      orderBy: { createdAt: "desc" },
    });
    const cu = nk.oldValues as unknown as {
      phanBo: Record<string, unknown>[];
      nguoiGan: unknown;
    };
    const moi = nk.newValues as unknown as {
      idButToanDao: string[];
      trangThaiDotSauGo: Record<string, unknown>[];
    };

    // ⚠️ `PaymentAllocation` bị XOÁ THẬT — thiếu cột nào trong ảnh chụp là cột đó mất vĩnh
    // viễn. Ca này liệt kê TỪNG CỘT, không dùng một phép so lỏng.
    expect(cu.phanBo).toHaveLength(2);
    for (const pb of cu.phanBo) {
      for (const cot of [
        "id",
        "bankTransactionId",
        "paymentRequestId",
        "orderItemId",
        "installmentNo",
        "amount",
        "roundingWaived",
        "centerId",
        "createdAt",
      ]) {
        expect(Object.keys(pb), cot).toContain(cot);
      }
      expect(pb.bankTransactionId).toBe(`${T}txn1`);
      expect(typeof pb.createdAt).toBe("string");
    }
    expect((cu.phanBo.map((p) => p.orderItemId) as string[]).sort()).toEqual([AN, BINH].sort());
    // Người GẮN — tra ngược từ nhật ký lượt gắn, vì bảng phân bổ không có cột actor.
    expect(cu.nguoiGan).toMatchObject({ actorId: ACTOR.id, actorName: ACTOR.name });
    // Lý do bắt buộc, và nó nằm ở cột `reason` chứ không lẫn vào payload.
    expect(nk.reason).toContain("Gắn nhầm");

    // Bút toán đảo: có id, và id ấy trỏ đúng dòng ADJUSTMENT trong DB.
    expect(moi.idButToanDao).toHaveLength(2);
    const dao = await db.payment.findMany({ where: { id: { in: moi.idButToanDao } } });
    expect(dao).toHaveLength(2);
    expect(dao.every((d) => d.paymentType === "ADJUSTMENT" && d.amount < 0)).toBe(true);

    // Trạng thái đợt SAU gỡ, ghi lại làm bằng chứng "nợ con đã quay lại".
    expect(moi.trangThaiDotSauGo.map((d) => d.status)).toEqual(["PENDING", "PENDING"]);
  });

  it("[GTC-14] sau gỡ, GẮN LẠI cùng giao dịch vào cùng đợt → ĐƯỢC", async () => {
    // Nếu phân bổ chỉ bị đánh dấu thay vì xoá, khoá `@@unique([bankTransactionId,
    // paymentRequestId])` sẽ chặn lượt gắn lại — và người dùng mắc kẹt với một giao dịch đã gỡ
    // mà không gắn đi đâu được.
    const goi = () =>
      ganTienTheoCon({
        bankTransactionId: `${T}txn1`,
        orderId: DON,
        dong: [
          { paymentRequestId: prAn, soTien: 2_508_000 },
          { paymentRequestId: prBinh, soTien: 2_508_000 },
        ],
        actor: ACTOR,
      });

    expect((await goi()).ok).toBe(true);
    await goGanTheoCon({
      bankTransactionId: `${T}txn1`,
      orderId: DON,
      lyDo: "thử lại",
      actor: ACTOR,
    });

    const dotSauGo = await db.paymentRequest.findMany({
      where: { orderId: DON },
      select: { status: true },
    });
    expect(dotSauGo.every((d) => d.status === "PENDING")).toBe(true);

    expect((await goi()).ok).toBe(true);
    const agg = await db.paymentAllocation.aggregate({
      where: { bankTransactionId: `${T}txn1` },
      _sum: { amount: true },
    });
    expect(agg._sum.amount).toBe(TIEN_HAI_CON);
    const txn = await db.bankTransaction.findUniqueOrThrow({ where: { id: `${T}txn1` } });
    expect(txn.status).toBe("MATCHED");

    // LEDGER-A — Σ `Payment` sống (gốc + đảo + dòng mới) phải về đúng số của lượt gắn lại.
    //
    // Đường gắn tay (`[gan-tay:…]`) hôm nay KHÔNG có phép kiểm trùng nên vế này xanh sẵn; nó
    // ở đây để khoá hai sổ vào nhau. Đường webhook (`[auto:…]`) CÓ phép kiểm trùng và từng
    // nuốt đúng lượt ghi này — `tests/finance/go-gan-gan-lai.test.ts` [GGL-01]. Ai thêm một
    // phép kiểm trùng kiểu cũ vào `ganTienTheoCon` thì vế này đỏ.
    const soCu = await db.payment.aggregate({
      where: { orderId: DON, deletedAt: null },
      _sum: { amount: true },
    });
    expect(soCu._sum.amount).toBe(TIEN_HAI_CON);
    expect(soCu._sum.amount).toBe(agg._sum.amount);
  });
});
