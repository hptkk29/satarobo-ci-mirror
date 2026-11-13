// tests/finance/doi-soat-ngay-thu-db.test.ts — HỒI QUY của đợt ĐỐI SOÁT T9–T10/2026. Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy:  pnpm test:finance-db      (CI: job "Chat DB invariants", một required check)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// ─────────────────────────────────────────────────────────────────────────────
// MỖI CA LÀ MỘT LỖI CÓ THẬT ĐÃ ĐO TRÊN PROD (23–24/10/2026), không phải ca phòng xa
//
//   [DNT-01] gắn tay chuyển khoản ghi ngày thu = LÚC BẤM GẮN — khoản 5.000.000đ của 30/08 nằm trong doanh thu tháng 10.
//   [DNT-02] giao dịch đời cũ lưu lệch +7 giờ (múi giờ tiến trình) bị gắn tay thì ngày thu lệch theo — 7 khoản đổi NGÀY.
//   [DNT-03] gỡ gắn: bút toán ĐẢO ghi ngày bấm gỡ ⇒ tháng gốc giữ +X, tháng bấm mang −X.
//   [DNT-04] tách khoản: đảo ghi `new Date()` trong khi các dòng + mang ngày gốc — T10 âm 5.016.000đ.
//   [DNT-05] tiền ghi vào dòng đơn đang CHÉO ghi danh của bé khác — công nợ hai bé đảo nhau.
//   [DNT-06] ghi nhận thủ công không có khoá chống trùng theo mã giao dịch ngân hàng (khoản 3.920.000đ).
//   [DNT-07] webhook về SAU một khoản đã ghi tay khai đúng mã thì tự rót tiền lần hai.
//   [DNT-08] webhook đọc giờ giao dịch (chuỗi KHÔNG múi giờ) theo múi giờ MÁY.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ganTienTheoCon, goGanTheoCon, tachKhoanChoCon } from "@/lib/finance/ghi-tien-don";
import { CAU_CHEO_HOC_VIEN } from "@/lib/finance/dong-don-ghi-danh";
import { CAU_TRUNG_SO_TIEN_NGAY, recordPayment } from "@/lib/finance/payment";
import { maGiaoDichMarker } from "@/lib/finance/payment-markers";
import { ingestPayosWebhook, TIEN_TO_TRUNG_GHI_TAY } from "@/lib/payments/payos-ingest";

if (!RUN_DB_TESTS) console.warn(`[DNT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-dnt-";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture" };
const PROVIDER = "SEPAY";

/** Đơn HAI bé (luồng theo con): dùng cho gắn tay / gỡ gắn / tách / cheo học viên. */
const DON = `${T}don`;
const AN = `${T}item-an`;
const BINH = `${T}item-binh`;
/** Đơn luồng CŨ (một dòng, đợt `orderItemId` NULL, `matchKey` ở đợt 1): dùng cho ghi tay + webhook. */
const DON_CU = `${T}don-cu`;
const MOI_DON = [DON, DON_CU];
const HV_X = `${T}hv-x`;
const HV_Y = `${T}hv-y`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const GHI_DANH_X = `${T}gd-x`;
const MA_KHOP = "DNTKEY001";

async function don() {
  await db.paymentAllocation.deleteMany({ where: { OR: [{ bankTransaction: { providerTxnId: { startsWith: T } } }, { bankTransaction: { providerTxnId: { startsWith: "FT2699DNT" } } }, { paymentRequest: { orderId: { in: MOI_DON } } }] } });
  await db.creditBalance.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.payment.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.bankTransaction.deleteMany({ where: { OR: [{ providerTxnId: { startsWith: T } }, { providerTxnId: { startsWith: "FT2699DNT" } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: MOI_DON } } });
  await db.order.deleteMany({ where: { id: { in: MOI_DON } } });
  await db.enrollment.deleteMany({ where: { id: GHI_DANH_X } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HV_X, HV_Y] } } });
}

/** Đơn HAI bé, mỗi bé 4.000.000đ và một đợt 4.000.000đ đang mở. */
async function dungDon(opts: { cheo?: boolean } = {}) {
  await don();
  if (opts.cheo) {
    await db.student.create({ data: { id: HV_X, name: "Bé X DNT" } });
    await db.student.create({ data: { id: HV_Y, name: "Bé Y DNT" } });
    await db.course.create({ data: { id: KHOA, name: "Sata 3 DNT", slug: `${T}sata-3` } });
    await db.class.create({ data: { id: LOP, name: "Lớp DNT", courseId: KHOA } });
    await db.enrollment.create({ data: { id: GHI_DANH_X, studentId: HV_X, classId: LOP, courseId: KHOA } });
  }
  await db.order.create({
    data: { id: DON, code: "ORD-269903-000001", type: "COURSE", status: "PENDING_PAYMENT", customerName: "Phụ huynh DNT", customerPhone: "0999000333", totalAmount: 8_000_000 },
  });
  for (const [id, ten] of [[AN, "Bé An DNT"], [BINH, "Bé Bình DNT"]] as const) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        itemName: ten,
        quantity: 1,
        unitPrice: 4_000_000,
        totalPrice: 4_000_000,
        // Ca CHÉO: dòng An thuộc bé Y nhưng trỏ vào ghi danh của bé X (đúng hình dạng ca thật).
        ...(opts.cheo && id === AN ? { studentId: HV_Y, enrollmentId: GHI_DANH_X } : {}),
      },
    });
    await db.paymentRequest.create({
      data: { id: `${id}-pr1`, orderId: DON, orderItemId: id, installmentNo: 1, amountDue: 4_000_000, status: "PENDING", sortOrder: 1 },
    });
  }
}

/** Đơn luồng cũ: đợt 1 = 4.000.000 (mang `matchKey`), đợt 2 = 4.000.000 còn mở ⇒ đơn KHÔNG tất toán, không kéo side-effect chốt đơn. */
async function dungDonCu() {
  await don();
  await db.order.create({
    data: { id: DON_CU, code: "ORD-269903-000002", type: "COURSE", status: "PENDING_PAYMENT", customerName: "Phụ huynh DNT cũ", customerPhone: "0999000335", totalAmount: 8_000_000 },
  });
  await db.orderItem.create({
    data: { id: `${DON_CU}-item`, orderId: DON_CU, type: "COURSE_ENROLLMENT", itemName: "Bé cũ DNT", quantity: 1, unitPrice: 8_000_000, totalPrice: 8_000_000 },
  });
  for (const [i, matchKey] of [[1, MA_KHOP], [2, null]] as const) {
    await db.paymentRequest.create({
      data: { id: `${DON_CU}-dot${i}`, orderId: DON_CU, orderItemId: null, installmentNo: i, amountDue: 4_000_000, status: "PENDING", sortOrder: i, matchKey },
    });
  }
}

async function dungGiaoDich(id: string, tuyChon: { transferredAt: Date; createdAt?: Date }) {
  await db.bankTransaction.create({
    data: {
      id: `${T}${id}`,
      provider: PROVIDER,
      providerTxnId: `${T}${id}`,
      amount: 4_000_000,
      transferredAt: tuyChon.transferredAt,
      ...(tuyChon.createdAt ? { createdAt: tuyChon.createdAt } : {}),
      status: "UNMATCHED",
      content: "PH CHUYEN HOC PHI",
    },
  });
}

const ganAn = (txn: string) =>
  ganTienTheoCon({
    bankTransactionId: `${T}${txn}`,
    orderId: DON,
    dong: [{ paymentRequestId: `${AN}-pr1`, soTien: 4_000_000 }],
    actor: ACTOR,
    nguoiGan: { loai: "KE_TOAN" },
  });

const tienVe = (reference: string, gio: string) => ({
  reference,
  description: `${MA_KHOP} HOC PHI`,
  amount: 4_000_000,
  transactionDateTime: gio,
  accountNumber: "9999000000001",
});

describe.skipIf(!RUN_DB_TESTS)("[DNT] đối soát ngày thu — gắn tay · gỡ gắn · tách · cheo học viên", () => {
  beforeEach(() => dungDon());
  afterAll(don);

  it("[DNT-01] gắn tay chuyển khoản ⇒ `paidDate` = GIỜ NGÂN HÀNG, không phải lúc bấm gắn", async () => {
    // Khoản tháng 8 gắn tay vào tháng 10: giao dịch 30/08 12:03 UTC, bấm gắn hôm nay.
    const gioNganHang = new Date("2026-08-30T12:03:00.000Z");
    await dungGiaoDich("txn1", { transferredAt: gioNganHang, createdAt: new Date("2026-08-30T12:03:17.000Z") });
    const r = await ganAn("txn1");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const khoan = await db.payment.findFirstOrThrow({ where: { orderId: DON, deletedAt: null, paymentType: "PAYMENT" } });
    expect(khoan.paidDate.toISOString()).toBe(gioNganHang.toISOString());
    expect(khoan.paidDate.getTime(), "không được là 'bây giờ'").toBeLessThan(Date.now() - 30 * 24 * 3600_000);
  });

  it("[DNT-02] giao dịch đời cũ LƯU LỆCH +7h ⇒ gắn tay vẫn ra đúng giờ ngân hàng (và đúng NGÀY)", async () => {
    // Nguyễn Công Hoàng Khải: lưu 04/09 03:11 giờ VN, webhook thực tế đến 20:11 giờ VN ngày 03/09.
    await dungGiaoDich("txn2", { transferredAt: new Date("2026-09-03T20:11:00.000Z"), createdAt: new Date("2026-09-03T13:11:44.000Z") });
    const r = await ganAn("txn2");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const khoan = await db.payment.findFirstOrThrow({ where: { orderId: DON, deletedAt: null, paymentType: "PAYMENT" } });
    expect(khoan.paidDate.toISOString(), "20:11 giờ VN ngày 03/09 — Sale ghi 03/09 là ĐÚNG").toBe("2026-09-03T13:11:00.000Z");
  });

  it("[DNT-03] gỡ gắn ⇒ bút toán ĐẢO KẾ THỪA ngày thu gốc (tháng gốc về 0, tháng bấm không mang −X)", async () => {
    await dungGiaoDich("txn3", { transferredAt: new Date("2026-08-30T12:03:00.000Z"), createdAt: new Date("2026-08-30T12:03:17.000Z") });
    expect((await ganAn("txn3")).ok).toBe(true);
    const r = await goGanTheoCon({ bankTransactionId: `${T}txn3`, orderId: DON, lyDo: "Gắn nhầm sang đơn của bé khác", actor: ACTOR });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const goc = await db.payment.findFirstOrThrow({ where: { orderId: DON, paymentType: "PAYMENT", deletedAt: null } });
    const dao = await db.payment.findFirstOrThrow({ where: { orderId: DON, paymentType: "ADJUSTMENT", adjustmentOfId: goc.id, deletedAt: null } });
    expect(dao.amount).toBe(-goc.amount);
    expect(dao.paidDate.toISOString(), "đảo mang đúng ngày của gốc").toBe(goc.paidDate.toISOString());
    const theoThang = await db.$queryRaw<{ thang: string; tien: bigint }[]>`
      SELECT to_char("paidDate" AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') thang, sum(amount)::bigint tien
      FROM "Payment" WHERE "orderId" = ${DON} AND "deletedAt" IS NULL GROUP BY 1`;
    expect(theoThang.map((x) => [x.thang, Number(x.tien)])).toEqual([["2026-08", 0]]);
  });

  it("[DNT-04] tách khoản ⇒ đảo VÀ các dòng + đều mang ngày thu của khoản gốc (ca thật T10)", async () => {
    const ngayGoc = new Date("2026-09-04T16:26:00.000Z");
    await db.payment.create({
      data: { id: `${T}pay-goc`, orderId: DON, amount: 5_016_000, method: "sepay", paidDate: ngayGoc, note: "gắn tay", saleStatus: "RECORDED", accountantStatus: "PENDING" },
    });
    const r = await tachKhoanChoCon({
      orderId: DON,
      paymentId: `${T}pay-goc`,
      actor: ACTOR,
      phan: [
        { orderItemId: AN, soTien: 2_640_000 },
        { orderItemId: BINH, soTien: 2_376_000 },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const khoan = await db.payment.findMany({ where: { orderId: DON, deletedAt: null }, select: { paymentType: true, amount: true, paidDate: true } });
    expect(khoan, "gốc + đảo + hai phần").toHaveLength(4);
    for (const k of khoan) expect(k.paidDate.toISOString(), `${k.paymentType} ${k.amount}`).toBe(ngayGoc.toISOString());
    expect(khoan.find((k) => k.paymentType === "ADJUSTMENT")?.amount).toBe(-5_016_000);
    // Tổng theo tháng sau tách = đúng 5.016.000 trong tháng GỐC — không còn một nửa trôi sang tháng sau.
    const theoThang = await db.$queryRaw<{ thang: string; tien: bigint }[]>`
      SELECT to_char("paidDate" AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') thang, sum(amount)::bigint tien
      FROM "Payment" WHERE "orderId" = ${DON} AND "deletedAt" IS NULL GROUP BY 1`;
    expect(theoThang.map((x) => [x.thang, Number(x.tien)])).toEqual([["2026-09", 5_016_000]]);
  });

  it("[DNT-05] tiền KHÔNG ghi vào dòng đơn đang CHÉO ghi danh học viên khác — gắn tay VÀ tách đều bị chặn TRƯỚC khi ghi gì", async () => {
    await dungDon({ cheo: true });
    await dungGiaoDich("txn5", { transferredAt: new Date("2026-10-06T09:03:00.000Z"), createdAt: new Date("2026-10-06T09:03:40.000Z") });
    const gan = await ganAn("txn5");
    expect(gan.ok).toBe(false);
    expect(!gan.ok && gan.error).toBe(CAU_CHEO_HOC_VIEN);
    expect(await db.payment.count({ where: { orderId: DON } }), "không ghi một dòng Payment nào").toBe(0);
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: `${T}txn5` } }), "không rót phân bổ").toBe(0);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: `${T}txn5` } })).status, "giao dịch vẫn chờ").toBe("UNMATCHED");

    await db.payment.create({
      data: { id: `${T}pay-goc5`, orderId: DON, amount: 4_000_000, method: "sepay", paidDate: new Date("2026-10-06T09:03:00.000Z"), saleStatus: "RECORDED", accountantStatus: "PENDING" },
    });
    const tach = await tachKhoanChoCon({
      orderId: DON,
      paymentId: `${T}pay-goc5`,
      actor: ACTOR,
      phan: [
        { orderItemId: AN, soTien: 2_000_000 },
        { orderItemId: BINH, soTien: 2_000_000 },
      ],
    });
    expect(tach.ok).toBe(false);
    expect(!tach.ok && tach.error).toBe(CAU_CHEO_HOC_VIEN);
    expect(await db.payment.count({ where: { orderId: DON } }), "chỉ còn đúng dòng gốc, không có đảo/phần nào").toBe(1);
  });

  it("[DNT-05b] ĐỐI CHỨNG DƯƠNG: dòng khớp ghi danh (cùng học viên) thì gắn tay chạy bình thường — cổng không chặn oan", async () => {
    await dungDon({ cheo: true });
    await db.orderItem.update({ where: { id: AN }, data: { studentId: HV_X } }); // đúng bé của ghi danh
    await dungGiaoDich("txn5b", { transferredAt: new Date("2026-10-06T09:03:00.000Z"), createdAt: new Date("2026-10-06T09:03:40.000Z") });
    const gan = await ganAn("txn5b");
    expect(gan.ok, JSON.stringify(gan)).toBe(true);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[DNT] ghi nhận thủ công ↔ webhook — chống trùng + giờ ngân hàng", () => {
  beforeEach(() => dungDonCu());
  afterAll(don);

  const co = () => ({ orderId: DON_CU, amount: 3_920_000, method: "backfill", paidDate: new Date("2026-10-04T00:00:00.000Z"), recordedById: `${T}nguoi`, centerId: null });

  it("[DNT-06] khai mã giao dịch ⇒ ghi marker; cùng mã lần hai ⇒ TỪ CHỐI; mã đã nằm trong Biến động số dư ⇒ TỪ CHỐI", async () => {
    const a = await recordPayment({ ...co(), maGiaoDichNganHang: "FT2699DNT00001" });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    const khoan = await db.payment.findFirstOrThrow({ where: { orderId: DON_CU, deletedAt: null } });
    expect(khoan.note).toContain(maGiaoDichMarker("FT2699DNT00001"));

    const b = await recordPayment({ ...co(), maGiaoDichNganHang: "FT2699DNT00001" });
    expect(b.ok).toBe(false);
    expect(!b.ok && b.error).toMatch(/đã được ghi nhận/);

    await db.bankTransaction.create({
      data: { id: `${T}ma2`, provider: PROVIDER, providerTxnId: "FT2699DNT00002", amount: 3_920_000, transferredAt: new Date("2026-10-04T05:00:00.000Z"), status: "UNMATCHED" },
    });
    const c = await recordPayment({ ...co(), maGiaoDichNganHang: "FT2699DNT00002" });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.error).toMatch(/ĐÃ có trong Biến động số dư/);
    expect(await db.payment.count({ where: { orderId: DON_CU, deletedAt: null } }), "chỉ khoản đầu").toBe(1);
  });

  it("[DNT-06b] không khai mã: cổng cùng-số-tiền-cùng-ngày chặn khoản thứ hai, nút 'không phải khoản trùng' mở lại; thư viện KHÔNG bật cổng mặc định", async () => {
    const d = await recordPayment({ ...co(), chanTrungCungSoTienNgay: true });
    expect(d.ok, JSON.stringify(d)).toBe(true);
    const d2 = await recordPayment({ ...co(), chanTrungCungSoTienNgay: true });
    expect(d2.ok).toBe(false);
    expect(!d2.ok && d2.error).toBe(CAU_TRUNG_SO_TIEN_NGAY);
    const d3 = await recordPayment({ ...co(), chanTrungCungSoTienNgay: false });
    expect(d3.ok, "đã xác nhận không phải khoản trùng ⇒ cho ghi").toBe(true);
    const d4 = await recordPayment({ ...co() });
    expect(d4.ok, "các đường gọi khác (script, ghi bù) cố ý ghi nhiều khoản giống nhau").toBe(true);
  });

  it("[DNT-07] webhook về SAU một khoản ghi tay đã khai đúng mã ⇒ KHÔNG tự rót; nằm hàng chờ với lý do 'TRÙNG NGHI VẤN'", async () => {
    // Đối chứng ÂM TRƯỚC: mã KHÁC (chưa ai ghi tay) ⇒ cùng nội dung webhook khớp phiếu và rót bình thường.
    const dc = await ingestPayosWebhook(tienVe("FT2699DNT00006", "2026-10-04 09:30:00"), PROVIDER);
    expect(dc.status, "đối chứng: không có khoản ghi tay thì phải MATCHED").toBe("MATCHED");

    await dungDonCu(); // dựng lại đơn sạch (xoá tiền của ca đối chứng)
    const ma = "FT2699DNT00007";
    const ghi = await recordPayment({ ...co(), amount: 4_000_000, maGiaoDichNganHang: ma });
    expect(ghi.ok, JSON.stringify(ghi)).toBe(true);
    const kq = await ingestPayosWebhook(tienVe(ma, "2026-10-04 09:30:00"), PROVIDER);
    expect(kq.status).toBe("UNMATCHED");
    expect(kq.status === "UNMATCHED" && kq.reason.startsWith(TIEN_TO_TRUNG_GHI_TAY)).toBe(true);
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: ma } });
    expect(txn.status).toBe("UNMATCHED");
    expect(txn.unmatchedNote?.startsWith(TIEN_TO_TRUNG_GHI_TAY)).toBe(true);
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: txn.id } }), "không rót phân bổ").toBe(0);
    expect(await db.payment.count({ where: { orderId: DON_CU, deletedAt: null } }), "vẫn đúng MỘT khoản (khoản ghi tay)").toBe(1);
    // Gửi lại lần hai vẫn không rót.
    const lai = await ingestPayosWebhook(tienVe(ma, "2026-10-04 09:30:00"), PROVIDER);
    expect(["UNMATCHED", "DUPLICATE"]).toContain(lai.status);
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: txn.id } })).toBe(0);
  });

  it("[DNT-08] webhook: chuỗi giờ KHÔNG múi giờ là giờ VIỆT NAM — `transferredAt` và `paidDate` không lệch theo múi giờ máy", async () => {
    const kq = await ingestPayosWebhook(tienVe("FT2699DNT00008", "2026-09-08 22:53:00"), PROVIDER);
    expect(kq.status).toBe("MATCHED");
    const txn = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: "FT2699DNT00008" } });
    expect(txn.transferredAt.toISOString(), "22:53 giờ VN = 15:53Z").toBe("2026-09-08T15:53:00.000Z");
    const khoan = await db.payment.findFirstOrThrow({ where: { orderId: DON_CU, deletedAt: null } });
    expect(khoan.paidDate.toISOString()).toBe("2026-09-08T15:53:00.000Z");
  });
});
