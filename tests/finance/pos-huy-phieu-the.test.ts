// tests/finance/pos-huy-phieu-the.test.ts — NÚT "HUỶ PHIẾU THẺ" (Việc 4 · phần MÁY CHỦ). Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-hai-nut.test.ts`).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §6 (hợp đồng) + §6.11 (kết quả của máy chủ). Đi qua ĐÚNG cửa đời thật: phiếu mở bằng
// `moPhieuPos`, huỷ bằng `huyPhieuThe` (lib) hoặc `huyPhieuTheAction` (action), tiền bằng `nhapLoPos` / `xuLyKetQuaPos` /
// `kiemTraPhieuPos`. Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm có `now` đều được truyền mốc tuyệt đối; riêng nhóm gọi ACTION (action
// tự đọc `new Date()`) dùng `vi.useFakeTimers({ toFake: ["Date"] })` — chỉ giả `Date`, không giả bộ hẹn giờ (khuôn `pos-gd4.test.ts`).
//
// ⚠️ Ca "bị từ chối" LUÔN khẳng định NGUYÊN VĂN câu (`ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE.X)`) VÀ ảnh chụp trước/sau
// (kể cả `updatedAt`, số dòng AuditLog) bằng nhau: chỉ đếm "0 dòng đổi" thì ca xanh ngay cả khi hàm không làm gì cả — và dòng
// "đỏ trước khi vá" ghi lại sẽ là giả (luật 11). Mỗi ca từ chối có ĐỐI CHỨNG DƯƠNG (đổi đúng một yếu tố ⇒ huỷ được).
//
// ⚠️ Mã từ chối của Việc 3 (`CO_YEU_CAU_SAI_MA`) có ca DB THẬT trong bảng `[HN4-DB-03]` (đọc bảng `PosSaiMaYeuCau` qua hàm nối ở
// `yeu-cau-sai-ma-dang-giu.ts`). Các kịch bản sâu hơn — đường thật gửi → từ chối → huỷ, ca LÁCH, ĐUA huỷ ×
// gửi/duyệt/từ chối/khớp tự động, thứ tự khoá — nằm ở `tests/finance/pos-huy-sai-ma.test.ts` (`[HN4-DB-13*]`, `[HN6-A2-*]`). Meta-ca `[HN4-DB-03c]` đòi ĐỦ 16 mã.
// VIỆC 6 · a2 (10/10/2026): mã `SAI_MA_BI_TU_CHOI` ĐÃ GỠ — kế toán từ chối thì sale HUỶ ĐƯỢC phiếu thẻ theo cổng thường (ca `[HN6-A2-*]`).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", async (goc) => ({
  ...(await goc<typeof import("@/lib/auth/actor")>()),
  resolveActor: h.resolveActor,
}));
vi.mock("next/cache", async (goc) => ({
  ...(await goc<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}));

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { Actor } from "@/lib/auth/actor";
import { docPhieuGopDangMo, dongPhieuGop, huyPhieuGop, phatHoacDungLaiPhieuGop, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import type { DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { FakePosProvider } from "@/lib/payments/pos/provider/fake";
import { TcbFileImportProvider } from "@/lib/payments/pos/provider/tcb-file";
import { kiemTraPhieuPos, xuLyKetQuaPos, type TriggeredBy } from "@/lib/payments/pos/xu-ly-ket-qua";
import { docPhieuPosTho, docPhieuPosView, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { chayPollerPos, hetHanPhieuPos } from "@/lib/payments/pos/poller";
import { quetSachPhieuPos } from "@/lib/payments/pos/quet-sach";
import { dongBoPhieuPosSauNhap } from "@/lib/payments/pos/dong-bo-sau-nhap";
import { dongBoPhieuPosSauAgent } from "@/lib/payments/pos/dong-bo-sau-agent";
import { docTheDangMoCuaPhieuGop } from "@/lib/payments/pos/the-dang-mo";
import { dungPhieuPosChoDon, LOI_HUY_KHI_CHO_QUET_THE } from "@/lib/payments/pos/phieu-pos-luat";
import { thongDiepPos } from "@/lib/payments/pos/thong-diep-pos";
import { huyPhieuThe } from "@/lib/payments/pos/huy-phieu-the-db";
import {
  CAU_PHIEU_THE_DA_HUY,
  CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN,
  CAU_THIEU_XAC_NHAN_MANH,
  CAU_TU_CHOI_HUY_PHIEU_THE,
  MA_TU_CHOI_HUY_PHIEU_THE,
  ghepCauTuChoiHuy,
  type MaLyDoHuyPhieuThe,
  type MaTuChoiHuyPhieuThe,
} from "@/lib/payments/pos/huy-phieu-the-cau";
import type { HuyPhieuTheInput } from "@/lib/validators/huy-phieu-the";
import { huyPhieuTheAction, taoPhieuPosAction } from "@/app/(admin)/admin/orders/_actions";

if (!RUN_DB_TESTS) console.warn(`[HN4-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos4hn-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS4HN";

const KT = `${T}kt`; // người nhập file (khoá ngoại của lô import)
const SALE = `${T}sale`; // người lập đơn + tạo phiếu + bấm huỷ
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON = `${T}don`;
const DON2 = `${T}don2`; // đơn thứ hai CÙNG cơ sở — dựng IDOR
const A = `${T}item-a`;
const B = `${T}item-b`;
const C = `${T}item-c`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const DOT_C = `${T}dot-c`;
const MAY1 = `${PFX}MAY01`;
const MAY2 = `${PFX}MAY02`;
const SDT_PH = "0399852399";
const TEN_SALE = "Sale fixture HN4";
const ACTOR = { id: SALE, name: TEN_SALE };

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000

/** Lúc tạo phiếu thẻ (17:00 giờ VN) — QUÁ KHỨ so với đồng hồ thật (khuôn pos-hai-nut). */
const NOW = new Date("2026-10-06T10:00:00Z");
/** Giờ quẹt (giờ VN) — SAU lúc tạo phiếu. */
const GIO_QUET = "2026-10-06T17:31:35+07:00";
const PHUT = 60_000;
const GIO = 60 * PHUT;
const sau = (moc: Date, ms: number) => new Date(moc.getTime() + ms);
/** Lúc bấm Kiểm tra / lúc sale bấm Huỷ khi phiếu thẻ CÒN HẠN. */
const KIEM = sau(NOW, 40 * PHUT);
const CON_HAN = sau(NOW, 41 * PHUT);
const QUA_HAN = sau(NOW, 25 * GIO);

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
const ghep = (ma: MaTuChoiHuyPhieuThe) => ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE[ma]);

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { providerTxnId: { startsWith: PFX } };
const CUA_DON = { orderId: { startsWith: T } };

async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: T } } });
  // Yêu cầu "nhập sai mã" (Việc 3) và nhật ký TRƯỚC phiếu POS (khoá ngoại RESTRICT).
  await db.posSaiMaYeuCau.deleteMany({ where: { intent: { paymentBill: CUA_DON } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: CUA_DON } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: CUA_DON } });
  await db.staffNotification.deleteMany({ where: { userId: { in: [KT, SALE] } } });
  await db.staffNotification.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: [KT, SALE] } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { actorId: { in: [KT, SALE] } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: CUA_DON } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT } });
  await db.paymentBillLine.deleteMany({ where: { bill: CUA_DON } });
  await db.paymentBill.deleteMany({ where: CUA_DON });
  await db.creditBalance.deleteMany({ where: CUA_DON });
  await db.payment.deleteMany({ where: CUA_DON });
  await db.paymentRequest.deleteMany({ where: CUA_DON });
  await db.bankTransaction.deleteMany({ where: LOC_BT });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: [KT, SALE] } } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: [KT, SALE] } }, { phone: { in: [SDT_PH, "84399852399"] } }] } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", "Kế toán fixture HN4"],
    [SALE, "SALES_CSM", TEN_SALE],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  for (const [id, ten] of [
    [CS1, "CS1 fixture POS4HN"],
    [CS2, "CS2 fixture POS4HN"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: "QTTFBKATK", centerId: CS2 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269985-000401",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture POS4HN",
      customerPhone: SDT_PH,
      totalAmount: TONG,
      centerId: CS1,
      createdById: SALE,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A HN4", DOT_TIEN_A],
    [B, "Bé B HN4", DOT_TIEN_B],
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

/** Đơn THỨ HAI cùng cơ sở, có phiếu gộp + phiếu thẻ riêng — để dựng IDOR (phiếu của đơn khác). */
async function dungDon2() {
  await db.order.create({
    data: {
      id: DON2,
      code: "ORD-269985-000402",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh 2 fixture POS4HN",
      customerPhone: "0399852398",
      totalAmount: DOT_TIEN_A,
      centerId: CS1,
      createdById: SALE,
    },
  });
  await db.orderItem.create({
    data: { id: C, orderId: DON2, type: "COURSE_ENROLLMENT", itemName: "Bé C HN4", quantity: 1, unitPrice: DOT_TIEN_A, totalPrice: DOT_TIEN_A },
  });
  await db.paymentRequest.create({
    data: { id: DOT_C, orderId: DON2, orderItemId: C, centerId: CS1, installmentNo: 1, amountDue: DOT_TIEN_A, status: "PENDING", sortOrder: 1 },
  });
  const g = await taoPhieuGop({ orderId: DON2, paymentRequestIds: [DOT_C], actor: ACTOR });
  if (!g.ok) throw new Error(`fixture: không phát được phiếu gộp đơn 2 — ${g.error}`);
  const r = await moPhieuPos({ orderId: DON2, paymentRequestId: DOT_C, actor: ACTOR, now: NOW });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS đơn 2 — ${r.error}`);
  return { g, p: r.phieu };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** Nút "Xuất QR" của phiếu gộp (mặc định cả hai đợt = TONG). */
async function phatPhieu(ids: string[] = [DOT_A, DOT_B]) {
  const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}

/** Nút "Thẻ POS". */
async function moPhieu(o: { now?: Date; dot?: string } = {}) {
  const r = await moPhieuPos({ orderId: DON, paymentRequestId: o.dot ?? DOT_A, actor: ACTOR, now: o.now ?? NOW });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  return r.phieu;
}

/** Phiếu gộp + MỘT phiếu thẻ đang chờ quẹt. */
async function dung() {
  const g = await phatPhieu();
  const p = await moPhieu();
  return { g, p };
}

/** Bấm "Huỷ phiếu thẻ" — chính hàm `huyPhieuTheAction` gọi. Mặc định: có tick, lý do "mở nhầm", còn hạn. */
function huy(
  intentId: string,
  o: { lyDo?: MaLyDoHuyPhieuThe; ghiChu?: string; xacNhan?: boolean; now?: Date; orderId?: string } = {},
) {
  return huyPhieuThe({
    orderId: o.orderId ?? DON,
    intentId,
    lyDo: o.lyDo ?? "MO_NHAM",
    ...(o.ghiChu !== undefined ? { ghiChu: o.ghiChu } : {}),
    xacNhanKhachChuaQuet: o.xacNhan ?? true,
    actor: ACTOR,
    now: o.now ?? CON_HAN,
  });
}

const phieuPos = (id: string) => db.posPaymentIntent.findUniqueOrThrow({ where: { id } });
const phieuGopDb = (id: string) => db.paymentBill.findUniqueOrThrow({ where: { id } });

/**
 * Ảnh chụp MỌI thứ một lượt huỷ có thể đổi. `updatedAt` nằm trong đó ⇒ một phép ghi vô hình cũng làm nó lệch.
 * `boQuaPhieuThe` — khi ca THÀNH CÔNG: chính phiếu thẻ đổi, các bảng còn lại phải y nguyên. `boQuaAudit` — khi ca thành công thêm một dòng.
 */
async function chup(o: { boQuaPhieuThe?: boolean; boQuaAudit?: boolean } = {}): Promise<string> {
  const [bill, lines, dots, payments, order, bts, allocs, theThe, nhatKy, intents, audit, suKien] = await Promise.all([
    db.paymentBill.findMany({ where: CUA_DON, orderBy: { id: "asc" } }),
    db.paymentBillLine.findMany({ where: { bill: CUA_DON }, orderBy: { id: "asc" } }),
    db.paymentRequest.findMany({ where: CUA_DON, orderBy: { id: "asc" } }),
    db.payment.findMany({ where: CUA_DON, orderBy: { id: "asc" } }),
    db.order.findMany({ where: { id: { startsWith: T } }, orderBy: { id: "asc" } }),
    db.bankTransaction.findMany({ where: LOC_BT, orderBy: { id: "asc" } }),
    db.paymentAllocation.findMany({ where: { paymentRequest: CUA_DON }, orderBy: { id: "asc" } }),
    db.posCardTransaction.findMany({ where: { maGiaoDich: { startsWith: PFX } }, orderBy: { id: "asc" } }),
    db.posCheckLog.count({ where: { intent: { paymentBill: CUA_DON } } }),
    o.boQuaPhieuThe ? Promise.resolve(null) : db.posPaymentIntent.findMany({ where: { paymentBill: CUA_DON }, orderBy: { id: "asc" } }),
    o.boQuaAudit ? Promise.resolve(null) : db.auditLog.count({ where: { entityType: "Order", entityId: { startsWith: T } } }),
    db.domainEvent.count({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } }),
  ]);
  return JSON.stringify({ bill, lines, dots, payments, order, bts, allocs, theThe, nhatKy, intents, audit, suKien });
}

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

/** Kiểm tra bằng provider cho trước (mặc định đọc FILE đã nhập — nơi tiền thật nằm). */
function kiem(intentId: string, provider: FakePosProvider | TcbFileImportProvider = new TcbFileImportProvider(), now: Date = KIEM) {
  return kiemTraPhieuPos({ intentId, provider, triggeredBy: "SALE", now, nguoiKiemId: SALE });
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

/** Khách quẹt đúng mã, máy của CHÍNH cơ sở, đúng số ⇒ file tự khớp vào phiếu gộp (phiếu gộp PAID). Trả mã giao dịch. */
async function tienVaoMa(ma: string, o: { soTien?: number; may?: string; thoiGian?: string; maGiaoDich?: string } = {}) {
  const m = o.maGiaoDich ?? maGd();
  await nhapFile([
    dong({ maGiaoDich: m, dienGiai: ma, soTien: o.soTien ?? TONG, maThietBi: o.may ?? MAY1, thoiGian: o.thoiGian ?? GIO_QUET }),
  ]);
  return m;
}

const btThe = (ma: string) => db.bankTransaction.findFirst({ where: { providerTxnId: ma } });

/**
 * Chèn THẲNG một dòng `PosSaiMaYeuCau` (Việc 3) — đường thật không bao giờ tạo "yêu cầu sống trên phiếu CHO_QUET" (gửi chuyển phiếu sang CAN_XU_LY
 * trong cùng transaction). Hợp lệ với cả năm CHECK + hai UNIQUE từng phần của migration `20261010090000`.
 * Kịch bản đi bằng ĐƯỜNG THẬT (`guiSaiMa` → `tuChoiSaiMa`) nằm ở `pos-huy-sai-ma.test.ts`. VIỆC 6 · a2: nhánh `TU_CHOI` của hàm này không còn ca nào gọi trong tệp (bị từ chối
 * không còn là lý do từ chối huỷ — mã `SAI_MA_BI_TU_CHOI` đã gỡ); giữ để dựng dữ liệu nếu một ca sau cần.
 */
async function chenYeuCauSaiMa(intentId: string, bankTransactionId: string, trangThai: "CHO_DUYET" | "TU_CHOI") {
  return db.posSaiMaYeuCau.create({
    data: {
      intentId,
      bankTransactionId,
      centerId: CS1,
      kieu: "CHO_KE_TOAN",
      trangThai,
      lyDo: "NHIEU_UNG_VIEN",
      nguoiGuiId: SALE,
      createdAt: KIEM,
      ...(trangThai === "TU_CHOI" ? { nguoiQuyetId: KT, quyetLuc: sau(KIEM, PHUT), lyDoTuChoi: "Không phải giao dịch của khách" } : {}),
    },
  });
}

/** Số dòng AuditLog `POS_PHIEU_HUY` của đơn. */
const soVetHuy = (orderId = DON) => db.auditLog.count({ where: { entityType: "Order", entityId: orderId, action: "POS_PHIEU_HUY" } });

/** Tiền ghi ĐÚNG MỘT LẦN: một BankTransaction MATCHED, Σ Payment = số tiền. */
async function khoanTienMotLan(m: string, soTien: number, soDong: number, ghiChu = "") {
  const bts = await db.bankTransaction.findMany({ where: { providerTxnId: m } });
  expect(bts, `${ghiChu} 1 BankTransaction`).toHaveLength(1);
  expect(bts[0]!.status, `${ghiChu} MATCHED`).toBe("MATCHED");
  const khoan = await db.payment.findMany({ where: { orderId: DON, note: { contains: `[auto:card_pos:${m}]` } } });
  expect(khoan.reduce((s, k) => s + k.amount, 0), `${ghiChu} Σ Payment`).toBe(soTien);
  expect(khoan, `${ghiChu} số dòng Payment`).toHaveLength(soDong);
}

/** Actor cấp cơ sở: thấy Order (`orders:`) và phiếu thẻ (`payments:`) CHỈ ở `centerId`. */
function actorCoSo(centerId: string): Actor {
  return {
    userId: SALE,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      { action: "orders:view", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_SALES_CSM", centerScope: [centerId] },
      { action: "payments:pos-check", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_SALES_CSM", centerScope: [centerId] },
    ],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

// ── Bộ gá ĐUA XÁC ĐỊNH: giữ khoá ĐƠN ở một transaction riêng, cho tới khi test cho nhả ──────────────────────────────────
//
// Test tuần tự KHÔNG phân biệt được "đọc lại DƯỚI khoá" với "đọc TRƯỚC khoá": lượt đọc bị dời lên trước khoá vẫn chạy sau khi
// lượt kia đã xong. Muốn thấy khác biệt phải ép đúng thứ tự: (1) kẻ khác GIỮ khoá đơn; (2) lượt huỷ bắt đầu và BỊ CHẶN ở khoá;
// (3) kẻ khác đổi sự thật rồi nhả; (4) lượt huỷ thức dậy — nó phải thấy sự thật MỚI.

/** Giữ khoá đơn trong một transaction riêng; `trongKhoa` chạy DƯỚI khoá. Trả `nha()` — cho transaction commit. */
async function giuKhoaDon(orderId: string, trongKhoa: (tx: Prisma.TransactionClient) => Promise<void>) {
  let nhaKhoa!: () => void;
  const choNha = new Promise<void>((xong) => {
    nhaKhoa = xong;
  });
  let daKhoa!: () => void;
  const choKhoa = new Promise<void>((xong) => {
    daKhoa = xong;
  });
  const giu = db.$transaction(
    async (tx) => {
      await khoaDonTrongTx(tx, orderId);
      await trongKhoa(tx);
      daKhoa();
      await choNha;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  // Transaction chết trước khi khoá được (lỗi DB) ⇒ `giu` reject ⇒ ca đỏ ngay, không treo.
  await Promise.race([choKhoa, giu]);
  return {
    nha: async () => {
      nhaKhoa();
      await giu;
    },
  };
}

/**
 * Chờ tới khi lượt `dangChay` BỊ CHẶN ở khoá advisory (khoá đơn): có ít nhất một phiên đang CHỜ khoá advisory ở DB này (lọc theo
 * oid — cụm 5432 dùng chung với phiên khác). Trả `true` khi thấy người chờ; `false` khi lượt đã xong mà chưa ai chờ (nó KHÔNG hề
 * bị chặn ⇒ không lấy khoá đơn) hoặc quá 8 giây. Không bao giờ ném và không để vòng thăm dò chạy tiếp sau khi lượt kia đã xong.
 *
 * Ca gọi phải KHẲNG ĐỊNH kết quả (`expect(biChan).toBe(true)`) — chính khẳng định ấy là bằng chứng "lượt huỷ chờ khoá đơn".
 */
async function choCoNguoiChoKhoa(dangChay: Promise<unknown>): Promise<boolean> {
  let xong = false;
  void dangChay.then(
    () => {
      xong = true;
    },
    () => {
      xong = true;
    },
  );
  const batDau = performance.now();
  while (!xong) {
    const r = await db.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from pg_locks
      where locktype = 'advisory' and not granted
        and database = (select oid from pg_database where datname = current_database())`;
    if ((r[0]?.n ?? 0) > 0) return true;
    if (performance.now() - batDau > 8_000) return false;
    await new Promise((x) => setTimeout(x, 25));
  }
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// CÁC CA
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!RUN_DB_TESTS)("[HN4-DB] nút 'Huỷ phiếu thẻ' — máy chủ", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-01] huỷ thành công", () => {
    it("[HN4-DB-01] CHO_QUET chưa kiểm, có tick ⇒ chỉ phiếu thẻ thành HUY; mọi bảng khác KHÔNG đổi; đúng 1 dòng AuditLog đủ người · lý do · mã · trạng thái trước", async () => {
      const { g, p } = await dung();
      const truocKhac = await chup({ boQuaPhieuThe: true, boQuaAudit: true });
      const truocAudit = await db.auditLog.count({ where: { entityType: "Order", entityId: DON } });
      const truoc = await phieuPos(p.intentId);
      expect(truoc.status).toBe("CHO_QUET");

      const kq = await huy(p.intentId, { lyDo: "KHACH_DOI_CACH_TRA" });
      expect(kq).toEqual({ ok: true, intentId: p.intentId, code5: g.ma });

      const x = await phieuPos(p.intentId);
      expect(x.status).toBe("HUY");
      // Mọi cột KHÁC của phiếu thẻ giữ nguyên (đặc biệt: mã, bankTransactionId, kết quả lượt kiểm, hạn).
      expect({ ...x, status: truoc.status, updatedAt: truoc.updatedAt }).toEqual(truoc);
      expect(x.updatedAt.getTime()).toBeGreaterThanOrEqual(truoc.updatedAt.getTime());
      // KHÔNG đụng PaymentBill / Order / Payment / BankTransaction / PaymentAllocation / PaymentRequest / PosCardTransaction / nhật ký kiểm / sự kiện.
      expect(await chup({ boQuaPhieuThe: true, boQuaAudit: true }), "chỉ phiếu thẻ đổi").toBe(truocKhac);
      expect((await phieuGopDb(g.billId)).status, "phiếu gộp VẪN mở, cùng mã").toBe("OPEN");

      // Vết: đúng MỘT dòng, đủ người · lý do · mã · trạng thái trước.
      expect(await db.auditLog.count({ where: { entityType: "Order", entityId: DON } }), "đúng một dòng mới").toBe(truocAudit + 1);
      const vet = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect(vet).toHaveLength(1);
      const v = vet[0]!;
      expect(v.actorId).toBe(SALE);
      expect(v.actorName).toBe(TEN_SALE);
      expect(v.module).toBe("finance");
      expect(v.oldValues).toEqual({ intentId: p.intentId, status: "CHO_QUET" });
      expect(v.newValues).toMatchObject({
        intentId: p.intentId,
        status: "HUY",
        ma: g.ma,
        lyDo: "KHACH_DOI_CACH_TRA",
        lyDoNhan: "Khách đổi cách trả",
        ghiChu: null,
        nguon: "HUY_TAY",
        xacNhanKhachChuaQuet: true,
      });
      expect(v.reason).toBe(`Huỷ phiếu thu thẻ mã ${g.ma} — Khách đổi cách trả`);
    });

    it("[HN4-DB-01b] 'Khác' + ghi chú ⇒ ghi chú vào vết (đã cắt khoảng trắng) và vào `reason`; lý do KHÔNG kèm ghi chú ⇒ `ghiChu: null`", async () => {
      const { g, p } = await dung();
      const kq = await huy(p.intentId, { lyDo: "KHAC", ghiChu: "  Khách muốn trả tiền mặt  " });
      expect(kq.ok).toBe(true);
      const v = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect(v.newValues).toMatchObject({ lyDo: "KHAC", lyDoNhan: "Khác", ghiChu: "Khách muốn trả tiền mặt" });
      expect(v.reason).toBe(`Huỷ phiếu thu thẻ mã ${g.ma} — Khác: Khách muốn trả tiền mặt`);
    });

    it("[HN4-DB-01c] `reason` KHÔNG vượt 500 ký tự dù ghi chú dài (cột dùng chung với mọi vết khác)", async () => {
      const { p } = await dung();
      await huy(p.intentId, { lyDo: "KHAC", ghiChu: "x".repeat(200) });
      const v = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect((v.reason ?? "").length).toBeLessThanOrEqual(500);
      expect((v.newValues as { ghiChu: string }).ghiChu).toHaveLength(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-02] xác nhận mạnh: MỌI ca cho huỷ đều đòi tick (V4.3)", () => {
    it("[HN4-DB-02] CHO_QUET chưa kiểm KHÔNG tick ⇒ `CAU_THIEU_XAC_NHAN_MANH`, 0 dòng đổi; CÓ tick ⇒ huỷ được", async () => {
      const { p } = await dung();
      const truoc = await chup();
      expect(await huy(p.intentId, { xacNhan: false })).toEqual({ ok: false, error: CAU_THIEU_XAC_NHAN_MANH });
      expect(await chup(), "bị từ chối thì không ghi gì").toBe(truoc);
      expect((await huy(p.intentId, { xacNhan: true })).ok, "đối chứng dương: cùng phiếu, có tick").toBe(true);
    });

    it("[HN4-DB-02b] THAT_BAI + FAILED cũng đòi tick (FAILED chỉ chứng minh lần quẹt GẦN NHẤT thất bại)", async () => {
      const { p } = await dung();
      const kq = await xuLy(p.intentId, { kind: "FAILED", reasonCode: "USER_CANCELLED", providerTxnId: maGd() });
      expect(kq.status).toBe("THAT_BAI");
      const truoc = await chup();
      expect(await huy(p.intentId, { xacNhan: false })).toEqual({ ok: false, error: CAU_THIEU_XAC_NHAN_MANH });
      expect(await chup()).toBe(truoc);
      expect((await huy(p.intentId, { xacNhan: true })).ok).toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
    });

    it("[HN4-DB-02c] 'Chưa thấy giao dịch' TRẦN (câu đường thật sinh ra) vẫn huỷ được khi có tick — và KHÔNG khi thiếu tick", async () => {
      const { g, p } = await dung();
      await xuLy(p.intentId, { kind: "NOT_FOUND" });
      const x = await phieuPos(p.intentId);
      expect(x.lastResultKind).toBe("NOT_FOUND");
      expect(x.lastResultMessage ?? "").toContain(`Chưa thấy giao dịch mang mã ${g.ma}.`);
      expect(await huy(p.intentId, { xacNhan: false })).toEqual({ ok: false, error: CAU_THIEU_XAC_NHAN_MANH });
      expect((await huy(p.intentId)).ok).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-03] mỗi mã từ chối chạm DB thật — 0 dòng đổi, đúng câu", () => {
    type Ca = {
      ma: MaTuChoiHuyPhieuThe;
      ten: string;
      /** Dựng trạng thái đời thật; trả phiếu cần huỷ + (tuỳ) đồng hồ bấm. */
      dung: () => Promise<{ intentId: string; now?: Date; doiChung?: () => Promise<void> }>;
    };
    const CA: Ca[] = [
      {
        ma: "DA_THU",
        ten: "tiền đã vào mã, phiếu thẻ được Kiểm tra ⇒ DA_THU",
        dung: async () => {
          const { g, p } = await dung();
          await tienVaoMa(g.ma);
          await kiem(p.intentId);
          expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
          return { intentId: p.intentId };
        },
      },
      {
        ma: "LECH_TIEN",
        ten: "máy thu lệch số (TONG − 1) ⇒ LECH_TIEN",
        dung: async () => {
          const { g, p } = await dung();
          const kq = await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma, amount: TONG - 1 }));
          expect(kq.status).toBe("LECH_TIEN");
          return { intentId: p.intentId };
        },
      },
      {
        ma: "CAN_XU_LY",
        ten: "máy thu ở cơ sở KHÁC (Q-E chặn khớp) ⇒ CAN_XU_LY",
        dung: async () => {
          const { g, p } = await dung();
          const kq = await xuLy(p.intentId, paid({ providerTxnId: maGd(), dienGiai: g.ma, terminalCode: MAY2 }));
          expect(kq.status).toBe("CAN_XU_LY");
          return { intentId: p.intentId };
        },
      },
      {
        ma: "DA_NHAN_GIAO_DICH",
        ten: "phiếu MỞ mà đã nhận một giao dịch (dữ liệu bất thường — giao dịch đã rời hàng chờ để cô lập cổng này)",
        dung: async () => {
          const { g, p } = await dung();
          const m = maGd();
          await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: MAY2 })]);
          const bt = (await btThe(m))!;
          await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { bankTransactionId: bt.id } });
          await db.bankTransaction.update({ where: { id: bt.id }, data: { status: "IGNORED" } });
          return { intentId: p.intentId };
        },
      },
      {
        ma: "CO_GIAO_DICH_CHO_TAY",
        ten: "giao dịch thẻ mang mã nằm hàng chờ tay (quẹt ở máy cơ sở khác), phiếu thẻ chưa nhận",
        dung: async () => {
          const { g, p } = await dung();
          const m = maGd();
          await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: MAY2 })]);
          expect((await btThe(m))?.status).toBe("UNMATCHED");
          return {
            intentId: p.intentId,
            doiChung: async () => {
              await db.bankTransaction.update({ where: { id: (await btThe(m))!.id }, data: { status: "IGNORED" } });
            },
          };
        },
      },
      {
        ma: "CO_GIAO_DICH_CHO_TAY",
        ten: "CẠM BẪY mốc: giao dịch quẹt dưới phiếu CŨ (đã bị thay) về hàng chờ SAU khi phiếu mới được mở",
        dung: async () => {
          const g = await phatPhieu();
          await moPhieu({ now: NOW }); // phiếu cũ — sẽ bị thay
          const p2 = await moPhieu({ now: QUA_HAN }); // quá hạn ⇒ cũ HET_HAN, mới CHO_QUET
          const dsSau = await db.posPaymentIntent.findMany({ where: { paymentBill: { orderId: DON } }, orderBy: { createdAt: "asc" } });
          expect(dsSau.map((x) => x.status)).toEqual(["HET_HAN", "CHO_QUET"]);
          // Quẹt lúc NOW+31′ (đời phiếu CŨ), file về SAU khi phiếu mới (tạo NOW+25h) đã mở ⇒ UNMATCHED.
          const m = maGd();
          await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: MAY2 })]);
          expect((await btThe(m))?.status).toBe("UNMATCHED");
          return {
            intentId: p2.intentId,
            now: sau(QUA_HAN, 10 * PHUT),
            doiChung: async () => {
              await db.bankTransaction.update({ where: { id: (await btThe(m))!.id }, data: { status: "IGNORED" } });
            },
          };
        },
      },
      {
        ma: "KET_QUA_PAID_CHUA_GHI",
        ten: "CHO_QUET mà lượt kiểm gần nhất thấy PAID (pha tiền ném)",
        dung: async () => {
          const { p } = await dung();
          await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { lastResultKind: "PAID" } });
          return { intentId: p.intentId };
        },
      },
      {
        ma: "KET_QUA_PAID_SAU_THAT_BAI",
        ten: "THAT_BAI mà lượt kiểm gần nhất có giao dịch mang mã (hai nguồn không phân biệt được bằng cột)",
        dung: async () => {
          const { p } = await dung();
          await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { status: "THAT_BAI", lastResultKind: "PAID_AMOUNT_MISMATCH" } });
          return { intentId: p.intentId };
        },
      },
      {
        ma: "HUY_SAU_THU",
        ten: "giao dịch đã bị huỷ/hoàn sau khi ghi nhận",
        dung: async () => {
          const { p } = await dung();
          await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { lastResultKind: "CANCELLED_AFTER_PAID" } });
          return { intentId: p.intentId };
        },
      },
      {
        ma: "LOI_KET_NOI",
        ten: "lần kiểm gần nhất lỗi kết nối (đường thật)",
        dung: async () => {
          const { p } = await dung();
          await xuLy(p.intentId, { kind: "PROVIDER_ERROR", reasonCode: "TIMEOUT" });
          expect((await phieuPos(p.intentId)).lastResultKind).toBe("PROVIDER_ERROR");
          return { intentId: p.intentId };
        },
      },
      {
        ma: "CHUA_NGA_NGU",
        ten: "NOT_FOUND mà câu lưu là 'dòng mang mã chưa ngã ngũ' (ĐỪNG quẹt lại) — cùng `lastResultKind` với 'chưa thấy' trần",
        dung: async () => {
          const { g, p } = await dung();
          const cau = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: g.ma, maTrangThai: "DANG_XU_LY" }).cau;
          await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { lastResultKind: "NOT_FOUND", lastResultMessage: cau } });
          return { intentId: p.intentId };
        },
      },
      {
        ma: "CO_YEU_CAU_SAI_MA",
        ten: "VIỆC 3 × VIỆC 4: yêu cầu 'nhập sai mã' CÒN SỐNG nằm trên phiếu CHO_QUET (dữ liệu vi phạm bất biến — đường thật chuyển phiếu sang CAN_XU_LY lúc gửi nên cổng ① nói trước; cờ là lớp thứ hai)",
        dung: async () => {
          const { p } = await dung();
          await xuLy(p.intentId, { kind: "NOT_FOUND" });
          const m = maGd();
          await nhapFile([dong({ maGiaoDich: m, dienGiai: "", maThietBi: MAY1 })]);
          await chenYeuCauSaiMa(p.intentId, (await btThe(m))!.id, "CHO_DUYET");
          return {
            intentId: p.intentId,
            doiChung: async () => {
              // Đúng MỘT yếu tố đổi (yêu cầu biến mất) ⇒ cùng phiếu huỷ được.
              await db.posSaiMaYeuCau.deleteMany({ where: { intentId: p.intentId } });
            },
          };
        },
      },
      // VIỆC 6 · a2: ca `SAI_MA_BI_TU_CHOI` ("yêu cầu MỚI NHẤT bị từ chối ⇒ không huỷ") ĐÃ GỠ cùng mã — chiều NGƯỢC LẠI (bị từ chối mà huỷ ĐƯỢC) đo ở `[HN6-A2-*]` (`pos-huy-sai-ma.test.ts`).
      {
        ma: "DONG_THE_CHUA_NGA_NGU",
        ten: "VIỆC 4 rà đối kháng: lượt kiểm lưu 'Chưa thấy…' rồi dòng 'Đang xử lý' mang mã VỀ (BO_QUA, không giao dịch) — cổng phải đọc dữ liệu ĐÃ CÓ",
        dung: async () => {
          const { g, p } = await dung();
          await kiem(p.intentId);
          expect((await phieuPos(p.intentId)).lastResultKind, "lượt kiểm cuối: chưa thấy").toBe("NOT_FOUND");
          const m = maGd();
          await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, trangThai: "Đang xử lý" })]);
          expect(await db.bankTransaction.count({ where: LOC_BT }), "dòng treo KHÔNG sinh giao dịch").toBe(0);
          return {
            intentId: p.intentId,
            doiChung: async () => {
              // Đúng MỘT yếu tố đổi: dòng treo ngã ngũ thành "Thất bại" (khách huỷ trên máy) ⇒ cùng phiếu huỷ được.
              await db.posCardTransaction.update({ where: { maGiaoDich: m }, data: { trangThai: "Thất bại" } });
            },
          };
        },
      },
      {
        ma: "PHIEU_GOP_DA_DONG",
        ten: "tiền ĐÚNG SỐ đã vào mã (phiếu gộp PAID) mà phiếu thẻ chưa ai Kiểm tra — màn vẫn nói CHO_QUET",
        dung: async () => {
          const { g, p } = await dung();
          await tienVaoMa(g.ma);
          expect((await phieuGopDb(g.billId)).status).toBe("PAID");
          expect((await phieuPos(p.intentId)).status, "phiếu thẻ CHƯA đổi").toBe("CHO_QUET");
          return { intentId: p.intentId };
        },
      },
      {
        ma: "QUA_HAN_CHO_DONG",
        ten: "phiếu thẻ quá hạn 24 giờ mà poller chưa ghi HET_HAN",
        dung: async () => {
          const { p } = await dung();
          return { intentId: p.intentId, now: QUA_HAN };
        },
      },
      {
        ma: "DA_HET_HAN",
        ten: "phiếu thẻ đã HET_HAN (poller ghi)",
        dung: async () => {
          const { p } = await dung();
          expect(await hetHanPhieuPos({ intentId: p.intentId, now: QUA_HAN })).toEqual({ doi: true });
          return { intentId: p.intentId, now: QUA_HAN };
        },
      },
    ];

    it.each(CA)("[HN4-DB-03] $ma — $ten", async (ca) => {
      const { intentId, now, doiChung } = await ca.dung();
      const truoc = await chup();
      const kq = await huy(intentId, { ...(now ? { now } : {}) });
      expect(kq).toEqual({ ok: false, error: ghep(ca.ma) });
      expect(await chup(), "cổng đứng TRƯỚC phép ghi đầu tiên: không đổi một dòng nào (kể cả AuditLog, updatedAt)").toBe(truoc);
      if (doiChung) {
        // Đối chứng dương: đúng MỘT yếu tố đổi (giao dịch chờ tay rời hàng chờ) ⇒ cùng phiếu huỷ được.
        await doiChung();
        const sauDoi = await huy(intentId, { ...(now ? { now } : {}) });
        expect(sauDoi.ok, "đối chứng dương").toBe(true);
        expect((await phieuPos(intentId)).status).toBe("HUY");
      }
    });

    it("[HN4-DB-03b] DA_HUY — huỷ hai lần: lần hai nhận `DA_HUY`, không ghi thêm dòng nào (kể cả AuditLog)", async () => {
      const { p } = await dung();
      expect((await huy(p.intentId)).ok).toBe(true);
      const truoc = await chup();
      expect(await huy(p.intentId)).toEqual({ ok: false, error: ghep("DA_HUY") });
      expect(await chup()).toBe(truoc);
      expect(await soVetHuy()).toBe(1);
    });

    it("[HN4-DB-03c] đúng tập 16 mã: MỖI mã từ chối có ca DB ở đây — kể cả mã của Việc 3 (không còn ngoại lệ); kịch bản sâu ở `pos-huy-sai-ma.test.ts`", () => {
      const phu = [...new Set([...CA.map((c) => c.ma), "DA_HUY" as const])].sort();
      expect(phu, "thêm một mã từ chối mà quên ca DB là đỏ ở đây").toEqual([...MA_TU_CHOI_HUY_PHIEU_THE].sort());
    });

    it("[HN4-DB-03e] BIÊN hết hạn dùng CHÍNH `phieuPosHetHan` (≤, mốc chung với view · poller · 'Thẻ POS'): đúng lúc `expiresAt` ⇒ `QUA_HAN_CHO_DONG`; lùi 1 ms ⇒ huỷ được", async () => {
      const { p } = await dung();
      const han = sau(NOW, 24 * GIO); // expiresAt = createdAt + HAN_PHIEU_POS_MS (24 giờ)
      expect((await phieuPos(p.intentId)).expiresAt.toISOString()).toBe(han.toISOString());
      const truoc = await chup();
      expect(await huy(p.intentId, { now: han })).toEqual({ ok: false, error: ghep("QUA_HAN_CHO_DONG") });
      expect(await chup(), "từ chối thì không ghi gì").toBe(truoc);
      expect((await huy(p.intentId, { now: sau(han, -1) })).ok, "đối chứng dương: lùi 1 ms vẫn còn hạn").toBe(true);
    });

    it("[HN4-DB-03d] vừa quá hạn vừa lỗi kết nối ⇒ nghe 'lỗi kết nối' (rủi ro tiền nói trước 'không còn gì để huỷ')", async () => {
      const { p } = await dung();
      await xuLy(p.intentId, { kind: "PROVIDER_ERROR", reasonCode: "TIMEOUT" });
      const truoc = await chup();
      expect(await huy(p.intentId, { now: QUA_HAN })).toEqual({ ok: false, error: ghep("LOI_KET_NOI") });
      expect(await chup()).toBe(truoc);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-04] ĐỌC LẠI dưới khoá — máy chủ không tin những gì màn đã nạp", () => {
    it("[HN4-DB-04a] màn nói 'huỷ được' (view), rồi tiền vào + phiếu thành DA_THU, rồi mới bấm ⇒ từ chối `DA_THU`, 0 dòng đổi", async () => {
      const { g, p } = await dung();
      const v = await docPhieuPosView(p.intentId, CON_HAN);
      expect(v?.huyPhieuThe.huyDuoc, "lúc dựng màn: huỷ được").toBe(true);
      await tienVaoMa(g.ma);
      await kiem(p.intentId);
      expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
      const truoc = await chup();
      expect(await huy(p.intentId)).toEqual({ ok: false, error: ghep("DA_THU") });
      expect(await chup()).toBe(truoc);
    });

    it("[HN4-DB-04b] XEN KẼ xác định: kẻ khác GIỮ khoá đơn và đặt phiếu gộp PAID; lượt huỷ chờ ở khoá, thức dậy ⇒ thấy PAID ⇒ `PHIEU_GOP_DA_DONG`, phiếu thẻ KHÔNG bị đổi", async () => {
      const { g, p } = await dung();
      const giu = await giuKhoaDon(DON, async (tx) => {
        await tx.paymentBill.update({ where: { id: g.billId }, data: { status: "PAID" } });
      });
      const dangHuy = huy(p.intentId);
      const biChan = await choCoNguoiChoKhoa(dangHuy);
      await giu.nha(); // nhả TRƯỚC khi khẳng định: khẳng định hỏng cũng không để lại phiên giữ khoá
      const kq = await dangHuy;
      expect(biChan, "lượt huỷ phải CHỜ khoá đơn của kẻ giữ — không chờ thì nó không bao giờ 'đọc lại dưới khoá'").toBe(true);
      expect(kq).toEqual({ ok: false, error: ghep("PHIEU_GOP_DA_DONG") });
      expect((await phieuPos(p.intentId)).status, "phiếu thẻ nguyên vẹn").toBe("CHO_QUET");
      expect(await soVetHuy(), "không vết huỷ").toBe(0);
    });

    it("[HN4-DB-04c] XEN KẼ xác định: kẻ khác đặt PHIẾU THẺ thành DA_THU dưới khoá; lượt huỷ thức dậy ⇒ nghe `DA_THU` (không phải 'vừa đổi trạng thái'), không đè DA_THU", async () => {
      const { p } = await dung();
      const giu = await giuKhoaDon(DON, async (tx) => {
        await tx.posPaymentIntent.update({ where: { id: p.intentId }, data: { status: "DA_THU" } });
      });
      const dangHuy = huy(p.intentId);
      const biChan = await choCoNguoiChoKhoa(dangHuy);
      await giu.nha();
      const kq = await dangHuy;
      expect(biChan, "lượt huỷ phải CHỜ khoá đơn của kẻ giữ").toBe(true);
      expect(kq).toEqual({ ok: false, error: ghep("DA_THU") });
      expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
      expect(await soVetHuy()).toBe(0);
    });

    it("[HN4-DB-04d] ĐỐI CHỨNG của bộ gá: kẻ giữ khoá KHÔNG đổi gì liên quan ⇒ lượt huỷ chờ rồi huỷ ĐƯỢC (bộ gá không tự gây từ chối)", async () => {
      const { p } = await dung();
      const giu = await giuKhoaDon(DON, async (tx) => {
        await tx.auditLog.count({ where: { entityId: DON } });
      });
      const dangHuy = huy(p.intentId);
      const biChan = await choCoNguoiChoKhoa(dangHuy);
      await giu.nha();
      const kq = await dangHuy;
      expect(biChan, "bộ gá thật sự chặn lượt huỷ ở khoá đơn (nếu không, 04b/04c xanh vì lý do sai)").toBe(true);
      expect(kq.ok).toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
    });

    it("[HN4-DB-04e] tiền LỆCH số đã vào hàng chờ (UNMATCHED) ⇒ `CO_GIAO_DICH_CHO_TAY`; đã khớp đúng số ⇒ `PHIEU_GOP_DA_DONG` — hai cổng khác nhau, cùng 0 dòng đổi", async () => {
      const { g, p } = await dung();
      const m = maGd();
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: MAY2 })]);
      const truoc = await chup();
      expect(await huy(p.intentId)).toEqual({ ok: false, error: ghep("CO_GIAO_DICH_CHO_TAY") });
      expect(await chup()).toBe(truoc);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-05..07] SAU huỷ: mã còn nguyên, 'Thẻ POS' mở lại, 'Huỷ phiếu' qua cổng, QR dùng được", () => {
    it("[HN4-DB-05] 'Thẻ POS' sau huỷ ⇒ phiếu thẻ MỚI dùng lại ĐÚNG mã, MỘT PaymentBill; phiếu cũ vẫn HUY. Đối chứng: KHÔNG huỷ thì bấm lại trả CHÍNH phiếu cũ", async () => {
      const { g, p } = await dung();
      const lai = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: CON_HAN });
      expect(lai.ok && lai.taoMoi, "đối chứng: chưa huỷ ⇒ trả lại chính phiếu, không tạo mới").toBe(false);
      expect(lai.ok && lai.phieu.intentId).toBe(p.intentId);

      expect((await huy(p.intentId)).ok).toBe(true);
      const moi = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: CON_HAN });
      expect(moi.ok).toBe(true);
      if (!moi.ok) return;
      expect(moi.taoMoi).toBe(true);
      expect(moi.phieu.code5, "cùng mã").toBe(g.ma);
      expect(moi.phieu.intentId).not.toBe(p.intentId);
      expect(await db.paymentBill.count({ where: { orderId: DON } }), "không phát mã mới").toBe(1);
      const ds = await db.posPaymentIntent.findMany({ where: { paymentBill: { orderId: DON } }, orderBy: { createdAt: "asc" } });
      expect(ds.map((x) => x.status)).toEqual(["HUY", "CHO_QUET"]);
      expect(ds.every((x) => x.code5 === g.ma && x.paymentBillId === g.billId)).toBe(true);
    });

    it("[HN4-DB-06] 'Huỷ phiếu' (gộp): TRƯỚC huỷ phiếu thẻ bị chặn đúng câu chủ dự án; SAU huỷ phiếu thẻ qua cổng ⇒ VOID", async () => {
      const { g, p } = await dung();
      const truoc = await chup();
      expect(await huyPhieuGop({ orderId: DON, billId: g.billId, lyDo: "", actor: ACTOR, now: CON_HAN })).toEqual({
        ok: false,
        error: LOI_HUY_KHI_CHO_QUET_THE,
      });
      expect(await chup(), "bị chặn thì không ghi gì").toBe(truoc);

      expect((await huy(p.intentId)).ok).toBe(true);
      const r = await huyPhieuGop({ orderId: DON, billId: g.billId, lyDo: "", actor: ACTOR, now: CON_HAN });
      expect(r.ok, "phiếu HUY không còn là 'thẻ đang mở'").toBe(true);
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
    });

    it("[HN4-DB-06b] 'thẻ đang mở' của phiếu gộp: DANG_CHO trước huỷ ⇒ null sau huỷ (cùng hàm máy chủ và trang đơn dùng)", async () => {
      const { p } = await dung();
      expect(await docTheDangMoCuaPhieuGop(db, { orderId: DON, now: CON_HAN })).toBe("DANG_CHO");
      await huy(p.intentId);
      expect(await docTheDangMoCuaPhieuGop(db, { orderId: DON, now: CON_HAN })).toBeNull();
    });

    it("[HN4-DB-07] QR sau huỷ: 'Xuất QR' dùng lại ĐÚNG mã (không phát mới)", async () => {
      const { g, p } = await dung();
      expect((await huy(p.intentId)).ok).toBe(true);
      const q = await phatHoacDungLaiPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A, DOT_B], actor: ACTOR, now: CON_HAN });
      expect(q.ok).toBe(true);
      if (!q.ok) return;
      expect(q.dungLai).toBe(true);
      expect(q.ma).toBe(g.ma);
      expect(await db.paymentBill.count({ where: { orderId: DON } })).toBe(1);
    });

    it("[HN4-DB-07b] ĐỢT KHÁC: trước huỷ phiếu thẻ ⇒ 'đang chờ quẹt thẻ… chưa huỷ được' chỉ tới nút huỷ phiếu thẻ; SAU huỷ ⇒ lối thoát thật là 'đóng hoặc huỷ mã đó'", async () => {
      await phatPhieu([DOT_A]);
      const p = await moPhieu({ dot: DOT_A });
      const truoc = await phatHoacDungLaiPhieuGop({ orderId: DON, paymentRequestIds: [DOT_B], actor: ACTOR, now: CON_HAN });
      expect(truoc.ok).toBe(false);
      if (truoc.ok) return;
      expect(truoc.error).toContain("đang chờ quẹt thẻ");
      expect(truoc.error).toContain("chưa huỷ được");
      expect(truoc.error, "nói đường huỷ phiếu thẻ — nút đã CÓ").toMatch(/huỷ phiếu thẻ/);
      expect(truoc.error, "không còn bảo 'chỉ còn cách chờ hết hạn'").not.toContain("chờ mã đó hết hạn rồi xuất cho đợt khác");

      expect((await huy(p.intentId)).ok).toBe(true);
      const sauHuy = await phatHoacDungLaiPhieuGop({ orderId: DON, paymentRequestIds: [DOT_B], actor: ACTOR, now: CON_HAN });
      expect(sauHuy.ok).toBe(false);
      if (sauHuy.ok) return;
      expect(sauHuy.error, "hết thẻ đang mở ⇒ câu cũ nói đúng lối thoát có thật").toContain("đóng hoặc huỷ mã đó rồi xuất lại");
      expect(sauHuy.error).not.toContain("đang chờ quẹt thẻ");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-08] giao dịch về MUỘN sau khi huỷ phiếu thẻ", () => {
    it("[HN4-DB-08a] phiếu gộp CÒN MỞ + đúng số ⇒ khớp vào ĐÚNG phiếu gộp (một bộ tiền); phiếu HUY KHÔNG sống lại; poller · quét sạch · đồng bộ sau nhập · agent KHÔNG kiểm nó", async () => {
      const { g, p } = await dung();
      expect((await huy(p.intentId)).ok).toBe(true);

      const m = await tienVaoMa(g.ma);
      await khoanTienMotLan(m, TONG, 2, "[a]");
      expect((await phieuGopDb(g.billId)).status, "tiền vào đúng phiếu gộp").toBe("PAID");
      const x = await phieuPos(p.intentId);
      expect(x.status, "phiếu thẻ HUY không bị kéo lại").toBe("HUY");
      expect(x.bankTransactionId).toBeNull();

      const fake = new FakePosProvider();
      const luot = sau(KIEM, 5 * PHUT);
      await chayPollerPos({ dongHo: () => luot, provider: fake });
      const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await quetSachPhieuPos({ dongHo: () => luot, provider: fake });
      canh.mockRestore();
      await dongBoPhieuPosSauNhap({ now: luot, nguoiKiemId: KT });
      const ag = await dongBoPhieuPosSauAgent({ centerId: CS1, maPhieu: [g.ma], btIdCoTinHieuHuy: [], dongHo: () => luot });
      expect(ag.daKiem, "agent không kiểm phiếu HUY").toBe(0);
      expect(fake.daHoi.filter((d) => d.intentId === p.intentId), "poller / quét sạch không hỏi provider về phiếu HUY").toHaveLength(0);
      expect(await db.posCheckLog.count({ where: { intentId: p.intentId } }), "không dòng nhật ký kiểm nào").toBe(0);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      await khoanTienMotLan(m, TONG, 2, "[a sau các lượt máy]");
    });

    it("[HN4-DB-08b] phiếu gộp ĐÃ HUỶ + giao dịch về ⇒ UNMATCHED hàng chờ: không mất tiền, KHÔNG ghi đôi (nhập lại file vẫn một dòng)", async () => {
      const { g, p } = await dung();
      expect((await huy(p.intentId)).ok).toBe(true);
      expect((await huyPhieuGop({ orderId: DON, billId: g.billId, lyDo: "", actor: ACTOR, now: CON_HAN })).ok).toBe(true);

      const m = maGd();
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })]);
      const bt = await db.bankTransaction.findMany({ where: { providerTxnId: m } });
      expect(bt, "tiền ở hàng chờ — không mất").toHaveLength(1);
      expect(bt[0]!.status).toBe("UNMATCHED");
      expect(await db.payment.count({ where: { orderId: DON } }), "chưa vào sổ").toBe(0);
      expect(await db.paymentAllocation.count({ where: { bankTransactionId: bt[0]!.id } })).toBe(0);
      expect(await db.posCardTransaction.count({ where: { maGiaoDich: m } })).toBe(1);

      // Nhập LẠI đúng dòng đó: không đẻ thêm bản ghi tiền.
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })]);
      expect(await db.bankTransaction.count({ where: { providerTxnId: m } }), "không ghi đôi").toBe(1);
      expect(await db.posCardTransaction.count({ where: { maGiaoDich: m } })).toBe(1);
      expect(await db.payment.count({ where: { orderId: DON } })).toBe(0);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
    });

    it("[HN4-DB-08c] quẹt TRƯỚC phiếu mới > 5′ (rồi huỷ, mở lại): file về ⇒ tiền VÀO MÃ dù phiếu mới nói 'chưa thấy' — và phiếu mới KHÔNG huỷ được (`PHIEU_GOP_DA_DONG`)", async () => {
      const { g, p } = await dung(); // phiếu 1 lúc NOW
      // Khách quẹt lúc NOW+31′35″ nhưng file CHƯA nhập. Sale huỷ phiếu 1 lúc NOW+40′, mở "Thẻ POS" lại lúc NOW+60′ (cửa sổ của
      // provider: [createdAt − 5′, now] = [NOW+55′, …] ⇒ lần quẹt NOW+31′ nằm NGOÀI cửa sổ của phiếu mới).
      expect((await huy(p.intentId, { now: KIEM })).ok).toBe(true);
      const p2 = await moPhieu({ now: sau(NOW, 60 * PHUT) });
      const m = await tienVaoMa(g.ma); // file về: khớp theo MÃ vào phiếu gộp (còn mở, đúng số)
      await khoanTienMotLan(m, TONG, 2, "[c]");
      await kiem(p2.intentId, new TcbFileImportProvider(), sau(NOW, 65 * PHUT));
      const x = await phieuPos(p2.intentId);
      expect(x.status, "phiếu mới không thấy lần quẹt cũ ⇒ vẫn mở (không DA_THU)").toBe("CHO_QUET");
      // Chính vì thế "chưa thấy" KHÔNG chứng minh khách chưa quẹt — và cổng phiếu gộp là tấm chắn cuối:
      const truoc = await chup();
      expect(await huy(p2.intentId, { now: sau(NOW, 66 * PHUT) })).toEqual({ ok: false, error: ghep("PHIEU_GOP_DA_DONG") });
      expect(await chup()).toBe(truoc);
      await khoanTienMotLan(m, TONG, 2, "[c sau]");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-09] ĐUA — đúng MỘT kết cục, không ghi đôi, không deadlock", () => {
    const VONG = 6;

    it("[HN4-DB-09a] huỷ ‖ huỷ ⇒ đúng một bên ok, bên kia nhận `DA_HUY`; một HUY, một dòng vết", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        if (vong > 0) await dungFixture();
        const { p } = await dung();
        const [x, y] = await Promise.all([huy(p.intentId, { lyDo: "MO_NHAM" }), huy(p.intentId, { lyDo: "KHACH_DOI_CACH_TRA" })]);
        expect([x.ok, y.ok].filter(Boolean), `vòng ${vong}: đúng một ok`).toHaveLength(1);
        const loi = [x, y].find((r) => !r.ok);
        expect(loi, `vòng ${vong}`).toEqual({ ok: false, error: ghep("DA_HUY") });
        expect((await phieuPos(p.intentId)).status, `vòng ${vong}`).toBe("HUY");
        expect(await soVetHuy(), `vòng ${vong}: một vết`).toBe(1);
      }
    }, 120_000);

    it("[HN4-DB-09b] huỷ ‖ Kiểm tra (pha tiền PAID đúng số) ⇒ mọi thứ tự kết thúc: tiền ghi ĐÚNG MỘT LẦN, phiếu thẻ DA_THU, vết huỷ ≤ 1 và khớp kết quả", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        if (vong > 0) await dungFixture();
        const { g, p } = await dung();
        const m = maGd();
        const fake = new FakePosProvider();
        fake.datKetQua(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma }));
        const [kq] = await Promise.all([huy(p.intentId), kiem(p.intentId, fake)]);
        await khoanTienMotLan(m, TONG, 2, `vòng ${vong}:`);
        const x = await phieuPos(p.intentId);
        expect(x.status, `vòng ${vong}: sự thật tiền thắng`).toBe("DA_THU");
        expect(x.bankTransactionId).not.toBeNull();
        expect((await phieuGopDb(g.billId)).status).toBe("PAID");
        if (kq.ok) {
          expect(await soVetHuy(), `vòng ${vong}: huỷ thành công ⇒ MỘT vết`).toBe(1);
        } else {
          expect([ghep("DA_THU"), ghep("PHIEU_GOP_DA_DONG")], `vòng ${vong}: từ chối vì tiền đã vào`).toContain(kq.error);
          expect(await soVetHuy(), `vòng ${vong}: từ chối ⇒ không vết`).toBe(0);
        }
      }
    }, 120_000);

    it("[HN4-DB-09c] huỷ ‖ poller (NOT_FOUND) ⇒ kết cục HUY, một vết; poller không hỏi provider về phiếu sau khi nó HUY", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        if (vong > 0) await dungFixture();
        const { p } = await dung();
        const fake = new FakePosProvider();
        const [kq] = await Promise.all([huy(p.intentId), chayPollerPos({ dongHo: () => KIEM, provider: fake })]);
        expect(kq.ok, `vòng ${vong}: ${kq.ok ? "" : kq.error}`).toBe(true);
        expect((await phieuPos(p.intentId)).status, `vòng ${vong}`).toBe("HUY");
        expect(await soVetHuy(), `vòng ${vong}`).toBe(1);
        expect(fake.daHoi.filter((d) => d.intentId === p.intentId).length, `vòng ${vong}: poller hỏi tối đa MỘT lần (trước huỷ)`).toBeLessThanOrEqual(1);
        // Lượt poller SAU huỷ: không hỏi nữa. ⚠️ Lượt này PHẢI ĐẾN NHỊP: phiếu ≥ 30′ tuổi chỉ được kiểm 10′ một lần (`NHIP_GIA_MS`)
        // và lượt đầu đã đặt `lastCheckAt = KIEM` — chạy lại sau 5′ thì một phiếu CÒN MỞ cũng KHÔNG bị hỏi, khẳng định "không hỏi"
        // xanh vô nghĩa. Cấy `TRANG_THAI_MO` thêm "HUY" ra 0 ca đỏ ở chỗ này (luật 14, 09/10/2026). 11′ ⇒ quá nhịp ⇒ phiếu mở chắc chắn bị hỏi.
        const f2 = new FakePosProvider();
        await chayPollerPos({ dongHo: () => sau(KIEM, 11 * PHUT), provider: f2 });
        expect(f2.daHoi.filter((d) => d.intentId === p.intentId), `vòng ${vong}: sau huỷ`).toHaveLength(0);
      }
    }, 120_000);

    it("[HN4-DB-09d] huỷ ‖ nhập file (đúng số) ⇒ tiền vào MỘT lần; huỷ ok ⇒ phiếu HUY + một vết, huỷ bị từ chối ⇒ `PHIEU_GOP_DA_DONG` + phiếu nguyên vẹn + không vết", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        if (vong > 0) await dungFixture();
        const { g, p } = await dung();
        const m = maGd();
        const [kq] = await Promise.all([huy(p.intentId), nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })])]);
        await khoanTienMotLan(m, TONG, 2, `vòng ${vong}:`);
        expect((await phieuGopDb(g.billId)).status, `vòng ${vong}`).toBe("PAID");
        const x = await phieuPos(p.intentId);
        if (kq.ok) {
          expect(x.status, `vòng ${vong}: huỷ thắng`).toBe("HUY");
          expect(await soVetHuy(), `vòng ${vong}`).toBe(1);
        } else {
          expect(kq.error, `vòng ${vong}: file thắng`).toBe(ghep("PHIEU_GOP_DA_DONG"));
          expect(x.status, `vòng ${vong}: phiếu nguyên vẹn`).toBe("CHO_QUET");
          expect(await soVetHuy(), `vòng ${vong}`).toBe(0);
        }
      }
    }, 120_000);

    it("[HN4-DB-09e] huỷ ‖ đồng bộ sau lô của máy (agent) ⇒ kết cục HUY, một vết, không lỗi", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        if (vong > 0) await dungFixture();
        const { g, p } = await dung();
        const [kq, ag] = await Promise.all([
          huy(p.intentId),
          dongBoPhieuPosSauAgent({ centerId: CS1, maPhieu: [g.ma], btIdCoTinHieuHuy: [], dongHo: () => KIEM }),
        ]);
        expect(kq.ok, `vòng ${vong}: ${kq.ok ? "" : kq.error}`).toBe(true);
        expect(ag.loi, `vòng ${vong}: agent không lỗi`).toBe(0);
        expect((await phieuPos(p.intentId)).status, `vòng ${vong}`).toBe("HUY");
        expect(await soVetHuy(), `vòng ${vong}`).toBe(1);
      }
    }, 120_000);

    it("[HN4-DB-09f] huỷ ‖ 'Thẻ POS' (bấm lại) ⇒ không deadlock, không P2002; luôn còn ĐÚNG MỘT phiếu mở và MỘT phiếu gộp", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        if (vong > 0) await dungFixture();
        const { g, p } = await dung();
        const [kq, the] = await Promise.all([
          huy(p.intentId),
          moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: CON_HAN }),
        ]);
        expect(the.ok, `vòng ${vong}: ${the.ok ? "" : the.error}`).toBe(true);
        expect(kq.ok, `vòng ${vong}: ${kq.ok ? "" : kq.error}`).toBe(true);
        const mo = await db.posPaymentIntent.count({ where: { paymentBillId: g.billId, status: { in: ["CHO_QUET", "THAT_BAI"] } } });
        expect(mo, `vòng ${vong}: đúng một phiếu mở`).toBeLessThanOrEqual(1);
        expect(await db.paymentBill.count({ where: { orderId: DON } })).toBe(1);
        expect(await soVetHuy()).toBe(1);
      }
    }, 120_000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-14] Kiểm tra từ TAB CŨ trên phiếu đã HUY — sự thật tiền thắng", () => {
    it("[HN4-DB-14a] không có tiền ⇒ vẫn HUY (kết quả yếu không đánh thức phiếu HUY); không thêm vết đổi trạng thái", async () => {
      const { p } = await dung();
      expect((await huy(p.intentId)).ok).toBe(true);
      await kiem(p.intentId, new FakePosProvider());
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      // Vết của phiếu: chỉ MỞ rồi HUỶ — lượt Kiểm tra không đổi trạng thái nên không đẻ vết `POS_PHIEU_<status>` nào.
      const acts = (await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: { startsWith: "POS_PHIEU_" } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
      expect(acts).toEqual(["POS_PHIEU_TAO", "POS_PHIEU_HUY"]);
    });

    it("[HN4-DB-14b] có tiền ĐÚNG SỐ đã vào mã (sau huỷ) ⇒ Kiểm tra từ tab cũ ⇒ DA_THU; vết giữ CẢ HAI bước (HUY rồi DA_THU)", async () => {
      const { g, p } = await dung();
      expect((await huy(p.intentId)).ok).toBe(true);
      const m = await tienVaoMa(g.ma);
      await kiem(p.intentId);
      expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
      await khoanTienMotLan(m, TONG, 2);
      const acts = (await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: { startsWith: "POS_PHIEU_" } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
      expect(acts).toEqual(expect.arrayContaining(["POS_PHIEU_HUY", "POS_PHIEU_DA_THU"]));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-15] câu NÓI THẬT của Việc 1 — nay trỏ tới nút CÓ THẬT (H17 mục 2–4)", () => {
    it("[HN4-DB-15a] `taoPhieuGop` trần bị chỉ mục 'một đơn một phiếu mở' từ chối: câu nói đường huỷ phiếu thẻ, KHÔNG 'phải đợi thẻ hết hạn'", async () => {
      await dung();
      const them = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT_A], actor: ACTOR });
      expect(them).toMatchObject({ ok: false, daCoPhieuMo: true });
      const e = !them.ok ? them.error : "";
      expect(e).toContain("đã có một phiếu gộp đang mở"); // mảnh đã bị `[HN2-DB-05]` ghim
      expect(e).toContain("chưa huỷ được");
      expect(e, "chỉ tới nút huỷ phiếu thẻ (nút đã tồn tại)").toMatch(/huỷ phiếu thẻ/);
      expect(e, "câu cũ: chỉ còn cách ĐỢI — không còn đúng").not.toContain("phải đợi thẻ hết hạn");
    });

    it("[HN4-DB-15b] 'Đóng phiếu' khi chưa nhận đồng nào: giữ 'chưa có gì để đóng' + 'chờ quẹt thẻ', thêm đường huỷ phiếu thẻ, bỏ 'phải đợi thẻ hết hạn'", async () => {
      const { g } = await dung();
      const r = await dongPhieuGop({ orderId: DON, billId: g.billId, lyDo: "thử", actor: ACTOR });
      expect(r.ok).toBe(false);
      const e = !r.ok ? r.error : "";
      expect(e).toContain("chưa có gì để đóng"); // mảnh đã bị `[HN2-DB-07]` ghim
      expect(e).toContain("chờ quẹt thẻ"); // mảnh đã bị `[HN2-DB-07]` ghim
      expect(e).toContain("chưa huỷ được");
      expect(e).toMatch(/huỷ phiếu thẻ/);
      expect(e).not.toContain("phải đợi thẻ hết hạn");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION — quyền · phạm vi cơ sở · IDOR · zod · cờ. Gọi THẲNG `huyPhieuTheAction` (cổng thật ở máy chủ, không ở nút).
  // `Date` bị giả (chỉ `Date`) vì action tự đọc `new Date()` mà fixture ở quá khứ.
  // ═══════════════════════════════════════════════════════════════════════════
  // VIỆC 4 — rà đối kháng 09/10/2026: dòng thẻ mang mã ĐÃ VỀ nhưng không thành giao dịch (BO_QUA / CAN_XU_LY / IGNORED).
  // `maCoGiaoDichChoTay` chỉ đếm UNMATCHED; lượt kiểm cuối (đã lưu) chỉ đúng lúc kiểm — nên cổng phải đọc cả DÒNG.
  describe("[HN4-DB-16] dòng thẻ mang mã chưa thành giao dịch — cổng huỷ đọc dữ liệu ĐÃ CÓ, không chỉ kết quả đã lưu", () => {
    /** Phiếu thẻ đã được Kiểm tra (lưu "Chưa thấy…" trần) — huỷ ĐƯỢC ở thời điểm này (đối chứng của mọi ca dưới). */
    async function daKiemChuaThay() {
      const { g, p } = await dung();
      await kiem(p.intentId);
      expect((await phieuPos(p.intentId)).lastResultKind).toBe("NOT_FOUND");
      const v = (await docPhieuPosView(p.intentId, CON_HAN))!;
      expect(v.huyPhieuThe, "trước khi dòng về: 'chưa thấy' trần ⇒ cho huỷ").toEqual({ huyDuoc: true, canXacNhanManh: true });
      return { g, p };
    }

    it("[HN4-DB-16a] dòng 'Đang xử lý' VỀ sau lượt kiểm ⇒ MÀN và MÁY CHỦ cùng từ chối `DONG_THE_CHUA_NGA_NGU`; 0 dòng đổi", async () => {
      const { g, p } = await daKiemChuaThay();
      await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, trangThai: "Đang xử lý" })]);
      // Tiền đề: dòng ĐÃ nằm trong DB nhưng không giao dịch nào sinh ra (đúng lớp mù) và kết quả lưu vẫn là "chưa thấy".
      expect(await db.posCardTransaction.count({ where: { maGiaoDich: { startsWith: PFX }, bankTransactionId: null } })).toBe(1);
      expect((await phieuPos(p.intentId)).lastResultMessage).toMatch(/^Chưa thấy giao dịch/);
      const v = (await docPhieuPosView(p.intentId, CON_HAN))!;
      expect(v.huyPhieuThe).toEqual({ huyDuoc: false, ma: "DONG_THE_CHUA_NGA_NGU", ...CAU_TU_CHOI_HUY_PHIEU_THE.DONG_THE_CHUA_NGA_NGU });
      const truoc = await chup();
      expect(await huy(p.intentId)).toEqual({ ok: false, error: ghep("DONG_THE_CHUA_NGA_NGU") });
      expect(await chup()).toBe(truoc);
    });

    it("[HN4-DB-16b] ĐỐI CHỨNG DƯƠNG: dòng đã ngã ngũ KHÔNG chặn — 'Thất bại' · hủy toàn phần · mã khác · quẹt trước cửa sổ ⇒ vẫn huỷ được", async () => {
      const CA_DOI_CHUNG: { ten: string; dong: (ma: string) => DongPos }[] = [
        { ten: "Thất bại", dong: (ma) => dong({ maGiaoDich: maGd(), dienGiai: ma, trangThai: "Thất bại" }) },
        {
          ten: "Thành công mà cột Hoàn/Hủy nói toàn phần",
          dong: (ma) => dong({ maGiaoDich: maGd(), dienGiai: ma, trangThaiHoanHuy: "Hủy toàn phần" }),
        },
        { ten: "mang MÃ KHÁC", dong: () => dong({ maGiaoDich: maGd(), dienGiai: "ZZ9ZZ", trangThai: "Đang xử lý" }) },
        {
          ten: "quẹt TRƯỚC cửa sổ (sớm hơn mốc − 5′)",
          dong: (ma) => dong({ maGiaoDich: maGd(), dienGiai: ma, trangThai: "Đang xử lý", thoiGian: "2026-10-06T16:40:00+07:00" }),
        },
      ];
      for (const ca of CA_DOI_CHUNG) {
        await dungFixture();
        const { g, p } = await daKiemChuaThay();
        await nhapFile([ca.dong(g.ma)]);
        expect(await db.bankTransaction.count({ where: { providerTxnId: { startsWith: PFX }, status: "UNMATCHED" } }), `${ca.ten}: không vào hàng chờ tay`).toBe(0);
        expect((await huy(p.intentId)).ok, ca.ten).toBe(true);
        expect((await phieuPos(p.intentId)).status, ca.ten).toBe("HUY");
      }
    });

    // [HN4-DB-16c] (hoàn MỘT PHẦN — giao dịch IGNORED) ĐÃ GỠ có chủ đích: giao dịch IGNORED là quyết định của kế toán ("Bỏ qua"), ca
    // `[HN4-DB-03]` CO_GIAO_DICH_CHO_TAY đòi phiếu thẻ huỷ được sau đó — hai yêu cầu không chung sống được. Ranh giới ghi ở docs §6.14.

    it("[HN4-DB-16d] CỬA SỔ tính trên MỌI phiếu thẻ của phiếu gộp: dòng quẹt dưới phiếu CŨ (đã huỷ), phiếu MỚI mở sau > 5′ ⇒ vẫn chặn phiếu mới", async () => {
      const g = await phatPhieu();
      const p1 = await moPhieu({ now: NOW });
      expect((await huy(p1.intentId, { now: sau(NOW, 10 * PHUT) })).ok).toBe(true);
      const p2 = await moPhieu({ now: sau(NOW, 45 * PHUT) }); // mốc − 5′ của RIÊNG phiếu 2 = NOW + 40′ — dòng bên dưới nằm TRƯỚC nó
      expect(p2.intentId).not.toBe(p1.intentId);
      await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, trangThai: "Đang xử lý", thoiGian: "2026-10-06T17:03:00+07:00" })]);
      const truoc = await chup();
      expect(await huy(p2.intentId, { now: sau(NOW, 50 * PHUT) })).toEqual({ ok: false, error: ghep("DONG_THE_CHUA_NGA_NGU") });
      expect(await chup()).toBe(truoc);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VIỆC 4 — rà đối kháng 09/10/2026: huỷ rồi MỞ LẠI, quá 30′ mà chưa có kết quả. Phiếu mới bị ẩn khỏi màn sale nhưng phiếu HUY cũ
  // KHÔNG BAO GIỜ bị ẩn ⇒ màn từng cầm phiếu HUY cũ trong khi phiếu gộp còn thẻ ĐANG CHỜ.
  describe("[HN4-DB-17] huỷ rồi mở lại, quá 30′ — trang đơn không được cầm phiếu HUY cũ", () => {
    /** Dựng ĐÚNG như trang đơn (`orders/[id]/page.tsx`): phiếu thô + phiếu gộp đang mở ⇒ chọn một phiếu + dựng view. */
    async function trangDon(now: Date) {
      const [ds, phieuMo] = await Promise.all([docPhieuPosTho(DON), docPhieuGopDangMo(DON)]);
      return {
        chon: dungPhieuPosChoDon({ ds, phieuMo, now }),
        theDangMo: await docTheDangMoCuaPhieuGop(db, { orderId: DON, now }),
      };
    }

    it("[HN4-DB-17a] +20′ màn cầm phiếu MỚI; +40′ phiếu mới bị ẩn ⇒ màn KHÔNG cầm phiếu HUY cũ (null) dù máy chủ nói DANG_CHO; bấm lại ⇒ CHÍNH phiếu đang chờ, và hộp của nó CHO huỷ", async () => {
      await phatPhieu();
      const p1 = await moPhieu({ now: NOW });
      expect((await huy(p1.intentId, { now: sau(NOW, 2 * PHUT) })).ok).toBe(true);
      const p2 = await moPhieu({ now: sau(NOW, 5 * PHUT) });
      expect(p2.intentId, "phiếu MỚI, dùng lại mã").not.toBe(p1.intentId);
      expect(p2.code5).toBe(p1.code5);

      const a = await trangDon(sau(NOW, 20 * PHUT));
      expect(a.chon?.intentId, "phiếu mới còn trẻ ⇒ lên màn").toBe(p2.intentId);
      expect(a.theDangMo).toBe("DANG_CHO");

      const b = await trangDon(sau(NOW, 40 * PHUT));
      expect(b.theDangMo, "máy chủ: phiếu gộp còn thẻ ĐANG CHỜ").toBe("DANG_CHO");
      expect(b.chon, "màn KHÔNG được cầm phiếu HUY cũ thay cho phiếu đang chờ").toBeNull();

      // Đường UI đi tiếp khi màn không cầm phiếu nào: ô dòng gọi 'Thẻ POS' ⇒ trả lại CHÍNH phiếu đang chờ (không ghi gì).
      const lai = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: sau(NOW, 40 * PHUT) });
      if (!lai.ok) throw new Error(lai.error);
      expect(lai.taoMoi).toBe(false);
      expect(lai.phieu.intentId).toBe(p2.intentId);
      expect(lai.phieu.huyPhieuThe, "hộp của phiếu đang chờ CÓ nút huỷ").toEqual({ huyDuoc: true, canXacNhanManh: true });
    });

    it("[HN4-DB-17c] huỷ rồi khách quẹt LỆCH SỐ (giao dịch chờ kế toán) ⇒ hộp phiếu HUY nói CẢNH BÁO, không mời 'thu thẻ lại' — và máy chủ từ chối đúng việc đó", async () => {
      const { g, p } = await dung();
      expect((await huy(p.intentId)).ok).toBe(true);
      const m = maGd();
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, soTien: TONG - 1_000 })]);
      expect((await btThe(m))?.status, "tiền đề: lệch số ⇒ hàng chờ tay").toBe("UNMATCHED");
      const v = (await docPhieuPosView(p.intentId, CON_HAN))!;
      expect(v.hienThi).toBe("HUY");
      expect(v.choKeToan).toBe(true);
      expect(v.thongDiep).toBe(CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN);
      expect(v.mucDo).toBe("canh_bao");
      const thuLai = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: CON_HAN });
      expect(thuLai.ok, "máy chủ từ chối chính điều hộp từng mời làm").toBe(false);
      // ĐỐI CHỨNG DƯƠNG: huỷ xong mà KHÔNG có giao dịch chờ ⇒ câu cũ 'thu thẻ lại', và mở phiếu mới được.
      await dungFixture();
      const { p: p2 } = await dung();
      expect((await huy(p2.intentId)).ok).toBe(true);
      const v2 = (await docPhieuPosView(p2.intentId, CON_HAN))!;
      expect(v2.thongDiep).toBe(CAU_PHIEU_THE_DA_HUY);
      expect((await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: CON_HAN })).ok).toBe(true);
    });

    it("[HN4-DB-17b] ĐỐI CHỨNG: không mở lại ⇒ phiếu HUY là phiếu mới nhất và LÊN màn ở +40′ (hộp nói 'đã huỷ')", async () => {
      await phatPhieu();
      const p1 = await moPhieu({ now: NOW });
      expect((await huy(p1.intentId, { now: sau(NOW, 2 * PHUT) })).ok).toBe(true);
      const b = await trangDon(sau(NOW, 40 * PHUT));
      expect(b.chon?.intentId).toBe(p1.intentId);
      expect(b.chon?.hienThi).toBe("HUY");
      expect(b.theDangMo).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-A] huyPhieuTheAction", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(CON_HAN);
      h.auth.mockReset();
      h.checkPermission.mockReset();
      h.resolveActor.mockReset();
      vi.mocked(revalidatePath).mockClear();
      h.auth.mockResolvedValue({ user: { id: SALE, name: TEN_SALE } });
      h.checkPermission.mockResolvedValue(true);
      h.resolveActor.mockResolvedValue(actorCoSo(CS1));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const goi = (intentId: string, o: Partial<HuyPhieuTheInput> = {}) =>
      huyPhieuTheAction({
        orderId: DON,
        intentId,
        lyDo: "MO_NHAM",
        xacNhanKhachChuaQuet: true,
        ...o,
      } as HuyPhieuTheInput);

    it("[HN4-DB-10a] qua action: thành công ⇒ `{ ok, intentId, code5 }`, phiếu HUY, vết mang NGƯỜI BẤM (từ phiên), làm mới trang đơn đúng một lần", async () => {
      const { g, p } = await dung();
      const kq = await goi(p.intentId, { lyDo: "KHAC", ghiChu: "  khách đổi ý  " });
      expect(kq).toEqual({ ok: true, intentId: p.intentId, code5: g.ma });
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      const v = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect(v.actorId).toBe(SALE);
      expect(v.actorName).toBe(TEN_SALE);
      expect(v.newValues).toMatchObject({ lyDo: "KHAC", ghiChu: "khách đổi ý" });
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/orders/${DON}`);
    });

    it("[HN4-DB-10b] chưa đăng nhập ⇒ 'Chưa đăng nhập', 0 dòng đổi, không hỏi quyền", async () => {
      const { p } = await dung();
      const truoc = await chup();
      h.auth.mockResolvedValue(null);
      expect(await goi(p.intentId)).toEqual({ ok: false, error: "Chưa đăng nhập" });
      expect(h.checkPermission).not.toHaveBeenCalled();
      expect(await chup()).toBe(truoc);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    });

    it("[HN4-DB-10c] thiếu `payments:pos-check` ⇒ 'Không có quyền' (hỏi ĐÚNG quyền đó), 0 dòng đổi; đối chứng dương: có quyền ⇒ huỷ được", async () => {
      const { p } = await dung();
      const truoc = await chup();
      h.checkPermission.mockResolvedValue(false);
      expect(await goi(p.intentId)).toEqual({ ok: false, error: "Không có quyền" });
      expect(h.checkPermission).toHaveBeenCalledWith("payments:pos-check");
      expect(await chup()).toBe(truoc);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();

      h.checkPermission.mockResolvedValue(true);
      expect((await goi(p.intentId)).ok, "đối chứng dương").toBe(true);
    });

    it("[HN4-DB-10d] đơn ở CƠ SỞ KHÁC ⇒ 'Không tìm thấy đơn hàng' (không phân biệt 'không có' với 'không thuộc cơ sở bạn'), 0 dòng đổi; đối chứng dương: actor cơ sở của đơn ⇒ huỷ được", async () => {
      const { p } = await dung();
      const truoc = await chup();
      h.resolveActor.mockResolvedValue(actorCoSo(CS2));
      expect(await goi(p.intentId)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(await chup()).toBe(truoc);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();

      h.resolveActor.mockResolvedValue(actorCoSo(CS1));
      expect((await goi(p.intentId)).ok, "đối chứng dương").toBe(true);
    });

    it("[HN4-DB-10e] IDOR: phiếu thẻ của ĐƠN KHÁC (cùng cơ sở) gửi kèm orderId của mình ⇒ 'Không tìm thấy phiếu POS'; phiếu của đơn kia KHÔNG bị đụng; đối chứng dương: phiếu của chính đơn", async () => {
      const { p } = await dung();
      const kia = await dungDon2();
      const truoc = await chup();
      expect(await goi(kia.p.intentId)).toEqual({ ok: false, error: "Không tìm thấy phiếu POS" });
      expect(await chup(), "không đổi dòng nào ở CẢ HAI đơn").toBe(truoc);
      expect((await phieuPos(kia.p.intentId)).status).toBe("CHO_QUET");
      expect(await soVetHuy(DON2)).toBe(0);

      expect((await goi(p.intentId)).ok, "đối chứng dương").toBe(true);
      expect((await phieuPos(kia.p.intentId)).status, "phiếu đơn kia vẫn nguyên").toBe("CHO_QUET");
    });

    it("[HN4-DB-10f] phiếu thẻ không tồn tại ⇒ 'Không tìm thấy phiếu POS', 0 dòng đổi", async () => {
      await dung();
      const truoc = await chup();
      expect(await goi(`${T}khong-ton-tai`)).toEqual({ ok: false, error: "Không tìm thấy phiếu POS" });
      expect(await chup()).toBe(truoc);
    });

    it("[HN4-DB-10g] tick do MÁY CHỦ quyết, không do màn: gửi `xacNhanKhachChuaQuet: false` ⇒ `CAU_THIEU_XAC_NHAN_MANH`, 0 dòng đổi, không làm mới trang", async () => {
      const { p } = await dung();
      const truoc = await chup();
      expect(await goi(p.intentId, { xacNhanKhachChuaQuet: false })).toEqual({ ok: false, error: CAU_THIEU_XAC_NHAN_MANH });
      expect(await chup()).toBe(truoc);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    });

    it("[HN4-DB-11] zod qua action: lý do thiếu/lạ · 'Khác' thiếu ghi chú · ghi chú > 200 ⇒ câu của vấn đề đầu tiên, KHÔNG đụng phiên/DB; biên hợp lệ ⇒ qua", async () => {
      const { p } = await dung();
      const truoc = await chup();
      const kemLyDo = { orderId: DON, intentId: p.intentId, xacNhanKhachChuaQuet: true } as unknown as HuyPhieuTheInput;
      for (const [ten, input, cau] of [
        ["thiếu lý do", kemLyDo, "Chọn lý do huỷ phiếu thẻ"],
        ["lý do lạ", { ...kemLyDo, lyDo: "LY_DO_LA" } as unknown as HuyPhieuTheInput, "Chọn lý do huỷ phiếu thẻ"],
        ["'Khác' không ghi chú", { ...kemLyDo, lyDo: "KHAC" } as unknown as HuyPhieuTheInput, "Chọn “Khác” thì ghi chú lý do (ít nhất 3 ký tự)"],
        ["'Khác' ghi chú 2 ký tự", { ...kemLyDo, lyDo: "KHAC", ghiChu: "ab" } as unknown as HuyPhieuTheInput, "Chọn “Khác” thì ghi chú lý do (ít nhất 3 ký tự)"],
        ["ghi chú 201 ký tự", { ...kemLyDo, lyDo: "MO_NHAM", ghiChu: "x".repeat(201) } as unknown as HuyPhieuTheInput, "Ghi chú tối đa 200 ký tự"],
      ] as const) {
        expect(await huyPhieuTheAction(input), ten).toEqual({ ok: false, error: cau });
      }
      const thieuTick = { orderId: DON, intentId: p.intentId, lyDo: "MO_NHAM" } as unknown as HuyPhieuTheInput;
      const r = await huyPhieuTheAction(thieuTick);
      expect(r.ok, "thiếu `xacNhanKhachChuaQuet` (bắt buộc, không mặc định) ⇒ từ chối").toBe(false);
      expect(h.auth, "zod đứng TRƯỚC cổng quyền: đầu vào rác không chạm phiên").not.toHaveBeenCalled();
      expect(await chup()).toBe(truoc);
      // Biên hợp lệ: 'Khác' + đúng 3 ký tự; ghi chú đúng 200 ký tự.
      expect((await goi(p.intentId, { lyDo: "KHAC", ghiChu: "abc" })).ok, "đối chứng dương: biên 3 ký tự").toBe(true);
    });

    it("[HN4-DB-11b] ghi chú đúng 200 ký tự ⇒ qua (biên trên)", async () => {
      const { p } = await dung();
      expect((await goi(p.intentId, { lyDo: "MO_NHAM", ghiChu: "y".repeat(200) })).ok).toBe(true);
    });

    it("[HN4-DB-12a] T8: cờ `billing.flexV1Enabled` TẮT ⇒ vẫn huỷ được (huỷ GIẢM rủi ro; cờ tắt giữa chừng sale vẫn phải gỡ phiếu đã mở). ĐỐI CHỨNG: cùng cờ tắt thì 'Thẻ POS' (tạo) bị từ chối", async () => {
      const { p } = await dung();
      expect(await laThuTienLinhHoatBat(null), "tiền đề: cờ TẮT").toBe(false);
      const tao = await taoPhieuPosAction({ orderId: DON, paymentRequestId: DOT_A });
      expect(tao, "đối chứng: đường TẠO hỏi cờ").toEqual({ ok: false, error: "Tính năng thu học phí linh hoạt chưa bật cho cơ sở này" });
      expect((await goi(p.intentId)).ok, "đường HUỶ không hỏi cờ").toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
    });

    it("[HN4-DB-12b] đơn CHỜ DUYỆT (sau khi phiếu đã mở) ⇒ vẫn huỷ được; ĐỐI CHỨNG: `moPhieuPos` (tạo) bị T9 từ chối", async () => {
      const { p } = await dung();
      await db.order.update({ where: { id: DON }, data: { discountApprovalStatus: "PENDING_APPROVAL" } });
      const tao = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: CON_HAN });
      expect(tao.ok, "đối chứng: đường TẠO bị chặn vì đơn chờ duyệt").toBe(false);
      expect((await goi(p.intentId)).ok, "đường HUỶ không bị chặn").toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
    });
  });
});
