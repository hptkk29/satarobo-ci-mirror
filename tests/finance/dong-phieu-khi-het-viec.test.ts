// tests/finance/dong-phieu-khi-het-viec.test.ts — #663: ĐỢT ĐỦ TIỀN BẰNG BẤT KỲ ĐƯỜNG NÀO / ĐƠN BỊ HUỶ ⇒ ĐÓNG PHIẾU GỘP + KẾT THÚC PHIẾU THẺ. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-bac-lach-phieu-moi.test.ts`).
//
// Cảnh gốc = đơn `ORD-261011-000017` / mã `DYUJU` trên test.satarobo.vn: phiếu gộp OPEN + phiếu thẻ CHO_QUET, kế toán GẮN TAY giao dịch thẻ đủ tiền ⇒ đợt "Đã đủ",
// đơn CONFIRMED, nhưng phiếu gộp ở lại OPEN và phiếu thẻ ở lại CHO_QUET; huỷ đơn sau đó cũng không đóng phiếu gộp. Mọi ca đi qua ĐÚNG cửa đời thật: phiếu mở bằng `taoPhieuGop` /
// `moPhieuPos`, giao dịch thẻ bằng `nhapLoPos` (file), gắn tay bằng `ganTienTheoCon`, mã đời cũ bằng `allocateToOrder`, huỷ đơn bằng `voidTienKhiHuyDonTrongTx`.
//
// Mỗi ca tự dựng lại fixture (chạy MỘT MÌNH vẫn xanh — luật 18); đồng hồ truyền vào (luật 19).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { goGanTheoCon, khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { ganTienTheoConVaDongPhieu } from "@/lib/finance/gan-tay-va-dong-phieu";
import { docPhieuGopDangMo, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { dongPhieuGopKhiHetViecTrongTx } from "@/lib/finance/dong-phieu-khi-het-viec-db";
import { voidTienKhiHuyDonTrongTx } from "@/lib/orders/huy-don-tien";
import { allocateToOrder } from "@/lib/payments/payos-ingest";
import { docPayloadDaChia, xuLyPhieuGopDaChia } from "@/lib/payments/sau-da-chia";
import { nhapLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import { moPhieuPos } from "@/lib/payments/pos/phieu-pos";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

if (!RUN_DB_TESTS) console.warn(`[DPH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-dph-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXDPH";
const KT = `${T}kt`;
const SALE = `${T}sale`;
const CS1 = `${T}cs1`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const MAY1 = `${PFX}MAY01`;
const SDT_PH = "0399812377";
const EMAIL_PH = "ph.fx.dph@test.local";
const ACTOR = { id: SALE, name: "Sale fixture DPH" };
const A_KT = { id: KT, name: "Kế toán fixture DPH" };
const NGUOI = [KT, SALE];

const TIEN_A = 3_168_000;
const TIEN_B = 3_564_000;
const TONG = TIEN_A + TIEN_B;
const NOW = new Date("2026-10-12T03:00:00Z");

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
let soRrn = 0;
const rrn = () => String(556677889000 + ++soRrn);

const LOC_BT = { providerTxnId: { startsWith: PFX } };

async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: T } } });
  await db.posSaiMaYeuCau.deleteMany({ where: { intent: { paymentBill: { orderId: DON } } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: { orderId: DON } } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: DON } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.staffNotification.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.emailLog.deleteMany({ where: { OR: [{ contextType: "Order", contextId: DON }, { toEmail: EMAIL_PH }] } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { actorId: { in: NGUOI } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
  await db.posTxnSource.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.creditBalance.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: LOC_BT });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: NGUOI } }, { email: EMAIL_PH }] } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

async function dungFixture() {
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", A_KT.name],
    [SALE, "SALES_CSM", ACTOR.name],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  await db.center.create({ data: { id: CS1, name: "CS1 fixture DPH", slug: CS1, address: "211 Nguyễn Hữu Thọ" } });
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269985-000701",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture DPH",
      customerPhone: SDT_PH,
      customerEmail: EMAIL_PH,
      totalAmount: TONG,
      centerId: CS1,
      createdById: SALE,
    },
  });
  for (const [item, dot, ten, tien, thuTu] of [
    [A, DOT_A, "Bé A DPH", TIEN_A, 1],
    [B, DOT_B, "Bé B DPH", TIEN_B, 2],
  ] as const) {
    await db.orderItem.create({
      data: { id: item, orderId: DON, type: "COURSE_ENROLLMENT", itemName: ten, quantity: 1, unitPrice: tien, totalPrice: tien },
    });
    await db.paymentRequest.create({
      data: { id: dot, orderId: DON, orderItemId: item, centerId: CS1, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: thuTu },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** Nút "Xuất QR": phát phiếu gộp cho CẢ HAI đợt ⇒ một mã, hai dòng. */
async function phatPhieu() {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A, DOT_B], actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}
/** Nút "Thẻ POS" trên dòng A. */
async function moPhieu() {
  const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: NOW });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  return r.phieu;
}
/** Cảnh gốc của #663: phiếu gộp OPEN + phiếu thẻ CHO_QUET. */
async function canhGoc() {
  const g = await phatPhieu();
  const p = await moPhieu();
  expect(p.code5, "phiếu thẻ dùng ĐÚNG mã của phiếu gộp").toBe(g.ma);
  return { billId: g.billId ?? (await db.paymentBill.findFirstOrThrow({ where: { orderId: DON, matchKey: g.ma } })).id, ma: g.ma, intentId: p.intentId };
}

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TONG,
    thoiGian: "2026-10-12T09:31:35+07:00",
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: rrn(),
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: "QTT45XWQT",
    maThietBi: MAY1,
    soTheMasked: "411111******1234",
    loaiThe: "VISA",
    maHachToan: null,
    phiGiaoDich: null,
    ...p,
  };
}

/** Một lượt import (đúng thứ màn làm). Trả id giao dịch ngân hàng của dòng đầu. */
async function nhapFile(dongs: DongPos[]): Promise<string[]> {
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture.xlsx", importedById: KT, soLoTong: 1 } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: [], nguoiNhapId: KT });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  await db.posImportBatch.update({ where: { id: batch.id }, data: { soLoXong: 1, trangThai: "XONG" } });
  return Promise.all(
    dongs.map(async (d) =>
      (await db.bankTransaction.findUniqueOrThrow({ where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: d.maGiaoDich } }, select: { id: true } })).id,
    ),
  );
}
const btDb = (id: string) => db.bankTransaction.findUniqueOrThrow({ where: { id } });

/** Kế toán GẮN TAY giao dịch `btId` vào các đợt — đúng hàm màn "Biến động số dư" gọi (`ganTienTheoConVaDongPhieu`). */
function ganTay(btId: string, dongChia: { paymentRequestId: string; soTien: number }[]) {
  return ganTienTheoConVaDongPhieu({ bankTransactionId: btId, orderId: DON, dong: dongChia, actor: A_KT, nguoiGan: { loai: "KE_TOAN" } });
}

/** Một giao dịch CHUYỂN KHOẢN (SePay) đang nằm hàng chờ — nguồn khác thẻ ⇒ luật gỡ gắn khác (Q-M chỉ đóng phiếu của THẺ). */
async function giaoDichChuyenKhoan(soTien: number): Promise<string> {
  const bt = await db.bankTransaction.create({
    data: { provider: "SEPAY", providerTxnId: `${PFX}CK${String(++soLan).padStart(6, "0")}`, amount: soTien, transferredAt: NOW, status: "UNMATCHED" },
  });
  return bt.id;
}

const phieuGop = (id: string) => db.paymentBill.findUniqueOrThrow({ where: { id } });
const phieuThe = (id: string) => db.posPaymentIntent.findUniqueOrThrow({ where: { id } });
const suKien = () => db.domainEvent.findMany({ where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], equals: DON } }, orderBy: { createdAt: "asc" } });
const soPayment = () => db.payment.count({ where: { orderId: DON } });
const soPhanBo = () => db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } });
const nhatKy = (action: string) => db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action }, orderBy: { createdAt: "asc" } });

/** Chạy hàm huỷ-đơn-tiền đúng như action: dưới khoá đơn, trong MỘT transaction. */
function huyDonTien() {
  return db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, DON);
    return voidTienKhiHuyDonTrongTx(tx, DON, A_KT);
  });
}

describe.skipIf(!RUN_DB_TESTS)("[DPH] đóng phiếu gộp + kết thúc phiếu thẻ khi hết việc — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[DPH-00] fixture mang hình dạng thật của #663: phiếu gộp OPEN (hai dòng) + phiếu thẻ CHO_QUET, chưa đồng nào vào", async () => {
    const c = await canhGoc();
    expect((await phieuGop(c.billId)).status).toBe("OPEN");
    expect((await phieuThe(c.intentId)).status).toBe("CHO_QUET");
    expect(await db.paymentBillLine.count({ where: { billId: c.billId } })).toBe(2);
    expect(await soPayment()).toBe(0);
    expect(await suKien()).toHaveLength(0);
  });

  it("[DPH-01] GẮN TAY đủ cả phiếu (ca DYUJU) ⇒ phiếu gộp ĐÓNG, phiếu thẻ HUY, MỘT sự kiện `phieu-gop.da-chia`, vết nói rõ vì sao", async () => {
    const c = await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG })]);
    expect((await btDb(bt!)).status, "ghi chú rỗng ⇒ không tự khớp, nằm hàng chờ").toBe("UNMATCHED");

    const kq = await ganTay(bt!, [
      { paymentRequestId: DOT_A, soTien: TIEN_A },
      { paymentRequestId: DOT_B, soTien: TIEN_B },
    ]);
    expect(kq).toMatchObject({ ok: true, daDuTien: true });

    expect((await phieuGop(c.billId)).status, "đã nhận tiền ⇒ ĐÓNG (không HUỶ)").toBe("CLOSED");
    expect((await phieuThe(c.intentId)).status, "mã không còn sống ⇒ phiếu thẻ kết thúc").toBe("HUY");

    const sk = await suKien();
    expect(sk).toHaveLength(1);
    expect(sk[0]!.dedupeKey).toBe(`phieu-gop.da-chia:${bt}:${c.billId}`);

    const [vetPhieu] = await nhatKy("PHIEU_GOP_CLOSED");
    expect(vetPhieu?.reason).toMatch(/đủ tiền bằng đường khác/);
    const [vetThe] = await nhatKy("POS_PHIEU_HUY");
    expect(vetThe?.newValues).toMatchObject({ intentId: c.intentId, nguon: "DU_TIEN", status: "HUY" });
  });

  it("[DPH-02] sự kiện sau chốt IDEMPOTENT: handler chạy HAI lần ⇒ không báo trùng, không ghi lịch sử trùng", async () => {
    await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG })]);
    await ganTay(bt!, [
      { paymentRequestId: DOT_A, soTien: TIEN_A },
      { paymentRequestId: DOT_B, soTien: TIEN_B },
    ]);
    const [e] = await suKien();
    const payload = docPayloadDaChia(e!.payloadJson);
    expect(payload).toMatchObject({ bankTransactionId: bt, orderId: DON, provider: PROVIDER_THE_POS, tong: TONG });

    await xuLyPhieuGopDaChia(payload);
    const sau1 = {
      thongBao: await db.staffNotification.count({ where: { userId: { in: NGUOI } } }),
      lichSu: await db.orderStatusHistory.count({ where: { orderId: DON } }),
    };
    expect(sau1.thongBao, "sale được báo ĐÚNG một lần").toBe(1);
    await xuLyPhieuGopDaChia(payload);
    expect({
      thongBao: await db.staffNotification.count({ where: { userId: { in: NGUOI } } }),
      lichSu: await db.orderStatusHistory.count({ where: { orderId: DON } }),
    }).toEqual(sau1);
  });

  it("[DPH-03] ĐỐI CHỨNG: gắn tay MỘT PHẦN (đợt B còn thiếu) ⇒ phiếu vẫn OPEN, phiếu thẻ vẫn CHO_QUET, KHÔNG sự kiện; gắn nốt ⇒ mới đóng, sự kiện của giao dịch SAU", async () => {
    const c = await canhGoc();
    const [bt1, bt2] = await nhapFile([
      dong({ maGiaoDich: maGd(), soTien: TIEN_A }),
      dong({ maGiaoDich: maGd(), soTien: TIEN_B }),
    ]);
    expect(await ganTay(bt1!, [{ paymentRequestId: DOT_A, soTien: TIEN_A }])).toMatchObject({ ok: true, daDuTien: false });
    expect((await phieuGop(c.billId)).status).toBe("OPEN");
    expect((await phieuThe(c.intentId)).status).toBe("CHO_QUET");
    expect(await suKien()).toHaveLength(0);

    expect(await ganTay(bt2!, [{ paymentRequestId: DOT_B, soTien: TIEN_B }])).toMatchObject({ ok: true, daDuTien: true });
    expect((await phieuGop(c.billId)).status).toBe("CLOSED");
    expect((await phieuThe(c.intentId)).status).toBe("HUY");
    const sk = await suKien();
    expect(sk).toHaveLength(1);
    expect(sk[0]!.dedupeKey).toBe(`phieu-gop.da-chia:${bt2}:${c.billId}`);
  });

  it("[DPH-04] GIAO DỊCH THẺ VỀ SAU khi phiếu đã đóng ⇒ hàng chờ (UNMATCHED), KHÔNG ghi phân bổ / Payment lần hai", async () => {
    const c = await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG })]);
    await ganTay(bt!, [
      { paymentRequestId: DOT_A, soTien: TIEN_A },
      { paymentRequestId: DOT_B, soTien: TIEN_B },
    ]);
    const truoc = { payment: await soPayment(), phanBo: await soPhanBo(), suKien: (await suKien()).length };
    expect(truoc.payment).toBeGreaterThan(0);

    // Khách quẹt LẠI theo mã cũ, đúng số: đường tự khớp nhận ra phiếu rồi thấy nó không còn mở.
    const [btSau] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG, dienGiai: c.ma })]);
    const sau = await btDb(btSau!);
    expect(sau.status, "ở hàng chờ cho kế toán, không tự vào đơn").toBe("UNMATCHED");
    expect({ payment: await soPayment(), phanBo: await soPhanBo(), suKien: (await suKien()).length }).toEqual(truoc);
  });

  it("[DPH-05] HUỶ ĐƠN khi phiếu còn OPEN mà MỌI đợt đã PAID (dữ liệu trước vá — đúng DYUJU) ⇒ phiếu gộp ĐÓNG, phiếu thẻ HUY", async () => {
    const c = await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG })]);
    await ganTay(bt!, [
      { paymentRequestId: DOT_A, soTien: TIEN_A },
      { paymentRequestId: DOT_B, soTien: TIEN_B },
    ]);
    // Dựng lại trạng thái TRƯỚC vá: phiếu gộp OPEN + phiếu thẻ CHO_QUET dù mọi đợt đã đủ (SQL trực tiếp — không còn đường thật nào sinh ra nó).
    await db.paymentBill.update({ where: { id: c.billId }, data: { status: "OPEN" } });
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "CHO_QUET" } });

    const daDong = await huyDonTien();
    expect(daDong.map((p) => p.dich)).toEqual(["CLOSED"]);
    expect((await phieuGop(c.billId)).status).toBe("CLOSED");
    expect((await phieuThe(c.intentId)).status).toBe("HUY");
    const vet = (await nhatKy("POS_PHIEU_HUY")).at(-1);
    expect(vet?.newValues).toMatchObject({ intentId: c.intentId, nguon: "HUY_DON" });
  });

  it("[DPH-06] HUỶ ĐƠN chưa thu đồng nào ⇒ phiếu gộp HUỶ (soát) VÀ phiếu thẻ cũng kết thúc — phiếu thẻ của phiếu đã VOID từng ở lại CHO_QUET", async () => {
    const c = await canhGoc();
    const daSoat = await huyDonTien();
    expect(daSoat.map((p) => p.dich)).toEqual(["VOID"]);
    expect((await phieuGop(c.billId)).status).toBe("VOID");
    expect((await phieuThe(c.intentId)).status).toBe("HUY");
  });

  it("[DPH-07] HUỶ ĐƠN khi mới đủ MỘT đợt ⇒ phiếu gộp ĐÓNG (đã nhận một phần), phiếu thẻ HUY; đúng MỘT dòng kết quả (không đóng hai lần)", async () => {
    const c = await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TIEN_A })]);
    await ganTay(bt!, [{ paymentRequestId: DOT_A, soTien: TIEN_A }]);
    const kq = await huyDonTien();
    expect(kq).toHaveLength(1);
    expect(kq[0]!.dich).toBe("CLOSED");
    expect((await phieuGop(c.billId)).status).toBe("CLOSED");
    expect((await phieuThe(c.intentId)).status).toBe("HUY");
  });

  it("[DPH-08] MÃ ĐỜI CŨ trả nốt đợt cuối của phiếu (`allocateToOrder`) ⇒ phiếu gộp ĐÓNG, phiếu thẻ HUY", async () => {
    const c = await canhGoc();
    const [bt1, bt2] = await nhapFile([
      dong({ maGiaoDich: maGd(), soTien: TIEN_A }),
      dong({ maGiaoDich: maGd(), soTien: TIEN_B }),
    ]);
    const rot = async (btId: string, dotId: string, soTien: number) => {
      const txn = await btDb(btId);
      const order = await db.order.findUniqueOrThrow({
        where: { id: DON },
        select: { id: true, code: true, status: true, centerId: true, orgUnitId: true, studentId: true, leadId: true, student: { select: { id: true, parentUserId: true } } },
      });
      return allocateToOrder({
        bankTransactionId: btId,
        order,
        amount: soTien,
        provider: txn.provider,
        providerTxnId: txn.providerTxnId,
        target: { paymentRequestId: dotId, orderId: DON, via: "manual" },
        data: { description: txn.content ?? undefined, amount: soTien, reference: txn.providerTxnId },
      });
    };
    expect(await rot(bt1!, DOT_A, TIEN_A)).toMatchObject({ status: "MATCHED" });
    expect((await phieuGop(c.billId)).status, "mới đủ một đợt ⇒ phiếu còn mở").toBe("OPEN");
    expect((await phieuThe(c.intentId)).status).toBe("CHO_QUET");

    expect(await rot(bt2!, DOT_B, TIEN_B)).toMatchObject({ status: "MATCHED" });
    expect((await phieuGop(c.billId)).status).toBe("CLOSED");
    expect((await phieuThe(c.intentId)).status).toBe("HUY");
  });

  it("[DPH-09] IDEMPOTENT: gọi lại hàm đóng phiếu khi phiếu đã đóng ⇒ không đổi gì, không phát thêm sự kiện", async () => {
    const c = await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG })]);
    await ganTay(bt!, [
      { paymentRequestId: DOT_A, soTien: TIEN_A },
      { paymentRequestId: DOT_B, soTien: TIEN_B },
    ]);
    const truoc = { phieu: await phieuGop(c.billId), the: await phieuThe(c.intentId), sk: (await suKien()).length, vet: (await nhatKy("PHIEU_GOP_CLOSED")).length };
    const lai = await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, DON);
      return dongPhieuGopKhiHetViecTrongTx(tx, { orderId: DON, lyDo: "DU_TIEN", actor: A_KT });
    });
    expect(lai).toEqual({ phieu: [], the: { daHuy: [], boQua: [] }, daPhatSuKien: false });
    expect({ phieu: await phieuGop(c.billId), the: await phieuThe(c.intentId), sk: (await suKien()).length, vet: (await nhatKy("PHIEU_GOP_CLOSED")).length }).toEqual(truoc);
  });

  it("[DPH-11] ĐẢO ĐƯỢC (chuyển khoản): phiếu đóng vì đủ tiền ⇒ GỠ GẮN ⇒ phiếu MỞ LẠI đúng số còn phải thu, mã cũ thu được (luật cũ `[V3-20]` còn nguyên)", async () => {
    const c = await canhGoc();
    const bt = await giaoDichChuyenKhoan(TONG);
    expect(await ganTay(bt, [{ paymentRequestId: DOT_A, soTien: TIEN_A }, { paymentRequestId: DOT_B, soTien: TIEN_B }])).toMatchObject({ ok: true, daDuTien: true });
    expect((await phieuGop(c.billId)).status).toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON), "đã đóng ⇒ màn không còn phiếu mở").toBeNull();

    const go = await goGanTheoCon({ bankTransactionId: bt, orderId: DON, lyDo: "gắn nhầm", actor: A_KT });
    expect(go.ok).toBe(true);
    expect((await phieuGop(c.billId)).status, "chuyển khoản ⇒ phiếu MỞ LẠI").toBe("OPEN");
    const mo = await docPhieuGopDangMo(DON);
    expect(mo?.ma).toBe(c.ma);
    expect(mo?.tongTien).toBe(TONG);
    expect((await nhatKy("PHIEU_GOP_MO_LAI")).length).toBe(1);
  });

  it("[DPH-12] ĐẢO ĐƯỢC (thẻ POS): phiếu đóng vì đủ tiền ⇒ gỡ gắn ⇒ phiếu VẪN ĐÓNG (Q-M: gỡ gắn thẻ luôn đóng phiếu), phiếu thẻ vẫn HUY, không có phiếu mở", async () => {
    const c = await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG })]);
    await ganTay(bt!, [{ paymentRequestId: DOT_A, soTien: TIEN_A }, { paymentRequestId: DOT_B, soTien: TIEN_B }]);
    expect((await phieuGop(c.billId)).status).toBe("CLOSED");

    const go = await goGanTheoCon({ bankTransactionId: bt!, orderId: DON, lyDo: "gắn nhầm", actor: A_KT });
    expect(go.ok).toBe(true);
    expect(go.ok && go.phieuGop.map((p) => p.hanhDong), "nói ra: phiếu ĐÓNG").toEqual(["DONG"]);
    expect((await phieuGop(c.billId)).status).toBe("CLOSED");
    expect((await phieuThe(c.intentId)).status).toBe("HUY");
    expect(await docPhieuGopDangMo(DON)).toBeNull();
    expect((await nhatKy("PHIEU_GOP_MO_LAI")).length).toBe(0);
  });

  it("[DPH-13] phiếu đóng vì LÝ DO KHÁC (không phải đủ tiền) KHÔNG bị mở lại khi một giao dịch trên đợt của nó bị gỡ — dấu `nguon: DU_TIEN` là điều kiện", async () => {
    const c = await canhGoc();
    const bt = await giaoDichChuyenKhoan(TONG);
    await ganTay(bt, [{ paymentRequestId: DOT_A, soTien: TIEN_A }, { paymentRequestId: DOT_B, soTien: TIEN_B }]);
    // Xoá dấu: dựng lại cảnh "phiếu đã đóng bởi đường khác" (vết đóng gần nhất không mang `nguon`).
    const [vet] = await nhatKy("PHIEU_GOP_CLOSED");
    await db.auditLog.update({ where: { id: vet!.id }, data: { newValues: { billId: c.billId, status: "CLOSED" } } });

    expect((await goGanTheoCon({ bankTransactionId: bt, orderId: DON, lyDo: "gắn nhầm", actor: A_KT })).ok).toBe(true);
    expect((await phieuGop(c.billId)).status, "không dấu ⇒ không đoán mở lại").toBe("CLOSED");
    expect(await docPhieuGopDangMo(DON)).toBeNull();
  });

  it("[DPH-10] ĐƯỜNG TỰ KHỚP không đổi: giao dịch thẻ ghi chú ĐÚNG mã + đúng số ⇒ phiếu PAID (không CLOSED), phiếu thẻ KHÔNG bị HUY (nó lên DA_THU ở lượt kiểm), đúng MỘT sự kiện", async () => {
    const c = await canhGoc();
    const [bt] = await nhapFile([dong({ maGiaoDich: maGd(), soTien: TONG, dienGiai: c.ma })]);
    expect((await btDb(bt!)).status).toBe("MATCHED");
    expect((await phieuGop(c.billId)).status).toBe("PAID");
    expect((await phieuThe(c.intentId)).status, "đường mới không đụng phiếu thẻ của đường tự khớp").not.toBe("HUY");
    const sk = await suKien();
    expect(sk).toHaveLength(1);
    expect(sk[0]!.dedupeKey).toBe(`phieu-gop.da-chia:${bt}:${c.billId}`);
  });
});
