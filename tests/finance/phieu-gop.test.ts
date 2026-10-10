// tests/finance/phieu-gop.test.ts — PHIÊN C: phiếu gộp + webhook tự khớp. Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants", một required check)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO ĐI QUA `ingestPayosWebhook` CHỨ KHÔNG GỌI THẲNG `thuTheoPhieuGop`
//
// Thứ phiên này thật sự thêm vào là **một cái móc**: đường phiếu gộp phải được hỏi TRƯỚC mọi
// phép suy đoán của đường cũ. Gọi thẳng `thuTheoPhieuGop` thì hàm ấy xanh trong khi cái móc
// có thể chưa từng được cắm — đúng lớp lỗi mà LƯỚI GHIM MÃ NGUỒN sinh ra để chặn, nhưng ở
// đây ta có cách tốt hơn lưới: đi qua chính cửa mà SePay đi.
//
// Đổi lại, mỗi ca phải dựng đủ `BankTransaction` + nhật ký. Đó là cái giá đúng để trả.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHÔNG THUỘC PHẠM VI BỘ NÀY, nói thẳng để không ai tưởng đã phủ:
//
//   · **Cờ `billing.flexV1Enabled`** — nó gác ở TẦNG ACTION (phát hành phiếu) và ở
//     `memoPhatHanh` (chọn khuôn memo), KHÔNG ở `thuTheoPhieuGop`. Và đó là CHỦ ĐÍCH: một
//     phiếu đã phát khi cờ BẬT phải vẫn khớp được sau khi cờ tắt, vì phụ huynh đang giữ tờ QR
//     ấy. Cờ tắt chỉ làm phiếu MỚI không phát được. `[PG-12]` khoá đúng điều đó.
//   · **Giao diện** (tick đợt → In QR) — `lib/finance/quyen-doi-soat.test.ts`.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  taoPhieuGop,
  huyPhieuGop,
  dongPhieuGop,
  docPhieuGopDangMo,
} from "@/lib/finance/phieu-gop";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { dungMemo } from "@/lib/payments/memo-ck";
import { capPhatSoThuTu, hoanViSoThuTu } from "@/lib/payments/cap-phat-ma";
import { sinhMa } from "@/lib/payments/ma-phieu";
import { docMemo } from "@/lib/payments/memo-ck";
import { chonKhuonMemo } from "@/lib/payments/memo-phat-hanh";

if (!RUN_DB_TESTS) console.warn(`[PG] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pg-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture" };

const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const CENTER = `${T}center`;

/** Số cố ý KHÔNG tròn — fixture tròn trịa là fixture không kiểm được gì. */
const HOC_PHI_A = 6_336_000;
const HOC_PHI_B = 7_128_000;
const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG_PHIEU = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000

const SDT = "0905123456";
const PROVIDER = "SEPAY";

let soLanTxn = 0;
/** Mỗi lượt bắn một `providerTxnId` mới — trừ ca CỐ Ý bắn trùng. */
const maTxn = () => `${T}txn-${++soLanTxn}`;

async function don() {
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: CENTER } });
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  // KHÔNG dọn `IntegrationLog`: nó là sổ append-only, không ca nào đếm nó, và lọc theo JSON
  // (`payload.path`) không nằm trong `IntegrationLogWhereInput` của Prisma. Để lại vài dòng
  // nhật ký trong DB nháp rẻ hơn một câu tra sai kiểu.
}

async function dungFixture() {
  await don();
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture PG", slug: `${T}co-so`, address: "114 Hoàng Diệu" },
  });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269920-000001",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture PG",
      customerPhone: SDT,
      totalAmount: HOC_PHI_A + HOC_PHI_B,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A PG", HOC_PHI_A],
    [B, "Bé B PG", HOC_PHI_B],
  ] as const) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        itemName: ten,
        quantity: 1,
        unitPrice: gia,
        totalPrice: gia,
      },
    });
  }
  // Mỗi bé MỘT đợt đang mở — đúng hình dạng "phụ huynh chuyển một lần cho cả hai con".
  for (const [id, item, tien, thuTu] of [
    [DOT_A, A, DOT_TIEN_A, 1],
    [DOT_B, B, DOT_TIEN_B, 2],
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
      },
    });
  }
}

/** Phát phiếu gộp cho cả hai đợt và trả mã. */
async function phatPhieu() {
  const r = await taoPhieuGop({
    orderId: DON,
    paymentRequestIds: [DOT_A, DOT_B],
    actor: ACTOR,
  });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
  return r;
}

/** Bắn một giao dịch vào đúng cửa mà SePay đi. */
function ban(opts: { noiDung: string; soTien: number; txnId?: string }) {
  return ingestPayosWebhook(
    {
      orderCode: undefined,
      reference: opts.txnId ?? maTxn(),
      paymentLinkId: opts.txnId ?? undefined,
      description: opts.noiDung,
      amount: opts.soTien,
      transactionDateTime: "2699-09-20T03:00:00Z",
      accountNumber: "0123456789",
    } as never,
    PROVIDER,
  );
}

describe.skipIf(!RUN_DB_TESTS)("[PG] phiếu gộp + webhook tự khớp — DB thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[PG-01] fixture + phát phiếu: mã 5 ký tự, tổng = Σ hai đợt", async () => {
    // Ca này kiểm FIXTURE. Thiếu nó thì mọi ca dưới có thể xanh vì không có phiếu nào để
    // khớp, và bộ test vô dụng mà trông vẫn xanh (bài học `[CTD-01]`).
    const r = await phatPhieu();
    expect(r.ok && r.ma).toHaveLength(5);
    expect(r.ok && r.tongTien).toBe(TONG_PHIEU);
    expect(r.ok && r.soDong).toBe(2);

    const bill = await db.paymentBill.findFirstOrThrow({
      where: { orderId: DON },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    expect(bill.status).toBe("OPEN");
    expect(bill.amountDue).toBe(TONG_PHIEU);
    expect(bill.lines.map((l) => l.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
  });

  it("[PG-02] ĐÚNG SỐ ⇒ chia đúng HAI CON, phiếu PAID, giao dịch MATCHED", async () => {
    const { ma } = (await phatPhieu()) as { ma: string };
    const kq = await ban({ noiDung: dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma }), soTien: TONG_PHIEU });
    expect(kq.status).toBe("MATCHED");

    // Ledger-B: mỗi đợt nhận đúng phần của nó.
    const phanBo = await db.paymentAllocation.findMany({
      where: { paymentRequest: { orderId: DON } },
      orderBy: { amount: "asc" },
    });
    expect(phanBo.map((p) => p.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
    expect(phanBo.every((p) => p.roundingWaived === 0), "phiếu gộp KHÔNG có dung sai").toBe(true);

    const dot = await db.paymentRequest.findMany({ where: { orderId: DON }, orderBy: { sortOrder: "asc" } });
    expect(dot.map((d) => d.status)).toEqual(["PAID", "PAID"]);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("PAID");

    // Ledger-A: MỘT dòng mỗi CON, mang `orderItemId` — đây là toàn bộ mục đích của phiên này.
    const khoan = await db.payment.findMany({ where: { orderId: DON }, orderBy: { amount: "asc" } });
    expect(khoan).toHaveLength(2);
    expect(khoan.map((k) => k.orderItemId)).toEqual([A, B]);
    expect(khoan.map((k) => k.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
    expect(khoan.every((k) => k.accountantStatus === "PENDING"), "máy ghi ≠ kế toán xác nhận").toBe(true);
    // Marker — dây DUY NHẤT để `goGanTheoCon` tìm lại dòng gốc khi kế toán gỡ.
    expect(khoan.every((k) => (k.note ?? "").includes("[auto:sepay:"))).toBe(true);
  });

  it("[PG-03] THỪA 1đ ⇒ KHÔNG phân bổ, về UNMATCHED", async () => {
    const { ma } = (await phatPhieu()) as { ma: string };
    const kq = await ban({
      noiDung: dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma }),
      soTien: TONG_PHIEU + 1,
    });
    expect(kq.status).toBe("UNMATCHED");
    expect("reason" in kq && kq.reason).toContain("LECH_SO");
    expect("reason" in kq && kq.reason, "câu lỗi phải nói rõ thừa bao nhiêu").toContain("thừa 1đ");

    expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(0);
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("OPEN");
  });

  it("[PG-04] THIẾU 1đ ⇒ KHÔNG phân bổ, về UNMATCHED", async () => {
    // ⚠️ Đánh đổi CÓ CHỦ ĐÍCH của luật "ăn cả hoặc không ăn gì": thiếu 1đ thì KHÔNG đợt nào
    // được ghi nhận, kế toán hoàn cả khoản. Nghe khắc nghiệt — nhưng nới ra là phải xây lại
    // cả cái đuôi ví gia đình mà `chia-phieu-gop.ts` đã cắt (5 story, 4 bất biến).
    const { ma } = (await phatPhieu()) as { ma: string };
    const kq = await ban({
      noiDung: dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma }),
      soTien: TONG_PHIEU - 1,
    });
    expect(kq.status).toBe("UNMATCHED");
    expect("reason" in kq && kq.reason).toContain("thiếu 1đ");
    expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(0);
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(0);
  });

  it("[PG-05] QUÉT LẠI phiếu đã PAID ⇒ UNMATCHED, và lý do nói ĐÚNG nguyên nhân", async () => {
    const { ma } = (await phatPhieu()) as { ma: string };
    const memo = dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma });
    expect((await ban({ noiDung: memo, soTien: TONG_PHIEU })).status).toBe("MATCHED");

    // Lần hai — giao dịch KHÁC, cùng mã.
    const lai = await ban({ noiDung: memo, soTien: TONG_PHIEU });
    expect(lai.status).toBe("UNMATCHED");
    // ⚠️ Lý do phải là PHIEU_KHONG_MO, KHÔNG phải LECH_SO. Phiếu PAID có "còn phải thu" = 0
    // nên kiểm số trước sẽ báo "lệch số" và kế toán đi tìm một khoản lệch không tồn tại thay
    // vì thấy ngay "khách quét lại QR cũ".
    expect("reason" in lai && lai.reason).toContain("PHIEU_KHONG_MO");
    expect("reason" in lai && lai.reason).toContain("ĐÃ THU ĐỦ");

    // Và tiền KHÔNG bị ghi lần hai.
    expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(2);
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[PG-06] memo có tiền tố ngân hàng `MBVCB.<số>.<số>.` ⇒ vẫn đọc đúng mã", async () => {
    // Ngân hàng chèn số vào nội dung CK. Sau khi parser xoá hết dấu phân cách, mã DÍNH LIỀN
    // vào dãy số ấy — và mỏ neo "ký tự đầu phải là CHỮ CÁI" là thứ giữ cho cửa sổ trượt không
    // cắt trúng dãy số của ngân hàng.
    const { ma } = (await phatPhieu()) as { ma: string };
    const kq = await ban({
      noiDung: `MBVCB.9182736455.1029.CT tu 0905123456 PHUONG ${SDT} ${ma}`,
      soTien: TONG_PHIEU,
    });
    expect(kq.status).toBe("MATCHED");
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[PG-07] memo có tiền tố `IBFT ` ⇒ vẫn đọc đúng mã", async () => {
    const { ma } = (await phatPhieu()) as { ma: string };
    const kq = await ban({ noiDung: `IBFT PHUONG ${SDT} ${ma}`, soTien: TONG_PHIEU });
    expect(kq.status).toBe("MATCHED");
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(2);
  });

  it("[PG-08] BẮN TRÙNG cùng `providerTxnId` ⇒ ghi ĐÚNG MỘT lần", async () => {
    const { ma } = (await phatPhieu()) as { ma: string };
    const memo = dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma });
    const trung = `${T}txn-trung`;

    const lan1 = await ban({ noiDung: memo, soTien: TONG_PHIEU, txnId: trung });
    const lan2 = await ban({ noiDung: memo, soTien: TONG_PHIEU, txnId: trung });
    expect(lan1.status).toBe("MATCHED");
    expect(lan2.status, "lần hai phải là DUPLICATE, không phải MATCHED").toBe("DUPLICATE");

    expect(await db.bankTransaction.count({ where: { providerTxnId: trung } })).toBe(1);
    expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(2);
    expect(await db.payment.count({ where: { orderId: DON } }), "KHÔNG cộng đôi tiền").toBe(2);
  });

  it("[PG-09] mã KHÔNG ra phiếu nào ⇒ NHƯỜNG cho đường cũ, không tự nuốt", async () => {
    // ⚠️ Ca quan trọng nhất của phiên, và là ca dễ làm ngược nhất.
    //
    // Checksum lọc 26/27 khối rác chứ không lọc hết, nên một memo ĐỜI CŨ vẫn có ~1/27 cơ hội
    // chứa một khối 5 ký tự qua checksum. Nếu đường phiếu gộp coi "có mã mà không ra phiếu"
    // là *mã sai ⇒ UNMATCHED* thì ~1/27 giao dịch đời cũ rơi xuống UNMATCHED không lý do, và
    // triệu chứng sẽ trông như "SePay thỉnh thoảng lỗi".
    //
    // Đo bằng cách: KHÔNG phát phiếu nào, bắn một memo mang mã hợp lệ. Kết quả phải là lý do
    // của ĐƯỜNG CŨ ("Không tra ra phiếu thu…"), chứng tỏ đường mới đã nhường.
    // ⚠️ MÃ PHẢI QUA CHECKSUM THẬT. Bản đầu của ca này gõ tay `"ACDEQ"` — một chuỗi KHÔNG
    // qua checksum — nên `docMemo` không nhặt nó, `thuTheoPhieuGop` thoát ở dòng
    // `ungVien.length === 0`, và ca xanh mà chưa từng chạm nhánh cần kiểm. Cấy lỗi "bỏ nhường"
    // vào ngày 20/09 KHÔNG làm nó đỏ — đúng nghĩa tautology.
    //
    // Nay sinh mã bằng chính bộ sinh, rồi KHẲNG ĐỊNH `docMemo` đã nhặt được nó. Khẳng định ấy
    // là thứ giữ cho ca này không âm thầm quay về tautology lần nữa.
    const maLa = sinhMa(hoanViSoThuTu(4_242));
    const noiDung = `PHUONG ${SDT} ${maLa}`;
    expect(
      docMemo(noiDung).ungVien,
      "mã phải qua checksum, nếu không ca này không chạm nhánh cần kiểm",
    ).toContain(maLa);
    expect(
      await db.paymentBill.count({ where: { matchKey: maLa } }),
      "và không phiếu nào được mang mã ấy",
    ).toBe(0);

    const kq = await ban({ noiDung, soTien: TONG_PHIEU });
    expect(kq.status).toBe("UNMATCHED");
    expect(
      "reason" in kq && kq.reason,
      "phải là lý do của ĐƯỜNG CŨ — đường phiếu gộp không được nhận trách nhiệm",
    ).toContain("Không tra ra phiếu thu");
  });

  it("[PG-10] B7 — một đơn chỉ MỘT phiếu OPEN, và DB là thứ gác", async () => {
    await phatPhieu();
    const hai = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(hai.ok).toBe(false);
    expect(!hai.ok && hai.error).toContain("đã có một phiếu gộp đang mở");
    expect(await db.paymentBill.count({ where: { orderId: DON } })).toBe(1);
  });

  // ── 24/09/2026 · QR THEO ĐỢT DÙNG MÃ 5 KÝ TỰ ────────────────────────────────
  //
  // Chủ dự án chốt: nút "Xuất QR" trên MỘT dòng đợt phát một phiếu gộp MỘT DÒNG. Toàn bộ
  // mục đích là để nội dung CK thôi bị cắt cụt — xem `lib/payments/qr-theo-dot.ts`.
  it("[PG-17] phiếu MỘT DÒNG: memo chở đủ SĐT 10 số, và webhook khớp đúng đợt ấy", async () => {
    const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(r.ok && r.soDong).toBe(1);
    expect(r.ok && r.tongTien).toBe(DOT_TIEN_A);
    const ma = (r as { ma: string }).ma;

    // ⭐ ĐIỂM CỦA CẢ ĐỢT NÀY. Khuôn đời CŨ (`noiDungCkCoKhoa`) ở trần 25 ký tự thì khoá
    // `ORD…D1` chiếm 18, phần người đọc còn 7 ⇒ SĐT bị cắt SẠCH. Khuôn mới chở đủ.
    const memo = dungMemo({ hoTen: "Nguyễn Phương Quỳnh Anh", sdt: SDT, ma });
    expect(memo.length).toBeLessThanOrEqual(25);
    expect(memo, "SĐT 10 số phải còn nguyên trong nội dung CK").toContain(SDT);
    expect(memo).toContain(ma);
    // Và nó KHÔNG mang khoá đời cũ — nếu một ngày ai đó ghép cả hai vào thì trần 25 vỡ.
    expect(memo).not.toMatch(/ORD\d/);

    // Tiền về ĐÚNG SỐ của phiếu một dòng ⇒ rót đúng đợt A, đợt B không đụng tới.
    const kq = await ban({ noiDung: memo, soTien: DOT_TIEN_A });
    expect(kq.status).toBe("MATCHED");
    const dot = await db.paymentRequest.findMany({
      where: { orderId: DON },
      orderBy: { sortOrder: "asc" },
    });
    expect(dot.map((d) => d.status)).toEqual(["PAID", "PENDING"]);
  });

  it("[PG-18] phiếu một dòng đang mở ⇒ đợt KHÁC không phát được (B7 chặn ở DB)", async () => {
    // Đây là hệ quả mà màn hình phải NÓI RA thay vì vẽ nút rồi ăn lỗi unique — ca
    // `[QTD-04]` khoá phần hiển thị, ca này khoá phần dữ liệu.
    const r1 = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(r1.ok).toBe(true);
    const r2 = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_B], actor: ACTOR });
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.error).toContain("đã có một phiếu gộp đang mở");
    expect(await db.paymentBill.count({ where: { orderId: DON, status: "OPEN" } })).toBe(1);
  });

  it("[PG-19] mỗi dòng phiếu mang ĐỊNH DANH đợt — cầu nối cho màn hình", async () => {
    // ⚠️ Lưới này sinh ra TỪ MỘT PHÉP CẤY (24/09): đặt `paymentRequestId: ""` ở
    // `docPhieuGopDangMo` thì **18/18 ca vẫn xanh**. Tức cầu nối quan trọng nhất của đợt
    // này không có ai canh.
    //
    // Mất nó là lỗi CÂM đúng hình dạng luật 11: `trangThaiQrDot` không khớp được dòng nào
    // ⇒ MỌI dòng rơi vào nhánh "đợt khác đang giữ mã" ⇒ **không ai xuất được QR nữa**, mà
    // không lỗi nào báo và không ca nào đỏ.
    const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A, DOT_B], actor: ACTOR });
    expect(r.ok).toBe(true);

    const mo = await docPhieuGopDangMo(DON);
    expect(mo, "phiếu vừa phát phải đọc lại được").not.toBeNull();
    expect(mo!.dong).toHaveLength(2);
    // Đúng tập đợt, không phải chuỗi rỗng, không phải id của đơn/phiếu.
    expect(new Set(mo!.dong.map((d) => d.paymentRequestId))).toEqual(new Set([DOT_A, DOT_B]));
    expect(mo!.dong.every((d) => d.paymentRequestId.length > 0)).toBe(true);
    // ⚠️ `installmentNo` đánh số THEO TỪNG CON, không theo đơn — khoá từng phần của DB là
    // `(orderItemId, installmentNo)`. Nên đợt 1 của bé A và đợt 1 của bé B ĐỀU là số 1, và
    // bản đầu của ca này khẳng định `[1, 2]` là SAI GIẢ ĐỊNH chứ không phải mã sai. So với
    // chính bản ghi thay vì đoán con số.
    const dotThat = await db.paymentRequest.findMany({
      where: { id: { in: [DOT_A, DOT_B] } },
      select: { id: true, installmentNo: true },
    });
    const soTheoId = new Map(dotThat.map((d) => [d.id, d.installmentNo]));
    expect(mo!.dong.every((d) => d.installmentNo === soTheoId.get(d.paymentRequestId))).toBe(true);
  });

  it("[PG-20] HUỶ không đòi lý do; ĐÓNG thì vẫn đòi", async () => {
    // Chủ dự án 24/09: *"huỷ phiếu kh cần lý do, chỉ cần xác nhận 1 lần nữa là được"*.
    //
    // ⚠️ Ranh giới KHÔNG tuỳ tiện — nó trùng đúng ranh giới nghiệp vụ đã có: `VOID` chỉ
    // xảy ra khi phiếu CHƯA nhận đồng nào, `CLOSED` chỉ khi ĐÃ nhận. Bỏ lý do ở nhánh có
    // tiền thật là xoá dấu vết đối soát; bắt ghi lý do ở nhánh không có gì để đối soát chỉ
    // tạo thói quen gõ "x" cho xong.
    const r1 = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(r1.ok).toBe(true);
    const huy = await huyPhieuGop({
      orderId: DON,
      billId: (r1 as { billId: string }).billId,
      lyDo: "",
      actor: ACTOR,
    });
    expect(huy.ok, "huỷ KHÔNG cần lý do").toBe(true);
    expect(
      (await db.paymentBill.findUniqueOrThrow({ where: { id: (r1 as { billId: string }).billId } }))
        .status,
    ).toBe("VOID");

    // …nhưng sổ kiểm toán VẪN có `reason` nói rõ, không để trống (ô rỗng đọc như dữ liệu hỏng).
    const log = await db.auditLog.findFirst({
      where: { entityId: DON, action: "PHIEU_GOP_VOID" },
      orderBy: { createdAt: "desc" },
      select: { reason: true },
    });
    expect(log?.reason ?? "").not.toBe("");

    // ĐÓNG: phiếu phải đã nhận tiền, và lý do VẪN bắt buộc.
    const r2 = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
    expect(r2.ok).toBe(true);
    const bill2 = (r2 as { billId: string }).billId;
    const dong = await dongPhieuGop({ orderId: DON, billId: bill2, lyDo: "  ", actor: ACTOR });
    expect(dong.ok, "đóng THIẾU lý do phải bị từ chối").toBe(false);
    expect(!dong.ok && dong.error).toContain("lý do");
  });

  it("[PG-11] HUỶ khi chưa nhận đồng nào; đã nhận rồi thì chỉ ĐÓNG được", async () => {
    const { billId } = (await phatPhieu()) as { billId: string };

    // Chưa nhận đồng nào ⇒ huỷ được, và phát lại được mã mới.
    const huy = await huyPhieuGop({ orderId: DON, billId, lyDo: "fixture: phát nhầm", actor: ACTOR });
    expect(huy.ok).toBe(true);
    expect((await db.paymentBill.findUniqueOrThrow({ where: { id: billId } })).status).toBe("VOID");
    const moi = await phatPhieu();
    expect(moi.ok).toBe(true);
    expect(moi.ok && moi.ma).not.toBe(billId);

    // Cho tiền vào một đợt TỪ ĐƯỜNG KHÁC (kế toán gắn tay) ⇒ phiếu đã nhận một phần.
    const txn = await db.bankTransaction.create({
      data: {
        id: `${T}txn-tay`,
        provider: PROVIDER,
        providerTxnId: `${T}tay`,
        amount: DOT_TIEN_A,
        transferredAt: new Date("2699-09-20T04:00:00Z"),
        status: "MATCHED",
        centerId: CENTER,
      },
    });
    await db.paymentAllocation.create({
      data: { bankTransactionId: txn.id, paymentRequestId: DOT_A, amount: DOT_TIEN_A, centerId: CENTER },
    });

    const billMoi = (moi as { billId: string }).billId;
    const huy2 = await huyPhieuGop({ orderId: DON, billId: billMoi, lyDo: "thử huỷ", actor: ACTOR });
    expect(huy2.ok, "đã nhận tiền thì KHÔNG huỷ được").toBe(false);
    expect(!huy2.ok && huy2.error).toContain("Đóng phiếu");

    const dongLai = await dongPhieuGop({ orderId: DON, billId: billMoi, lyDo: "thu phần còn lại bằng đường khác", actor: ACTOR });
    expect(dongLai.ok).toBe(true);
    expect(dongLai.ok && dongLai.daNhan).toBe(DOT_TIEN_A);
    expect((await db.paymentBill.findUniqueOrThrow({ where: { id: billMoi } })).status).toBe("CLOSED");
  });

  it("[PG-12] CỜ TẮT ⇒ khuôn memo về ĐỜI CŨ; phiếu ĐÃ PHÁT vẫn khớp được", async () => {
    // ⚠️ Hai vế, và vế thứ hai là vế dễ bị gỡ.
    //
    // (a) cờ tắt ⇒ QR mới in khuôn CŨ — `chonKhuonMemo` là chỗ duy nhất quyết định;
    // (b) nhưng phiếu ĐÃ phát khi cờ còn bật thì mã vẫn nằm trong điện thoại phụ huynh, nên
    //     `thuTheoPhieuGop` KHÔNG được hỏi cờ. Hỏi cờ ở đó nghĩa là tắt cờ = mọi tờ QR đã
    //     phát hoá giấy lộn, và tiền về rơi xuống UNMATCHED hàng loạt.
    expect(chonKhuonMemo({ bat: false, maMoi: "ACDEQ" }), "cờ tắt ⇒ khuôn CŨ").toBe("CU");
    expect(chonKhuonMemo({ bat: true, maMoi: null }), "chưa có mã ⇒ khuôn CŨ").toBe("CU");
    expect(chonKhuonMemo({ bat: true, maMoi: "ACDEQ" })).toBe("MOI");

    // Vế (b): phiếu phát rồi vẫn khớp, không phụ thuộc cờ.
    const { ma } = (await phatPhieu()) as { ma: string };
    const kq = await ban({ noiDung: dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma }), soTien: TONG_PHIEU });
    expect(kq.status).toBe("MATCHED");
  });

  it("[PG-13] SEQUENCE không bao giờ cấp lại cùng một số — kể cả khi transaction ROLLBACK", async () => {
    // ⚠️ Đây là lý do dùng SEQUENCE thay vì một bảng đếm. `nextval` KHÔNG theo transaction:
    // rollback thì số đã cấp mất luôn. Mất số là ĐÚNG (mã không tái sử dụng); cấp LẠI mới là
    // lỗi — và một bảng đếm với `UPDATE ... RETURNING` sẽ cấp lại đúng số đó.
    const a = await db.$transaction(async (tx) => capPhatSoThuTu(tx));

    await db
      .$transaction(async (tx) => {
        await capPhatSoThuTu(tx);
        throw new Error("fixture: cố ý rollback");
      })
      .catch(() => undefined);

    const c = await db.$transaction(async (tx) => capPhatSoThuTu(tx));
    expect(c, "số sau rollback phải NHẢY QUA số đã cấp, không cấp lại").toBeGreaterThan(a + 1);
  });

  it("[PG-14] phát phiếu cho đợt của ĐƠN KHÁC / đợt đã PAID ⇒ CHẶN", async () => {
    // Đợt đã PAID không còn gì để thu — gộp nó vào phiếu là in một QR đòi tiền đã đóng.
    await db.paymentRequest.update({ where: { id: DOT_A }, data: { status: "PAID" } });
    const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A, DOT_B], actor: ACTOR });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("PAID");
    expect(await db.paymentBill.count({ where: { orderId: DON } }), "không ghi dòng nào").toBe(0);

    const la = await taoPhieuGop({ orderId: DON, paymentRequestIds: ["khong-ton-tai"], actor: ACTOR });
    expect(la.ok).toBe(false);
    expect(!la.ok && la.error).toContain("không tồn tại");
  });

  it("[PG-15] đợt PARTIAL vào phiếu với phần CÒN THIẾU, không phải trọn `amountDue`", async () => {
    // Đợt đã nhận một phần từ đường khác mà ghi trọn `amountDue` thì QR đòi cả phần đã trả —
    // đúng con bug mà cổng tạo đợt đã phải vá một lần.
    const txn = await db.bankTransaction.create({
      data: {
        id: `${T}txn-phan`,
        provider: PROVIDER,
        providerTxnId: `${T}phan`,
        amount: 1_000_000,
        transferredAt: new Date("2699-09-20T05:00:00Z"),
        status: "MATCHED",
        centerId: CENTER,
      },
    });
    await db.paymentAllocation.create({
      data: { bankTransactionId: txn.id, paymentRequestId: DOT_A, amount: 1_000_000, centerId: CENTER },
    });
    await db.paymentRequest.update({ where: { id: DOT_A }, data: { status: "PARTIAL" } });

    const r = await phatPhieu();
    expect(r.ok && r.tongTien, "phiếu chỉ đòi phần CÒN THIẾU").toBe(TONG_PHIEU - 1_000_000);

    // Và tiền về đúng số mới thì vẫn chia được — đợt A chỉ nhận nốt phần thiếu.
    const kq = await ban({
      noiDung: dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma: (r as { ma: string }).ma }),
      soTien: TONG_PHIEU - 1_000_000,
    });
    expect(kq.status).toBe("MATCHED");
    const khoan = await db.payment.findMany({ where: { orderId: DON }, orderBy: { amount: "asc" } });
    expect(khoan.map((k) => k.amount)).toEqual([DOT_TIEN_A - 1_000_000, DOT_TIEN_B]);
  });

  it("[PG-16] đơn đã HUỶ ⇒ không phát phiếu được, và phiếu cũ cũng không nhận tiền", async () => {
    const { ma } = (await phatPhieu()) as { ma: string };
    await db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });

    const kq = await ban({ noiDung: dungMemo({ hoTen: "Bé A PG", sdt: SDT, ma }), soTien: TONG_PHIEU });
    expect(kq.status).toBe("UNMATCHED");
    expect("reason" in kq && kq.reason).toContain("không nhận tiền được");
    expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(0);
  });
});
