// tests/finance/phieu-gop-tu-rot.test.ts — TỰ RÓT NGUYÊN KHOẢN khi phiếu gộp một QR chuyển lệch số [22/10/2026]. Postgres THẬT.
//
// Chạy: pnpm test:finance-db (bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id).
//
// Luật (chủ dự án chốt 22/10/2026): thiếu ⇒ rót NGUYÊN khoản theo thứ tự cho tới khi gặp khoản không vừa thì DỪNG; không rót một phần;
// dư ⇒ «tiền chờ gắn» (giao dịch GIỮ UNMATCHED kèm phân bổ đã rót). Chỉ áp khi: nguồn không phải thẻ POS · cờ thu học phí linh hoạt BẬT ·
// MỌI dòng của phiếu thuộc một con. Ngoài ba điều kiện đó giữ NGUYÊN «ăn cả hoặc không ăn gì» (`[PG-*]` ở `phieu-gop.test.ts`).
//
// Đi qua `ingestPayosWebhook` (cửa thật của SePay) như `phieu-gop.test.ts`; riêng ca thẻ POS gọi thẳng `thuTheoPhieuGop` vì cửa thẻ không phải webhook.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { taoPhieuGop, thuTheoPhieuGop } from "@/lib/finance/phieu-gop";
import { ganTienTheoCon } from "@/lib/finance/ghi-tien-don";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { dungMemo } from "@/lib/payments/memo-ck";
import { clearSettingsCache } from "@/lib/settings/service";

if (!RUN_DB_TESTS) console.warn(`[PTR] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const T = "fx-ptr-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture" };
const DON = `${T}don`;
const CENTER = `${T}center`;
const ITEM = { a: `${T}item-a`, b: `${T}item-b`, c: `${T}item-c` };
const DOT = { a: `${T}dot-a`, b: `${T}dot-b`, c: `${T}dot-c` };
/** Số cố ý KHÔNG tròn. Khoản b NHỎ hơn khoản a — để ca «không nhảy cóc» có nghĩa. */
const TIEN = { a: 3_168_000, b: 1_564_000, c: 2_222_000 };
const TONG = TIEN.a + TIEN.b + TIEN.c;
const SDT = "0905123456";
const KHOA_FLEX = "billing.flexV1Enabled";

let soLanTxn = 0;
const maTxn = () => `${T}txn-${++soLanTxn}`;

async function datCo(bat: boolean) {
  await db.systemSetting.upsert({ where: { key: KHOA_FLEX }, create: { key: KHOA_FLEX, valueJson: bat }, update: { valueJson: bat } });
  clearSettingsCache();
}

async function don() {
  // Đơn thu đủ ⇒ handler/rollup có thể đã ghi lịch sử trạng thái (FK RESTRICT chặn xoá đơn) — dọn trước, kẻo một lượt lỗi để lại rác làm cả bộ đỏ giả.
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  const txns = await db.bankTransaction.findMany({ where: { OR: [{ providerTxnId: { startsWith: T } }, { id: { startsWith: T } }] }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "Order", entityId: DON }, { entityType: "BankTransaction", entityId: { in: txns.map((t) => t.id) } }] } });
  await db.bankTransaction.deleteMany({ where: { id: { in: txns.map((t) => t.id) } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: CENTER } });
  await db.systemSetting.deleteMany({ where: { key: KHOA_FLEX } });
  clearSettingsCache();
}

/** `dongCuaCon`: false ⇒ khoản c là đợt đời cũ (`orderItemId` NULL). */
async function dungFixture(opts: { coBay?: boolean; dotCDoiCu?: boolean } = {}) {
  await don();
  await datCo(opts.coBay ?? true);
  await db.center.create({ data: { id: CENTER, name: "Cơ sở fixture PTR", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.order.create({
    data: { id: DON, code: "ORD-269921-000001", type: "COURSE", status: "PENDING_PAYMENT", customerName: "Phụ huynh fixture PTR", customerPhone: SDT, totalAmount: TONG, centerId: CENTER },
  });
  for (const k of ["a", "b", "c"] as const) {
    await db.orderItem.create({
      data: { id: ITEM[k], orderId: DON, type: "COURSE_ENROLLMENT", itemName: `Bé ${k.toUpperCase()} PTR`, quantity: 1, unitPrice: TIEN[k], totalPrice: TIEN[k] },
    });
    await db.paymentRequest.create({
      data: {
        id: DOT[k],
        orderId: DON,
        orderItemId: k === "c" && opts.dotCDoiCu ? null : ITEM[k],
        centerId: CENTER,
        installmentNo: k === "c" && opts.dotCDoiCu ? 2 : 1,
        amountDue: TIEN[k],
        status: "PENDING",
        sortOrder: k === "a" ? 1 : k === "b" ? 2 : 3,
      },
    });
  }
}

async function phatPhieu(): Promise<string> {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT.a, DOT.b, DOT.c], actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
  return r.ma;
}

function ban(opts: { ma: string; soTien: number; txnId?: string }) {
  const id = opts.txnId ?? maTxn();
  return ingestPayosWebhook(
    {
      orderCode: undefined,
      reference: id,
      paymentLinkId: id,
      description: dungMemo({ hoTen: "Bé A PTR", sdt: SDT, ma: opts.ma }),
      amount: opts.soTien,
      transactionDateTime: "2699-09-20T03:00:00Z",
      accountNumber: "0123456789",
    } as never,
    "SEPAY",
  );
}

const phanBoCuaDon = () => db.paymentAllocation.findMany({ where: { paymentRequest: { orderId: DON } }, orderBy: { paymentRequestId: "asc" } });
const dotCuaDon = () => db.paymentRequest.findMany({ where: { orderId: DON }, orderBy: { sortOrder: "asc" } });
const phieuCuaDon = () => db.paymentBill.findFirstOrThrow({ where: { orderId: DON } });
const nhatKyTuRot = () => db.auditLog.findMany({ where: { action: "PHIEU_GOP_TU_ROT", entityType: "BankTransaction" }, orderBy: { createdAt: "asc" } });

describe.skipIf(!RUN_DB_TESTS)("[PTR] phiếu gộp tự rót nguyên khoản — DB thật", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  it("[PTR-01] fixture: cờ BẬT, 3 con, phiếu = Σ ba khoản, thứ tự theo sortOrder", async () => {
    await phatPhieu();
    const p = await db.paymentBill.findFirstOrThrow({ where: { orderId: DON }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    expect(p.amountDue).toBe(TONG);
    expect(p.lines.map((l) => l.amount)).toEqual([TIEN.a, TIEN.b, TIEN.c]);
  });

  it("[PTR-02] ĐÚNG TỔNG ⇒ như luật cũ: phiếu PAID, giao dịch MATCHED, KHÔNG có nhật ký tự rót", async () => {
    const ma = await phatPhieu();
    const kq = await ban({ ma, soTien: TONG });
    expect(kq.status).toBe("MATCHED");
    expect((await phanBoCuaDon()).map((p) => p.amount).sort((x, y) => x - y)).toEqual([TIEN.b, TIEN.c, TIEN.a]);
    expect((await phieuCuaDon()).status).toBe("PAID");
    expect((await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: { startsWith: T } } })).status).toBe("MATCHED");
    expect(await nhatKyTuRot()).toHaveLength(0);
  });

  it("[PTR-03] THIẾU, đủ ĐÚNG con đầu ⇒ rót con a, giao dịch MATCHED (hết tiền), phiếu VẪN MỞ; chuyển nốt phần còn lại vào cùng QR ⇒ PAID", async () => {
    const ma = await phatPhieu();
    const kq = await ban({ ma, soTien: TIEN.a });
    expect(kq.status).toBe("MATCHED");
    const dot = await dotCuaDon();
    expect(dot.map((d) => d.status)).toEqual(["PAID", "PENDING", "PENDING"]);
    expect((await phieuCuaDon()).status, "phiếu CHƯA đủ ⇒ giữ OPEN").toBe("OPEN");
    // Sổ cũ: một dòng Payment mang tên bé a.
    const khoan = await db.payment.findMany({ where: { orderId: DON } });
    expect(khoan.map((k) => [k.orderItemId, k.amount])).toEqual([[ITEM.a, TIEN.a]]);
    // Giao dịch hết tiền ⇒ MATCHED, không để lại «tiền chờ gắn».
    expect((await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: { startsWith: T } } })).status).toBe("MATCHED");
    // Nhật ký: lượt này KHÁC luật đúng-số nên PHẢI có.
    const nk = await nhatKyTuRot();
    expect(nk).toHaveLength(1);
    expect(nk[0]!.newValues).toMatchObject({ billId: expect.any(String), tongRot: TIEN.a, conLai: 0, hetPhieu: false });

    // Chuyển nốt đúng số còn lại: khớp ĐÚNG SỐ như thường ⇒ phiếu PAID.
    const kq2 = await ban({ ma, soTien: TIEN.b + TIEN.c });
    expect(kq2.status).toBe("MATCHED");
    expect((await phieuCuaDon()).status).toBe("PAID");
    expect((await dotCuaDon()).map((d) => d.status)).toEqual(["PAID", "PAID", "PAID"]);
  });

  it("[PTR-04] THIẾU nhưng đủ con a + b: rót a, b; c KHÔNG vừa ⇒ dừng; phần dư nằm CHỜ GẮN (UNMATCHED + phân bổ)", async () => {
    const ma = await phatPhieu();
    const du = 1_000_000; // < TIEN.c
    const kq = await ban({ ma, soTien: TIEN.a + TIEN.b + du });
    expect(kq.status, "đã rót một phần ⇒ MATCHED về phía webhook (200, có allocated)").toBe("MATCHED");
    expect((await dotCuaDon()).map((d) => d.status)).toEqual(["PAID", "PAID", "PENDING"]);
    expect((await phanBoCuaDon()).map((p) => p.paymentRequestId).sort()).toEqual([DOT.a, DOT.b].sort());
    expect((await phieuCuaDon()).status).toBe("OPEN");
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: { startsWith: T } } });
    expect(txn.status, "còn dư ⇒ GIỮ UNMATCHED để hiện ở hàng chờ").toBe("UNMATCHED");
    expect(txn.unmatchedNote).toContain("RÓT_MỘT_PHẦN");
    expect(txn.unmatchedNote).toContain("1.000.000");
    // Không có khoản Payment một phần cho c.
    expect((await db.payment.findMany({ where: { orderId: DON } })).map((k) => k.orderItemId).sort()).toEqual([ITEM.a, ITEM.b].sort());
    const nk = await nhatKyTuRot();
    expect(nk).toHaveLength(1);
    expect(nk[0]!.newValues).toMatchObject({ tongRot: TIEN.a + TIEN.b, conLai: du, hetPhieu: false, soTienVe: TIEN.a + TIEN.b + du });
    const dongNk = (nk[0]!.newValues as { dong: { thuTu: number; orderItemId: string; paymentRequestId: string; soTienRot: number }[] }).dong;
    expect(dongNk.map((d) => d.thuTu)).toEqual([1, 2]);
    // Nhật ký chỉ ra ĐÚNG con và ĐÚNG khoản theo thứ tự rót (phiếu nhiều con, không phải một con).
    expect(dongNk.map((d) => [d.orderItemId, d.paymentRequestId, d.soTienRot])).toEqual([
      [ITEM.a, DOT.a, TIEN.a],
      [ITEM.b, DOT.b, TIEN.b],
    ]);
    expect(nk[0]!.entityId, "giao dịch nguồn").toBe(txn.id);
  });

  it("[PTR-05] KHÔNG NHẢY CÓC: tiền chỉ đủ khoản b (nhỏ hơn a) ⇒ KHÔNG rót gì, UNMATCHED lý do LECH_SO", async () => {
    const ma = await phatPhieu();
    const kq = await ban({ ma, soTien: TIEN.b });
    expect(kq.status).toBe("UNMATCHED");
    expect("reason" in kq && kq.reason).toContain("LECH_SO");
    expect(await phanBoCuaDon()).toHaveLength(0);
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(0);
    expect((await phieuCuaDon()).status).toBe("OPEN");
    expect(await nhatKyTuRot(), "không rót gì ⇒ không có gì để nhật ký").toHaveLength(0);
  });

  it("[PTR-06] THIẾU NGAY KHOẢN ĐẦU 1đ ⇒ không rót, giao dịch UNMATCHED nguyên số", async () => {
    const ma = await phatPhieu();
    const kq = await ban({ ma, soTien: TIEN.a - 1 });
    expect(kq.status).toBe("UNMATCHED");
    expect(await phanBoCuaDon()).toHaveLength(0);
  });

  it("[PTR-07] DƯ ⇒ rót đủ cả ba, phiếu PAID, phần dư chờ gắn", async () => {
    const ma = await phatPhieu();
    const du = 500_000;
    const kq = await ban({ ma, soTien: TONG + du });
    expect(kq.status).toBe("MATCHED");
    expect((await dotCuaDon()).map((d) => d.status)).toEqual(["PAID", "PAID", "PAID"]);
    expect((await phieuCuaDon()).status).toBe("PAID");
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: { startsWith: T } } });
    expect(txn.status).toBe("UNMATCHED");
    expect(txn.unmatchedNote).toContain("500.000");
    const nk = await nhatKyTuRot();
    expect(nk[0]!.newValues).toMatchObject({ tongRot: TONG, conLai: du, hetPhieu: true });
  });

  it("[PTR-08] CALLBACK LẶP sau khi rót một phần ⇒ DUPLICATE, KHÔNG rót thêm một đồng", async () => {
    const ma = await phatPhieu();
    const id = maTxn();
    const lan1 = await ban({ ma, soTien: TIEN.a + TIEN.b + 1_000_000, txnId: id });
    expect(lan1.status).toBe("MATCHED");
    const truoc = { phanBo: (await phanBoCuaDon()).length, khoan: await db.payment.count({ where: { orderId: DON } }), nk: (await nhatKyTuRot()).length };
    // Giao dịch đang UNMATCHED (còn dư) — đúng hình dạng mà bản KHÔNG có cổng «đã có phân bổ» sẽ rót tiếp phần dư vào khoản c.
    const lan2 = await ban({ ma, soTien: TIEN.a + TIEN.b + 1_000_000, txnId: id });
    expect(lan2.status).toBe("DUPLICATE");
    expect((await phanBoCuaDon()).length).toBe(truoc.phanBo);
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(truoc.khoan);
    expect((await nhatKyTuRot()).length).toBe(truoc.nk);
    expect((await dotCuaDon()).map((d) => d.status)).toEqual(["PAID", "PAID", "PENDING"]);
  });

  it("[PTR-09] HAI CALLBACK CÙNG LÚC của cùng một giao dịch ⇒ rót đúng MỘT lần", async () => {
    const ma = await phatPhieu();
    const id = maTxn();
    const [x, y] = await Promise.all([
      ban({ ma, soTien: TIEN.a + TIEN.b + 1_000_000, txnId: id }),
      ban({ ma, soTien: TIEN.a + TIEN.b + 1_000_000, txnId: id }),
    ]);
    expect([x.status, y.status].sort()).toEqual(["DUPLICATE", "MATCHED"]);
    expect(await phanBoCuaDon()).toHaveLength(2);
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[PTR-10] HAI GIAO DỊCH KHÁC NHAU cùng lúc vào cùng phiếu ⇒ khoá đơn tuần tự hoá: không khoản nào bị rót quá, Σ phân bổ ≤ Σ phải thu", async () => {
    const ma = await phatPhieu();
    const so = TIEN.a + TIEN.b;
    const [x, y] = await Promise.all([ban({ ma, soTien: so }), ban({ ma, soTien: so })]);
    expect([x.status, y.status].every((s) => s === "MATCHED" || s === "UNMATCHED")).toBe(true);
    const dot = await dotCuaDon();
    const pb = await phanBoCuaDon();
    for (const d of dot) {
      const rot = pb.filter((p) => p.paymentRequestId === d.id).reduce((s, p) => s + p.amount, 0);
      expect(rot, `khoản ${d.id} không được rót quá số phải thu`).toBeLessThanOrEqual(d.amountDue);
    }
    // Lượt vào trước rót a+b; lượt sau chỉ còn c (≤ phần còn lại) — cả ba đủ, phần dư (a+b−c) chờ gắn.
    expect(dot.map((d) => d.status)).toEqual(["PAID", "PAID", "PAID"]);
    expect(pb.reduce((s, p) => s + p.amount, 0)).toBe(TONG);
  });

  it("[PTR-11] khoản a ĐÃ có tiền một phần từ đường khác ⇒ chỉ cần phần CÒN THIẾU của a", async () => {
    // Đã rót 1.000.000 vào a bằng giao dịch khác (đường gắn tay trước khi phát phiếu).
    await db.bankTransaction.create({ data: { id: `${T}tx-truoc`, provider: "SEPAY", providerTxnId: `${T}truoc`, amount: 1_000_000, transferredAt: new Date("2026-10-20T03:00:00Z"), status: "MATCHED" } });
    await db.paymentAllocation.create({ data: { bankTransactionId: `${T}tx-truoc`, paymentRequestId: DOT.a, amount: 1_000_000, centerId: CENTER } });
    await db.paymentRequest.update({ where: { id: DOT.a }, data: { status: "PARTIAL" } });
    const ma = await phatPhieu();
    const con = TIEN.a - 1_000_000;
    // Đúng số còn thiếu của a ⇒ a đủ; b, c chưa.
    const kq = await ban({ ma, soTien: con });
    expect(kq.status).toBe("MATCHED");
    expect((await dotCuaDon()).map((d) => d.status)).toEqual(["PAID", "PENDING", "PENDING"]);
  });

  it("[PTR-12] CỜ TẮT ⇒ luật cũ: thiếu là KHÔNG rót gì", async () => {
    await dungFixture({ coBay: false });
    // Cờ tắt thì không phát được phiếu qua action; dựng phiếu bằng cờ BẬT rồi tắt lại — phiếu đã phát phải vẫn khớp (phụ huynh đang giữ tờ QR).
    await datCo(true);
    const ma = await phatPhieu();
    await datCo(false);
    const kq = await ban({ ma, soTien: TIEN.a });
    expect(kq.status).toBe("UNMATCHED");
    expect("reason" in kq && kq.reason).toContain("LECH_SO");
    expect(await phanBoCuaDon()).toHaveLength(0);
  });

  it("[PTR-13] có một dòng ĐỜI CŨ (orderItemId NULL) trong phiếu ⇒ luật cũ, dù cờ BẬT", async () => {
    await dungFixture({ dotCDoiCu: true });
    const ma = await phatPhieu();
    const kq = await ban({ ma, soTien: TIEN.a });
    expect(kq.status).toBe("UNMATCHED");
    expect(await phanBoCuaDon()).toHaveLength(0);
  });

  it("[PTR-14] THẺ POS (provider CARD_POS) ⇒ luật cũ «ăn cả hoặc không ăn gì», dù cờ BẬT và phiếu theo con", async () => {
    const ma = await phatPhieu();
    await db.bankTransaction.create({
      data: { id: `${T}tx-pos`, provider: "CARD_POS", providerTxnId: `${T}pos-1`, amount: TIEN.a, transferredAt: new Date("2026-10-20T03:00:00Z"), status: "UNMATCHED" },
    });
    const kq = await thuTheoPhieuGop({
      bankTransactionId: `${T}tx-pos`,
      provider: "CARD_POS",
      providerTxnId: `${T}pos-1`,
      noiDung: dungMemo({ hoTen: "Bé A PTR", sdt: SDT, ma }),
      soTienVe: TIEN.a,
      ngayThu: new Date("2026-10-20T03:00:00Z"),
    });
    expect(kq.xuLy && kq.ketQua).toBe("CHUA_CHIA");
    expect(await phanBoCuaDon()).toHaveLength(0);
  });

  it("[PTR-15] GẮN PHẦN DƯ: `ganTienTheoCon` chỉ chia PHẦN CÒN LẠI; chia cả số tiền giao dịch bị từ chối", async () => {
    const ma = await phatPhieu();
    const du = 1_000_000;
    await ban({ ma, soTien: TIEN.a + TIEN.b + du });
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: { startsWith: T } } });
    expect(txn.status).toBe("UNMATCHED");

    // Chia CẢ số tiền giao dịch ⇒ từ chối (đếm hai lần phần đã rót).
    const sai = await ganTienTheoCon({
      bankTransactionId: txn.id,
      orderId: DON,
      dong: [{ paymentRequestId: DOT.c, soTien: txn.amount }],
      actor: ACTOR,
      nguoiGan: { loai: "KE_TOAN" },
    });
    expect(sai.ok).toBe(false);

    // Chia đúng phần còn lại cho khoản c ⇒ xong, giao dịch MATCHED.
    const dung = await ganTienTheoCon({
      bankTransactionId: txn.id,
      orderId: DON,
      dong: [{ paymentRequestId: DOT.c, soTien: du }],
      actor: ACTOR,
      nguoiGan: { loai: "KE_TOAN" },
    });
    expect(dung.ok).toBe(true);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("MATCHED");
    // Tổng phân bổ của giao dịch = số tiền giao dịch: không đồng nào bị đếm hai lần.
    const pbTxn = await db.paymentAllocation.findMany({ where: { bankTransactionId: txn.id } });
    expect(pbTxn.reduce((s, p) => s + p.amount, 0)).toBe(txn.amount);
  });

  it("[PTR-16] «Rót vào đơn» (waterfall cả số tiền) bị từ chối trên giao dịch đã rót một phần", async () => {
    const { allocateToOrder } = await import("@/lib/payments/payos-ingest");
    const ma = await phatPhieu();
    await ban({ ma, soTien: TIEN.a + TIEN.b + 1_000_000 });
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: { startsWith: T } } });
    const truoc = (await phanBoCuaDon()).length;
    const order = await db.order.findUniqueOrThrow({ where: { id: DON }, include: { student: { select: { id: true, parentUserId: true } } } });
    const kq = await allocateToOrder({
      bankTransactionId: txn.id,
      order: { ...order, student: order.student } as never,
      amount: txn.amount,
      provider: txn.provider,
      providerTxnId: txn.providerTxnId,
      target: { paymentRequestId: DOT.c, orderId: DON, via: "manual" },
      data: { description: txn.content ?? undefined, amount: txn.amount, reference: txn.providerTxnId },
    });
    expect(kq.status).toBe("DUPLICATE");
    expect((await phanBoCuaDon()).length).toBe(truoc);
  });
});
