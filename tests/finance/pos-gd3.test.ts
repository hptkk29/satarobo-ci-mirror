// tests/finance/pos-gd3.test.ts — GĐ3 POS: đường dự phòng NHẬP FILE (`TcbFileImportProvider`). Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// `pnpm test:unit` trần sẽ SKIP. Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo mã giao
// dịch của fixture + tiền tố id (khuôn `pos-that.test.ts`).
//
// Thiết kế: docs/pos-gd3-thiet-ke.md §9.7. Nhập bằng ĐÚNG đường của màn: byte zip (`_000` + `_001`,
// data descriptor) → `docFilePos` → `catLoPos` (lô nhỏ ⇒ cặp Thanh toán + Hủy rơi vào hai lô) →
// `dongPosNhapSchema` (hợp đồng lối vào của action) → `nhapLoPos({ lo })`. Chỉ bỏ vế `auth()` của action.
//
// Fixture `tests/fixtures/pos/smartpos-gd3.ts`: 3 thành công · 5 thất bại CÓ ghi chú · 1 cặp Thanh toán +
// Hủy (hủy toàn phần, đúng số), cùng máy CS1. Số tiền KHÔNG tròn, mỗi phiếu một số ⇒ dòng nào lỡ đi
// khớp là khớp được thật (phiếu đổi trạng thái), không có chuyện xanh nhờ lệch số.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { z } from "zod";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { taoPhieuGop } from "@/lib/finance/phieu-gop";
import { docFilePos } from "@/lib/payments/pos/doc-file-pos";
import { catLoPos } from "@/lib/payments/pos/cat-lo-pos";
import { khopGiaoDichThe, nhapLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { KET_QUA_RONG, congKetQua, tongLuotSauLo, type KetQuaLoPos } from "@/lib/payments/pos/ket-qua-lo";
import { LY_DO_HUY_TOAN_PHAN } from "@/lib/payments/pos/phan-loai-pos";
import { PROVIDER_THE_POS, dongHuyPosSchema, dongPosNhapSchema, type DongPos } from "@/lib/payments/pos/kieu";
import { MAY_CS1, type DongThat } from "@/tests/fixtures/pos/smartpos-that";
import {
  GD3,
  MA_CHI_O_001,
  MA_GD3_TAT_CA,
  SO_THE_DAY_DU,
  TEN_CHU_THE_GIA,
  TIEN_GD3,
  dungDongGd3,
  dungZipGd3,
  suaDong,
  type MaPhieuGd3,
} from "@/tests/fixtures/pos/smartpos-gd3";

if (!RUN_DB_TESTS) console.warn(`[POS3-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-posgd3-";
const KT = `${T}kt`;
const CS1 = `${T}cs1`;
const ACTOR = { id: KT, name: "Kế toán HO fixture GĐ3" };
const MA = [...MA_GD3_TAT_CA];

/** Sáu đơn, mỗi đơn MỘT phiếu gộp đang mở (mỗi đơn chỉ được một mã sống). */
const DON = {
  thu0: `${T}don-thu0`,
  thu1: `${T}don-thu1`,
  thu2: `${T}don-thu2`,
  cap: `${T}don-cap`,
  tg0: `${T}don-tg0`,
  tg1: `${T}don-tg1`,
} as const;
type KhoaDon = keyof typeof DON;
const TAT_CA_DON: string[] = Object.values(DON);
const TIEN_DON: Record<KhoaDon, number> = {
  thu0: TIEN_GD3.thu[0],
  thu1: TIEN_GD3.thu[1],
  thu2: TIEN_GD3.thu[2],
  cap: TIEN_GD3.capHuy,
  tg0: TIEN_GD3.trongGhiChu[0],
  tg1: TIEN_GD3.trongGhiChu[1],
};

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

/** Mã phiếu GIẢ cho ca không cần phiếu thật — chỉ dùng với dòng không bao giờ đi khớp. */
const MA_PHIEU_GIA: MaPhieuGd3 = { thu: ["AAAAA", "AAAAA", "AAAAA"], capHuy: "AAAAA", trongGhiChu: ["AAAAA", "AAAAA"] };

// ── Dọn / dựng ─────────────────────────────────────────────────────────────────

async function don() {
  await db.domainEvent.deleteMany({ where: { OR: TAT_CA_DON.map((id) => ({ payloadJson: { path: ["orderId"], equals: id } })) } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: KT }, { entityType: "Order", entityId: { in: TAT_CA_DON } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: TAT_CA_DON } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { in: MA } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: TAT_CA_DON } } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA } } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: TAT_CA_DON } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: TAT_CA_DON } } });
  await db.creditBalance.deleteMany({ where: { orderId: { in: TAT_CA_DON } } });
  await db.payment.deleteMany({ where: { orderId: { in: TAT_CA_DON } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: TAT_CA_DON } } });
  await db.bankTransaction.deleteMany({ where: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA } } });
  await db.posTerminal.deleteMany({ where: { maThietBi: MAY_CS1 } });
  await db.orderItem.deleteMany({ where: { orderId: { in: TAT_CA_DON } } });
  await db.order.deleteMany({ where: { id: { in: TAT_CA_DON } } });
  await db.center.deleteMany({ where: { id: CS1 } });
  await db.user.deleteMany({ where: { id: KT } });
}

async function dungFixture() {
  await don();
  await db.user.create({ data: { id: KT, name: ACTOR.name, email: `${KT}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] } });
  await db.center.create({ data: { id: CS1, name: "Cơ sở 1 fixture GĐ3", slug: `${T}cs1`, address: "211 Nguyễn Hữu Thọ" } });
  await db.posTerminal.create({ data: { maThietBi: MAY_CS1, maQuay: "QTT45XWQT", centerId: CS1 } });
}

/** Sáu đơn ở CS1, mỗi đơn một đợt + một phiếu gộp đang mở, số phải thu = số tiền của dòng mang mã. */
async function phatPhieu(): Promise<MaPhieuGd3> {
  const ma = {} as Record<KhoaDon, string>;
  let so = 0;
  for (const k of Object.keys(DON) as KhoaDon[]) {
    so += 1;
    const id = DON[k];
    await db.order.create({
      data: {
        id,
        code: `ORD-269939-0003${String(so).padStart(2, "0")}`,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: `Phụ huynh fixture GĐ3 ${k}`,
        customerPhone: `09000003${String(so).padStart(2, "0")}`,
        totalAmount: TIEN_DON[k],
        centerId: CS1,
      },
    });
    await db.orderItem.create({
      data: { id: `${id}-item`, orderId: id, type: "COURSE_ENROLLMENT", itemName: `Bé ${k}`, quantity: 1, unitPrice: TIEN_DON[k], totalPrice: TIEN_DON[k] },
    });
    await db.paymentRequest.create({
      data: { id: `${id}-dot`, orderId: id, orderItemId: `${id}-item`, centerId: CS1, installmentNo: 1, amountDue: TIEN_DON[k], status: "PENDING", sortOrder: 1 },
    });
    const r = await taoPhieuGop({ orderId: id, paymentRequestIds: [`${id}-dot`], actor: ACTOR });
    if (!r.ok) throw new Error(`fixture: không phát được phiếu ${k} — ${r.error}`);
    ma[k] = r.ma;
  }
  return { thu: [ma.thu0, ma.thu1, ma.thu2], capHuy: ma.cap, trongGhiChu: [ma.tg0, ma.tg1] };
}

// ── Đường của màn: zip → docFilePos → catLoPos → schema của action → nhapLoPos ─────

const loSchema = z.object({ dong: z.array(dongPosNhapSchema), dongHuyCuaFile: z.array(dongHuyPosSchema) });
const LO_NHO = { dong: 4, byte: 600_000 };

async function docZip(zip: Uint8Array): Promise<DongPos[]> {
  const kq = await docFilePos(zip, "29092026_USER_TXN.zip");
  if (!kq.ok) throw new Error(`docFilePos từ chối: ${kq.loi}`);
  return kq.dong;
}

type LuotNhap = { batchId: string; kq: KetQuaLoPos; soLo: number; maTheoLo: string[][] };

async function nhapZip(zip: Uint8Array): Promise<LuotNhap> {
  const cacLo = catLoPos(await docZip(zip), LO_NHO);
  const batch = await db.posImportBatch.create({
    data: { tenFile: "29092026_USER_TXN.zip", importedById: KT, soLoTong: cacLo.length },
  });
  let kq: KetQuaLoPos = KET_QUA_RONG;
  for (const [i, lo] of cacLo.entries()) {
    const p = loSchema.parse(lo); // như `nhapLoSchema` của `nhapLoPosAction`
    const r = await nhapLoPos({ batchId: batch.id, lo: i + 1, dong: p.dong, dongHuyCuaFile: p.dongHuyCuaFile, nguoiNhapId: KT });
    expect(r.loi, `lô ${i + 1}: không dòng nào được lỗi`).toEqual([]);
    kq = congKetQua(kq, r);
  }
  return { batchId: batch.id, kq, soLo: cacLo.length, maTheoLo: cacLo.map((l) => l.dong.map((d) => d.maGiaoDich)) };
}

const posRow = (ma: string) =>
  db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: ma }, include: { bankTransaction: true } });
const luot = (id: string) => db.posImportBatch.findUniqueOrThrow({ where: { id } });
const SO_DEM = (b: Awaited<ReturnType<typeof luot>>) => ({
  soDong: b.soDong,
  soMoi: b.soMoi,
  soCapNhat: b.soCapNhat,
  soTuKhop: b.soTuKhop,
  soCanXuLy: b.soCanXuLy,
  soBoQua: b.soBoQua,
  soLoi: b.soLoi,
  soLoXong: b.soLoXong,
});

/** Mọi thứ của SỔ TIỀN mà nhập lại không được đổi. */
async function anhChupSo() {
  const theoDon = { orderId: { in: TAT_CA_DON } };
  const phieu = await db.paymentBill.findMany({ where: theoDon, select: { orderId: true, status: true } });
  const bt = await db.bankTransaction.findMany({
    where: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA } },
    select: { providerTxnId: true, status: true, amount: true },
    orderBy: { providerTxnId: "asc" },
  });
  return {
    soDongPos: await db.posCardTransaction.count({ where: { maGiaoDich: { in: MA } } }),
    giaoDich: bt,
    soPayment: await db.payment.count({ where: theoDon }),
    tongPayment: (await db.payment.aggregate({ where: theoDon, _sum: { amount: true } }))._sum.amount ?? 0,
    soPhanBo: await db.paymentAllocation.count({ where: { paymentRequest: theoDon } }),
    soPhieu: phieu.length,
    soPhieuPos: await db.posPaymentIntent.count({ where: { paymentBill: theoDon } }),
    trangThaiPhieu: Object.fromEntries(phieu.map((p) => [p.orderId, p.status])),
  };
}

describe.skipIf(!RUN_DB_TESTS)("[POS3-DB] GĐ3 — nhập file SmartPOS làm đường dự phòng — DB thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS3-DB-01] lần nhập 1: 3 tự khớp (Payment PENDING), 5 thất bại + cặp hủy BO_QUA, không giao dịch thừa — CA KIỂM FIXTURE", async () => {
    const ma = await phatPhieu();
    const l = await nhapZip(await dungZipGd3(ma));

    // Hình dạng lượt: ≥ 3 lô, cặp Thanh toán + Hủy ở HAI lô khác nhau (gốc ở `_001`, Hủy ở `_000`).
    expect(l.soLo).toBeGreaterThanOrEqual(3);
    const loCua = (m: string) => l.maTheoLo.findIndex((ds) => ds.includes(m));
    expect(loCua(GD3.goc)).toBeGreaterThanOrEqual(0);
    expect(loCua(GD3.huy)).toBeGreaterThanOrEqual(0);
    expect(loCua(GD3.goc), "cặp Thanh toán + Hủy phải rơi vào hai lô").not.toBe(loCua(GD3.huy));

    expect(l.kq).toEqual({ moi: 10, capNhat: 0, tuKhop: 3, canXuLy: 0, boQua: 7, loi: [], lech: [] });
    expect(SO_DEM(await luot(l.batchId))).toEqual({
      soDong: 10,
      soMoi: 10,
      soCapNhat: 0,
      soTuKhop: 3,
      soCanXuLy: 0,
      soBoQua: 7,
      soLoi: 0,
      soLoXong: l.soLo,
    });

    // Ba dòng thành công ⇒ TU_KHOP, giao dịch MATCHED đúng số, cơ sở theo máy.
    for (const [i, m] of GD3.thu.entries()) {
      const r = await posRow(m);
      expect(r.matchStatus, `thu[${i}]`).toBe("TU_KHOP");
      expect(r.maPhieu).toBe(ma.thu[i]);
      expect(r.centerId).toBe(CS1);
      expect(r.bankTransaction?.status).toBe("MATCHED");
      expect(r.bankTransaction?.amount).toBe(TIEN_GD3.thu[i]);
    }
    // Năm dòng thất bại (kể cả dòng mang mã phiếu ĐANG MỞ) + cặp hủy ⇒ BO_QUA, KHÔNG giao dịch.
    for (const m of [...GD3.thatBai, GD3.goc, GD3.huy]) {
      const r = await posRow(m);
      expect(r.matchStatus, m).toBe("BO_QUA");
      expect(r.bankTransactionId, `${m} không sinh giao dịch`).toBeNull();
    }
    expect((await posRow(GD3.huy)).matchReason).toContain("Hủy giao dịch gốc");
    const bt = await db.bankTransaction.findMany({ where: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA } } });
    expect(bt.map((b) => b.providerTxnId).sort()).toEqual([...GD3.thu].sort());

    // Tiền: đúng 3 Payment card_pos PENDING (kế toán chưa duyệt), mỗi phiếu thành công một khoản đúng số.
    for (const [i, k] of (["thu0", "thu1", "thu2"] as const).entries()) {
      const khoan = await db.payment.findMany({ where: { orderId: DON[k] } });
      expect(khoan, k).toHaveLength(1);
      expect(khoan[0]).toMatchObject({ amount: TIEN_GD3.thu[i], method: "card_pos", accountantStatus: "PENDING" });
      expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON[k] } })).status, k).toBe("PAID");
    }
    // Phiếu của cặp hủy + hai phiếu chỉ nằm trong ghi chú của dòng THẤT BẠI ⇒ VẪN MỞ, 0 tiền.
    for (const k of ["cap", "tg0", "tg1"] as const) {
      expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON[k] } })).status, k).toBe("OPEN");
      expect(await db.payment.count({ where: { orderId: DON[k] } }), k).toBe(0);
      expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON[k] } } }), k).toBe(0);
    }
  });

  it("[POS3-DB-02] nhập LẦN 2 cùng zip (lượt mới) ⇒ KHÔNG nhân đôi gì; mọi dòng vào 'Cập nhật'", async () => {
    const ma = await phatPhieu();
    const zip = await dungZipGd3(ma);
    await nhapZip(zip);
    const truoc = await anhChupSo();
    expect(truoc).toMatchObject({ soDongPos: 10, soPayment: 3, soPhieu: 6 });

    const l2 = await nhapZip(zip);
    expect(await anhChupSo()).toEqual(truoc);
    // V13: Tự khớp / Cần xử lý / Bỏ qua là kết luận Ở LƯỢT NÀY. Dòng đã khoá (3 thành công) và dòng
    // Hủy đã kết luận chỉ vào "Cập nhật"; 6 = 5 thất bại + gốc của cặp — dòng CHƯA khoá, được xét lại.
    expect(l2.kq).toEqual({ moi: 0, capNhat: 10, tuKhop: 0, canXuLy: 0, boQua: 6, loi: [], lech: [] });
    expect(SO_DEM(await luot(l2.batchId))).toEqual({
      soDong: 10,
      soMoi: 0,
      soCapNhat: 10,
      soTuKhop: 0,
      soCanXuLy: 0,
      soBoQua: 6,
      soLoi: 0,
      soLoXong: l2.soLo,
    });
  });

  it("[POS3-DB-03] zip _000 + _001: mọi mã CHỈ có ở _001 đều vào DB, đúng trạng thái", async () => {
    const ma = await phatPhieu();
    await nhapZip(await dungZipGd3(ma));
    expect(MA_CHI_O_001).toHaveLength(4);
    const kq = Object.fromEntries(
      (await db.posCardTransaction.findMany({ where: { maGiaoDich: { in: [...MA_CHI_O_001] } } })).map((r) => [
        r.maGiaoDich,
        r.matchStatus,
      ]),
    );
    expect(kq).toEqual({
      [GD3.goc]: "BO_QUA",
      [GD3.thu[2]]: "TU_KHOP",
      [GD3.thatBai[3]]: "BO_QUA",
      [GD3.thatBai[4]]: "BO_QUA",
    });
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON.thu2 } })).status).toBe("PAID");
  });

  it("[POS3-DB-04] nhập lại: dòng ĐÃ GHI NHẬN chỉ đổi Mã hạch toán + Phí; số tiền khác ⇒ KHÔNG đổi, BÁO lệch", async () => {
    const ma = await phatPhieu();
    const { phan000, phan001 } = dungDongGd3(ma);
    await nhapZip(await dungZipGd3(ma));
    const truoc = await anhChupSo();
    const cu = await posRow(GD3.thu[0]);

    // File ngày sau: mọi dòng đã kết toán (Mã hạch toán + Phí); riêng thu[0] đổi số tiền, ghi chú, giờ.
    const ketToan = (ds: DongThat[], dau: string) =>
      ds.map((d, i) => ({ ...d, "Mã hạch toán": `${dau}${String(i).padStart(4, "0")}`, "Phí giao dịch": 1_100 }));
    const p0 = suaDong(ketToan(phan000, "FT2627301"), GD3.thu[0], {
      "Số tiền thanh toán": TIEN_GD3.thu[0] + 1,
      "Diễn giải đơn hàng": `${ma.thu[0]} sua`,
      "Thời gian giao dịch": "2026/09/29 19:41:19",
    });
    const l = await nhapZip(await dungZipGd3(ma, { phan000: p0, phan001: ketToan(phan001, "FT2627302") }));

    const sau = await posRow(GD3.thu[0]);
    expect(sau.maHachToan).toBe("FT26273010000");
    expect(sau.phiGiaoDich).toBe(1_100);
    const goc = (r: typeof cu) => ({
      soTien: r.soTien,
      trangThai: r.trangThai,
      dienGiai: r.dienGiai,
      thoiGianGiaoDich: r.thoiGianGiaoDich.toISOString(),
      matchStatus: r.matchStatus,
      matchReason: r.matchReason,
      maPhieu: r.maPhieu,
    });
    expect(goc(sau)).toEqual(goc(cu));
    expect(await anhChupSo(), "sổ tiền không đổi một đồng").toEqual(truoc);

    expect(l.kq.lech).toEqual([
      { maGiaoDich: GD3.thu[0], truong: "soTien", daGhiNhan: fmt(TIEN_GD3.thu[0]), trongFile: fmt(TIEN_GD3.thu[0] + 1) },
    ]);
    // Đối chứng dương: thu[1] cũng đã ghi nhận, cũng nhận Mã hạch toán mới — nhưng KHÔNG lệch.
    expect(l.kq.lech.some((x) => x.maGiaoDich === GD3.thu[1])).toBe(false);
    expect((await posRow(GD3.thu[1])).maHachToan).toMatch(/^FT2627301/);
  });

  it("[POS3-DB-04b] nhập lại: dòng đã ghi nhận mà file nói 'Thất bại' ⇒ sổ KHÔNG đổi, BÁO lệch trạng thái", async () => {
    const ma = await phatPhieu();
    const { phan000, phan001 } = dungDongGd3(ma);
    await nhapZip(await dungZipGd3(ma));
    const truoc = await anhChupSo();

    const p0 = suaDong(phan000, GD3.thu[1], { "Trạng thái giao dịch": "Thất bại" });
    const l = await nhapZip(await dungZipGd3(ma, { phan000: p0, phan001 }));

    expect(await anhChupSo()).toEqual(truoc);
    const r = await posRow(GD3.thu[1]);
    expect(r.trangThai).toBe("Thành công");
    expect(r.matchStatus).toBe("TU_KHOP");
    expect(r.bankTransaction?.status).toBe("MATCHED");
    expect(l.kq.lech).toEqual([
      { maGiaoDich: GD3.thu[1], truong: "trangThai", daGhiNhan: "Thành công", trongFile: "Thất bại" },
    ]);
  });

  it("[POS3-DB-04c] giao dịch ĐÃ BỎ QUA mà file ghi số khác ⇒ KHÔNG báo (không tiền trong sổ); đối chứng: đã ghi nhận ⇒ báo", async () => {
    // Lệch chỉ báo cho dòng ĐÃ GHI NHẬN (giao dịch MATCHED): khối báo trên màn nói "đã ghi nhận … gỡ gắn
    // / hoàn" — liệt kê một giao dịch đã BỎ QUA dưới câu đó là nói sai (luật 12).
    const ma = await phatPhieu();
    const { phan000, phan001 } = dungDongGd3(ma);
    // thu[1] quên ghi mã ⇒ CAN_XU_LY, giao dịch UNMATCHED; kế toán bấm "Bỏ qua" ⇒ IGNORED (giả lập trạng thái).
    const p0 = suaDong(phan000, GD3.thu[1], { "Diễn giải đơn hàng": "quen ma" });
    await nhapZip(await dungZipGd3(ma, { phan000: p0, phan001 }));
    const bt1 = (await posRow(GD3.thu[1])).bankTransaction!;
    expect(bt1.status).toBe("UNMATCHED");
    await db.bankTransaction.update({ where: { id: bt1.id }, data: { status: "IGNORED", unmatchedNote: "Bỏ qua tay (fixture GĐ3)" } });

    // Nhập lại: CẢ thu[1] (đã bỏ qua) và thu[0] (đã ghi nhận) đổi số tiền.
    const p0b = suaDong(suaDong(p0, GD3.thu[1], { "Số tiền thanh toán": TIEN_GD3.thu[1] + 5 }), GD3.thu[0], {
      "Số tiền thanh toán": TIEN_GD3.thu[0] + 5,
    });
    const l = await nhapZip(await dungZipGd3(ma, { phan000: p0b, phan001 }));
    expect(l.kq.lech.map((x) => x.maGiaoDich)).toEqual([GD3.thu[0]]);
    // Dòng + giao dịch đã bỏ qua giữ nguyên (đã khoá — không phân loại lại, không đổi số).
    const r1 = await posRow(GD3.thu[1]);
    expect(r1.soTien).toBe(TIEN_GD3.thu[1]);
    expect(r1.bankTransaction).toMatchObject({ status: "IGNORED", amount: TIEN_GD3.thu[1] });
  });

  it("[POS3-DB-05] V8: ô TRỐNG không xoá Mã hạch toán / Phí / Hoàn-Hủy đã có của dòng đã khoá; file có giá trị ⇒ ghi mới", async () => {
    const ma = await phatPhieu();
    const { phan000, phan001 } = dungDongGd3(ma);
    const zipNgayDau = await dungZipGd3(ma);
    await nhapZip(zipNgayDau);

    // File ngày sau: thu[0] đã kết toán VÀ bị hủy sau khi đã ghi nhận (D7 — cảnh báo, không tự đảo).
    await nhapZip(
      await dungZipGd3(ma, {
        phan000: suaDong(phan000, GD3.thu[0], {
          "Mã hạch toán": "FT2627300001",
          "Phí giao dịch": 1_100,
          "Trạng thái Hoàn/Hủy": "Hủy toàn phần",
        }),
        phan001,
      }),
    );
    const sauNgaySau = await posRow(GD3.thu[0]);
    expect(sauNgaySau).toMatchObject({
      maHachToan: "FT2627300001",
      phiGiaoDich: 1_100,
      trangThaiHoanHuy: "Hủy toàn phần",
      canhBaoHuy: true,
    });

    // Nhập LẠI file ngày đầu (ba ô trống) — mã TRƯỚC bản vá xoá cả ba, kể cả tín hiệu hủy mà
    // `tcb-file.ts` đọc để không báo xanh một lần quẹt đã hoàn về thẻ khách.
    await nhapZip(zipNgayDau);
    expect(await posRow(GD3.thu[0])).toMatchObject({
      maHachToan: "FT2627300001",
      phiGiaoDich: 1_100,
      trangThaiHoanHuy: "Hủy toàn phần",
      canhBaoHuy: true,
    });

    // Đối chứng dương: file mang giá trị KHÁC ⇒ ghi giá trị mới.
    await nhapZip(
      await dungZipGd3(ma, {
        phan000: suaDong(phan000, GD3.thu[0], {
          "Mã hạch toán": "FT2627300002",
          "Phí giao dịch": 1_200,
          "Trạng thái Hoàn/Hủy": "Hoàn toàn phần",
        }),
        phan001,
      }),
    );
    expect(await posRow(GD3.thu[0])).toMatchObject({
      maHachToan: "FT2627300002",
      phiGiaoDich: 1_200,
      trangThaiHoanHuy: "Hoàn toàn phần",
    });
    // Tiền đã vào sổ không bị tự đảo.
    expect(await db.payment.count({ where: { orderId: DON.thu0 } })).toBe(1);
    expect((await posRow(GD3.thu[0])).bankTransaction?.status).toBe("MATCHED");
  });

  it("[POS3-DB-06] V11: gửi LẠI cùng lô (trả lời bị mất) ⇒ số đếm không cộng lần hai, updatedAt không đổi; lô kế tiếp cộng tiếp", async () => {
    const ma = await phatPhieu();
    const cacLo = catLoPos(await docZip(await dungZipGd3(ma)), LO_NHO);
    const batch = await db.posImportBatch.create({
      data: { tenFile: "29092026_USER_TXN.zip", importedById: KT, soLoTong: cacLo.length },
    });
    const lo1 = loSchema.parse(cacLo[0]);
    const r1 = await nhapLoPos({ batchId: batch.id, lo: 1, ...lo1, nguoiNhapId: KT });
    expect(r1).toMatchObject({ moi: 4, capNhat: 0, tuKhop: 2, boQua: 2, loi: [], lech: [] });
    const b1 = await luot(batch.id);
    expect(SO_DEM(b1)).toEqual({ soDong: 4, soMoi: 4, soCapNhat: 0, soTuKhop: 2, soCanXuLy: 0, soBoQua: 2, soLoi: 0, soLoXong: 1 });
    const so1 = await anhChupSo();

    // Gửi LẠI lô 1: dòng xử lý lại (idempotent), kết quả ĐẦY ĐỦ vẫn trả về màn — nhưng lượt không cộng.
    const r2 = await nhapLoPos({ batchId: batch.id, lo: 1, ...lo1, nguoiNhapId: KT });
    expect(Object.keys(r2).sort()).toEqual(["boQua", "canXuLy", "capNhat", "lech", "loi", "moi", "soDemLuot", "tuKhop"]);
    expect(r2).toMatchObject({ moi: 0, capNhat: 4, tuKhop: 0, loi: [], lech: [] });
    const b2 = await luot(batch.id);
    expect(SO_DEM(b2)).toEqual(SO_DEM(b1));
    // Rà đối kháng GĐ3 (#4): kết quả lô mang SỐ ĐẾM CỦA LƯỢT đọc từ DB sau câu đếm — màn hiện đúng số này,
    // nên lô gửi lại (số của lô ≠ số đã đếm) không làm panel lệch lịch sử import.
    const soDemB1 = { moi: b1.soMoi, capNhat: b1.soCapNhat, tuKhop: b1.soTuKhop, canXuLy: b1.soCanXuLy, boQua: b1.soBoQua };
    expect(r1.soDemLuot).toEqual(soDemB1);
    expect(r2.soDemLuot, "lô gửi lại: số của LƯỢT, không phải số của lần xử lý lại").toEqual(soDemB1);
    expect(tongLuotSauLo(r1, r2)).toMatchObject(soDemB1);
    expect(b2.updatedAt.toISOString(), "câu đếm đổi 0 dòng ⇒ không chạm updatedAt").toBe(b1.updatedAt.toISOString());
    expect(await anhChupSo(), "không tiền nào ghi lần hai").toEqual(so1);

    // Đối chứng dương: lô 2 sau lô 1 ⇒ cộng tiếp.
    const lo2 = loSchema.parse(cacLo[1]);
    await nhapLoPos({ batchId: batch.id, lo: 2, ...lo2, nguoiNhapId: KT });
    const b3 = await luot(batch.id);
    expect(b3.soLoXong).toBe(2);
    expect(b3.soDong).toBe(4 + lo2.dong.length);
    expect(b3.soMoi).toBe(4 + lo2.dong.length);
  });

  it("[POS3-DB-07] V7(ii): giao dịch đã vào sổ từ nguồn KHÁC file (số A), file mang số B ⇒ dòng POS ghi B, sổ GIỮ A, báo lệch", async () => {
    const ma = await phatPhieu();
    const zip = await dungZipGd3(ma);
    const dThu0 = (await docZip(zip)).find((d) => d.maGiaoDich === GD3.thu[0])!;
    const A = TIEN_GD3.thu[0];
    const B = A + 1_000;

    // Nút "Kiểm tra" với provider không phải file (FAKE) ghi giao dịch TRƯỚC — chưa có dòng POS.
    const kl = await khopGiaoDichThe({ d: dThu0, nguonDuLieu: "FAKE" });
    expect(kl.tien?.loai).toBe("DA_CHIA");
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: GD3.thu[0] } })).toBe(0);
    const btTruoc = await db.bankTransaction.findUniqueOrThrow({
      where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: GD3.thu[0] } },
    });
    expect(btTruoc).toMatchObject({ status: "MATCHED", amount: A });

    const { phan000, phan001 } = dungDongGd3(ma);
    const p0 = suaDong(phan000, GD3.thu[0], { "Số tiền thanh toán": B, "Số tiền đơn hàng": B });
    const l = await nhapZip(await dungZipGd3(ma, { phan000: p0, phan001 }));

    const r = await posRow(GD3.thu[0]);
    expect(r.soTien, "dòng POS là bản ghi của FILE").toBe(B);
    expect(r.matchStatus).toBe("TU_KHOP");
    expect(r.bankTransactionId).toBe(btTruoc.id);
    expect(r.bankTransaction?.amount, "sổ giữ số đã ghi").toBe(A);
    const khoan = await db.payment.findMany({ where: { orderId: DON.thu0 } });
    expect(khoan).toHaveLength(1);
    expect(khoan[0]!.amount).toBe(A);
    expect(l.kq.lech).toEqual([{ maGiaoDich: GD3.thu[0], truong: "soTien", daGhiNhan: fmt(A), trongFile: fmt(B) }]);
    // Rà đối kháng GĐ3 (#3): "Tự khớp" = khớp MỚI ở lượt này (V13). thu[0] đã vào sổ TRƯỚC lượt (nút Kiểm
    // tra) ⇒ không đếm; chỉ thu[1], thu[2] do CHÍNH lượt này chia tiền. Mã TRƯỚC bản vá đếm 3.
    expect(l.kq.tuKhop).toBe(2);
    expect((await luot(l.batchId)).soTuKhop).toBe(2);
  });

  it("[POS3-DB-08] V12: hai dòng TRÙNG mã trong một lô ⇒ soDong đếm SAU khử trùng; Mới + Cập nhật + Lỗi = soDong", async () => {
    // Dòng thất bại không mang mã phiếu nào ("0900000001") ⇒ không cần phiếu thật.
    const d = (await docZip(await dungZipGd3(MA_PHIEU_GIA))).find((x) => x.maGiaoDich === GD3.thatBai[0])!;
    const batch = await db.posImportBatch.create({ data: { tenFile: "trung.xlsx", importedById: KT, soLoTong: 1 } });
    const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: [d, { ...d }], dongHuyCuaFile: [], nguoiNhapId: KT });
    expect(kq).toMatchObject({ moi: 1, capNhat: 0, boQua: 1, loi: [] });
    const b = await luot(batch.id);
    expect(b.soDong).toBe(1);
    expect(b.soMoi + b.soCapNhat + b.soLoi).toBe(b.soDong);
  });

  it("[POS3-DB-09] PII: không cột nào của dòng POS / giao dịch mang tên chủ thẻ hay số thẻ đầy đủ", async () => {
    const ma = await phatPhieu();
    await nhapZip(await dungZipGd3(ma));
    const SO_THE = /(?<!\d)\d{13,19}(?!\d)/;
    const rows = await db.posCardTransaction.findMany({ where: { maGiaoDich: { in: MA } } });
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v !== "string") continue;
        expect(v, `${r.maGiaoDich}.${k}`).not.toContain(TEN_CHU_THE_GIA);
        expect(v, `${r.maGiaoDich}.${k}`).not.toContain("Tên chủ thẻ");
        expect(v, `${r.maGiaoDich}.${k}`).not.toMatch(SO_THE);
      }
    }
    // File lỡ ghi số thẻ ĐẦY ĐỦ ⇒ vào DB đã che.
    expect((await posRow(GD3.thu[2])).soTheMasked).toBe(`${SO_THE_DAY_DU.slice(0, 6)}******${SO_THE_DAY_DU.slice(-4)}`);
    const bt = await db.bankTransaction.findMany({ where: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA } } });
    expect(bt).toHaveLength(3);
    for (const b of bt) {
      const tho = JSON.stringify(b.rawPayload);
      expect(tho).not.toContain(TEN_CHU_THE_GIA);
      expect(tho, "rawPayload không mang số thẻ, kể cả bản che").not.toMatch(/\*|4111/);
      expect(tho).not.toMatch(SO_THE);
      expect(`${b.content ?? ""} ${b.referenceCode ?? ""}`).not.toMatch(SO_THE);
    }
  });
  // ── RÀ ĐỐI KHÁNG GĐ3 (06/10/2026) ────────────────────────────────────────────────

  it("[POS3-DB-10] file MỚI (cột 'Hủy toàn phần', không dòng Hủy) rồi file CŨ (cột trống) ⇒ vẫn BỎ QUA: 0 giao dịch, 0 Payment, phiếu MỞ, cột giữ nguyên", async () => {
    // Mã TRƯỚC bản vá: dòng BO_QUA không có giao dịch là "chưa khoá" ⇒ file cũ phân loại lại theo ô TRỐNG
    // ⇒ THU ⇒ Payment card_pos + phiếu PAID cho một lần quẹt ĐÃ HỦY; `ghiDong` còn xoá luôn cột Hoàn/Hủy.
    const ma = await phatPhieu();
    const { phan000, phan001 } = dungDongGd3(ma);
    const zipNgayDau = await dungZipGd3(ma);
    await nhapZip(
      await dungZipGd3(ma, {
        phan000: suaDong(phan000, GD3.thu[0], {
          "Trạng thái Hoàn/Hủy": "Hủy toàn phần",
          "Mã hạch toán": "FT2627300009",
          "Phí giao dịch": 1_100,
        }),
        phan001,
      }),
    );
    const truoc = await posRow(GD3.thu[0]);
    expect(truoc).toMatchObject({ matchStatus: "BO_QUA", bankTransactionId: null, trangThaiHoanHuy: "Hủy toàn phần" });

    const l = await nhapZip(zipNgayDau);
    const sau = await posRow(GD3.thu[0]);
    expect(sau).toMatchObject({
      matchStatus: "BO_QUA",
      matchReason: LY_DO_HUY_TOAN_PHAN,
      bankTransactionId: null,
      trangThaiHoanHuy: "Hủy toàn phần",
      maHachToan: "FT2627300009",
      phiGiaoDich: 1_100,
    });
    expect(
      await db.bankTransaction.count({ where: { provider: PROVIDER_THE_POS, providerTxnId: GD3.thu[0] } }),
      "không sinh giao dịch cho lần quẹt đã hủy",
    ).toBe(0);
    expect(await db.payment.count({ where: { orderId: DON.thu0 } })).toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON.thu0 } })).status).toBe("OPEN");
    // Đối chứng dương: thu[1] (không mang tín hiệu hủy) vẫn khớp được ở lượt đầu — cổng này không chặn nó.
    expect(await db.payment.count({ where: { orderId: DON.thu1 } })).toBe(1);
    expect(l.kq.tuKhop).toBe(0);
  });

  it("[POS3-DB-10b] lượt DỪNG trước lô chứa dòng Hủy (gốc BO_QUA nhờ dòng Hủy đi kèm) rồi nhập bản CŨ ⇒ gốc vẫn BỎ QUA, phiếu MỞ", async () => {
    // Hình dạng file thật 29/09: `catLoPos` xếp MỌI dòng Hủy xuống cuối, dòng Hủy chỉ đi kèm gốc qua
    // `dongHuyCuaFile` ⇒ dừng trước lô cuối là dòng Hủy KHÔNG được lưu, gốc chỉ còn `matchReason`.
    const ma = await phatPhieu();
    const { phan000, phan001 } = dungDongGd3(ma);
    const cotTrong = (ds: DongThat[]) => suaDong(ds, GD3.goc, { "Trạng thái Hoàn/Hủy": "" });
    const cacLo = catLoPos(await docZip(await dungZipGd3(ma, { phan000, phan001: cotTrong(phan001) })), LO_NHO);
    const iGoc = cacLo.findIndex((lo) => lo.dong.some((d) => d.maGiaoDich === GD3.goc));
    expect(iGoc).toBeGreaterThanOrEqual(0);
    expect(cacLo[iGoc]!.dong.some((d) => d.maGiaoDich === GD3.huy), "dòng Hủy ở lô KHÁC").toBe(false);
    expect(cacLo[iGoc]!.dongHuyCuaFile.map((d) => d.maGiaoDich)).toContain(GD3.huy);

    const batch = await db.posImportBatch.create({
      data: { tenFile: "29092026_USER_TXN.zip", importedById: KT, soLoTong: cacLo.length },
    });
    const p = loSchema.parse(cacLo[iGoc]);
    const r = await nhapLoPos({ batchId: batch.id, lo: 1, dong: p.dong, dongHuyCuaFile: p.dongHuyCuaFile, nguoiNhapId: KT });
    expect(r.loi).toEqual([]);
    expect(await posRow(GD3.goc)).toMatchObject({
      matchStatus: "BO_QUA",
      matchReason: LY_DO_HUY_TOAN_PHAN,
      bankTransactionId: null,
      trangThaiHoanHuy: null,
    });
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: GD3.huy } }), "dòng Hủy chưa được lưu").toBe(0);

    // Bản xuất CŨ của cùng ngày: chưa có dòng Hủy, cột Hoàn/Hủy của gốc trống.
    await nhapZip(
      await dungZipGd3(ma, {
        phan000: phan000.filter((d) => String(d["Mã giao dịch"]) !== GD3.huy),
        phan001: cotTrong(phan001),
      }),
    );
    expect(await posRow(GD3.goc)).toMatchObject({ matchStatus: "BO_QUA", bankTransactionId: null });
    expect(await db.bankTransaction.count({ where: { provider: PROVIDER_THE_POS, providerTxnId: GD3.goc } })).toBe(0);
    expect(await db.payment.count({ where: { orderId: DON.cap } })).toBe(0);
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON.cap } })).status).toBe("OPEN");
  });

  it("[POS3-DB-11] V8 khi ĐUA: lượt khác ghi kết toán + 'Hủy toàn phần' GIỮA lúc lượt file ngày đầu chạy ⇒ ô trống KHÔNG đè", async () => {
    // Mã TRƯỚC bản vá: `cotKetToanCapNhat` trả lại giá trị CŨ của ẢNH CHỤP ĐẦU LÔ khi ô trống và ghi nó
    // TƯỜNG MINH ⇒ đè mất giá trị lượt song song vừa commit (đo: {cot:null, ht:null, phi:null}).
    const ma = await phatPhieu();
    const zipNgayDau = await dungZipGd3(ma);
    await nhapZip(zipNgayDau);
    expect((await posRow(GD3.thu[0])).bankTransaction?.status).toBe("MATCHED");

    /** Chờ tới khi một câu UPDATE dòng POS ĐỨNG CHỜ KHOÁ (đếm lượt hỏi, không đọc đồng hồ). */
    const choCauGhiDangCho = async () => {
      for (let i = 0; i < 400; i++) {
        const [r] = await db.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%UPDATE%PosCardTransaction%'`;
        if ((r?.n ?? 0) > 0) return;
        await new Promise((ok) => setTimeout(ok, 25));
      }
      throw new Error("không thấy câu ghi dòng POS đứng chờ khoá");
    };

    let chay: Promise<LuotNhap> | null = null;
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "PosCardTransaction" WHERE "maGiaoDich" = ${GD3.thu[0]} FOR UPDATE`;
          chay = nhapZip(zipNgayDau);
          await choCauGhiDangCho();
          await tx.posCardTransaction.update({
            where: { maGiaoDich: GD3.thu[0] },
            data: { maHachToan: "FT-SONG-SONG", phiGiaoDich: 1_100, trangThaiHoanHuy: "Hủy toàn phần" },
          });
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } finally {
      if (chay) await chay;
    }
    expect(await posRow(GD3.thu[0])).toMatchObject({
      maHachToan: "FT-SONG-SONG",
      phiGiaoDich: 1_100,
      trangThaiHoanHuy: "Hủy toàn phần",
    });
  });

  it("[POS3-DB-12] hai lượt nhập CÙNG file chạy SONG SONG ⇒ tiền một lần; 'Tự khớp' cộng hai lượt = 3, không 6", async () => {
    const ma = await phatPhieu();
    const zip = await dungZipGd3(ma);
    const [a, b] = await Promise.all([nhapZip(zip), nhapZip(zip)]);
    const so = await anhChupSo();
    expect(so).toMatchObject({ soPayment: 3, soPhanBo: 3 });
    expect(so.giaoDich).toHaveLength(3);
    expect(a.kq.tuKhop + b.kq.tuKhop).toBe(3);
    expect((await luot(a.batchId)).soTuKhop + (await luot(b.batchId)).soTuKhop).toBe(3);
  });
});
