// tests/finance/pos-no-so-tien.test.ts — BA NỢ SỔ TIỀN của thẻ POS + gỡ gắn. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// `pnpm test:unit` trần sẽ SKIP. Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo
// tiền tố id — cùng khuôn `tests/finance/pos-the.test.ts`.
//
// Ba nợ đã ghi ở `docs/pos-the-smartpos.md` mục "Nợ còn lại":
//
//   NỢ 1 [PNS-0x] — "Phiếu gộp vẫn PAID sau gỡ gắn" (nợ CÓ SẴN của `goGanTheoCon`, không riêng
//         POS). Gỡ gắn giao dịch đã trả phiếu gộp ⇒ phân bổ bị xoá, đợt về PENDING, nhưng phiếu
//         ở lại PAID ⇒ khách quét lại CÙNG mã với ĐÚNG số thì bị từ chối "ĐÃ THU ĐỦ".
//   NỢ 2 [PNS-1x] — gỡ gắn một giao dịch thẻ mà gốc ĐÃ BIẾT bị hủy toàn phần / chặn hoàn một phần
//         ⇒ giao dịch về hàng chờ UNMATCHED (đủ số GỘP, gắn tay lại được) tới lượt import sau.
//   NỢ 3 [PNS-2x] — dòng GỐC được cập nhật từ một dòng hủy (gốc không nằm trong lô) không nhận
//         cơ sở theo máy ⇒ NULL cơ sở mãi (NULL_IS_GLOBAL — mọi cơ sở đọc được).
//
// Đi qua ĐÚNG cửa của đời thật: SePay qua `ingestPayosWebhook`, thẻ qua `nhapLoPos`, gỡ gắn qua
// `goGanTheoCon`, đóng cảnh báo qua `dongCanhBaoHuyPos`. Test KHÔNG import helper mới của bản vá
// — trước bản vá cả tệp vẫn nạp được và từng ca đỏ ĐÚNG chỗ của nó (test đỏ trước khi vá).
//
// Fixture số KHÔNG tròn, HAI con (một phiếu gộp ⇒ hai dòng `Payment`).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docPhieuGopDangMo, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { ganTienTheoCon, goGanTheoCon } from "@/lib/finance/ghi-tien-don";
import { noTheoCon } from "@/lib/finance/debt";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { dungMemo } from "@/lib/payments/memo-ck";
import { dongCanhBaoHuyPos } from "@/lib/payments/pos/dong-canh-bao-pos";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import type { DongHuyPos, DongPos } from "@/lib/payments/pos/kieu";
import { DUOI_CHAN_HOAN_MOT_PHAN, loaiCanhBaoPos } from "@/lib/payments/pos/phan-loai-pos";

if (!RUN_DB_TESTS) console.warn(`[PNS] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-posno-";
/** `maGiaoDich` / `maThietBi` chỉ nhận chữ/số ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOSNO";
const ACTOR = { id: `${T}actor`, name: "Kế toán fixture nợ sổ tiền" };

const USER = `${T}user`;
const CENTER = `${T}center`;
const CENTER2 = `${T}center2`;
/** OrgUnit của CENTER — id CỐ ĐỊNH: cache ghi kép (`centerToOrgUnit`) giữ kết quả theo tiến trình. */
const OU_CENTER = `${T}ou-center`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const MAY = `${PFX}MAY01`;

const HOC_PHI_A = 6_336_000;
const HOC_PHI_B = 7_128_000;
const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000
const SDT = "0905333777";
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
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: PFX } } });
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.orgUnit.deleteMany({ where: { id: OU_CENTER } });
  await db.center.deleteMany({ where: { id: { in: [CENTER, CENTER2] } } });
  await db.user.deleteMany({ where: { id: USER } });
}

async function dungFixture() {
  await don();
  await db.user.create({
    data: { id: USER, name: "Kế toán HO fixture PNS", email: `${USER}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] },
  });
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture PNS", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" },
  });
  await db.orgUnit.create({
    data: { id: OU_CENTER, type: "CENTER", code: `${PFX}OU`, name: "Đơn vị fixture PNS", centerId: CENTER, path: "/fxposno-ou/", depth: 0 },
  });
  await db.posTerminal.create({ data: { maThietBi: MAY, maQuay: "Q1", centerId: CENTER } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269930-000911",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture PNS",
      customerPhone: SDT,
      totalAmount: HOC_PHI_A + HOC_PHI_B,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A PNS", HOC_PHI_A],
    [B, "Bé B PNS", HOC_PHI_B],
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

async function phatPhieu(ids: string[] = [DOT_A, DOT_B]): Promise<{ ma: string; billId: string }> {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
  return { ma: r.ma, billId: r.billId };
}

const memo = (ma: string) => dungMemo({ hoTen: "Bé A PNS", sdt: SDT, ma });

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
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture-pns.xlsx", importedById: USER } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: dongHuyCuaFile.map(tom), nguoiNhapId: USER });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  return kq;
}

const posRow = (ma: string) =>
  db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: ma }, include: { bankTransaction: true } });
const phieu = (billId: string) => db.paymentBill.findUniqueOrThrow({ where: { id: billId } });
const trangThaiDot = async () =>
  (await db.paymentRequest.findMany({ where: { orderId: DON }, orderBy: { sortOrder: "asc" }, select: { status: true } })).map(
    (d) => d.status,
  );
const tongPaymentDon = async () =>
  (await db.payment.aggregate({ where: { orderId: DON, deletedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0;
const tongPhanBoDon = async () =>
  (await db.paymentAllocation.aggregate({ where: { paymentRequest: { orderId: DON } }, _sum: { amount: true } }))._sum
    .amount ?? 0;
const tongPhanBoGd = async (bankTransactionId: string) =>
  (await db.paymentAllocation.aggregate({ where: { bankTransactionId }, _sum: { amount: true } }))._sum.amount ?? 0;
const tongPhanBoDot = async (paymentRequestId: string) =>
  (await db.paymentAllocation.aggregate({ where: { paymentRequestId }, _sum: { amount: true } }))._sum.amount ?? 0;

/** Gắn tay (đường B của màn biến động) một giao dịch SePay dựng sẵn vào các đợt. */
async function ganTaySepay(soTien: number, dongChia: { paymentRequestId: string; soTien: number }[]): Promise<string> {
  const bt = await db.bankTransaction.create({
    data: {
      provider: "SEPAY",
      providerTxnId: maSepay(),
      amount: soTien,
      transferredAt: new Date("2026-09-20T02:00:00Z"),
      content: "PH chuyen khoan khong ghi ma",
      status: "UNMATCHED",
    },
  });
  const r = await ganTienTheoCon({ bankTransactionId: bt.id, orderId: DON, dong: dongChia, actor: ACTOR, nguoiGan: { loai: "KE_TOAN" } });
  if (!r.ok) throw new Error(`fixture: gắn tay lỗi — ${r.error}`);
  return bt.id;
}

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN_DB_TESTS)("[PNS] nợ sổ tiền: phiếu gộp sau gỡ gắn · thẻ đã hủy khi gỡ gắn · cơ sở của gốc", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // ═════════════════════════════════════════════════════════════════════════
  // NỢ 1 — PHIẾU GỘP SAU GỠ GẮN
  // ═════════════════════════════════════════════════════════════════════════

  it("[PNS-01] SePay: phiếu PAID → gỡ gắn ⇒ phiếu MỞ LẠI; quét lại CÙNG mã đúng số ⇒ tự khớp lần hai, công nợ đúng", async () => {
    const { ma, billId } = await phatPhieu();
    const t1 = maSepay();
    expect((await banSepay(memo(ma), TONG, t1)).status, "đối chứng fixture: lượt đầu tự khớp").toBe("MATCHED");
    expect((await phieu(billId)).status).toBe("PAID");

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "khớp nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);

    // Mã cũ dùng lại được: phiếu OPEN, và số in lên QR = trọn số còn phải thu của phiếu.
    expect((await phieu(billId)).status, "phiếu phải MỞ LẠI sau gỡ gắn").toBe("OPEN");
    const mo = await docPhieuGopDangMo(DON);
    expect(mo?.ma).toBe(ma);
    expect(mo?.tongTien).toBe(TONG);
    expect(await trangThaiDot()).toEqual(["PENDING", "PENDING"]);
    // Giao dịch SePay không có nhánh thẻ: về hàng chờ như cũ, giữ lý do gỡ.
    const bt1 = await btSepay(t1);
    expect(bt1.status).toBe("UNMATCHED");
    expect(bt1.unmatchedNote).toBe("Đã gỡ gắn: khớp nhầm");
    expect(
      await db.auditLog.count({ where: { entityType: "Order", entityId: DON, action: "PHIEU_GOP_MO_LAI" } }),
      "mở lại phải có nhật ký",
    ).toBe(1);

    // Khách chuyển lại CÙNG mã, ĐÚNG số ⇒ khớp lần hai.
    const t2 = maSepay();
    expect((await banSepay(memo(ma), TONG, t2)).status).toBe("MATCHED");
    expect((await phieu(billId)).status).toBe("PAID");
    expect(await tongPhanBoGd((await btSepay(t2)).id)).toBe(TONG);
    expect(await trangThaiDot()).toEqual(["PAID", "PAID"]);

    // Công nợ: mỗi bé đã về ĐÚNG phần của mình, KHÔNG đếm đôi lượt đã gỡ.
    const so = await noTheoCon(DON);
    expect(so.tongDaVe).toBe(TONG);
    expect(so.con.find((c) => c.orderItemId === A)?.daVe).toBe(DOT_TIEN_A);
    expect(so.con.find((c) => c.orderItemId === B)?.daVe).toBe(DOT_TIEN_B);
    expect(await tongPaymentDon(), "sổ A = sổ B").toBe(await tongPhanBoDon());
  });

  // ĐỔI VÌ Q-M (chủ dự án chốt 30/09/2026 — "gỡ gắn giao dịch THẺ luôn ĐÓNG phiếu gộp"): bản cũ ghim
  // "thẻ chưa có tín hiệu ⇒ phiếu MỞ LẠI; quẹt lại cùng mã ⇒ TU_KHOP". Nay phiếu ĐÓNG; quẹt lại mã cũ
  // ⇒ CAN_XU_LY; phát mã mới ⇒ quẹt mã mới TU_KHOP. Phần "dòng cũ KHÔNG tự khớp lại" giữ nguyên.
  it("[PNS-02] thẻ POS: TU_KHOP → gỡ gắn ⇒ phiếu ĐÓNG (Q-M); quẹt lại mã cũ ⇒ CAN_XU_LY, mã mới ⇒ TU_KHOP; dòng cũ KHÔNG tự khớp lại", async () => {
    const { ma, billId } = await phatPhieu();
    const m1 = maGd();
    await lo([dong({ maGiaoDich: m1, dienGiai: `Be A ${SDT} ${ma}` })]);
    const r1 = await posRow(m1);
    expect(r1.matchStatus, "đối chứng fixture").toBe("TU_KHOP");
    expect((await phieu(billId)).status).toBe("PAID");

    const go = await goGanTheoCon({ bankTransactionId: r1.bankTransactionId!, orderId: DON, lyDo: "quẹt nhầm đơn", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(billId)).status, "Q-M: thẻ luôn ĐÓNG, không mở lại").toBe("CLOSED");

    const m2 = maGd();
    const kq = await lo([dong({ maGiaoDich: m2, dienGiai: `Be A ${SDT} ${ma}` })]);
    expect(kq).toMatchObject({ moi: 1, tuKhop: 0, canXuLy: 1 });
    expect((await posRow(m2)).matchStatus, "mã cũ không thu nữa").toBe("CAN_XU_LY");
    const moi = await phatPhieu();
    const m3 = maGd();
    expect(await lo([dong({ maGiaoDich: m3, dienGiai: `Be A ${SDT} ${moi.ma}` })])).toMatchObject({ moi: 1, tuKhop: 1, canXuLy: 0 });
    expect((await phieu(moi.billId)).status).toBe("PAID");

    // Import lại dòng ĐÃ GỠ: nhánh "đã gỡ gắn" giữ nguyên quyết định của kế toán.
    await lo([dong({ maGiaoDich: m1, dienGiai: `Be A ${SDT} ${ma}`, maHachToan: "HT30" })]);
    const r1b = await posRow(m1);
    expect(r1b.bankTransaction?.status).toBe("UNMATCHED");
    expect(r1b.bankTransaction?.unmatchedNote).toBe("Đã gỡ gắn: quẹt nhầm đơn");
    expect(await tongPhanBoGd(r1.bankTransactionId!)).toBe(0);

    expect(await tongPaymentDon()).toBe(TONG);
    expect(await tongPaymentDon(), "sổ A = sổ B").toBe(await tongPhanBoDon());
  });

  it("[PNS-03] đơn ĐÃ có phiếu OPEN khác ⇒ KHÔNG mở lại (chỉ mục từng phần) — phiếu cũ ĐÓNG, tiền về theo mã cũ KHÔNG tự khớp", async () => {
    const p1 = await phatPhieu([DOT_A]);
    const t1 = maSepay();
    expect((await banSepay(memo(p1.ma), DOT_TIEN_A, t1)).status).toBe("MATCHED");
    expect((await phieu(p1.billId)).status).toBe("PAID");
    const p2 = await phatPhieu([DOT_B]);
    expect((await phieu(p2.billId)).status, "đối chứng fixture: phiếu thứ hai đang mở").toBe("OPEN");

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "đối soát lại", actor: ACTOR });
    expect(go.ok, "gỡ gắn KHÔNG được vỡ vì chỉ mục một-phiếu-mở").toBe(true);
    expect((await phieu(p1.billId)).status, "PAID là nói dối (đợt đã về PENDING)").toBe("CLOSED");
    expect((await phieu(p2.billId)).status).toBe("OPEN");
    expect(await db.paymentBill.count({ where: { orderId: DON, status: "OPEN" } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityType: "Order", entityId: DON, action: "PHIEU_GOP_CLOSED" } }),
    ).toBe(1);

    // Khách quét lại mã CŨ đúng số ⇒ KHÔNG tự khớp, lý do nói ĐÚNG nguyên nhân (đã đóng, không phải
    // "đã thu đủ" — câu đó mời kế toán hoàn nhầm một khoản mà đợt vẫn đang nợ).
    const lai = await banSepay(memo(p1.ma), DOT_TIEN_A);
    expect(lai.status).toBe("UNMATCHED");
    expect("reason" in lai && lai.reason).toContain("PHIEU_KHONG_MO");
    expect("reason" in lai && lai.reason).toContain("ĐÃ ĐÓNG");
    expect(await tongPhanBoDot(DOT_A)).toBe(0);
    expect(await tongPaymentDon(), "sổ A = sổ B").toBe(await tongPhanBoDon());
  });

  it("[PNS-04] phiếu NHIỀU dòng, đợt A đã nhận một phần TỪ ĐƯỜNG KHÁC ⇒ mở lại đúng phần còn thiếu; lệch 1đ vẫn bị từ chối", async () => {
    // X gắn tay 1.000.000 vào đợt A TRƯỚC khi phát phiếu ⇒ dòng A của phiếu = 2.168.000.
    const x = await ganTaySepay(1_000_000, [{ paymentRequestId: DOT_A, soTien: 1_000_000 }]);
    const { ma, billId } = await phatPhieu();
    const conLai = TONG - 1_000_000; // 5.732.000
    expect((await phieu(billId)).amountDue, "đối chứng fixture").toBe(conLai);
    const t = maSepay();
    expect((await banSepay(memo(ma), conLai, t)).status).toBe("MATCHED");
    expect((await phieu(billId)).status).toBe("PAID");

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t)).id, orderId: DON, lyDo: "khớp nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(billId)).status).toBe("OPEN");
    // Số phải thu tính LẠI từ phân bổ (dòng phiếu chụp số lúc phát, tiền đã rót đọc sống).
    expect((await docPhieuGopDangMo(DON))?.tongTien).toBe(conLai);
    expect(await trangThaiDot()).toEqual(["PARTIAL", "PENDING"]);
    expect(await tongPhanBoGd(x), "phân bổ của giao dịch KHÁC không bị đụng").toBe(1_000_000);

    const thieu = await banSepay(memo(ma), conLai - 1);
    expect(thieu.status).toBe("UNMATCHED");
    expect("reason" in thieu && thieu.reason).toContain("thiếu 1đ");

    expect((await banSepay(memo(ma), conLai)).status).toBe("MATCHED");
    expect(await trangThaiDot()).toEqual(["PAID", "PAID"]);
    expect(await tongPhanBoDot(DOT_A)).toBe(DOT_TIEN_A);
    expect(await tongPhanBoDot(DOT_B)).toBe(DOT_TIEN_B);
    expect(await tongPaymentDon(), "sổ A = sổ B").toBe(await tongPhanBoDon());
  });

  it("[PNS-05] đối chứng: gỡ gắn giao dịch KHÔNG trả phiếu (gắn tay) ⇒ phiếu PAID của giao dịch khác GIỮ NGUYÊN", async () => {
    // Phiếu một dòng cho đợt A, phát SAU khi X đã gắn tay 1.000.000 ⇒ dòng = 2.168.000, T trả đủ.
    // Gỡ X làm đợt A thiếu lại 1.000.000 — nhưng đó KHÔNG phải tiền của phiếu: phiếu đã được T
    // trả trọn. Phân biệt bằng nhãn "Phiếu gộp <mã>" trên khoản vừa đảo, không bằng dòng phiếu.
    const x = await ganTaySepay(1_000_000, [{ paymentRequestId: DOT_A, soTien: 1_000_000 }]);
    const { ma, billId } = await phatPhieu([DOT_A]);
    expect((await banSepay(memo(ma), DOT_TIEN_A - 1_000_000)).status).toBe("MATCHED");
    expect((await phieu(billId)).status).toBe("PAID");

    const go = await goGanTheoCon({ bankTransactionId: x, orderId: DON, lyDo: "gắn nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(billId)).status, "phiếu KHÔNG do giao dịch vừa gỡ trả").toBe("PAID");
    expect(await trangThaiDot()).toEqual(["PARTIAL", "PENDING"]);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: DON, action: "PHIEU_GOP_MO_LAI" } })).toBe(0);
  });

  it("[PNS-06] thứ tự cố định: webhook TRƯỚC gỡ gắn ⇒ 'ĐÃ THU ĐỦ', không ghi; gỡ gắn TRƯỚC webhook ⇒ khớp", async () => {
    const { ma, billId } = await phatPhieu();
    const t1 = maSepay();
    await banSepay(memo(ma), TONG, t1);
    const t2 = maSepay();
    const truoc = await banSepay(memo(ma), TONG, t2);
    expect(truoc.status).toBe("UNMATCHED");
    expect(await tongPhanBoGd((await btSepay(t2)).id)).toBe(0);
    await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "khách chuyển hai lần", actor: ACTOR });
    expect((await phieu(billId)).status).toBe("OPEN");
    // Giao dịch thứ hai VẪN ở hàng chờ — mở lại phiếu không tự nhặt lại giao dịch cũ.
    expect((await btSepay(t2)).status).toBe("UNMATCHED");
    expect(await tongPhanBoDon()).toBe(0);
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[PNS-07] ĐUA: gỡ gắn ‖ webhook cùng mã đúng số ⇒ tiền KHÔNG bao giờ ghi đôi, phiếu và giao dịch khớp nhau", async () => {
    let soKhop = 0;
    let soCho = 0;
    for (let lan = 0; lan < 6; lan++) {
      await dungFixture();
      const { ma, billId } = await phatPhieu();
      const t1 = maSepay();
      expect((await banSepay(memo(ma), TONG, t1)).status).toBe("MATCHED");
      const bt1 = (await btSepay(t1)).id;
      const t2 = maSepay();
      // Lệch nhau theo lượt để mỗi bên đều có lượt vào trước (đo 30/09: 5–6 lượt khớp / 0–1 lượt
      // chờ trên 6 — thứ tự "webhook trước" được ghim chắc ở `[PNS-06]`, ca này canh GHI ĐÔI).
      const goTruoc = lan % 2 === 0;
      await Promise.all([
        cho(goTruoc ? 0 : lan * 6).then(() =>
          goGanTheoCon({ bankTransactionId: bt1, orderId: DON, lyDo: `đua lượt ${lan}`, actor: ACTOR }),
        ),
        cho(goTruoc ? lan * 2 : 0).then(() => banSepay(memo(ma), TONG, t2)),
      ]);
      const bt2 = await btSepay(t2);
      const pb2 = await tongPhanBoGd(bt2.id);
      expect(await tongPhanBoGd(bt1), `lượt ${lan}: giao dịch đã gỡ không còn phân bổ`).toBe(0);
      expect([0, TONG], `lượt ${lan}: phân bổ của giao dịch mới ∈ {0, đủ}`).toContain(pb2);
      expect(await tongPhanBoDot(DOT_A), `lượt ${lan}: đợt A không vượt`).toBeLessThanOrEqual(DOT_TIEN_A);
      expect(await tongPhanBoDot(DOT_B), `lượt ${lan}: đợt B không vượt`).toBeLessThanOrEqual(DOT_TIEN_B);
      expect(await tongPaymentDon(), `lượt ${lan}: sổ A = sổ B`).toBe(await tongPhanBoDon());
      const p = await phieu(billId);
      if (bt2.status === "MATCHED") {
        soKhop += 1;
        expect(p.status, `lượt ${lan}`).toBe("PAID");
        expect(pb2).toBe(TONG);
      } else {
        soCho += 1;
        expect(bt2.status, `lượt ${lan}`).toBe("UNMATCHED");
        expect(bt2.unmatchedNote, `lượt ${lan}`).toContain("PHIEU_KHONG_MO");
        expect(p.status, `lượt ${lan}: webhook tới trước ⇒ gỡ gắn mở lại phiếu`).toBe("OPEN");
      }
    }
    expect(soKhop + soCho).toBe(6);
  });

  // ĐỔI VÌ Q-M (30/09/2026): nhánh "import tới trước ⇒ gỡ gắn mở lại phiếu" nay ĐÓNG; và dòng quẹt MỚI
  // cùng mã không bao giờ khớp nữa (phiếu PAID ⇒ "ĐÃ THU ĐỦ", phiếu ĐÓNG ⇒ "ĐÃ ĐÓNG"). Luật ca canh —
  // KHÔNG ghi đôi — giữ nguyên.
  it("[PNS-08] ĐUA thẻ POS: gỡ gắn ‖ import dòng quẹt MỚI cùng mã đúng số ⇒ không ghi đôi, dòng cũ không tự khớp lại", async () => {
    for (let lan = 0; lan < 4; lan++) {
      await dungFixture();
      const { ma, billId } = await phatPhieu();
      const m1 = maGd();
      await lo([dong({ maGiaoDich: m1, dienGiai: ma })]);
      const bt1 = (await posRow(m1)).bankTransactionId!;
      const m2 = maGd();
      const goTruoc = lan % 2 === 0;
      await Promise.all([
        cho(goTruoc ? 0 : lan * 6).then(() =>
          goGanTheoCon({ bankTransactionId: bt1, orderId: DON, lyDo: `đua thẻ lượt ${lan}`, actor: ACTOR }),
        ),
        cho(goTruoc ? lan * 2 : 0).then(() => lo([dong({ maGiaoDich: m2, dienGiai: ma })])),
      ]);
      const r2 = await posRow(m2);
      expect(await tongPhanBoGd(bt1), `lượt ${lan}: giao dịch đã gỡ không còn phân bổ`).toBe(0);
      expect([0, TONG], `lượt ${lan}`).toContain(await tongPhanBoGd(r2.bankTransactionId!));
      expect(await tongPhanBoDot(DOT_A), `lượt ${lan}: đợt A không vượt`).toBeLessThanOrEqual(DOT_TIEN_A);
      expect(await tongPhanBoDot(DOT_B), `lượt ${lan}: đợt B không vượt`).toBeLessThanOrEqual(DOT_TIEN_B);
      expect(await tongPaymentDon(), `lượt ${lan}: sổ A = sổ B`).toBe(await tongPhanBoDon());
      const p = await phieu(billId);
      expect(r2.bankTransaction?.status, `lượt ${lan}: quẹt mới cùng mã không khớp (PAID hoặc ĐÃ ĐÓNG)`).toBe("UNMATCHED");
      expect(p.status, `lượt ${lan}: Q-M ⇒ gỡ gắn thẻ ĐÓNG phiếu ở mọi thứ tự`).toBe("CLOSED");
    }
  });

  it("[PNS-09] đơn đã HUỶ ⇒ phiếu KHÔNG mở lại mà ĐÓNG — mở lại là phát lại một QR mà đường khớp sẽ từ chối", async () => {
    const { ma, billId } = await phatPhieu();
    const t1 = maSepay();
    expect((await banSepay(memo(ma), TONG, t1)).status).toBe("MATCHED");
    await db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } });

    const go = await goGanTheoCon({ bankTransactionId: (await btSepay(t1)).id, orderId: DON, lyDo: "đơn đã huỷ", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await phieu(billId)).status).toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON), "màn đơn không còn mã nào để in").toBeNull();
    expect(await tongPaymentDon()).toBe(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // NỢ 2 — GỠ GẮN GIAO DỊCH THẺ MÀ GỐC ĐÃ BIẾT BỊ HỦY / HOÀN
  // ═════════════════════════════════════════════════════════════════════════

  it("[PNS-10] hủy TOÀN PHẦN sau ghi nhận → ĐÓNG cảnh báo TRƯỚC (Q-H) → gỡ gắn ⇒ giao dịch IGNORED ngay, không gắn tay lại được", async () => {
    const { ma, billId } = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    const huy = maGd();
    const dHuy = dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG });
    await lo([dHuy]);
    const g1 = await posRow(goc);
    expect(g1.canhBaoHuy, "đối chứng fixture: cảnh báo hủy sau ghi nhận").toBe(true);
    await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "đã hoàn về thẻ", luc: new Date() });
    expect((await posRow(goc)).bankTransaction?.status, "Q-H: đóng tự do, không đụng giao dịch").toBe("MATCHED");

    const go = await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "khách hủy thẻ", actor: ACTOR });
    expect(go.ok).toBe(true);
    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status, "khoản đã hoàn về thẻ phải RA KHỎI hàng chờ ngay").toBe("IGNORED");
    expect(g2.bankTransaction?.unmatchedNote).toMatch(/^Đã gỡ gắn: khách hủy thẻ/);
    expect(g2.bankTransaction?.unmatchedNote).toContain(`Đã bị hủy bởi giao dịch thẻ ${huy}`);
    expect(g2.matchStatus).toBe("BO_QUA");

    const gan = await ganTienTheoCon({
      bankTransactionId: g1.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
      nguoiGan: { loai: "KE_TOAN" },
    });
    expect(gan.ok, "gắn tay một giao dịch ĐÃ HỦY phải bị từ chối").toBe(false);

    // Import lại cả file ⇒ vẫn vậy; nợ quay lại. ĐỔI VÌ Q-M (30/09/2026): bản cũ ghim "mã phiếu dùng lại
    // được" (phiếu OPEN) — nay gỡ gắn thẻ luôn ĐÓNG phiếu, phát mã mới nếu cần thu lại.
    await lo([dong({ maGiaoDich: goc, dienGiai: ma, trangThaiHoanHuy: "Hủy toàn phần" }), dHuy]);
    expect((await posRow(goc)).bankTransaction?.status).toBe("IGNORED");
    expect((await phieu(billId)).status).toBe("CLOSED");
    expect(await tongPaymentDon()).toBe(0);
    expect(await tongPhanBoDon()).toBe(0);
  });

  it("[PNS-11] hoàn MỘT PHẦN sau ghi nhận → đóng TRƯỚC → gỡ gắn ⇒ IGNORED + cảnh báo MỞ LẠI loại 'Hoàn một phần'; đóng lại ⇒ kết luận", async () => {
    const { ma, billId } = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần" })]);
    const g1 = await posRow(goc);
    expect(loaiCanhBaoPos(g1.matchReason), "đối chứng fixture").toBe("HUY_SAU_GHI_NHAN");
    await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "sẽ điều chỉnh", luc: new Date() });

    const go = await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "hoàn một phần", actor: ACTOR });
    expect(go.ok).toBe(true);
    // Rà vòng 4: số ròng còn nằm ở công ty (ngoài sổ) ⇒ phiếu KHÔNG được mở lại đòi trọn số gộp
    // bằng mã cũ (tự khớp, thu hai lần). ĐÓNG; phát phiếu mới sau khi điều chỉnh.
    expect((await phieu(billId)).status, "hoàn MỘT PHẦN ⇒ phiếu ĐÓNG, không MỞ LẠI").toBe("CLOSED");
    expect(go.ok ? go.phieuGop.map((p) => p.hanhDong) : null).toEqual(["DONG"]);
    expect(await docPhieuGopDangMo(DON), "không mời trả trọn số gộp bằng mã cũ").toBeNull();
    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status, "số GỘP không được về hàng chờ").toBe("IGNORED");
    expect(g2.bankTransaction?.unmatchedNote).toMatch(/^Đã gỡ gắn: hoàn một phần/);
    expect(g2.bankTransaction?.unmatchedNote).toContain(DUOI_CHAN_HOAN_MOT_PHAN);
    // Tiền ròng còn giữ CHƯA vào sổ nào ⇒ việc còn đó: cảnh báo MỞ LẠI dù đã đóng trước.
    expect(g2.matchStatus).toBe("CAN_XU_LY");
    expect(g2.canhBaoHuy).toBe(true);
    expect(g2.canhBaoDaXuLyLuc).toBeNull();
    expect(loaiCanhBaoPos(g2.matchReason)).toBe("HOAN_MOT_PHAN");

    const gan = await ganTienTheoCon({
      bankTransactionId: g1.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
      nguoiGan: { loai: "KE_TOAN" },
    });
    expect(gan.ok).toBe(false);

    const n = await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "đã ghi số ròng", luc: new Date() });
    expect(n, "cảnh báo đã mở lại nên đóng được lần hai").not.toBeNull();
    const g3 = await posRow(goc);
    expect(g3.matchStatus).toBe("BO_QUA");
    expect(g3.bankTransaction?.status).toBe("IGNORED");
    expect(await tongPaymentDon()).toBe(0);
  });

  it("[PNS-11b] Q-I: CỘT của gốc mang giá trị LẠ ('Chờ hủy' ⇒ một phần) → gỡ gắn ⇒ IGNORED + phiếu ĐÓNG (không mở lại)", async () => {
    const { ma, billId } = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    await lo([dong({ maGiaoDich: goc, dienGiai: ma, trangThaiHoanHuy: "Chờ hủy" })]);
    const g1 = await posRow(goc);
    expect(g1.bankTransaction?.status, "đối chứng fixture").toBe("MATCHED");

    const go = await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "ngân hàng báo chờ hủy", actor: ACTOR });
    expect(go.ok).toBe(true);
    expect((await posRow(goc)).bankTransaction?.status).toBe("IGNORED");
    expect((await phieu(billId)).status, "một phần (Q-I) ⇒ phiếu ĐÓNG").toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON)).toBeNull();
  });

  it("[PNS-12] chỉ CỘT 'Hủy toàn phần' (dòng hủy chưa import) → gỡ gắn ⇒ IGNORED", async () => {
    const { ma, billId } = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    await lo([dong({ maGiaoDich: goc, dienGiai: ma, trangThaiHoanHuy: "Hủy toàn phần" })]);
    const g1 = await posRow(goc);
    expect(g1.canhBaoHuy, "đối chứng fixture: cột mới có giá trị ⇒ cảnh báo").toBe(true);
    expect(g1.bankTransaction?.status).toBe("MATCHED");

    const go = await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "ngân hàng báo hủy", actor: ACTOR });
    expect(go.ok).toBe(true);
    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status).toBe("IGNORED");
    expect(g2.bankTransaction?.unmatchedNote).toMatch(/^Đã gỡ gắn: ngân hàng báo hủy/);
    expect(g2.bankTransaction?.unmatchedNote).toContain("toàn phần");
    expect(g2.matchStatus).toBe("BO_QUA");
    // ĐỔI VÌ Q-M (30/09/2026): bản vòng 4 ghim "hủy TOÀN PHẦN ⇒ phiếu MỞ LẠI như luật cũ". Q-M: gỡ gắn
    // THẺ luôn ĐÓNG — kể cả toàn phần. Đối chứng dương của luật mở lại nay là chuyển khoản (`[PNS-01]`).
    expect((await phieu(billId)).status, "Q-M: thẻ ⇒ đóng").toBe("CLOSED");
  });

  it("[PNS-13] đối chứng: gốc KHÔNG có tín hiệu hủy/hoàn → gỡ gắn ⇒ về hàng chờ UNMATCHED như cũ", async () => {
    const { ma } = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    const g1 = await posRow(goc);
    const go = await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "gắn nhầm", actor: ACTOR });
    expect(go.ok).toBe(true);
    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status).toBe("UNMATCHED");
    expect(g2.bankTransaction?.unmatchedNote).toBe("Đã gỡ gắn: gắn nhầm");
    expect(g2.matchStatus, "dòng POS không bị kết luận BO_QUA").not.toBe("BO_QUA");
  });

  it("[PNS-14] đóng cảnh báo: chỉ CỘT 'Hủy toàn phần' + giao dịch đã gỡ (trạng thái bản cũ để lại) ⇒ IGNORED + BO_QUA", async () => {
    const { ma } = await phatPhieu();
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: ma })]);
    await lo([dong({ maGiaoDich: goc, dienGiai: ma, trangThaiHoanHuy: "Hủy toàn phần" })]);
    const g1 = await posRow(goc);
    await goGanTheoCon({ bankTransactionId: g1.bankTransactionId!, orderId: DON, lyDo: "gỡ trước ngày vá", actor: ACTOR });
    // Dựng lại đúng trạng thái mà gỡ gắn TRƯỚC bản vá để lại: giao dịch UNMATCHED trong hàng
    // chờ, dòng POS gốc chưa bị đụng (TU_KHOP).
    await db.bankTransaction.update({
      where: { id: g1.bankTransactionId! },
      data: { status: "UNMATCHED", unmatchedNote: "Đã gỡ gắn: gỡ trước ngày vá" },
    });
    await db.posCardTransaction.update({ where: { id: g1.id }, data: { matchStatus: "TU_KHOP", matchReason: g1.matchReason } });

    const n = await dongCanhBaoHuyPos({ id: g1.id, maGiaoDich: goc, nguoiDongId: USER, ghiChu: "đã hoàn", luc: new Date() });
    expect(n).not.toBeNull();
    const g2 = await posRow(goc);
    expect(g2.bankTransaction?.status, "cột nói hủy toàn phần ⇒ ra khỏi hàng chờ").toBe("IGNORED");
    expect(g2.matchStatus).toBe("BO_QUA");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // NỢ 3 — DÒNG GỐC CẬP NHẬT TỪ DÒNG HỦY NHẬN CƠ SỞ THEO MÁY
  // ═════════════════════════════════════════════════════════════════════════

  it("[PNS-20] gốc NULL cơ sở (máy chưa khai) → khai máy → file CHỈ có dòng hủy ⇒ gốc BO_QUA + cơ sở theo máy (ghi kép orgUnitId)", async () => {
    const mayLa = `${PFX}MAYLA1`;
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma", maThietBi: mayLa })]);
    const r0 = await posRow(goc);
    expect(r0.centerId, "đối chứng fixture").toBeNull();
    expect(r0.bankTransaction?.status).toBe("UNMATCHED");

    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER } });
    const huy = maGd();
    await lo([dong({ maGiaoDich: huy, loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG, maThietBi: mayLa })]);
    const r1 = await posRow(goc);
    expect(r1.matchStatus).toBe("BO_QUA");
    expect(r1.bankTransaction?.status).toBe("IGNORED");
    expect(r1.centerId, "NULL ⇒ mọi cơ sở đọc được").toBe(CENTER);
    expect(r1.orgUnitId, "ghi kép phải điền orgUnitId").toBe(OU_CENTER);
    expect((await posRow(huy)).centerId).toBe(CENTER);
  });

  it("[PNS-21] gốc NULL cơ sở đang chờ → khai máy → file CHỈ có dòng hoàn MỘT PHẦN ⇒ gốc chặn (Q-G) + cơ sở theo máy", async () => {
    const mayLa = `${PFX}MAYLA2`;
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma", maThietBi: mayLa })]);
    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER } });
    await lo([
      dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hoàn tiền", maGiaoDichGoc: goc, soTien: -1_000_000, trangThaiHoanHuy: "Hoàn một phần", maThietBi: mayLa }),
    ]);
    const r1 = await posRow(goc);
    expect(r1.bankTransaction?.status).toBe("IGNORED");
    expect(r1.canhBaoHuy).toBe(true);
    expect(r1.centerId).toBe(CENTER);
    expect(r1.orgUnitId).toBe(OU_CENTER);
  });

  it("[PNS-22] gốc NULL cơ sở không giao dịch (số 0đ) → khai máy → dòng hủy 0đ ⇒ gốc BO_QUA + cơ sở theo máy", async () => {
    const mayLa = `${PFX}MAYLA3`;
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma", soTien: 0, maThietBi: mayLa })]);
    const r0 = await posRow(goc);
    expect(r0.bankTransactionId, "đối chứng fixture: luật 4 không tạo giao dịch").toBeNull();
    expect(r0.centerId).toBeNull();
    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER } });
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: 0, maThietBi: mayLa })]);
    const r1 = await posRow(goc);
    expect(r1.matchStatus).toBe("BO_QUA");
    expect(r1.centerId).toBe(CENTER);
  });

  it("[PNS-23] đối chứng ưu tiên: gốc đã GẮN TAY vào đơn cơ sở này, máy khai về cơ sở KHÁC ⇒ gốc theo cơ sở của ĐƠN", async () => {
    await db.center.create({
      data: { id: CENTER2, name: "Cơ sở fixture PNS 2", slug: `${T}co-so-2`, address: "114 Hoàng Diệu" },
    });
    const mayLa = `${PFX}MAYLA4`;
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma", maThietBi: mayLa })]);
    const r0 = await posRow(goc);
    const gan = await ganTienTheoCon({
      bankTransactionId: r0.bankTransactionId!,
      orderId: DON,
      dong: [
        { paymentRequestId: DOT_A, soTien: DOT_TIEN_A },
        { paymentRequestId: DOT_B, soTien: DOT_TIEN_B },
      ],
      actor: ACTOR,
      nguoiGan: { loai: "KE_TOAN" },
    });
    expect(gan.ok).toBe(true);
    await db.posTerminal.create({ data: { maThietBi: mayLa, centerId: CENTER2 } });
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG, maThietBi: mayLa })]);
    const r1 = await posRow(goc);
    expect(r1.canhBaoHuy).toBe(true);
    expect(r1.centerId, "tiền đã vào đơn cơ sở này — cơ sở của máy KHÔNG được thắng").toBe(CENTER);
  });

  it("[PNS-24] đối chứng: gốc ĐÃ có cơ sở ⇒ dòng hủy KHÔNG đổi cơ sở của gốc (sửa máy sang cơ sở khác sau đó)", async () => {
    await db.center.create({
      data: { id: CENTER2, name: "Cơ sở fixture PNS 2", slug: `${T}co-so-2`, address: "114 Hoàng Diệu" },
    });
    const goc = maGd();
    await lo([dong({ maGiaoDich: goc, dienGiai: "khong ma" })]);
    expect((await posRow(goc)).centerId, "đối chứng fixture").toBe(CENTER);
    await db.posTerminal.update({ where: { maThietBi: MAY }, data: { centerId: CENTER2 } });
    await lo([dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: goc, soTien: -TONG })]);
    const r1 = await posRow(goc);
    expect(r1.matchStatus).toBe("BO_QUA");
    expect(r1.centerId).toBe(CENTER);
  });
});
