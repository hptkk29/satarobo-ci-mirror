// tests/finance/pos-gd1.test.ts — GĐ1 THU HỌC PHÍ BẰNG THẺ POS: phiếu thu thẻ + nút Kiểm tra +
// sự kiện sau DA_CHIA. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-the.test.ts`).
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §8. Đi qua ĐÚNG cửa đời thật: tạo phiếu bằng `moPhieuPos`
// (chính hàm action gọi), kết quả máy qua `xuLyKetQuaPos` / `kiemTraPhieuPos`, file qua `nhapLoPos`,
// QR qua `ingestPayosWebhook`, gỡ gắn qua `goGanTheoCon`, sự kiện qua chính handler đăng ký.
//
// Fixture cố ý KHÔNG tròn số và có HAI con (một phiếu gộp ⇒ hai dòng `Payment`); giờ quẹt thẻ cách
// xa `now` để `paidDate = now` không trùng may với giờ quẹt. Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm
// có `now` đều được truyền mốc tuyệt đối.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docPhieuGopDangMo, huyPhieuGop, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { goGanTheoCon } from "@/lib/finance/ghi-tien-don";
import { writeAudit } from "@/lib/audit/audit-log";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { recomputeRequestStatuses } from "@/lib/payments/payment-request";
import { dungMemo } from "@/lib/payments/memo-ck";
import { hoanViSoThuTu } from "@/lib/payments/cap-phat-ma";
import { sinhMa } from "@/lib/payments/ma-phieu";
import { publishEvent } from "@/lib/events/publish";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { getHandlers } from "@/lib/events/registry";
import { nhapLoPos, khopGiaoDichThe, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongHuyPos, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { TcbFileImportProvider } from "@/lib/payments/pos/provider/tcb-file";
import { kiemTraPhieuPos, xuLyKetQuaPos, type TriggeredBy } from "@/lib/payments/pos/xu-ly-ket-qua";
import { baoAdminPhieuPos, docPhieuPosTho, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { dungPhieuPosChoDon } from "@/lib/payments/pos/phieu-pos-luat";
import { dongBoPhieuPosSauNhap } from "@/lib/payments/pos/dong-bo-sau-nhap";
import { docPayloadDaChia, xuLyPhieuGopDaChia } from "@/lib/payments/sau-da-chia";

if (!RUN_DB_TESTS) console.warn(`[POS1-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos1gd-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS1GD";

const KT = `${T}kt`; // Kế toán HO — người nhập file + vai HO_ACCOUNTANT (người nhận "Báo admin")
const SALE = `${T}sale`; // sale phụ trách lead + người lập đơn + người tạo phiếu POS
const ADMIN = `${T}admin`; // Quản trị tối cao (vai SUPER_ADMIN)
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const LEAD = `${T}lead`;
const MAY1 = `${PFX}MAY01`;
const MAY2 = `${PFX}MAY02`;
const TPL = `${T}tpl-bien-nhan`;
const SDT_PH = "0399812345";
const EMAIL_PH = `${T}ph@test.local`;
const ACTOR = { id: SALE, name: "Sale fixture POS1" };

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000

/** Lúc tạo phiếu POS (17:00 giờ VN). */
const NOW = new Date("2026-10-06T10:00:00Z");
/** Giờ quẹt thẻ (giờ VN) — SAU lúc tạo phiếu, TRƯỚC lúc bấm Kiểm tra. */
const GIO_QUET = "2026-10-06T17:31:35+07:00";
/** Lúc bấm Kiểm tra. */
const KIEM = new Date("2026-10-06T10:40:00Z");
const PHUT = 60_000;
const GIO = 60 * PHUT;

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
let soSepay = 0;
const maSepay = () => `${T}sepay-${++soSepay}`;

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { OR: [{ providerTxnId: { startsWith: PFX } }, { providerTxnId: { startsWith: T } }] };

async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], equals: DON } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: T } } });
  // GĐ2: nhật ký kiểm (`PosCheckLog`) trỏ phiếu POS bằng khoá ngoại RESTRICT ⇒ xoá TRƯỚC phiếu POS.
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: { orderId: DON } } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: DON } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.emailLog.deleteMany({ where: { OR: [{ contextType: "Order", contextId: DON }, { toEmail: EMAIL_PH }] } });
  await db.emailTemplate.deleteMany({ where: { code: TPL } });
  await db.auditLog.deleteMany({
    where: { OR: [{ entityType: "Order", entityId: DON }, { actorId: { in: [KT, SALE, ADMIN] } }, { entityId: LEAD }] },
  });
  await db.orderStatusHistory.deleteMany({ where: { orderId: DON } });
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
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.user.deleteMany({
    where: { OR: [{ id: { in: [KT, SALE, ADMIN] } }, { email: EMAIL_PH }, { phone: { in: [SDT_PH, "84399812345"] } }] },
  });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function vai(code: string): Promise<string> {
  const r = await db.roleDef.upsert({ where: { code }, create: { code, name: code }, update: {}, select: { id: true } });
  return r.id;
}

async function dungFixture() {
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", "Kế toán HO fixture POS1"],
    [SALE, "SALES_CSM", "Sale fixture POS1"],
    [ADMIN, "SUPER_ADMIN", "Quản trị fixture POS1"],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  // "Báo admin" (T17) gửi Kế toán HO ∪ Quản trị tối cao — đọc từ VAI (UserOrgRole), không từ User.role.
  // `effectiveFrom` TUYỆT ĐỐI (luật 19): để mặc định `now()` của DB là ca hẹn giờ nổ — chạy bộ này sau
  // ngày 06/10/2026 thì vai "chưa hiệu lực" so với mốc `now` đóng băng ⇒ không ai nhận báo.
  const HIEU_LUC = new Date("2026-01-01T00:00:00Z");
  await db.userOrgRole.create({
    data: { userId: ADMIN, orgUnitId: `${T}ou-goc`, roleId: await vai("SUPER_ADMIN"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
  });
  await db.userOrgRole.create({
    data: { userId: KT, orgUnitId: `${T}ou-ho`, roleId: await vai("HO_ACCOUNTANT"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
  });

  for (const [id, ten] of [
    [CS1, "CS1 fixture POS1GD"],
    [CS2, "CS2 fixture POS1GD"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: "QTTFBKATK", centerId: CS2 } });
  await db.emailTemplate.create({
    data: {
      code: TPL,
      name: "Biên nhận fixture POS1",
      trigger: "PAYMENT_RECEIPT",
      subject: "Biên nhận {{order_code}}",
      bodyText: "Đã thanh toán {{total_amount}} · {{payment_method}}",
      bodyHtml: "<p>Đã thanh toán {{total_amount}} · {{payment_method}}</p>",
    },
  });
  await db.lead.create({
    data: { id: LEAD, parentName: "PH fixture POS1", phone: "0399812346", assignedToId: SALE, status: "CHO_QUYET_DINH" },
  });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269979-000123",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture POS1",
      customerPhone: SDT_PH,
      customerEmail: EMAIL_PH,
      totalAmount: TONG,
      centerId: CS1,
      leadId: LEAD,
      createdById: SALE,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A POS1", DOT_TIEN_A],
    [B, "Bé B POS1", DOT_TIEN_B],
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
      data: { id, orderId: DON, orderItemId: item, centerId: CS1, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: thuTu },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function phatPhieu(ids: string[] = [DOT_A, DOT_B]) {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}

async function moPhieu(o: { now?: Date; dot?: string; may?: string } = {}) {
  const r = await moPhieuPos({
    orderId: DON,
    paymentRequestId: o.dot ?? DOT_A,
    ...(o.may ? { posTerminalId: o.may } : {}),
    actor: ACTOR,
    now: o.now ?? NOW,
  });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  return r.phieu;
}

const phieuPos = (id: string) => db.posPaymentIntent.findUniqueOrThrow({ where: { id } });

function paid(p: Partial<PosCheckResult> & { providerTxnId: string; dienGiai: string }): PosCheckResult {
  return {
    kind: "PAID",
    amount: TONG,
    paidAt: GIO_QUET,
    approvalCode: "123456",
    cardMasked: "411111******1111",
    terminalCode: MAY1,
    ...p,
  };
}

function xuLy(intentId: string, ketQua: PosCheckResult, triggeredBy: TriggeredBy = "SALE", now: Date = KIEM) {
  return xuLyKetQuaPos({ intentId, ketQua, triggeredBy, now, nguonDuLieu: "FAKE" });
}

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TONG,
    thoiGian: GIO_QUET,
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: "998877665544",
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: "QTT45XWQT",
    maThietBi: MAY1,
    soTheMasked: "411111******1111",
    loaiThe: "VISA",
    maHachToan: null,
    phiGiaoDich: null,
    ...p,
  };
}

/** Một lượt import (đúng thứ màn làm: mở lượt, ghi lô, đánh dấu XONG). */
async function nhapFile(dongs: DongPos[]): Promise<KetQuaLoPos> {
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture.xlsx", importedById: KT, soLoTong: 1 } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: [], nguoiNhapId: KT });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  await db.posImportBatch.update({ where: { id: batch.id }, data: { soLoXong: 1, trangThai: "XONG" } });
  return kq;
}

const tcb = new TcbFileImportProvider();
// GĐ2: `nguoiKiemId` BẮT BUỘC (luật 7). Bộ GĐ1 không soi nhật ký ⇒ `null` (lượt máy).
const kiem = (intentId: string, triggeredBy: TriggeredBy = "SALE", now: Date = KIEM) =>
  kiemTraPhieuPos({ intentId, provider: tcb, triggeredBy, now, nguoiKiemId: null });

const btThe = (ma: string) =>
  db.bankTransaction.findUnique({
    where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: ma } },
    include: { allocations: true },
  });
const soPayment = () => db.payment.count({ where: { orderId: DON } });
const soPhanBo = () => db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } });
const suKienDaChia = () =>
  db.domainEvent.findMany({
    where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], equals: DON } },
    orderBy: { createdAt: "asc" },
  });

/** Chạy handler THẬT trên mọi sự kiện DA_CHIA của đơn — như dispatcher làm, không chạm sự kiện khác. */
async function chayHandler(): Promise<number> {
  ensureHandlersRegistered();
  const evs = await suKienDaChia();
  for (const e of evs) {
    for (const h of getHandlers(e.type)) {
      await h({ id: e.id, type: e.type, payload: e.payloadJson as Record<string, unknown> });
    }
  }
  return evs.length;
}

const thongBaoSale = () => db.staffNotification.count({ where: { userId: SALE, dedupeKey: { startsWith: "phieu-gop.da-chia:" } } });
const bienNhan = () => db.emailLog.count({ where: { contextType: "Order", contextId: DON } });
const lichSuChot = () => db.orderStatusHistory.count({ where: { orderId: DON, toStatus: "CONFIRMED" } });

// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS1-DB] phiếu thu thẻ — mỗi loại kết quả", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-DB-01] PAID đúng số ⇒ DA_THU; 2 Payment PENDING card_pos, paidDate = GIỜ QUẸT; phiếu gộp PAID; phiếu POS nhận đúng giao dịch", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    expect(p.code5).toBe(g.ma);
    expect(p.soTienLucTao).toBe(TONG);
    const m = maGd();
    const kq = await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: `Kiet 0399812345 ${g.ma}` }));
    expect(kq.status).toBe("DA_THU");
    expect(kq.thongDiep).toBe("Đã thu 6.732.000đ lúc 17:31 — đã ghi nhận, chờ kế toán xác nhận.");

    const bt = await btThe(m);
    expect(bt?.status).toBe("MATCHED");
    expect(bt?.allocations).toHaveLength(2);
    expect(JSON.stringify(bt?.rawPayload)).toContain('"nguon":"FAKE"');
    const khoan = await db.payment.findMany({ where: { orderId: DON }, orderBy: { amount: "asc" } });
    expect(khoan.map((k) => k.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
    expect(khoan.every((k) => k.method === "card_pos" && k.accountantStatus === "PENDING")).toBe(true);
    const gioQuet = new Date(GIO_QUET).getTime();
    expect(khoan.map((k) => k.paidDate?.getTime()), "ngày thu = giờ quẹt, KHÔNG phải now").toEqual([gioQuet, gioQuet]);
    expect((await db.paymentBill.findUniqueOrThrow({ where: { id: g.billId } })).status).toBe("PAID");
    const x = await phieuPos(p.intentId);
    expect(x).toMatchObject({ status: "DA_THU", bankTransactionId: bt?.id, lastResultKind: "PAID", lastTriggeredBy: "SALE" });
    expect(x.lastCheckAt?.toISOString()).toBe(KIEM.toISOString());
    // Đổi trạng thái để lại vết.
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_DA_THU" } })).toBe(1);
  });

  it("[POS1-DB-02] FAILED ⇒ THAT_BAI, 0 giao dịch; phiếu VẪN MỞ (bấm lại 'Thẻ POS' trả CHÍNH nó)", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const kq = await xuLy(p.intentId, { kind: "FAILED", reasonCode: "USER_CANCELLED", providerTxnId: maGd() });
    expect(kq.status).toBe("THAT_BAI");
    expect(kq.thongDiep).toBe("Khách huỷ trên máy — cho quẹt lại.");
    expect(await db.bankTransaction.count({ where: LOC_BT })).toBe(0);
    const lai = await moPhieu({ now: new Date(KIEM.getTime() + PHUT) });
    expect(lai.intentId, "THAT_BAI là phiếu MỞ — không đẻ phiếu mới").toBe(p.intentId);
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(1);
  });

  it("[POS1-DB-03] NOT_FOUND (đọc file đã import) ⇒ giữ CHO_QUET, lastResultKind NOT_FOUND, câu mang giờ dữ liệu", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    // File đã import nhưng KHÔNG có dòng mang mã này.
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "khong co ma" })]);
    const kq = await kiem(p.intentId);
    expect(kq.status).toBe("CHO_QUET");
    expect(kq.thongDiep).toContain(`Chưa thấy giao dịch mang mã ${g.ma}.`);
    expect(kq.thongDiep).toContain("Dữ liệu Techcombank cập nhật lần cuối");
    const x = await phieuPos(p.intentId);
    expect(x.lastResultKind).toBe("NOT_FOUND");
    expect(x.lastResultMessage).toBe(kq.thongDiep);
  });

  it("[POS1-DB-04] CANCELLED_AFTER_PAID trên DA_THU ⇒ giữ DA_THU, 0 phép ghi tiền, câu D7", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma }));
    const truoc = { pay: await soPayment(), pb: await soPhanBo(), bt: (await btThe(m))?.status };
    const kq = await xuLy(p.intentId, { kind: "CANCELLED_AFTER_PAID", providerTxnId: m, amount: TONG }, "SALE", new Date(KIEM.getTime() + PHUT));
    expect(kq.status).toBe("DA_THU");
    expect(kq.thongDiep).toBe("Giao dịch thẻ đã bị huỷ/hoàn sau khi ghi nhận — kế toán đang xử lý (hệ thống không tự đảo).");
    expect({ pay: await soPayment(), pb: await soPhanBo(), bt: (await btThe(m))?.status }).toEqual(truoc);
  });

  it("[POS1-DB-05] PROVIDER_ERROR ⇒ giữ, báo admin ĐÚNG MỘT (bấm hai lần trong giờ vẫn một)", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const kq = await xuLy(p.intentId, { kind: "PROVIDER_ERROR", reasonCode: "TCB_FILE_DB" });
    expect(kq.status).toBe("CHO_QUET");
    expect(kq.thongDiep).toBe("Lỗi kết nối hệ thống thanh toán (mã TCB_FILE_DB) — đã báo admin.");
    await xuLy(p.intentId, { kind: "PROVIDER_ERROR", reasonCode: "TCB_FILE_DB" }, "SALE", new Date(KIEM.getTime() + 5 * PHUT));
    const tb = await db.staffNotification.findMany({ where: { userId: ADMIN, dedupeKey: { startsWith: "pos.loi-ket-noi:" } } });
    expect(tb).toHaveLength(1);
    expect(tb[0]!.dedupeKey).toContain(p.intentId);
    expect(await db.staffNotification.count({ where: { userId: KT, dedupeKey: { startsWith: "pos.loi-ket-noi:" } } })).toBe(1);
    expect(await db.staffNotification.count({ where: { userId: SALE, dedupeKey: { startsWith: "pos.loi-ket-noi:" } } })).toBe(0);
  });

  it("[POS1-DB-06] pha tiền NÉM ⇒ giữ trạng thái, câu 'Chưa xác định — ĐỪNG cho quẹt lại', báo admin", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    // Tiêm lỗi bằng DỮ LIỆU (không mock): số tiền vượt cột Int của BankTransaction ⇒ Postgres ném.
    const kq = await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma, amount: 3_000_000_000 }));
    expect(kq.status).toBe("CHO_QUET");
    expect(kq.thongDiep).toBe("Chưa xác định được kết quả — ĐỪNG cho khách quẹt lại. Bấm Kiểm tra lại sau ít phút; đã báo admin.");
    expect(await soPayment()).toBe(0);
    expect(await db.staffNotification.count({ where: { userId: ADMIN, dedupeKey: { startsWith: "pos.chua-xac-dinh:" } } })).toBe(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-D3] khớp ĐÚNG số còn phải thu LÚC KHỚP", () => {
  beforeEach(dungFixture);
  afterAll(don);

  for (const [ma, lech, nhan] of [
    ["POS1-D3-01", -1, "THIẾU 1đ"],
    ["POS1-D3-02", 50_000, "THỪA"],
  ] as const) {
    it(`[${ma}] quẹt ${nhan} ⇒ LECH_TIEN, 0 phân bổ, 0 Payment, giao dịch UNMATCHED [LECH_SO], không ví`, async () => {
      const g = await phatPhieu();
      const p = await moPhieu();
      const m = maGd();
      const kq = await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma, amount: TONG + lech }));
      expect(kq.status).toBe("LECH_TIEN");
      expect(kq.thongDiep).toContain("phiếu cần 6.732.000đ");
      expect(kq.thongDiep).toContain("Đừng quẹt bù phần chênh");
      expect(await soPhanBo()).toBe(0);
      expect(await soPayment()).toBe(0);
      const bt = await btThe(m);
      expect(bt?.status).toBe("UNMATCHED");
      expect(bt?.unmatchedNote).toContain("[LECH_SO]");
      expect(await db.creditBalance.count({ where: { orderId: DON } })).toBe(0);
      expect((await phieuPos(p.intentId)).bankTransactionId, "phiếu giữ giao dịch để kế toán lần ra").toBe(bt?.id);
      expect(await suKienDaChia(), "không chia ⇒ không sự kiện").toHaveLength(0);
    });
  }

  async function lapMotPhanDotA(soTien: number) {
    // Đường KHÁC (chuyển khoản gắn tay) lấp một phần Đợt A SAU khi phiếu POS đã tạo.
    const bt = await db.bankTransaction.create({
      data: { provider: "SEPAY", providerTxnId: `${T}lap-${soTien}`, amount: soTien, transferredAt: NOW, status: "MATCHED", centerId: CS1 },
    });
    await db.paymentAllocation.create({ data: { bankTransactionId: bt.id, paymentRequestId: DOT_A, amount: soTien, centerId: CS1 } });
    await db.$transaction((tx) => recomputeRequestStatuses(tx, DON));
  }

  it("[POS1-D3-03] số phải thu GIẢM sau lúc tạo phiếu ⇒ quẹt đúng số LÚC TẠO ra LECH_TIEN (so `conPhaiThuCuaPhieu` lúc khớp)", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await lapMotPhanDotA(1_000_000);
    const kq = await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma, amount: p.soTienLucTao }));
    expect(kq.status).toBe("LECH_TIEN");
    expect(kq.thongDiep).toBe("Máy đã thu 6.732.000đ, phiếu cần 5.732.000đ — đã chuyển kế toán xử lý. Đừng quẹt bù phần chênh.");
  });

  it("[POS1-D3-04] đối chứng dương: quẹt đúng số MỚI ⇒ DA_THU", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await lapMotPhanDotA(1_000_000);
    const kq = await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma, amount: TONG - 1_000_000 }));
    expect(kq.status).toBe("DA_THU");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-EV] sự kiện sau DA_CHIA — biên nhận / báo sale ĐÚNG MỘT lần", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-EV-01] publishEvent TRONG tx, hai lần cùng dedupeKey ⇒ tx VẪN COMMIT, đúng 1 dòng", async () => {
    const khoa = `${T}ev01`;
    await db.$transaction(async (tx) => {
      await publishEvent("pos1.ev01", { orderId: DON, lan: 1 }, { tx, dedupeKey: khoa });
      const lai = await publishEvent("pos1.ev01", { orderId: DON, lan: 2 }, { tx, dedupeKey: khoa });
      expect(lai?.dedupeKey, "lần hai trả bản đã có").toBe(khoa);
      // Phép ghi nghiệp vụ SAU hai lần phát vẫn phải sống: bản cũ làm tx hỏng (25P02) ⇒ cuộn ngược.
      await writeAudit({ tx, actor: ACTOR, module: "finance", entityType: "Order", entityId: DON, action: "POS1_EV01" });
    });
    expect(await db.domainEvent.count({ where: { dedupeKey: khoa } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS1_EV01" } })).toBe(1);
  });

  it("[POS1-EV-02] DA_CHIA phát ĐÚNG MỘT `phieu-gop.da-chia` khoá `<bt>:<bill>`; CHUA_CHIA và TRUNG phát 0", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const lech = maGd();
    await xuLy(p.intentId, paid({ providerTxnId: lech, dienGiai: g.ma, amount: TONG - 1 }));
    expect(await suKienDaChia(), "CHUA_CHIA").toHaveLength(0);
    await db.bankTransaction.update({ where: { id: (await btThe(lech))!.id }, data: { status: "IGNORED" } }); // kế toán hoàn

    const p2 = await moPhieu({ now: new Date(KIEM.getTime() + PHUT) });
    const m = maGd();
    await xuLy(p2.intentId, paid({ providerTxnId: m, dienGiai: g.ma }), "SALE", new Date(KIEM.getTime() + 2 * PHUT));
    const bt = await btThe(m);
    const ev = await suKienDaChia();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.dedupeKey).toBe(`phieu-gop.da-chia:${bt!.id}:${g.billId}`);
    expect(ev[0]!.payloadJson).toMatchObject({
      bankTransactionId: bt!.id,
      billId: g.billId,
      ma: g.ma,
      orderId: DON,
      provider: "CARD_POS",
      providerTxnId: m,
      tong: TONG,
    });
    // TRUNG: cùng giao dịch lần nữa ⇒ không thêm sự kiện.
    await xuLy(p2.intentId, paid({ providerTxnId: m, dienGiai: g.ma }), "POLLER", new Date(KIEM.getTime() + 3 * PHUT));
    expect(await suKienDaChia()).toHaveLength(1);
  });

  it("[POS1-EV-03] kế toán GỠ GẮN trước khi handler chạy ⇒ 0 báo, 0 chốt đơn, lead không đổi", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma }));
    const go = await goGanTheoCon({ bankTransactionId: (await btThe(m))!.id, orderId: DON, lyDo: "quẹt nhầm đơn", actor: { id: KT, name: "KT" } });
    expect(go.ok).toBe(true);
    expect(await chayHandler()).toBe(1);
    expect(await thongBaoSale()).toBe(0);
    // (Rollup một chiều của `recomputeRequestStatuses` để đơn CONFIRMED ngầm — hành vi CÓ SẴN, F6.)
    // Thứ handler KHÔNG được làm: nhận lượt sau-chốt (confirmedAt), ghi lịch sử, gửi biên nhận.
    expect((await db.order.findUniqueOrThrow({ where: { id: DON } })).confirmedAt).toBeNull();
    expect(await lichSuChot()).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: LEAD } })).status).toBe("CHO_QUYET_DINH");
    expect(await bienNhan()).toBe(0);
  });

  it("[POS1-EV-04] phiếu lấp ĐỦ đơn ⇒ CONFIRMED đúng 1 lịch sử + đúng 1 biên nhận; chạy handler lần hai vẫn 1", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma }));
    // F6 (đo 06/10/2026): `recomputeRequestStatuses` trong giao dịch rót tiền ĐÃ đặt đơn CONFIRMED
    // NGẦM — không lịch sử, không confirmedAt, không biên nhận. Việc sau chốt là của handler.
    const ngam = await db.order.findUniqueOrThrow({ where: { id: DON } });
    expect(ngam.status).toBe("CONFIRMED");
    expect(ngam.confirmedAt, "đường tiền KHÔNG làm việc sau chốt").toBeNull();
    expect(await lichSuChot()).toBe(0);
    expect(await bienNhan()).toBe(0);
    expect(await chayHandler()).toBe(1);
    const o = await db.order.findUniqueOrThrow({ where: { id: DON } });
    expect(o.status).toBe("CONFIRMED");
    expect(o.confirmedAt, "handler nhận lượt sau-chốt").not.toBeNull();
    expect(await lichSuChot()).toBe(1);
    expect(await bienNhan()).toBe(1);
    expect(await thongBaoSale()).toBe(1);
    await chayHandler();
    expect(await lichSuChot()).toBe(1);
    expect(await bienNhan()).toBe(1);
    expect(await thongBaoSale()).toBe(1);
  });

  it("[POS1-EV-05] phiếu MỘT đợt, đơn còn đợt khác ⇒ KHÔNG chốt, KHÔNG biên nhận; sale được báo 1; lead lên ĐÃ ĐĂNG KÝ đúng 1 dòng sổ", async () => {
    const g = await phatPhieu([DOT_A]);
    const p = await moPhieu({ dot: DOT_A });
    expect(p.soTienLucTao).toBe(DOT_TIEN_A);
    await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma, amount: DOT_TIEN_A }));
    await chayHandler();
    await chayHandler();
    expect((await db.order.findUniqueOrThrow({ where: { id: DON } })).status).toBe("PENDING_PAYMENT");
    expect(await bienNhan()).toBe(0);
    expect(await thongBaoSale()).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: LEAD } })).status).toBe("DA_DANG_KY");
    expect(await db.leadStatusHistory.count({ where: { leadId: LEAD, toStatus: "DA_DANG_KY" } })).toBe(1);
  });

  it("[POS1-EV-06] tiền QR SePay khớp phiếu gộp (MỌI DA_CHIA) ⇒ cùng sự kiện, cùng chốt + biên nhận + báo sale", async () => {
    const g = await phatPhieu();
    const r = await ingestPayosWebhook(
      {
        reference: maSepay(),
        description: dungMemo({ hoTen: "Bé A POS1", sdt: SDT_PH, ma: g.ma }),
        amount: TONG,
        transactionDateTime: "2026-10-06T03:00:00Z",
        accountNumber: "0123456789",
      } as never,
      "SEPAY",
    );
    expect(r.status).toBe("MATCHED");
    expect(await chayHandler()).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: DON } })).status).toBe("CONFIRMED");
    expect(await lichSuChot()).toBe(1);
    expect(await bienNhan()).toBe(1);
    expect(await thongBaoSale()).toBe(1);
  });

  it("handler `phieu-gop.da-chia` được ĐĂNG KÝ đúng một lần (dispatcher thật sẽ gọi nó)", () => {
    ensureHandlersRegistered();
    expect(getHandlers("phieu-gop.da-chia")).toHaveLength(1);
    expect(docPayloadDaChia({ bankTransactionId: "b", billId: "p", ma: "K7M2N", orderId: "o", provider: "SEPAY", providerTxnId: "x", tong: 1, ngayThu: NOW.toISOString() })).toMatchObject({ orderId: "o" });
    expect(() => docPayloadDaChia({ orderId: "o" })).toThrow();
    expect(typeof xuLyPhieuGopDaChia).toBe("function");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-RACE] nút ‖ poller ‖ import cùng giao dịch", () => {
  beforeEach(dungFixture);
  afterAll(don);

  async function batBien(m: string, intentId: string, billId: string) {
    const bts = await db.bankTransaction.findMany({ where: { providerTxnId: m } });
    expect(bts, "1 BankTransaction").toHaveLength(1);
    expect(bts[0]!.provider).toBe(PROVIDER_THE_POS);
    expect(bts[0]!.status).toBe("MATCHED");
    expect(await db.paymentAllocation.count({ where: { bankTransactionId: bts[0]!.id } }), "1 bộ phân bổ").toBe(2);
    const khoan = await db.payment.findMany({ where: { orderId: DON, note: { contains: `[auto:card_pos:${m}]` } } });
    expect(khoan, "1 bộ Payment").toHaveLength(2);
    expect(khoan.reduce((s, k) => s + k.amount, 0)).toBe(TONG);
    const ev = await suKienDaChia();
    expect(ev, "1 sự kiện").toHaveLength(1);
    expect(ev[0]!.dedupeKey).toBe(`phieu-gop.da-chia:${bts[0]!.id}:${billId}`);
    const x = await phieuPos(intentId);
    expect(x.status).toBe("DA_THU");
    expect(x.bankTransactionId).toBe(bts[0]!.id);
    await chayHandler();
    expect(await thongBaoSale(), "1 lượt báo sale").toBe(1);
    expect(await bienNhan(), "1 biên nhận").toBe(1);
    expect(await lichSuChot()).toBe(1);
  }

  it("[POS1-RACE-01] 8 vòng: xuLyKetQuaPos SALE ‖ POLLER ‖ nhapLoPos cùng mã giao dịch ⇒ đúng một bộ tiền", async () => {
    for (let vong = 0; vong < 8; vong += 1) {
      if (vong > 0) await dungFixture();
      const g = await phatPhieu();
      const p = await moPhieu();
      const m = maGd();
      const kq = paid({ providerTxnId: m, dienGiai: g.ma });
      const [r1, r2] = await Promise.all([
        xuLy(p.intentId, kq, "SALE"),
        xuLy(p.intentId, kq, "POLLER"),
        nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })]),
      ]);
      expect([r1.status, r2.status], `vòng ${vong}`).toEqual(["DA_THU", "DA_THU"]);
      await batBien(m, p.intentId, g.billId);
    }
  }, 120_000);

  it("[POS1-RACE-02] dòng đã import nhưng giao dịch CHƯA khớp (máy khai SAU) ⇒ 3 × kiemTraPhieuPos song song ⇒ đúng một bộ tiền", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const mayMoi = `${PFX}MAYMOI`;
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: mayMoi })]);
    expect((await btThe(m))?.status, "máy chưa khai ⇒ hàng chờ").toBe("UNMATCHED");
    await db.posTerminal.create({ data: { maThietBi: mayMoi, centerId: CS1 } });
    // GĐ2 (docs/pos-gd2-thiet-ke.md §9.11): cửa sổ chống bấm dồn 5 giây nằm trong `kiemTraPhieuPos` ⇒
    // ba lượt CÙNG mốc thì hai lượt sau ra CACHE (đó là `[POS2-CD-03]`). Ý của ca này là ĐUA ba lượt
    // GỌI PROVIDER dưới khoá ⇒ ba mốc cách nhau ≥ 5 giây, VẪN chạy song song.
    const kq = await Promise.all([
      kiem(p.intentId, "SALE", KIEM),
      kiem(p.intentId, "POLLER", new Date(KIEM.getTime() + 6_000)),
      kiem(p.intentId, "IMPORT", new Date(KIEM.getTime() + 12_000)),
    ]);
    expect(kq.map((k) => k.status)).toEqual(["DA_THU", "DA_THU", "DA_THU"]);
    expect(kq.map((k) => k.tuCache), "cả ba lượt đều GỌI provider").toEqual([false, false, false]);
    await batBien(m, p.intentId, g.billId);
  });

  it("[POS1-RACE-03] kết quả CŨ (NOT_FOUND) ghi SAU khi IMPORT đã đặt DA_THU ⇒ vẫn DA_THU, kết quả không lùi", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma })]);
    expect((await kiem(p.intentId, "IMPORT")).status).toBe("DA_THU");
    const cu = await xuLy(p.intentId, { kind: "NOT_FOUND" }, "SALE", new Date(KIEM.getTime() + PHUT));
    expect(cu.status).toBe("DA_THU");
    expect(cu.thongDiep, "không bao giờ mời quẹt lại khi đã thu").not.toMatch(/quẹt lại/);
    const x = await phieuPos(p.intentId);
    expect(x.status).toBe("DA_THU");
    expect(x.lastResultKind).toBe("PAID");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-D5] chuyển khoản ↔ thẻ không quét nhầm nhau", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-D5-01] BT SEPAY và BT CARD_POS CÙNG mã giao dịch cùng sống; webhook SePay không đụng giao dịch thẻ", async () => {
    const g = await phatPhieu();
    const m = maGd();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })]);
    const the = await btThe(m);
    expect(the?.status).toBe("MATCHED");
    const r = await ingestPayosWebhook(
      { reference: m, description: dungMemo({ hoTen: "Bé A", sdt: SDT_PH, ma: g.ma }), amount: TONG } as never,
      "SEPAY",
    );
    expect(r.status, "phiếu đã thu đủ ⇒ giao dịch chuyển khoản vào hàng chờ").toBe("UNMATCHED");
    const bts = await db.bankTransaction.findMany({ where: { providerTxnId: m }, orderBy: { provider: "asc" } });
    expect(bts.map((b) => b.provider)).toEqual(["CARD_POS", "SEPAY"]);
    const theSau = await btThe(m);
    expect(theSau?.status).toBe("MATCHED");
    expect(theSau?.unmatchedNote).toBe(the?.unmatchedNote ?? null);
    expect(theSau?.allocations.map((a) => a.id).sort()).toEqual(the?.allocations.map((a) => a.id).sort());
  });

  it("[POS1-D5-02] ngược lại: khopGiaoDichThe / nhapLoPos cùng mã giao dịch KHÔNG đụng BT SEPAY", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const r = await ingestPayosWebhook(
      { reference: m, description: dungMemo({ hoTen: "Bé A", sdt: SDT_PH, ma: g.ma }), amount: TONG } as never,
      "SEPAY",
    );
    expect(r.status).toBe("MATCHED");
    const sepay = await db.bankTransaction.findUniqueOrThrow({
      where: { provider_providerTxnId: { provider: "SEPAY", providerTxnId: m } },
      include: { allocations: true },
    });
    const kl = await khopGiaoDichThe({ d: dong({ maGiaoDich: m, dienGiai: g.ma }), nguonDuLieu: "FAKE" });
    expect(kl.tien?.loai, "phiếu đã thu đủ qua QR ⇒ thẻ vào hàng chờ").toBe("CHO_TAY");
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })]);
    const sau = await db.bankTransaction.findUniqueOrThrow({
      where: { provider_providerTxnId: { provider: "SEPAY", providerTxnId: m } },
      include: { allocations: true },
    });
    expect(sau.status).toBe("MATCHED");
    expect(sau.allocations.map((a) => a.id).sort()).toEqual(sepay.allocations.map((a) => a.id).sort());
    expect((await btThe(m))?.status).toBe("UNMATCHED");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-D2] nhận mã — token đứng riêng, đúng một mã", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-D2-01] mã LẪN trong từ (`X<MA>X`) ⇒ provider NOT_FOUND", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: `X${g.ma}X` })]);
    const kq = await tcb.checkStatus(
      { id: p.intentId, code5: g.ma, amount: TONG, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 24 * GIO), centerId: CS1, posTerminalId: null, bankTransactionId: null },
      KIEM,
    );
    expect(kq.kind).toBe("NOT_FOUND");
  });

  it("[POS1-D2-02] ghi chú HAI mã hợp lệ ⇒ PAID nhưng phiếu POS CAN_XU_LY 'Ghi chú có 2 mã phiếu', 0 phân bổ, KHÔNG nhận giao dịch", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const maKhac = sinhMa(hoanViSoThuTu(4_242));
    const m = maGd();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: `${g.ma} ${maKhac}` })]);
    const kq = await kiem(p.intentId);
    expect(kq.status).toBe("CAN_XU_LY");
    expect(kq.thongDiep).toContain("Ghi chú có 2 mã phiếu");
    expect(await soPhanBo()).toBe(0);
    expect((await btThe(m))?.status).toBe("UNMATCHED");
    expect((await phieuPos(p.intentId)).bankTransactionId).toBeNull();
  });

  it("[POS1-D2-03] mã viết THƯỜNG + dấu câu ⇒ DA_THU", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const kq = await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: `hp be an ${g.ma.toLowerCase()}.` }));
    expect(kq.status).toBe("DA_THU");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-QE] chặn quẹt chéo cơ sở", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-QE-01] máy CS2 quẹt phiếu đơn CS1 ⇒ provider vẫn PAID (không lọc cơ sở — T4) ⇒ CAN_XU_LY 'cơ sở khác', 0 phân bổ", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, maThietBi: MAY2 })]);
    const kq = await kiem(p.intentId);
    expect(kq.status).toBe("CAN_XU_LY");
    expect(kq.thongDiep).toContain("cơ sở khác");
    expect(await soPhanBo()).toBe(0);
  });

  it("[POS1-QE-02] đối chứng dương: cùng mã, máy CS1 ⇒ DA_THU", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, maThietBi: MAY1 })]);
    expect((await kiem(p.intentId)).status).toBe("DA_THU");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-PRV] TcbFileImportProvider đọc dữ liệu đã import", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const deKiem = (intentId: string, code5: string, bankTransactionId: string | null = null) => ({
    id: intentId,
    code5,
    amount: TONG,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 24 * GIO),
    centerId: CS1,
    posTerminalId: null,
    bankTransactionId,
  });

  it("[POS1-PRV-01] cửa sổ [lúc tạo − 5′, now]: dòng −6′ không thấy, −4′ thấy", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, thoiGian: "2026-10-06T16:54:00+07:00" })]);
    expect((await tcb.checkStatus(deKiem(p.intentId, g.ma), KIEM)).kind).toBe("NOT_FOUND");
    const m = maGd();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, thoiGian: "2026-10-06T16:56:00+07:00" })]);
    const kq = await tcb.checkStatus(deKiem(p.intentId, g.ma), KIEM);
    expect(kq).toMatchObject({ kind: "PAID", providerTxnId: m });
  });

  it("[POS1-PRV-02] THẤT BẠI + THÀNH CÔNG cùng mã ⇒ PAID (thành công thắng)", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const ok = maGd();
    await nhapFile([
      dong({ maGiaoDich: maGd(), dienGiai: g.ma, trangThai: "Thất bại", thoiGian: "2026-10-06T17:30:00+07:00" }),
      dong({ maGiaoDich: ok, dienGiai: g.ma, thoiGian: "2026-10-06T17:31:00+07:00" }),
    ]);
    expect(await tcb.checkStatus(deKiem(p.intentId, g.ma), KIEM)).toMatchObject({ kind: "PAID", providerTxnId: ok });
    // Chỉ có dòng thất bại ⇒ FAILED, mã lý do là chữ trạng thái đã chuẩn hoá (T19).
    const g2 = await (async () => {
      await dungFixture();
      return phatPhieu();
    })();
    const p2 = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g2.ma, trangThai: "Thất bại" })]);
    expect(await tcb.checkStatus(deKiem(p2.intentId, g2.ma), KIEM)).toMatchObject({ kind: "FAILED", reasonCode: "THAT_BAI" });
  });

  it("[POS1-PRV-03] HAI giao dịch thành công cùng mã ⇒ PAID SỚM NHẤT, giaoDichKhac = 1, câu cảnh báo thu đôi", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const som = maGd();
    await nhapFile([
      dong({ maGiaoDich: som, dienGiai: g.ma, thoiGian: "2026-10-06T17:31:00+07:00" }),
      dong({ maGiaoDich: maGd(), dienGiai: g.ma, thoiGian: "2026-10-06T17:35:00+07:00" }),
    ]);
    expect(await tcb.checkStatus(deKiem(p.intentId, g.ma), KIEM)).toMatchObject({ kind: "PAID", providerTxnId: som, giaoDichKhac: 1 });
    const kq = await kiem(p.intentId);
    expect(kq.status).toBe("DA_THU");
    expect(kq.thongDiep).toContain("Có thêm 1 giao dịch thẻ thành công mang mã này");
  });

  it("[POS1-PRV-04] giao dịch ĐÃ THUỘC phiếu POS khác bị loại khỏi tìm kiếm", async () => {
    const g = await phatPhieu();
    const p1 = await moPhieu();
    const lech = maGd();
    await nhapFile([dong({ maGiaoDich: lech, dienGiai: g.ma, soTien: TONG - 1 })]);
    expect((await kiem(p1.intentId)).status).toBe("LECH_TIEN");
    // Kế toán hoàn giao dịch lệch ⇒ T21 thôi chặn ⇒ sale mở phiếu POS mới cho cùng phiếu gộp.
    await db.bankTransaction.update({ where: { id: (await btThe(lech))!.id }, data: { status: "IGNORED" } });
    const p2 = await moPhieu({ now: new Date(KIEM.getTime() + PHUT) });
    expect(p2.intentId).not.toBe(p1.intentId);
    const kq = await tcb.checkStatus(deKiem(p2.intentId, g.ma), new Date(KIEM.getTime() + 2 * PHUT));
    expect(kq.kind, "giao dịch lệch thuộc phiếu POS cũ — không phải của phiếu mới").toBe("NOT_FOUND");
  });

  it("[POS1-PRV-05] NOT_FOUND mang lúc nhập cuối + giờ giao dịch mới nhất CỦA CƠ SỞ phiếu (file cơ sở khác nhập muộn không che câu cấm quẹt lại)", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    // CS1: giao dịch mới nhất 16:50 (TRƯỚC lúc tạo phiếu 17:00). CS2: một giao dịch 18:00 nhập SAU.
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "khong ma", thoiGian: "2026-10-06T16:50:00+07:00" })]);
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "khong ma", maThietBi: MAY2, thoiGian: "2026-10-06T18:00:00+07:00" })]);
    const kq = await tcb.checkStatus(deKiem(p.intentId, g.ma), new Date("2026-10-06T11:30:00Z"));
    expect(kq.kind).toBe("NOT_FOUND");
    const lo = await db.posImportBatch.findFirstOrThrow({ where: { soLoXong: { gt: 0 } }, orderBy: { updatedAt: "desc" } });
    const moi = await db.posCardTransaction.aggregate({ where: { centerId: CS1 }, _max: { thoiGianGiaoDich: true } });
    expect(new Date(kq.duLieuCapNhatLuc!).getTime()).toBe(Math.floor(lo.updatedAt.getTime() / 1000) * 1000);
    expect(new Date(kq.gdMoiNhatLuc!).getTime()).toBe(moi._max.thoiGianGiaoDich!.getTime());
    expect(kq.gdMoiNhatLuc, "giờ của CS1, không phải giao dịch 18:00 của CS2").toBe("2026-10-06T16:50:00+07:00");
    // Câu cho sale vì thế VẪN mang lệnh cấm quẹt lại.
    const r = await xuLy(p.intentId, kq, "SALE", new Date("2026-10-06T11:30:00Z"));
    expect(r.thongDiep).toContain("ĐỪNG cho quẹt lại");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-LC] vòng đời phiếu POS", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-LC-01] bấm 'Thẻ POS' hai lần ⇒ CÙNG một phiếu POS, lần hai không ghi gì", async () => {
    await phatPhieu();
    const p1 = await moPhieu();
    const x1 = await phieuPos(p1.intentId);
    const p2 = await moPhieu({ now: new Date(NOW.getTime() + PHUT) });
    expect(p2.intentId).toBe(p1.intentId);
    const x2 = await phieuPos(p1.intentId);
    expect(x2.updatedAt.getTime()).toBe(x1.updatedAt.getTime());
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_PHIEU_TAO" } })).toBe(1);
  });

  it("[POS1-LC-02] quá hạn ⇒ phiếu MỚI, cũ HET_HAN; hai phiếu mở cùng phiếu gộp bị DB từ chối", async () => {
    await phatPhieu();
    const p1 = await moPhieu();
    const p2 = await moPhieu({ now: new Date(NOW.getTime() + 25 * GIO) });
    expect(p2.intentId).not.toBe(p1.intentId);
    expect((await phieuPos(p1.intentId)).status).toBe("HET_HAN");
    const moi = await phieuPos(p2.intentId);
    expect(moi.status).toBe("CHO_QUET");
    expect(moi.createdAt.toISOString(), "createdAt do app đặt (T18)").toBe(new Date(NOW.getTime() + 25 * GIO).toISOString());
    const loi = await db.posPaymentIntent
      .create({
        data: {
          paymentBillId: moi.paymentBillId,
          code5: moi.code5,
          amount: moi.amount,
          centerId: CS1,
          createdById: SALE,
          createdAt: NOW,
          expiresAt: new Date(NOW.getTime() + GIO),
        },
      })
      .then(() => null)
      .catch((e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e)));
    expect(loi).toBe("P2002");
  });

  it("[POS1-LC-03] phiếu gộp bị huỷ, phát phiếu mới ⇒ phiếu POS cũ HUY", async () => {
    const p1 = await moPhieu({ dot: DOT_A }); // chưa có phiếu gộp ⇒ tự phát phiếu 1 dòng
    const bill1 = (await phieuPos(p1.intentId)).paymentBillId;
    // 09/10/2026 (hai nút QR / Thẻ POS, đặc tả luật 7): "Huỷ phiếu" nay bị TỪ CHỐI khi phiếu thẻ còn mở và còn hạn
    // (khách có thể đang quẹt) — ca `[HN1-DB-03]`. Nên ca này dựng lại ở lúc phiếu thẻ đã HẾT HẠN (quá 24 giờ):
    // vẫn kiểm đúng điều nó vốn kiểm (phiếu thẻ của phiếu gộp đã đóng bị đánh dấu HUY khi mở phiếu thẻ mới).
    // Đường khác còn đóng được phiếu gộp lúc thẻ đang mở (dừng học…) nên trạng thái này vẫn tới được ngoài đời.
    const sauHan = new Date(NOW.getTime() + 25 * GIO);
    const huy = await huyPhieuGop({ orderId: DON, billId: bill1, lyDo: "", actor: ACTOR, now: sauHan });
    expect(huy.ok).toBe(true);
    const p2 = await moPhieu({ dot: DOT_A, now: new Date(sauHan.getTime() + PHUT) });
    expect((await phieuPos(p2.intentId)).paymentBillId).not.toBe(bill1);
    expect((await phieuPos(p1.intentId)).status).toBe("HUY");
  });

  it("[POS1-LC-04] cơ sở của đơn CHƯA khai máy POS đang bật ⇒ không tạo được (T10)", async () => {
    await db.posTerminal.updateMany({ where: { centerId: CS1 }, data: { active: false } });
    await phatPhieu();
    const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: NOW });
    expect(r).toEqual({ ok: false, error: "Cơ sở chưa khai máy POS — Kế toán HO khai ở màn Cơ sở, mục Máy POS quẹt thẻ" });
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(0);
  });

  it("[POS1-LC-05] phiếu HET_HAN kiểm ra CAN_XU_LY ⇒ giữ HET_HAN, KHÔNG nhận giao dịch; phiếu MỚI vẫn thấy giao dịch đó", async () => {
    const g = await phatPhieu();
    const p1 = await moPhieu();
    const sau = new Date(NOW.getTime() + 25 * GIO);
    const p2 = await moPhieu({ now: sau });
    // Quẹt ở máy CS2 (Q-E chặn) lúc sau khi phiếu mới mở — nằm trong cửa sổ của CẢ hai phiếu.
    const m = maGd();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: MAY2, thoiGian: "2026-10-07T18:10:00+07:00" })]);
    const luc = new Date(sau.getTime() + 20 * PHUT);
    const k1 = await kiem(p1.intentId, "SALE", luc);
    expect(k1.status).toBe("HET_HAN");
    expect((await phieuPos(p1.intentId)).bankTransactionId).toBeNull();
    const k2 = await kiem(p2.intentId, "SALE", new Date(luc.getTime() + PHUT));
    expect(k2.status).toBe("CAN_XU_LY");
    expect((await phieuPos(p2.intentId)).bankTransactionId).toBe((await btThe(m))?.id);
  });

  it("[POS1-LC-06] (T21) phiếu LECH_TIEN còn giao dịch ở hàng chờ ⇒ KHÔNG mở phiếu mới; kế toán hoàn xong ⇒ mở được", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const lech = maGd();
    await xuLy(p.intentId, paid({ providerTxnId: lech, dienGiai: g.ma, amount: TONG - 1 }));
    const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: new Date(KIEM.getTime() + PHUT) });
    expect(r).toEqual({ ok: false, error: "Giao dịch thẻ trước còn chờ kế toán xử lý — xử lý xong mới thu thẻ tiếp" });
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(1);
    await db.bankTransaction.update({ where: { id: (await btThe(lech))!.id }, data: { status: "IGNORED" } });
    const r2 = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: new Date(KIEM.getTime() + 2 * PHUT) });
    expect(r2.ok, "đối chứng dương").toBe(true);
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(2);
  });

  it("[POS1-Q-05] đơn CHỜ DUYỆT ⇒ không mở phiếu POS, KHÔNG phát phiếu gộp (T9)", async () => {
    await db.order.update({ where: { id: DON }, data: { discountApprovalStatus: "PENDING_APPROVAL" } });
    const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/duyệt/);
    expect(await db.paymentBill.count({ where: { orderId: DON } }), "không phát mã cho đơn chưa ai ký").toBe(0);
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(0);
  });

  it("[POS1-LC-07] phiếu gộp đang mở là của đợt KHÁC ⇒ nói rõ 'Mã đang mở cho …', không tạo gì", async () => {
    await phatPhieu([DOT_A]);
    const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_B, actor: ACTOR, now: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Đơn đang có một mã QR mở cho/);
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-GG] gỡ gắn không bị tự khớp lại (vá F3)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  async function daThuRoiGo() {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    expect((await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma }))).status).toBe("DA_THU");
    const go = await goGanTheoCon({ bankTransactionId: (await btThe(m))!.id, orderId: DON, lyDo: "quẹt nhầm gia đình", actor: { id: KT, name: "KT" } });
    expect(go.ok).toBe(true);
    return { g, p, m };
  }

  it("[POS1-GG-01] DA_THU → kế toán gỡ gắn → PAID lần nữa (không dòng POS) ⇒ KHÔNG khớp lại, ghi chú gỡ còn nguyên, phiếu POS CAN_XU_LY", async () => {
    const { g, p, m } = await daThuRoiGo();
    const pbTruoc = await soPhanBo();
    const kq = await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma }), "POLLER", new Date(KIEM.getTime() + PHUT));
    expect(kq.status).toBe("CAN_XU_LY");
    const bt = await btThe(m);
    expect(bt?.status).toBe("UNMATCHED");
    expect(bt?.unmatchedNote ?? "").toMatch(/^Đã gỡ gắn: /);
    expect(await soPhanBo()).toBe(pbTruoc);
  });

  it("[POS1-GG-02] như GG-01 nhưng lượt sau là IMPORT dòng file (chưa từng có dòng POS) ⇒ không khớp lại", async () => {
    const { g, m } = await daThuRoiGo();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })]);
    const bt = await btThe(m);
    expect(bt?.status).toBe("UNMATCHED");
    expect(bt?.unmatchedNote ?? "").toMatch(/^Đã gỡ gắn: /);
    const row = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    expect(row.matchStatus).toBe("CAN_XU_LY");
    expect(row.bankTransactionId).toBe(bt?.id);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-BAO] báo admin + đồng bộ sau import", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-Q-09b] 'Báo admin': trước 10 phút bị từ chối; đủ điều kiện ⇒ Kế toán HO + Quản trị nhận, sale KHÔNG (T17)", async () => {
    await phatPhieu();
    const p = await moPhieu();
    await xuLy(p.intentId, { kind: "NOT_FOUND" }, "SALE", new Date(NOW.getTime() + 2 * PHUT));
    const som = await baoAdminPhieuPos({ intentId: p.intentId, orderId: DON, actor: ACTOR, now: new Date(NOW.getTime() + 5 * PHUT) });
    expect(som.ok).toBe(false);
    const r = await baoAdminPhieuPos({ intentId: p.intentId, orderId: DON, ghiChu: "Biên lai báo thành công", actor: ACTOR, now: new Date(NOW.getTime() + 11 * PHUT) });
    expect(r.ok).toBe(true);
    const khoa = `pos.bao-admin:${p.intentId}`;
    expect(await db.staffNotification.count({ where: { dedupeKey: khoa, userId: ADMIN } })).toBe(1);
    expect(await db.staffNotification.count({ where: { dedupeKey: khoa, userId: KT } })).toBe(1);
    expect(await db.staffNotification.count({ where: { dedupeKey: khoa, userId: SALE } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_PHIEU_BAO_ADMIN" } })).toBe(1);
    // Phiếu của đơn KHÁC ⇒ không tìm thấy.
    expect(await baoAdminPhieuPos({ intentId: p.intentId, orderId: `${T}don-khac`, actor: ACTOR, now: new Date(NOW.getTime() + 12 * PHUT) })).toEqual({
      ok: false,
      error: "Không tìm thấy phiếu POS",
    });
  });

  it("[POS1-SYNC-01] đồng bộ sau import: phiếu MỞ trong 7 ngày được kiểm với IMPORT; phiếu quá 7 ngày bỏ qua", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma })]);
    const bo = await dongBoPhieuPosSauNhap({ now: new Date(NOW.getTime() + 8 * 24 * GIO), nguoiKiemId: KT });
    expect(bo.daKiem, "quá 7 ngày ⇒ không kiểm").toBe(0);
    expect((await phieuPos(p.intentId)).status).toBe("CHO_QUET");
    const kq = await dongBoPhieuPosSauNhap({ now: KIEM, nguoiKiemId: KT });
    expect(kq.daKiem).toBe(1);
    const x = await phieuPos(p.intentId);
    expect(x.status).toBe("DA_THU");
    expect(x.lastTriggeredBy).toBe("IMPORT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG 06/10/2026 — các lỗi đã xác nhận (docs/pos-gd1-thiet-ke.md Phụ lục D)
// ─────────────────────────────────────────────────────────────────────────────

const LOI_T21 = "Giao dịch thẻ trước còn chờ kế toán xử lý — xử lý xong mới thu thẻ tiếp";
const tom = (d: DongPos): DongHuyPos => ({
  maGiaoDich: d.maGiaoDich,
  loaiGiaoDich: d.loaiGiaoDich,
  trangThai: d.trangThai,
  soTien: d.soTien,
  maGiaoDichGoc: d.maGiaoDichGoc,
  trangThaiHoanHuy: d.trangThaiHoanHuy,
});

/** Một LÔ của lượt import (màn gửi kèm tóm tắt dòng hủy của CẢ FILE) — không đánh dấu XONG. */
async function nhapLo(dongs: DongPos[], huyCuaFile: DongPos[]): Promise<KetQuaLoPos> {
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture.xlsx", importedById: KT, soLoTong: 2 } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: huyCuaFile.map(tom), nguoiNhapId: KT });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  await db.posImportBatch.update({ where: { id: batch.id }, data: { soLoXong: 1 } });
  return kq;
}

/** View của màn đơn — CÙNG hai loader trang dùng. */
async function viewDon(now: Date) {
  const mo = await docPhieuGopDangMo(DON);
  return dungPhieuPosChoDon({ ds: await docPhieuPosTho(DON), phieuMo: mo, now });
}

function maKhac(tru: string): string {
  for (let i = 500; i < 5000; i++) {
    const m = sinhMa(i);
    if (m !== tru) return m;
  }
  throw new Error("fixture: không sinh được mã thứ hai");
}

describe.skipIf(!RUN_DB_TESTS)("[POS1-VA] rà đối kháng — hủy rồi quẹt lại · T21 theo mã · kiểm giữa lô · 'Đang xử lý' · hủy sau ghi nhận · biên nhận", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const SAU = new Date(KIEM.getTime() + 2 * PHUT);

  function huyRoiQuetLai(g: { ma: string }, soTienY: number) {
    const X = maGd();
    const H = maGd();
    const Y = maGd();
    const dX = dong({ maGiaoDich: X, dienGiai: g.ma, thoiGian: "2026-10-06T17:31:35+07:00", trangThaiHoanHuy: "Hủy toàn phần" });
    const dH = dong({ maGiaoDich: H, loaiGiaoDich: "Hủy", maGiaoDichGoc: X, soTien: -TONG, thoiGian: "2026-10-06T17:32:10+07:00" });
    const dY = dong({ maGiaoDich: Y, dienGiai: g.ma, soTien: soTienY, thoiGian: "2026-10-06T17:35:00+07:00" });
    // File xếp giờ GIẢM dần (như file thật): Y, H, X.
    return { X, Y, file: [dY, dH, dX] };
  }

  it("[POS1-VA-DB-01] quẹt X → HỦY → quẹt lại Y CÙNG mã, đúng số ⇒ phiếu POS DA_THU, nhận Y (không kẹt THAT_BAI)", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const { Y, file } = huyRoiQuetLai(g, TONG);
    await nhapFile(file);
    await dongBoPhieuPosSauNhap({ now: KIEM, nguoiKiemId: KT });
    const btY = await btThe(Y);
    expect(btY?.status).toBe("MATCHED");
    const x = await phieuPos(p.intentId);
    expect(x.status).toBe("DA_THU");
    expect(x.bankTransactionId).toBe(btY?.id);
    // Bấm Kiểm tra lần nữa ⇒ vẫn DA_THU, không câu "có thể cho quẹt lại".
    const k = await kiem(p.intentId, "SALE", SAU);
    expect(k.status).toBe("DA_THU");
    expect(k.thongDiep).not.toMatch(/quẹt lại/);
  });

  it("[POS1-VA-DB-02] quẹt X → HỦY → quẹt lại Y LỆCH SỐ ⇒ LECH_TIEN nhận Y; T21 chặn lần quẹt thứ ba", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const { Y, file } = huyRoiQuetLai(g, TONG - 100_000);
    await nhapFile(file);
    await dongBoPhieuPosSauNhap({ now: KIEM, nguoiKiemId: KT });
    const btY = await btThe(Y);
    expect(btY?.status).toBe("UNMATCHED");
    const x = await phieuPos(p.intentId);
    expect(x.status).toBe("LECH_TIEN");
    expect(x.bankTransactionId).toBe(btY?.id);
    expect(await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: SAU })).toEqual({ ok: false, error: LOI_T21 });
    expect((await viewDon(SAU))?.choKeToan).toBe(true);
  });

  it("[POS1-VA-DB-03] ghi chú HAI mã ⇒ phiếu CAN_XU_LY không nhận giao dịch, NHƯNG T21 (theo mã) vẫn chặn phiếu mới + màn báo chờ kế toán", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const X = maGd();
    await nhapFile([dong({ maGiaoDich: X, dienGiai: `${g.ma} ${maKhac(g.ma)}` })]);
    await dongBoPhieuPosSauNhap({ now: KIEM, nguoiKiemId: KT });
    expect((await btThe(X))?.status).toBe("UNMATCHED");
    const x = await phieuPos(p.intentId);
    expect(x.status).toBe("CAN_XU_LY");
    expect(x.bankTransactionId, "D2: không nhận giao dịch 2 mã").toBeNull();
    expect(await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: SAU })).toEqual({ ok: false, error: LOI_T21 });
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(1);
    expect((await viewDon(SAU))?.choKeToan).toBe(true);
    // Đối chứng dương: kế toán xử lý xong (bỏ qua) ⇒ mở được.
    await db.bankTransaction.update({ where: { id: (await btThe(X))!.id }, data: { status: "IGNORED" } });
    expect((await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: new Date(SAU.getTime() + PHUT) })).ok).toBe(true);
  });

  it("[POS1-VA-DB-04] phiếu cũ HET_HAN bị thay TRƯỚC khi file về; file mang lần quẹt LỆCH SỐ dưới phiếu cũ ⇒ T21 chặn, màn báo chờ kế toán", async () => {
    const g = await phatPhieu();
    await moPhieu();
    const thay = new Date(NOW.getTime() + 25 * GIO);
    const p2 = await moPhieu({ now: thay });
    const X = maGd();
    await nhapFile([dong({ maGiaoDich: X, dienGiai: g.ma, soTien: TONG - 100_000, thoiGian: "2026-10-06T17:05:00+07:00" })]);
    const dongBo = new Date(thay.getTime() + GIO);
    await dongBoPhieuPosSauNhap({ now: dongBo, nguoiKiemId: KT });
    expect((await btThe(X))?.status).toBe("UNMATCHED");
    expect((await phieuPos(p2.intentId)).status).toBe("CHO_QUET");
    const v = await viewDon(new Date(dongBo.getTime() + PHUT));
    expect(v?.intentId).toBe(p2.intentId);
    expect(v?.choKeToan).toBe(true);
    const r = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: new Date(dongBo.getTime() + 25 * GIO) });
    expect(r).toEqual({ ok: false, error: LOI_T21 });
  });

  it("[POS1-VA-DB-05] cặp Thanh toán + Hủy rơi HAI lô: sale bấm Kiểm tra GIỮA hai lô ⇒ 0 tiền ghi cho lần quẹt đã hủy", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const X = maGd();
    const H = maGd();
    const dX = dong({ maGiaoDich: X, dienGiai: g.ma });
    const dH = dong({ maGiaoDich: H, loaiGiaoDich: "Hủy", maGiaoDichGoc: X, soTien: -TONG, thoiGian: "2026-10-06T17:32:10+07:00" });
    await nhapLo([dX], [dH]);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: X } })).matchStatus).toBe("BO_QUA");
    const k = await kiem(p.intentId);
    expect(k.status).not.toBe("DA_THU");
    expect(await btThe(X), "không tạo giao dịch cho lần quẹt import đã kết luận BO_QUA").toBeNull();
    expect(await soPayment()).toBe(0);
    expect(await suKienDaChia()).toHaveLength(0);
    await nhapLo([dH], [dH]);
    expect(await soPayment()).toBe(0);
    expect((await db.paymentBill.findUniqueOrThrow({ where: { id: g.billId } })).status).toBe("OPEN");
  });

  it("[POS1-VA-DB-06] dòng file 'Đang xử lý' mang mã ⇒ KHÔNG THAT_BAI: phiếu giữ CHO_QUET, câu 'ĐỪNG cho quẹt lại'", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, trangThai: "Đang xử lý" })]);
    const k = await kiem(p.intentId);
    expect(k.status).toBe("CHO_QUET");
    expect(k.thongDiep).toMatch(/ĐỪNG cho quẹt lại/);
    expect(k.thongDiep).not.toMatch(/thất bại/i);
    expect((await phieuPos(p.intentId)).lastResultKind).toBe("NOT_FOUND");
    // Đối chứng dương: "Thất bại" ⇒ THAT_BAI mời quẹt lại.
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, trangThai: "Thất bại", thoiGian: "2026-10-06T17:00:00+07:00" })]);
    await db.posCardTransaction.deleteMany({ where: { trangThai: "Đang xử lý", dienGiai: g.ma, maGiaoDich: { startsWith: PFX } } });
    const k2 = await kiem(p.intentId, "SALE", SAU);
    expect(k2.status).toBe("THAT_BAI");
    expect(k2.thongDiep).toMatch(/cho quẹt lại/);
  });

  it("[POS1-VA-DB-07] giao dịch đã ghi nhận rồi bị HỦY TOÀN PHẦN (file sau) ⇒ Kiểm tra ra câu D7 'huỷ/hoàn sau khi ghi nhận', KHÔNG báo xanh, tiền không tự đảo", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const X = maGd();
    await nhapFile([dong({ maGiaoDich: X, dienGiai: g.ma })]);
    expect((await btThe(X))?.status).toBe("MATCHED");
    // Phiếu CHƯA ai kiểm (vẫn CHO_QUET) — file sau mang hủy toàn phần.
    await nhapFile([
      dong({ maGiaoDich: X, dienGiai: g.ma, trangThaiHoanHuy: "Hủy toàn phần" }),
      dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: X, soTien: -TONG, thoiGian: "2026-10-06T18:00:00+07:00" }),
    ]);
    const k = await kiem(p.intentId);
    expect(k.ketLuan?.loai).toBe("HUY_SAU_THU");
    expect(k.status).toBe("CAN_XU_LY");
    expect(k.mucDo).toBe("canh_bao");
    expect(k.thongDiep).toMatch(/huỷ\/hoàn sau khi ghi nhận/);
    expect(await soPayment(), "D7: không tự đảo").toBe(2);
    expect((await btThe(X))?.status).toBe("MATCHED");
    expect((await phieuPos(p.intentId)).lastResultKind).toBe("CANCELLED_AFTER_PAID");
  });

  it("[POS1-VA-DB-07b] phiếu ĐÃ DA_THU rồi giao dịch bị HỦY TOÀN PHẦN ⇒ giữ DA_THU nhưng câu D7, màn mức cảnh báo", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const X = maGd();
    await nhapFile([dong({ maGiaoDich: X, dienGiai: g.ma })]);
    expect((await kiem(p.intentId)).status).toBe("DA_THU");
    await nhapFile([
      dong({ maGiaoDich: X, dienGiai: g.ma, trangThaiHoanHuy: "Hủy toàn phần" }),
      dong({ maGiaoDich: maGd(), loaiGiaoDich: "Hủy", maGiaoDichGoc: X, soTien: -TONG, thoiGian: "2026-10-06T18:00:00+07:00" }),
    ]);
    const k = await kiem(p.intentId, "SALE", SAU);
    expect(k.status).toBe("DA_THU");
    expect(k.ketLuan?.loai).toBe("HUY_SAU_THU");
    const v = await viewDon(SAU);
    expect(v?.mucDo).toBe("canh_bao");
    expect(v?.thongDiep).toMatch(/huỷ\/hoàn sau khi ghi nhận/);
  });

  it("[POS1-VA-DB-08] biên nhận phụ huynh cho khoản thu bằng THẺ ghi phương thức 'Thẻ (máy POS)', không 'Chuyển khoản (payOS)'", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma }));
    await chayHandler();
    const log = await db.emailLog.findMany({ where: { contextType: "Order", contextId: DON } });
    expect(log).toHaveLength(1);
    expect(log[0]!.bodyText).toContain("Thẻ (máy POS)");
    expect(log[0]!.bodyText).not.toContain("Chuyển khoản (payOS)");
  });
});
