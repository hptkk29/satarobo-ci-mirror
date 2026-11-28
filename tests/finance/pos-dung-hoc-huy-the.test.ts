// tests/finance/pos-dung-hoc-huy-the.test.ts — VIỆC 6 · MỤC 3: DỪNG HỌC HUỶ KÈM PHIẾU THẺ ĐANG MỞ, CÙNG MỘT TRANSACTION. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-hai-nut.test.ts` / `pos-bac-lach-phieu-moi.test.ts`).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §9 (Việc 6 · mục 3). Chủ dự án chốt 10/10/2026: *"Dừng học: huỷ kèm phiếu thẻ đang mở trong cùng transaction với việc huỷ
// phiếu gộp; giao dịch về sau rơi vào hàng chờ gắn tay, không ghi đôi."* Trước đó (V1 của Việc 1, ca `[HN1-DB-09]` cũ) dừng học huỷ phiếu gộp mà để phiếu thẻ MỞ
// ở lại — poller vẫn hỏi nó tới 24 giờ, màn vẫn in "phiếu gộp đã đóng" cho một phiếu thẻ khách có thể đang quẹt.
//
// Mọi ca đi qua ĐÚNG cửa đời thật: phiếu mở bằng `moPhieuPos`, dừng học bằng `dungHocMotCon` (chính hàm `dungHocConAction` gọi), tiền bằng `nhapLoPos` /
// `xuLyKetQuaPos`, yêu cầu sai mã bằng `guiSaiMa` / `tuChoiSaiMa`. CHỈ BỐN chỗ chèn thẳng bảng, đều ghi rõ ở ca: (i) `[HN6-DH-04a]` ép `lastResultKind` (đường thật
// tới "pha tiền ném" cần provider hỏng), (ii) `[HN6-DH-05c]` yêu cầu SỐNG trên phiếu MỞ — đường thật không bao giờ tạo (gửi chuyển phiếu sang CAN_XU_LY trong cùng
// transaction), (iii) `[HN6-DH-01b]` phân bổ tiền vào đợt (tiền "vào từ đường khác" làm phiếu gộp phải ĐÓNG chứ không huỷ), (iv) `[HN6-DH-05f]` ép yêu cầu sang DANG_GHI
// (trạng thái "sập sau phép chuyển CHO_DUYET → DANG_GHI, trước khi ghi tiền" — `[HN3-DB-12]` đạt nó bằng hook ném trong `xuLyKetQuaPos`; ở đây chỉ cần TRẠNG THÁI).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm có `now` đều được truyền mốc tuyệt đối. Ca "KHÔNG làm gì" luôn kèm ẢNH CHỤP trước/sau (`chup`); ca "làm" kèm ĐỐI CHỨNG.
// "Cùng MỘT transaction" được đo bằng `xmin` của Postgres (mã transaction đã ghi dòng) chứ không bằng lời — xem `xidCuaLuotDungHoc`.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ⚠️ Cấy lỗi GIỮA CHỪNG: `dungHocTrongTx` gọi `doiTrangThaiPhieuTrongTx` SAU khi đã HUY phiếu thẻ. Hook này cho test ép nó ném / trả `{ ok:false }` — vắng hook thì
// gọi hàm thật. Chỉ có tác dụng với lời gọi từ `dung-hoc-con.ts` (hàm nội bộ `huyPhieuGop` gọi bản cục bộ, không đi qua binding đã mock).
type DoiTrangThaiFn = typeof import("@/lib/finance/phieu-gop").doiTrangThaiPhieuTrongTx;
const h = vi.hoisted(() => ({ cay: null as null | ((...a: Parameters<DoiTrangThaiFn>) => ReturnType<DoiTrangThaiFn>) }));
vi.mock("@/lib/finance/phieu-gop", async (goc) => {
  const that = await goc<typeof import("@/lib/finance/phieu-gop")>();
  return {
    ...that,
    doiTrangThaiPhieuTrongTx: (...a: Parameters<DoiTrangThaiFn>) => (h.cay ? h.cay(...a) : that.doiTrangThaiPhieuTrongTx(...a)),
  };
});

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ghiTienChoDon, ganTienTheoCon, khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { dungHocMotCon, dungHocTrongTx, xemTruocDungHoc } from "@/lib/finance/dung-hoc-con";
import { huyPhieuGop, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { docPhieuPosTho, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { docPhieuGopDangMo } from "@/lib/finance/phieu-gop";
import { TRANG_THAI_MO, dungPhieuPosChoDon } from "@/lib/payments/pos/phieu-pos-luat";
import { CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN } from "@/lib/payments/pos/huy-phieu-the-cau";
import { xuLyKetQuaPos } from "@/lib/payments/pos/xu-ly-ket-qua";
import { laCauChuaThay } from "@/lib/payments/pos/thong-diep-pos";
import { docGiaoDichDaBiBac, docHangChoSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { duyetSaiMa, guiSaiMa, tuChoiSaiMa } from "@/lib/payments/pos/sai-ma-ghi";
import { huyPhieuThe } from "@/lib/payments/pos/huy-phieu-the-db";

// Mỗi ca dựng cảnh ~10–20 lượt DB, ca đua lặp 8 lần — nới trần để một máy bận không làm đỏ ca và làm hỏng ca đứng sau (vitest không huỷ được promise đang chạy — luật 18).
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

if (!RUN_DB_TESTS) console.warn(`[HN6-DH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos6dh-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS6DH";

const KT = `${T}kt`; // Kế toán — người quyết yêu cầu + người nhập file
const SALE = `${T}sale`; // người lập đơn + mở phiếu + dừng học
const CS1 = `${T}cs1`;
const DON = `${T}don`; // hai bé A, B — mỗi bé một đợt
const DON2 = `${T}don2`; // đơn KHÁC cùng cơ sở — phiếu gộp + phiếu thẻ riêng, KHÔNG được bị chạm
const A = `${T}item-a`;
const B = `${T}item-b`;
const C = `${T}item-c`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const DOT_C = `${T}dot-c`;
const MAY1 = `${PFX}MAY01`; // máy DUY NHẤT của CS1 ⇒ `moPhieuPos` tự chọn
const SDT_PH = "0399812336";
const ACTOR = { id: SALE, name: "Sale fixture HN6" };
const A_KT = { id: KT, name: "Kế toán fixture HN6" };
/**
 * Người xem hàng chờ của kế toán: Quản trị tối cao thấy MỌI cơ sở — các ca ở đây KHÔNG đo phạm vi xem (đã có ở `pos-hai-nut-sai-ma.test.ts` `[HN3-DB-24]`), chỉ đo "yêu cầu CÒN được liệt kê".
 * `docHangChoSaiMa` NHẬN client đã scope nên đưa vào client scope THẬT (khuôn `pos-huy-sai-ma.test.ts`).
 */
const ACTOR_TAT_CA = {
  userId: KT,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Actor;
const SDB_TAT_CA = scopedDb(ACTOR_TAT_CA);
const NGUOI = [KT, SALE];
const DON_CUA_TEST = [DON, DON2];

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000

const GIAY = 1_000;
const PHUT = 60 * GIAY;
const GIO = 60 * PHUT;
const z = (iso: string) => new Date(iso);
const sau = (moc: Date, ms: number) => new Date(moc.getTime() + ms);

/** Lúc mở phiếu thẻ (hết hạn 24 giờ sau). QUÁ KHỨ so với đồng hồ thật (khuôn pos-hai-nut). */
const NOW = z("2026-10-06T10:00:00Z");
const KIEM = sau(NOW, 40 * PHUT);
/** Lúc bấm "Dừng học" — phiếu thẻ CÒN HẠN. */
const NOW_DUNG = sau(NOW, 50 * PHUT);
const QUA_HAN = sau(NOW, 25 * GIO);
/** Giờ quẹt (giờ VN) — SAU lúc mở phiếu, TRONG cửa sổ 5′ của phiếu. */
const GIO_QUET = "2026-10-06T17:31:35+07:00";

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
let soRrn = 0;
const rrn = () => String(112233446000 + ++soRrn);

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { providerTxnId: { startsWith: PFX } };
const LOC_BT_TAY = { id: { startsWith: T } };

async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: T } } });
  // Yêu cầu TRƯỚC phiếu thẻ + giao dịch (khoá ngoại RESTRICT); nhật ký kiểm trước phiếu thẻ.
  await db.posSaiMaYeuCau.deleteMany({ where: { intent: { paymentBill: { orderId: { in: DON_CUA_TEST } } } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: { orderId: { in: DON_CUA_TEST } } } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: { in: DON_CUA_TEST } } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.staffNotification.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { actorId: { in: NGUOI } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.posTxnSource.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: DON_CUA_TEST } } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT_TAY } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: DON_CUA_TEST } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.refundRequest.deleteMany({ where: { orderItem: { orderId: { in: DON_CUA_TEST } } } });
  await db.creditBalance.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.payment.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: { in: DON_CUA_TEST } } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.bankTransaction.deleteMany({ where: LOC_BT });
  await db.bankTransaction.deleteMany({ where: LOC_BT_TAY });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.order.deleteMany({ where: { id: { in: DON_CUA_TEST } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: NGUOI } }, { phone: { in: [SDT_PH, "84399812336"] } }] } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

/**
 * Hình dạng THẬT của đơn hai con: mỗi bé một dòng hàng chưa gắn ghi danh + một đợt PENDING. Không ghi danh/khoá ⇒ dừng học tính được mà không cần lớp
 * (`soBuoiDaDung = 0` không cần mẫu số — `dung-hoc.ts` mục 2) và không đụng chat. `daThu = 0` ⇒ `chenh = 0` ⇒ không cần phân dư.
 */
async function dungFixture() {
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", A_KT.name],
    [SALE, "SALES_CSM", ACTOR.name],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  await db.center.create({ data: { id: CS1, name: "CS1 fixture POS6DH", slug: CS1, address: "211 Nguyễn Hữu Thọ" } });
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });

  const taoDon = (id: string, code: string, tong: number) =>
    db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture HN6",
        customerPhone: SDT_PH,
        totalAmount: tong,
        centerId: CS1,
        createdById: SALE,
      },
    });
  const taoDong = async (orderId: string, itemId: string, dotId: string, ten: string, tien: number, thuTu: number) => {
    await db.orderItem.create({
      data: { id: itemId, orderId, type: "COURSE_ENROLLMENT", itemName: ten, quantity: 1, unitPrice: tien, totalPrice: tien },
    });
    await db.paymentRequest.create({
      data: { id: dotId, orderId, orderItemId: itemId, centerId: CS1, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: thuTu },
    });
  };
  await taoDon(DON, "ORD-269986-000701", TONG);
  await taoDong(DON, A, DOT_A, "Bé A HN6", DOT_TIEN_A, 1);
  await taoDong(DON, B, DOT_B, "Bé B HN6", DOT_TIEN_B, 2);
}

/** Đơn THỨ HAI cùng cơ sở, có phiếu gộp + phiếu thẻ riêng — dừng học đơn kia KHÔNG được chạm vào. */
async function dungDon2() {
  await db.order.create({
    data: {
      id: DON2,
      code: "ORD-269986-000702",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh 2 fixture HN6",
      customerPhone: "0399812337",
      totalAmount: DOT_TIEN_A,
      centerId: CS1,
      createdById: SALE,
    },
  });
  await db.orderItem.create({
    data: { id: C, orderId: DON2, type: "COURSE_ENROLLMENT", itemName: "Bé C HN6", quantity: 1, unitPrice: DOT_TIEN_A, totalPrice: DOT_TIEN_A },
  });
  await db.paymentRequest.create({
    data: { id: DOT_C, orderId: DON2, orderItemId: C, centerId: CS1, installmentNo: 1, amountDue: DOT_TIEN_A, status: "PENDING", sortOrder: 1 },
  });
  const g = await phatPhieu(DON2, [DOT_C]);
  const p = await moPhieu(DON2, DOT_C, NOW);
  return { g, p };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** Nút "Xuất QR": phát phiếu gộp cho các đợt. */
async function phatPhieu(orderId: string, ids: string[]) {
  const r = await taoPhieuGop({ orderId, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}

/** Nút "Thẻ POS". CS1 chỉ có MỘT máy ⇒ không cần chọn máy. */
async function moPhieu(orderId: string, dot: string, now: Date) {
  const r = await moPhieuPos({ orderId, paymentRequestId: dot, actor: ACTOR, now });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  return r.phieu;
}

/** Phiếu gộp cả hai đợt (mã M, TONG) + MỘT phiếu thẻ đang chờ quẹt. */
async function dungPhieuGopVaThe() {
  const g = await phatPhieu(DON, [DOT_A, DOT_B]);
  const p = await moPhieu(DON, DOT_A, NOW);
  expect(p.code5, "phiếu thẻ dùng ĐÚNG mã của phiếu gộp").toBe(g.ma);
  return { g, p };
}

/** Bấm "Dừng học" bé A — chính hàm `dungHocConAction` gọi. Số buổi đã dùng 0 ⇒ giá trị đã dùng 0, dư 0. */
const dungHoc = (them: Partial<Parameters<typeof dungHocMotCon>[0]> = {}) =>
  dungHocMotCon({
    orderId: DON,
    orderItemId: A,
    lyDo: "PH_CHU_DONG",
    buoiCuoiId: null,
    ghiChu: null,
    phanDu: [],
    actor: ACTOR,
    now: NOW_DUNG,
    ...them,
  });

const phieuPos = (id: string) => db.posPaymentIntent.findUniqueOrThrow({ where: { id } });
const phieuGopDb = (id: string) => db.paymentBill.findUniqueOrThrow({ where: { id } });
const dotDb = (id: string) => db.paymentRequest.findUniqueOrThrow({ where: { id } });
const dongDb = (id: string) => db.orderItem.findUniqueOrThrow({ where: { id } });
const soPayment = (orderId = DON) => db.payment.count({ where: { orderId } });
const soVetHuy = (orderId = DON) => db.auditLog.count({ where: { entityType: "Order", entityId: orderId, action: "POS_PHIEU_HUY" } });
const yeuCauCua = (intentId: string) => db.posSaiMaYeuCau.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } });

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TONG,
    thoiGian: GIO_QUET,
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: rrn(),
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

const btThe = (ma: string) =>
  db.bankTransaction.findUnique({
    where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: ma } },
    include: { allocations: true, posCardTransaction: true },
  });
const btId = async (ma: string) => (await btThe(ma))!.id;

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

/** Sale / người ở tab cũ bấm "Kiểm tra" ⇒ provider báo kết quả vào ĐÚNG đường `xuLyKetQuaPos`. */
const xuLy = (intentId: string, ketQua: PosCheckResult, now: Date = KIEM) =>
  xuLyKetQuaPos({ intentId, ketQua, triggeredBy: "SALE", now, nguonDuLieu: "FAKE" });

/** "Chưa thấy giao dịch" — kết quả NOT_FOUND vào ĐÚNG đường `xuLyKetQuaPos`. */
async function chuaThay(intentId: string, now: Date) {
  const kq = await xuLy(intentId, { kind: "NOT_FOUND" }, now);
  expect(laCauChuaThay(kq.thongDiep), `phải ra câu 'Chưa thấy': ${kq.thongDiep}`).toBe(true);
}

/**
 * Ảnh chụp MỌI thứ một lượt dừng học có thể đổi (của CÁC ĐƠN CỦA BỘ NÀY). `updatedAt` nằm trong hàng ⇒ một phép ghi vô hình cũng làm nó lệch; AuditLog, thông báo, sự kiện
 * đếm số dòng. Hai ảnh bằng nhau ⇒ lượt kia KHÔNG ghi gì.
 */
async function chup(orderIds: string[] = DON_CUA_TEST): Promise<string> {
  const co = { orderId: { in: orderIds } };
  const [bills, lines, dots, items, intents, pays, allocs, bts, poss, yc, orders, audit, thongBao, suKien, nhatKy, hoan, qr] = await Promise.all([
    db.paymentBill.findMany({ where: co, orderBy: { id: "asc" } }),
    db.paymentBillLine.findMany({ where: { bill: co }, orderBy: { id: "asc" } }),
    db.paymentRequest.findMany({ where: co, orderBy: { id: "asc" } }),
    db.orderItem.findMany({ where: co, orderBy: { id: "asc" } }),
    db.posPaymentIntent.findMany({ where: { paymentBill: co }, orderBy: { id: "asc" } }),
    db.payment.findMany({ where: co, orderBy: { id: "asc" } }),
    db.paymentAllocation.findMany({ where: { paymentRequest: co }, orderBy: { id: "asc" } }),
    db.bankTransaction.findMany({ where: LOC_BT, orderBy: { id: "asc" } }),
    db.posCardTransaction.findMany({ where: { maGiaoDich: { startsWith: PFX } }, orderBy: { id: "asc" } }),
    db.posSaiMaYeuCau.findMany({ where: { intent: { paymentBill: co } }, orderBy: { id: "asc" } }),
    db.order.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: { in: orderIds } } }),
    db.staffNotification.count({ where: { userId: { in: NGUOI } } }),
    db.domainEvent.count({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } }),
    db.posCheckLog.count({ where: { intent: { paymentBill: co } } }),
    db.refundRequest.count({ where: { orderItem: co } }),
    db.qrSession.count({ where: { paymentRequest: co } }),
  ]);
  return JSON.stringify({ bills, lines, dots, items, intents, pays, allocs, bts, poss, yc, orders, audit, thongBao, suKien, nhatKy, hoan, qr });
}

/**
 * Mã TRANSACTION đã ghi từng thứ mà một lượt dừng học chạm tới. `xmin` của một dòng = xid của transaction GHI CUỐI lên nó (dòng bị sửa trong cùng transaction nhiều lần vẫn
 * mang một xid). Ghi trong MỘT transaction ⇒ chỉ MỘT giá trị; HUY phiếu thẻ ở transaction riêng ⇒ ≥ 2. Đây là chứng cứ "cùng transaction" ở tầng DB, không phải lời hứa.
 */
async function xidCuaLuotDungHoc(intentId: string, billId: string): Promise<string[]> {
  const mot = async (q: Promise<{ x: string }[]>) => (await q).map((r) => r.x);
  const xids = [
    ...(await mot(db.$queryRaw<{ x: string }[]>`SELECT xmin::text AS x FROM "PosPaymentIntent" WHERE id = ${intentId}`)),
    ...(await mot(db.$queryRaw<{ x: string }[]>`SELECT xmin::text AS x FROM "PaymentBill" WHERE id = ${billId}`)),
    ...(await mot(db.$queryRaw<{ x: string }[]>`SELECT xmin::text AS x FROM "PaymentRequest" WHERE id = ${DOT_A}`)),
    ...(await mot(db.$queryRaw<{ x: string }[]>`SELECT xmin::text AS x FROM "OrderItem" WHERE id = ${A}`)),
    ...(await mot(
      db.$queryRaw<{ x: string }[]>`
        SELECT xmin::text AS x FROM "AuditLog"
        WHERE "entityId" = ${DON} AND action IN ('POS_PHIEU_HUY', 'PHIEU_GOP_VOID', 'PHIEU_GOP_CLOSED', 'CON_DUNG_HOC')`,
    )),
  ];
  return [...new Set(xids)];
}

/** Giữ khoá ĐƠN ở một transaction riêng, `trongKhoa` chạy DƯỚI khoá, cho tới khi test cho nhả (khuôn `pos-huy-phieu-the.test.ts`). */
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
  await Promise.race([choKhoa, giu]);
  return {
    nha: async () => {
      nhaKhoa();
      await giu;
    },
  };
}

/** Chờ tới khi lượt `dangChay` BỊ CHẶN ở khoá advisory (khoá đơn) — lọc theo oid DB này (cụm 5432 dùng chung với phiên khác). */
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

/**
 * CẢNH SAI MÃ bằng ĐƯỜNG THẬT (khuôn `pos-bac-lach-phieu-moi.test.ts` `canhGoc`): phiếu gộp một đợt + phiếu thẻ + "Chưa thấy" + HAI giao dịch cùng số, ghi chú rỗng
 * ⇒ sale gửi X cho kế toán (`NHIEU_UNG_VIEN`) ⇒ phiếu thẻ `CAN_XU_LY` giữ X, yêu cầu `CHO_DUYET`. `tuChoi = true` ⇒ kế toán BÁC X ⇒ phiếu thẻ về `CHO_QUET` (MỞ), yêu cầu `TU_CHOI`.
 */
async function canhSaiMa(o: { tuChoi: boolean }) {
  const g = await phatPhieu(DON, [DOT_A]);
  const p = await moPhieu(DON, DOT_A, NOW);
  await chuaThay(p.intentId, z("2026-10-06T10:40:00Z"));
  const mKhac = maGd();
  const mX = maGd();
  await nhapFile([
    dong({ maGiaoDich: mKhac, soTien: g.tongTien, thoiGian: "2026-10-06T17:20:00+07:00" }), // 10:20Z — khách KHÁC
    dong({ maGiaoDich: mX, soTien: g.tongTien, thoiGian: "2026-10-06T17:38:00+07:00" }), // 10:38Z — X
  ]);
  const btX = await btId(mX);
  const gui = await guiSaiMa({ orderId: DON, intentId: p.intentId, bankTransactionId: btX, actor: ACTOR, now: z("2026-10-06T10:41:00Z") });
  expect(gui, "hai ứng viên ⇒ gửi kế toán").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
  const yc = (await yeuCauCua(p.intentId))[0]!;
  if (o.tuChoi) {
    const tc = await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: z("2026-10-06T10:42:00Z") });
    expect(tc, "kế toán bác X").toMatchObject({ ok: true, trangThai: "TU_CHOI" });
  }
  return { g, p, mX, btX, yeuCauId: yc.id };
}

/**
 * (ii) chèn thẳng một yêu cầu SỐNG lên phiếu thẻ đang MỞ — đường thật không bao giờ tạo "phiếu MỞ + yêu cầu sống" (gửi chuyển phiếu sang CAN_XU_LY trong cùng transaction), nên đây là
 * DỮ LIỆU VI PHẠM bất biến (chèn SQL tay, một sửa đổi sau này của Việc 3). Dùng cho [HN6-DH-05c] (đường ghi bỏ qua) và [HN6-DH-10c] (xem trước cũng bỏ qua).
 */
async function chenYeuCauSongTrenPhieuMo(intentId: string) {
  const m = maGd();
  await nhapFile([dong({ maGiaoDich: m, soTien: TONG, thoiGian: "2026-10-06T17:20:00+07:00" })]);
  return db.posSaiMaYeuCau.create({
    data: {
      intentId,
      bankTransactionId: await btId(m),
      centerId: CS1,
      kieu: "CHO_KE_TOAN",
      trangThai: "CHO_DUYET",
      lyDo: "NHIEU_UNG_VIEN",
      nguoiGuiId: SALE,
      createdAt: KIEM,
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// CÁC CA
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!RUN_DB_TESTS)("[HN6-DH] dừng học huỷ kèm phiếu thẻ đang mở — cùng MỘT transaction", () => {
  beforeEach(dungFixture);
  afterEach(() => {
    h.cay = null;
  });
  afterAll(don);

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-01] CA GỐC", () => {
    it("[HN6-DH-01] phiếu gộp (A+B) có phiếu thẻ CHO_QUET ⇒ dừng học A: phiếu thẻ HUY + phiếu gộp VOID + đợt A VOID + bé A STOPPED, đủ vết, MỘT transaction (xmin)", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const truocThe = await phieuPos(p.intentId);
      expect(truocThe.status, "fixture: phiếu thẻ đang chờ quẹt").toBe("CHO_QUET");
      const truocAudit = await db.auditLog.count({ where: { entityType: "Order", entityId: DON } });

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.soPhieuTheDaHuy, "kết quả nói đã huỷ MỘT phiếu thẻ").toBe(1);
      expect(kq.phieuGop, "phiếu gộp của cả nhà bị huỷ (chưa nhận đồng nào)").toEqual({ ma: g.ma, dich: "VOID" });

      // Phiếu thẻ: chỉ `status` đổi — mã, kết quả lượt kiểm, giao dịch đã nhận, hạn giữ nguyên.
      const sauThe = await phieuPos(p.intentId);
      expect(sauThe.status).toBe("HUY");
      expect({ ...sauThe, status: truocThe.status, updatedAt: truocThe.updatedAt }).toEqual(truocThe);
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
      expect((await dotDb(DOT_A)).status, "đợt của bé dừng học bị huỷ").toBe("VOID");
      expect((await dotDb(DOT_B)).status, "đợt của bé còn lại GIỮ NGUYÊN (sale phát mã mới cho phần còn lại)").toBe("PENDING");
      expect((await dongDb(A)).status).toBe("STOPPED");
      expect((await dongDb(B)).status).toBe("ACTIVE");
      expect(await soPayment(), "dừng học không đẻ bút toán").toBe(0);
      expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(0);

      // Vết: đúng MỘT dòng `POS_PHIEU_HUY`, nguồn DUNG_HOC, đủ mã · bé · trạng thái trước.
      const vet = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect(vet).toHaveLength(1);
      const v = vet[0]!;
      expect(v.actorId).toBe(SALE);
      expect(v.module).toBe("finance");
      expect(v.oldValues).toEqual({ intentId: p.intentId, status: "CHO_QUET" });
      expect(v.newValues).toMatchObject({
        intentId: p.intentId,
        billId: g.billId,
        status: "HUY",
        ma: g.ma,
        nguon: "DUNG_HOC",
        orderItemId: A,
      });
      expect(v.reason ?? "").toContain("Dừng học");
      expect(v.reason ?? "").toContain(g.ma);
      // Vết dừng học nhắc phiếu thẻ đã huỷ (người đọc sổ không phải đoán).
      const vetDung = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "CON_DUNG_HOC" } });
      expect(vetDung.newValues).toMatchObject({ phieuTheDaHuy: [{ intentId: p.intentId, ma: g.ma }] });
      // Ba dòng vết mới: huỷ phiếu thẻ + huỷ phiếu gộp + dừng học.
      expect(await db.auditLog.count({ where: { entityType: "Order", entityId: DON } })).toBe(truocAudit + 3);

      // ⚠️ CÙNG MỘT transaction: phiếu thẻ · phiếu gộp · đợt · dòng đơn · mọi dòng vết đều mang MỘT xid.
      expect(await xidCuaLuotDungHoc(p.intentId, g.billId), "mọi thứ ghi trong MỘT transaction").toHaveLength(1);
    });

    it("[HN6-DH-01b] phiếu gộp ĐÃ NHẬN MỘT PHẦN (tiền vào từ đường khác) ⇒ dừng học ĐÓNG phiếu gộp (không huỷ) và VẪN huỷ phiếu thẻ mở — cùng một transaction", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      // (iii) chèn thẳng một phân bổ: tiền vào đợt A không do phiếu gộp (gắn tay / QR đơn lẻ). Đẩy đợt sang PARTIAL như đường thật.
      const bt = await db.bankTransaction.create({
        data: {
          id: `${T}txn-tay`,
          provider: "SEPAY",
          providerTxnId: `${T}txn-tay-1`,
          amount: 1_000_000,
          content: "fixture HN6 — tiền vào từ đường khác",
          transferredAt: z("2026-10-06T10:30:00Z"),
          status: "MATCHED",
          centerId: CS1,
        },
      });
      await db.paymentAllocation.create({ data: { bankTransactionId: bt.id, paymentRequestId: DOT_A, amount: 1_000_000, centerId: CS1 } });
      await db.paymentRequest.update({ where: { id: DOT_A }, data: { status: "PARTIAL" } });

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.phieuGop, "đã nhận tiền ⇒ ĐÓNG, giữ dấu vết").toEqual({ ma: g.ma, dich: "CLOSED" });
      expect(kq.soPhieuTheDaHuy).toBe(1);
      expect((await phieuGopDb(g.billId)).status).toBe("CLOSED");
      expect((await phieuPos(p.intentId)).status, "phiếu thẻ vẫn bị huỷ khi phiếu gộp ĐÓNG").toBe("HUY");
      expect(await soVetHuy()).toBe(1);
      expect(await xidCuaLuotDungHoc(p.intentId, g.billId), "một transaction").toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-02/03] PHẠM VI — chỉ phiếu thẻ của phiếu gộp BỊ HUỶ/ĐÓNG", () => {
    it("[HN6-DH-02] phiếu gộp mở KHÔNG chứa dòng của bé dừng học (chỉ đợt B) ⇒ phiếu gộp + phiếu thẻ của nó GIỮ NGUYÊN, 0 phiếu thẻ bị huỷ; đối chứng: đợt của A vẫn VOID", async () => {
      const g = await phatPhieu(DON, [DOT_B]);
      const p = await moPhieu(DON, DOT_B, NOW);
      const truocThe = await phieuPos(p.intentId);
      const truocBill = await phieuGopDb(g.billId);

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.phieuGop, "phiếu gộp không có dòng của bé ⇒ không đụng").toBeNull();
      expect(kq.soPhieuTheDaHuy).toBe(0);
      expect(await phieuPos(p.intentId), "phiếu thẻ của phiếu gộp KHÁC nguyên vẹn (kể cả updatedAt)").toEqual(truocThe);
      expect(await phieuGopDb(g.billId), "phiếu gộp nguyên vẹn").toEqual(truocBill);
      expect(await soVetHuy()).toBe(0);
      // Đối chứng: dừng học vẫn chạy phần của nó.
      expect((await dongDb(A)).status).toBe("STOPPED");
      expect((await dotDb(DOT_A)).status).toBe("VOID");
    });

    it("[HN6-DH-02b] ĐƠN KHÁC không bị chạm: đơn 2 có phiếu gộp + phiếu thẻ riêng — dừng học ở đơn 1 không đổi một dòng nào của đơn 2", async () => {
      const { p } = await dungPhieuGopVaThe();
      const o2 = await dungDon2();
      const truoc2 = await chup([DON2]);

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      expect((await phieuPos(p.intentId)).status, "đối chứng: phiếu thẻ của đơn 1 bị huỷ").toBe("HUY");
      expect(await chup([DON2]), "đơn 2 nguyên vẹn").toBe(truoc2);
      expect((await phieuPos(o2.p.intentId)).status).toBe("CHO_QUET");
      expect(await soVetHuy(DON2)).toBe(0);
    });

    it("[HN6-DH-03] ĐỐI CHỨNG: phiếu gộp KHÔNG có phiếu thẻ nào ⇒ dừng học y như cũ (phiếu gộp VOID, 0 phiếu thẻ huỷ, 0 vết huỷ thẻ, vết dừng học không nhắc phiếu thẻ)", async () => {
      const g = await phatPhieu(DON, [DOT_A, DOT_B]);
      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.phieuGop).toEqual({ ma: g.ma, dich: "VOID" });
      expect(kq.soPhieuTheDaHuy).toBe(0);
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
      expect(await soVetHuy()).toBe(0);
      const vetDung = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "CON_DUNG_HOC" } });
      expect(vetDung.newValues).toMatchObject({ phieuTheDaHuy: [] });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-04] mọi trạng thái của phiếu thẻ — chỉ phiếu MỞ bị huỷ", () => {
    it("[HN6-DH-04] THAT_BAI (khách quẹt lại với cùng mã) là phiếu MỞ ⇒ cũng bị huỷ", async () => {
      const { p } = await dungPhieuGopVaThe();
      const kq0 = await xuLy(p.intentId, { kind: "FAILED", reasonCode: "USER_CANCELLED", providerTxnId: maGd() });
      expect(kq0.status).toBe("THAT_BAI");
      const kq = await dungHoc();
      expect(kq.ok).toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      expect(kq.ok && kq.soPhieuTheDaHuy).toBe(1);
    });

    it.each(["PROVIDER_ERROR", "PAID", "PAID_AMOUNT_MISMATCH"] as const)(
      "[HN6-DH-04a] DẤU HIỆU TIỀN ĐANG BAY (kết quả gần nhất %s, phiếu CHO_QUET) — nút 'Huỷ phiếu thẻ' của Việc 4 SẼ TỪ CHỐI, nhưng DỪNG HỌC KHÔNG BỊ CHẶN: vẫn huỷ phiếu thẻ cùng phiếu gộp",
      async (kind) => {
        const { p } = await dungPhieuGopVaThe();
        // (i) ép kết quả gần nhất — đường thật tới đây cần provider hỏng / pha tiền ném.
        await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { lastResultKind: kind, lastResultMessage: "fixture: kết quả chưa kết luận" } });
        const manual = await huyPhieuThe({ orderId: DON, intentId: p.intentId, lyDo: "MO_NHAM", xacNhanKhachChuaQuet: true, actor: ACTOR, now: sau(NOW, 41 * PHUT) });
        expect(manual.ok, "đối chứng: nút huỷ TAY bị từ chối vì dấu hiệu tiền").toBe(false);
        expect((await phieuPos(p.intentId)).status, "bị từ chối ⇒ phiếu thẻ nguyên").toBe("CHO_QUET");

        const kq = await dungHoc();
        expect(kq.ok, `dừng học KHÔNG dùng cổng của nút huỷ tay: ${!kq.ok ? kq.error : ""}`).toBe(true);
        expect((await phieuPos(p.intentId)).status).toBe("HUY");
        expect(kq.ok && kq.soPhieuTheDaHuy).toBe(1);
        // Không mất dấu: kết quả lượt kiểm gần nhất vẫn nằm trên phiếu (chỉ `status` đổi) và vết ghi nó lại.
        expect((await phieuPos(p.intentId)).lastResultKind).toBe(kind);
        const v = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
        expect(v.newValues).toMatchObject({ ketQuaTruoc: kind, nguon: "DUNG_HOC" });
      },
    );

    it("[HN6-DH-04b] phiếu thẻ ĐÃ ĐÓNG của phiếu gộp (HET_HAN do phiếu mới thay) GIỮ NGUYÊN — chỉ phiếu MỞ hiện hành bị huỷ, đúng một dòng vết", async () => {
      const { g, p: p1 } = await dungPhieuGopVaThe();
      // Quá hạn: "Thẻ POS" thay P1 bằng P2 (P1 → HET_HAN), cùng phiếu gộp, cùng mã.
      const p2 = await moPhieu(DON, DOT_A, QUA_HAN);
      expect(p2.intentId).not.toBe(p1.intentId);
      expect((await phieuPos(p1.intentId)).status).toBe("HET_HAN");
      const truocP1 = await phieuPos(p1.intentId);

      const kq = await dungHoc({ now: sau(QUA_HAN, 5 * PHUT) });
      expect(kq.ok).toBe(true);
      expect((await phieuPos(p2.intentId)).status, "phiếu MỞ hiện hành bị huỷ").toBe("HUY");
      expect(await phieuPos(p1.intentId), "phiếu đã HET_HAN nguyên vẹn (kể cả updatedAt)").toEqual(truocP1);
      expect(await soVetHuy(), "đúng MỘT vết huỷ — không động tới phiếu đã đóng").toBe(1);
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
    });

    it("[HN6-DH-04c] phiếu thẻ ĐANG CHỜ KẾ TOÁN (LECH_TIEN, giao dịch còn ở hàng chờ) KHÔNG phải phiếu mở: GIỮ NGUYÊN, giao dịch GIỮ UNMATCHED; dừng học vẫn chạy; đối chứng: 0 Payment", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const lech = maGd();
      const kq0 = await xuLy(p.intentId, paid({ providerTxnId: lech, dienGiai: g.ma, amount: TONG - 1 }));
      expect(kq0.status, "máy thu lệch số ⇒ LECH_TIEN, giao dịch nằm hàng chờ").toBe("LECH_TIEN");
      const truocThe = await phieuPos(p.intentId);
      expect(truocThe.bankTransactionId, "phiếu giữ giao dịch").not.toBeNull();

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      expect(kq.ok && kq.soPhieuTheDaHuy, "phiếu chờ kế toán không phải phiếu mở").toBe(0);
      expect(await phieuPos(p.intentId), "phiếu thẻ + giao dịch nó giữ nguyên vẹn").toEqual(truocThe);
      expect((await btThe(lech))?.status, "giao dịch vẫn nằm hàng chờ gắn tay").toBe("UNMATCHED");
      expect((await phieuGopDb(g.billId)).status, "phiếu gộp vẫn bị huỷ").toBe("VOID");
      expect(await soPayment()).toBe(0);
      expect(await soVetHuy()).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-05] YÊU CẦU 'NHẬP SAI MÃ' (Việc 3) đi cùng phiếu thẻ", () => {
    it("[HN6-DH-05a] phiếu thẻ CAN_XU_LY giữ X + yêu cầu CHO_DUYET (tiền đang chờ KẾ TOÁN QUYẾT) ⇒ dừng học KHÔNG đụng vào cả hai; kế toán 'Duyệt' bị từ chối bằng câu nói thật; 0 Payment", async () => {
      const c = await canhSaiMa({ tuChoi: false });
      const truocThe = await phieuPos(c.p.intentId);
      expect(truocThe.status, "fixture: phiếu thẻ giữ X").toBe("CAN_XU_LY");
      expect(truocThe.bankTransactionId).toBe(c.btX);
      const truocYc = await yeuCauCua(c.p.intentId);
      expect(truocYc.map((y) => y.trangThai)).toEqual(["CHO_DUYET"]);

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.phieuGop).toEqual({ ma: c.g.ma, dich: "VOID" });
      expect(kq.soPhieuTheDaHuy, "phiếu CAN_XU_LY mang giao dịch của khách — không phải phiếu mở").toBe(0);
      expect(await phieuPos(c.p.intentId), "phiếu thẻ nguyên vẹn").toEqual(truocThe);
      expect(await yeuCauCua(c.p.intentId), "yêu cầu nguyên vẹn — CHỈ kế toán (≠ người gửi) mới quyết được").toEqual(truocYc);
      expect((await btThe(c.mX))?.status, "X vẫn nằm hàng chờ").toBe("UNMATCHED");
      expect(await soVetHuy()).toBe(0);

      // Hệ quả đã thiết kế (§5.3.7 "dừng học VOID phiếu giữa chừng"): phiếu gộp đã VOID ⇒ 'Duyệt' KHÔNG ghi tiền được, nói đúng vì sao; kế toán từ chối hoặc gắn tay.
      const truoc = await chup();
      const duyet = await duyetSaiMa({ orderId: DON, yeuCauId: c.yeuCauId, actor: A_KT, now: z("2026-10-06T11:10:00Z") });
      expect(duyet.ok).toBe(false);
      expect(!duyet.ok && duyet.error).toContain("Phiếu gộp không còn mở");
      expect(await chup(), "bị từ chối ⇒ không ghi gì").toBe(truoc);
      expect(await soPayment()).toBe(0);

      // KHÔNG MỒ CÔI (đề bài: "không để yêu cầu mồ côi"): hàng chờ của kế toán — ĐÚNG hàm màn `/bien-dong-so-du` đọc — vẫn LIỆT KÊ yêu cầu ở "việc cần làm" với hiệu lực CHO_DUYET, nên nút 'Từ chối'
      // (lối thoát duy nhất, `05d`) có đó. `docHangChoSaiMa` không lọc theo trạng thái phiếu gộp.
      const hang = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, z("2026-10-06T11:10:00Z"));
      expect(hang.cho.find((d) => d.id === c.yeuCauId)?.hieuLuc, "yêu cầu của phiếu gộp đã VOID vẫn nằm ở việc cần làm").toBe("CHO_DUYET");
      expect(hang.theoGiaoDich[c.btX], "…và chip \"đang giữ\" ở bảng giao dịch").toMatchObject({ hieuLuc: "CHO_DUYET" });
      expect(hang.soCanXuLy, "…tính vào số việc cần người").toBeGreaterThanOrEqual(1);
    });

    it("[HN6-DH-05b] phiếu thẻ CHO_QUET sau khi kế toán BÁC X (yêu cầu TU_CHOI) ⇒ dừng học HUY phiếu thẻ; yêu cầu GIỮ TU_CHOI; bộ nhớ 'X đã bị bác' của ĐƠN còn nguyên; X vẫn UNMATCHED", async () => {
      const c = await canhSaiMa({ tuChoi: true });
      expect((await phieuPos(c.p.intentId)).status, "fixture: bác ⇒ phiếu thẻ về CHO_QUET (MỞ)").toBe("CHO_QUET");
      const truocYc = await yeuCauCua(c.p.intentId);
      expect(truocYc.map((y) => y.trangThai)).toEqual(["TU_CHOI"]);

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      expect(kq.ok && kq.soPhieuTheDaHuy).toBe(1);
      expect((await phieuPos(c.p.intentId)).status).toBe("HUY");
      expect(await yeuCauCua(c.p.intentId), "yêu cầu đã bác nguyên vẹn").toEqual(truocYc);
      const bac = await docGiaoDichDaBiBac(db, DON);
      expect(bac.giaoDich.has(c.btX), "đơn vẫn nhớ X đã bị bác — huỷ phiếu thẻ không xoá bộ nhớ").toBe(true);
      expect(bac.soLan).toBe(1);
      expect((await btThe(c.mX))?.status).toBe("UNMATCHED");
      expect(await soPayment()).toBe(0);
    });

    it("[HN6-DH-05c] DỮ LIỆU VI PHẠM bất biến — phiếu thẻ MỞ nhưng còn yêu cầu SỐNG (CHO_DUYET): dừng học vẫn chạy, KHÔNG huỷ phiếu thẻ ấy (có người đang quyết tiền gắn với nó), yêu cầu nguyên vẹn, vết nói rõ phiếu bị bỏ qua", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const yc = await chenYeuCauSongTrenPhieuMo(p.intentId); // (ii)
      const truocThe = await phieuPos(p.intentId);
      expect(truocThe.status).toBe("CHO_QUET");

      const kq = await dungHoc();
      expect(kq.ok, `dừng học KHÔNG được kẹt vì dữ liệu lạ: ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.phieuGop).toEqual({ ma: g.ma, dich: "VOID" });
      expect(kq.soPhieuTheDaHuy, "bỏ qua phiếu mang yêu cầu sống").toBe(0);
      expect(await phieuPos(p.intentId), "phiếu thẻ nguyên vẹn").toEqual(truocThe);
      expect(await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: yc.id } }), "yêu cầu nguyên vẹn").toEqual(yc);
      expect(await soVetHuy()).toBe(0);
      const vetDung = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "CON_DUNG_HOC" } });
      expect(vetDung.newValues).toMatchObject({
        phieuTheDaHuy: [],
        phieuTheBoQua: [{ intentId: p.intentId, ma: g.ma, vi: "CO_YEU_CAU_SAI_MA" }],
      });
    });

    it("[HN6-DH-05d] SAU dừng học, kế toán TỪ CHỐI yêu cầu đang chờ ⇒ phiếu thẻ KHÔNG sống lại thành phiếu MỞ trên mã đã chết (HUY); yêu cầu TU_CHOI; X vẫn UNMATCHED và gắn tay được ĐÚNG MỘT LẦN; 0 Payment tự sinh", async () => {
      // Ca này đo VẾ CÒN LẠI của [HN6-DH-05a]: dừng học để nguyên phiếu thẻ CAN_XU_LY + yêu cầu CHO_DUYET (có người đang quyết tiền), phiếu gộp đã VOID. Lối thoát duy nhất của yêu cầu ấy
      // là kế toán TỪ CHỐI ("Duyệt" bị từ chối — 05a). `tuChoiSaiMa` nhả phiếu thẻ về CHO_QUET: nếu không hỏi phiếu gộp còn OPEN không thì NHẢ RA một phiếu thẻ MỞ trên mã đã chết —
      // đúng thứ mục 3 cấm: poller hỏi nó tới hết hạn, màn in "phiếu gộp đã đóng" cho một phiếu quẹt được, nút huỷ tay cũng từ chối (cổng ④ "phiếu gộp đã đóng"), và lượt "Kiểm tra" sau
      // đó lại giữ giao dịch về CAN_XU_LY.
      const c = await canhSaiMa({ tuChoi: false });
      const kqDung = await dungHoc();
      expect(kqDung.ok, `dừng học phải thành công: ${!kqDung.ok ? kqDung.error : ""}`).toBe(true);
      expect((await phieuGopDb(c.g.billId)).status, "fixture: phiếu gộp đã VOID").toBe("VOID");
      expect((await phieuPos(c.p.intentId)).status, "fixture: dừng học để nguyên phiếu thẻ đang giữ X (05a)").toBe("CAN_XU_LY");

      const tc = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yeuCauId, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: z("2026-10-06T11:10:00Z") });
      expect(tc, "kế toán bác được dù phiếu gộp đã VOID").toMatchObject({ ok: true, trangThai: "TU_CHOI" });

      const the = await phieuPos(c.p.intentId);
      expect(TRANG_THAI_MO as readonly string[], "phiếu thẻ KHÔNG được mở lại trên một phiếu gộp đã chết").not.toContain(the.status);
      expect(the.status).toBe("HUY");
      expect(the.bankTransactionId, "đã nhả X").toBeNull();
      expect((await yeuCauCua(c.p.intentId)).map((y) => y.trangThai), "yêu cầu đã bác").toEqual(["TU_CHOI"]);
      expect((await btThe(c.mX))?.status, "X nằm lại hàng chờ gắn tay").toBe("UNMATCHED");
      expect(await soPayment(), "không tự ghi vào đơn").toBe(0);
      // Vết: đúng MỘT dòng huỷ phiếu thẻ, nói RÕ vì sao (kế toán bác khi phiếu gộp đã đóng), cùng mã + cùng yêu cầu.
      const vet = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect(vet).toHaveLength(1);
      expect(vet[0]!.newValues).toMatchObject({ intentId: c.p.intentId, billId: c.g.billId, status: "HUY", ma: c.g.ma, nguon: "TU_CHOI_SAI_MA", yeuCauId: c.yeuCauId });

      // ĐỐI CHỨNG DƯƠNG (luật 11): hàng chờ gắn tay DÙNG ĐƯỢC cho đúng giao dịch ấy — kế toán gắn vào đợt B; lần hai bị từ chối.
      const gan = await ganTienTheoCon({ bankTransactionId: c.btX, orderId: DON, dong: [{ paymentRequestId: DOT_B, soTien: c.g.tongTien }], actor: A_KT, nguoiGan: { loai: "KE_TOAN" } });
      expect(gan.ok, `kế toán gắn tay phải được: ${!gan.ok ? gan.error : ""}`).toBe(true);
      expect(await soPayment()).toBe(1);
      const lan2 = await ganTienTheoCon({ bankTransactionId: c.btX, orderId: DON, dong: [{ paymentRequestId: DOT_B, soTien: c.g.tongTien }], actor: A_KT, nguoiGan: { loai: "KE_TOAN" } });
      expect(lan2.ok, "gắn lần hai bị từ chối").toBe(false);
      expect(await soPayment(), "không ghi đôi").toBe(1);

      // Hàng chờ kế toán sau khi quyết: yêu cầu RỜI "việc cần làm", nằm ở hậu kiểm với nhãn Đã từ chối (không treo vô hạn).
      const hang = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, z("2026-10-06T11:20:00Z"));
      expect(hang.cho.map((d) => d.id), "đã quyết ⇒ rời việc cần làm").not.toContain(c.yeuCauId);
      expect(hang.hauKiem.find((d) => d.id === c.yeuCauId)?.hieuLuc, "…và vào hậu kiểm").toBe("TU_CHOI");
    });

    it("[HN6-DH-05e] ĐỐI CHỨNG đường thường: KHÔNG dừng học (phiếu gộp còn OPEN) ⇒ kế toán TỪ CHỐI vẫn nhả phiếu thẻ về CHO_QUET như Việc 3 đã chốt (cho quẹt/kiểm lại), 0 vết huỷ phiếu thẻ", async () => {
      // Chứng minh bản vá của 05d KHÔNG đổi đường thường: chỉ khi phiếu gộp đã đóng phiếu thẻ mới HUY.
      const c = await canhSaiMa({ tuChoi: false });
      expect((await phieuGopDb(c.g.billId)).status).toBe("OPEN");
      const tc = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yeuCauId, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: z("2026-10-06T11:10:00Z") });
      expect(tc).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      const the = await phieuPos(c.p.intentId);
      expect(the.status, "phiếu gộp còn mở ⇒ phiếu thẻ về CHO_QUET").toBe("CHO_QUET");
      expect(the.bankTransactionId).toBeNull();
      expect(await soVetHuy(), "không huỷ gì").toBe(0);
    });

    it("[HN6-DH-05f] YÊU CẦU KẸT Ở DANG_GHI (kế toán bấm Duyệt, máy sập TRƯỚC khi ghi tiền) + dừng học xen vào ⇒ dừng học không đụng phiếu thẻ/yêu cầu; 'thử lại' sau 2′ KHÔNG ghi tiền vào đơn đã dừng học; X ở lại hàng chờ; yêu cầu vẫn được liệt kê", async () => {
      // Đề bài nêu rõ `CHO_DUYET/DANG_GHI`. DANG_GHI là trạng thái DUY NHẤT còn có thể sinh MỘT PHÉP GHI TIỀN sau dừng học: kế toán bấm 'Duyệt' ⇒ phép chuyển CHO_DUYET → DANG_GHI commit ⇒ máy sập ⇒
      // yêu cầu KẸT; ≥ 2′ sau, 'thử lại' của `duyetSaiMa` BỎ QUA cổng "phiếu gộp còn OPEN" (cổng chỉ chạy khi trạng thái là CHO_DUYET) rồi gọi thẳng đường tiền chung. Phiếu gộp lúc ấy đã VOID
      // (dừng học xen vào giữa). (iv) chèn thẳng trạng thái do 'sập trước tiền' để lại — xem chú thích đầu tệp.
      const c = await canhSaiMa({ tuChoi: false });
      const GHI_LUC = z("2026-10-06T10:45:00Z");
      await db.posSaiMaYeuCau.update({ where: { id: c.yeuCauId }, data: { trangThai: "DANG_GHI", nguoiQuyetId: KT, quyetLuc: GHI_LUC, dangGhiLuc: GHI_LUC } });
      const truocThe = await phieuPos(c.p.intentId);
      expect(truocThe.status, "fixture: phiếu thẻ giữ X").toBe("CAN_XU_LY");

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.soPhieuTheDaHuy, "phiếu CAN_XU_LY không phải phiếu mở").toBe(0);
      expect(kq.phieuGop).toEqual({ ma: c.g.ma, dich: "VOID" });
      expect(await phieuPos(c.p.intentId), "phiếu thẻ nguyên vẹn").toEqual(truocThe);

      // Hàng chờ kế toán: yêu cầu KẸT vẫn được liệt kê (đúng hàm màn đọc) — kế toán thấy "Kẹt — thử lại".
      const THU_LAI = z("2026-10-06T11:10:00Z");
      const hang = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, THU_LAI);
      expect(hang.cho.find((d) => d.id === c.yeuCauId)?.hieuLuc, "yêu cầu kẹt vẫn nằm ở việc cần làm").toBe("KET");

      // 'Thử lại' sau 2′ — đường tiền chạy trên phiếu gộp VOID.
      const lai = await duyetSaiMa({ orderId: DON, yeuCauId: c.yeuCauId, actor: A_KT, now: THU_LAI });
      expect(lai.ok, "đường tiền chạy trên phiếu gộp đã VOID ⇒ không ghi được").toBe(false);
      expect(!lai.ok && lai.error, "câu nói thật: chưa ghi nhận được vì phiếu không mở").toContain("Chưa ghi nhận được");
      expect(!lai.ok && lai.error).toContain("PHIEU_KHONG_MO");

      // AN TOÀN TIỀN: không Payment, không phân bổ, X ở lại hàng chờ gắn tay, phiếu gộp vẫn VOID, phiếu thẻ KHÔNG thành DA_THU.
      expect(await soPayment(), "KHÔNG ghi tiền vào đơn đã dừng học").toBe(0);
      expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } }), "0 phân bổ").toBe(0);
      expect((await btThe(c.mX))?.status, "X ở lại hàng chờ").toBe("UNMATCHED");
      expect((await phieuGopDb(c.g.billId)).status).toBe("VOID");
      const the = await phieuPos(c.p.intentId);
      expect(the.status, "phiếu thẻ không thành DA_THU").toBe("CAN_XU_LY");
      expect(the.bankTransactionId, "vẫn giữ X cho tới khi kế toán quyết").toBe(c.btX);

      // YÊU CẦU KHÔNG KẸT VĨNH VIỄN: 'Từ chối' chỉ đi từ CHO_DUYET (không từ chối được yêu cầu đang ghi tiền), nên lối thoát phụ thuộc việc yêu cầu QUAY VỀ CHO_DUYET sau lượt thử lại thất bại.
      const yc = (await yeuCauCua(c.p.intentId))[0]!;
      expect(yc.trangThai, "về CHO_DUYET để kế toán quyết").toBe("CHO_DUYET");
      expect(yc.lyDo, "kèm lý do ghi tự động không được").toContain("GHI_TU_DONG_KHONG_DUOC");
      expect(yc.nguoiQuyetId, "bỏ người duyệt cũ").toBeNull();
      const hang2 = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, THU_LAI);
      expect(hang2.cho.find((d) => d.id === c.yeuCauId)?.hieuLuc, "…và nằm ở việc cần làm với nút Từ chối").toBe("CHO_DUYET");

      // Lối thoát: TỪ CHỐI ⇒ phiếu thẻ KẾT THÚC (HUY) — không mở lại trên mã chết; X vẫn ở hàng chờ; 0 Payment.
      const tc = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yeuCauId, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: sau(THU_LAI, 5 * PHUT) });
      expect(tc, "từ chối được dù phiếu gộp đã VOID").toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      expect((await phieuPos(c.p.intentId)).status).toBe("HUY");
      expect((await btThe(c.mX))?.status).toBe("UNMATCHED");
      expect(await soPayment()).toBe(0);
    });

    it("[HN6-DH-05g] ĐỐI CHỨNG DƯƠNG của 05f: CÙNG yêu cầu kẹt ở DANG_GHI nhưng KHÔNG có dừng học ⇒ 'thử lại' sau 2′ GHI ĐÚNG MỘT LẦN và chốt DA_GHI_NHAN (đường thử lại có sống — 05f không xanh vì nó chết sẵn)", async () => {
      const c = await canhSaiMa({ tuChoi: false });
      const GHI_LUC = z("2026-10-06T10:45:00Z");
      await db.posSaiMaYeuCau.update({ where: { id: c.yeuCauId }, data: { trangThai: "DANG_GHI", nguoiQuyetId: KT, quyetLuc: GHI_LUC, dangGhiLuc: GHI_LUC } });
      expect((await phieuGopDb(c.g.billId)).status, "fixture: phiếu gộp còn OPEN").toBe("OPEN");
      const lai = await duyetSaiMa({ orderId: DON, yeuCauId: c.yeuCauId, actor: A_KT, now: z("2026-10-06T11:10:00Z") });
      expect(lai, `thử lại phải ghi được: ${!lai.ok ? lai.error : ""}`).toMatchObject({ ok: true, trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(), "đúng MỘT bút toán").toBe(1);
      expect((await phieuGopDb(c.g.billId)).status).toBe("PAID");
      expect((await btThe(c.mX))?.status).toBe("MATCHED");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-06] GIAO DỊCH VỀ SAU — rơi vào hàng chờ gắn tay, không ghi đôi, không mất tiền", () => {
    it("[HN6-DH-06] file về SAU dừng học (đúng mã cũ, đúng số) ⇒ UNMATCHED, 0 Payment, 0 phân bổ, ghi chú nói 'phiếu không mở'; nhập lại file ⇒ vẫn 1 giao dịch, 0 Payment", async () => {
      const { g } = await dungPhieuGopVaThe();
      expect((await dungHoc()).ok).toBe(true);
      const m = maGd();
      const file = [dong({ maGiaoDich: m, dienGiai: g.ma, soTien: TONG })];
      await nhapFile(file);
      const bt = await btThe(m);
      expect(bt?.status, "đúng mã + đúng số nhưng phiếu gộp đã VOID ⇒ hàng chờ gắn tay").toBe("UNMATCHED");
      expect(bt?.unmatchedNote ?? "").toContain("PHIEU_KHONG_MO");
      expect(bt?.allocations).toHaveLength(0);
      expect(await soPayment(), "KHÔNG ghi vào đơn").toBe(0);

      await nhapFile(file);
      expect(await db.bankTransaction.count({ where: { providerTxnId: m } }), "nhập lại không đẻ thêm giao dịch").toBe(1);
      expect(await soPayment(), "nhập lại không ghi đôi").toBe(0);
    });

    it("[HN6-DH-06b] KHÔNG ghi nhầm sang đợt khác: sau dừng học A, quẹt đúng số của đợt B nhưng bằng MÃ CŨ ⇒ vẫn UNMATCHED (mã cũ đã chết, không tự khớp vào phiếu/đợt nào)", async () => {
      const { g } = await dungPhieuGopVaThe();
      expect((await dungHoc()).ok).toBe(true);
      const m = maGd();
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, soTien: DOT_TIEN_B })]);
      expect((await btThe(m))?.status).toBe("UNMATCHED");
      expect(await soPayment()).toBe(0);
      expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(0);
      expect((await dotDb(DOT_B)).status, "đợt B không bị rót tiền").toBe("PENDING");
    });

    it("[HN6-DH-06c] 'Kiểm tra' từ TAB CŨ trên phiếu thẻ đã HUY, provider báo PAID đúng số ⇒ giao dịch UNMATCHED, phiếu thẻ VẪN HUY (không nhận giao dịch, không sống lại), 0 Payment", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      expect((await dungHoc()).ok).toBe(true);
      const m = maGd();
      const kq = await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma, amount: TONG }), sau(NOW_DUNG, 5 * PHUT));
      expect(kq.status, "phiếu đã HUY không sống lại").toBe("HUY");
      expect((await btThe(m))?.status).toBe("UNMATCHED");
      const sau_ = await phieuPos(p.intentId);
      expect(sau_.status).toBe("HUY");
      expect(sau_.bankTransactionId, "phiếu đã huỷ không giữ giao dịch").toBeNull();
      expect(await soPayment()).toBe(0);
    });

    it("[HN6-DH-06d] ĐỐI CHỨNG DƯƠNG — hàng chờ gắn tay DÙNG ĐƯỢC: kế toán gắn giao dịch về sau vào đợt B ĐÚNG MỘT LẦN (lần hai bị từ chối), Payment = số tiền, không ghi đôi", async () => {
      const { g } = await dungPhieuGopVaThe();
      expect((await dungHoc()).ok).toBe(true);
      const m = maGd();
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, soTien: DOT_TIEN_B })]);
      const id = await btId(m);
      const gan = await ganTienTheoCon({ bankTransactionId: id, orderId: DON, dong: [{ paymentRequestId: DOT_B, soTien: DOT_TIEN_B }], actor: A_KT, nguoiGan: { loai: "KE_TOAN" } });
      expect(gan.ok, `gắn tay phải được: ${!gan.ok ? gan.error : ""}`).toBe(true);
      expect(await soPayment()).toBe(1);
      expect((await btThe(m))?.status).toBe("MATCHED");
      const lan2 = await ganTienTheoCon({ bankTransactionId: id, orderId: DON, dong: [{ paymentRequestId: DOT_B, soTien: DOT_TIEN_B }], actor: A_KT, nguoiGan: { loai: "KE_TOAN" } });
      expect(lan2.ok, "gắn lần hai bị từ chối").toBe(false);
      expect(await soPayment(), "không ghi đôi").toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-07] ĐUA — đúng một bên, tiền không mất, không ghi đôi", () => {
    it("[HN6-DH-07] dừng học ‖ 'Kiểm tra' thấy PAID đúng số (lặp 8 lượt) ⇒ HOẶC tiền vào phiếu (Payment > 0, phiếu gộp PAID, phiếu thẻ DA_THU, KHÔNG vết huỷ) HOẶC rơi hàng chờ (Payment 0, phiếu gộp VOID, phiếu thẻ HUY) — không bao giờ nửa nọ nửa kia", async () => {
      // Hai kết cục đều hợp lệ và CẢ HAI cho dừng học thành công (đo ở [HN6-DH-07e]: tiền vào phiếu gộp không gắn riêng bé nào ⇒ `daThu` của bé = 0 ⇒ không có dư để phân). Ca đua chỉ khẳng định
      // tính nhất quán của kết cục; từng kết cục được ghim TẤT ĐỊNH ở [HN6-DH-06c] (dừng học trước) và [HN6-DH-07e] (Kiểm tra trước) — ca đua không thể bảo đảm cả hai nhánh đều chạy.
      let tienVao = 0;
      let hangCho = 0;
      for (let lan = 0; lan < 8; lan++) {
        await dungFixture();
        const { g, p } = await dungPhieuGopVaThe();
        const m = maGd();
        const [dung, kiem] = await Promise.all([dungHoc(), xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma, amount: TONG }))]);
        expect(dung.ok, `lượt ${lan}: dừng học phải thành công — ${!dung.ok ? dung.error : ""}`).toBe(true);
        const bts = await db.bankTransaction.findMany({ where: { providerTxnId: m } });
        expect(bts, `lượt ${lan}: đúng MỘT giao dịch`).toHaveLength(1);
        const bill = (await phieuGopDb(g.billId)).status;
        const the = (await phieuPos(p.intentId)).status;
        const pay = await soPayment();
        const phanBo = await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } });
        if (pay > 0) {
          tienVao++;
          expect(bts[0]!.status, `lượt ${lan}: tiền vào ⇒ giao dịch MATCHED`).toBe("MATCHED");
          expect(bill, `lượt ${lan}: tiền vào ⇒ phiếu gộp PAID`).toBe("PAID");
          expect(the, `lượt ${lan}: tiền vào ⇒ phiếu thẻ DA_THU`).toBe("DA_THU");
          expect(phanBo, `lượt ${lan}: có phân bổ`).toBeGreaterThan(0);
          expect(kiem.status).toBe("DA_THU");
          expect(await soVetHuy(), `lượt ${lan}: tiền đã vào ⇒ phiếu thẻ DA_THU không bị huỷ`).toBe(0);
          expect(dung.ok && dung.soPhieuTheDaHuy, `lượt ${lan}`).toBe(0);
        } else {
          hangCho++;
          expect(pay, `lượt ${lan}: không Payment`).toBe(0);
          expect(bts[0]!.status, `lượt ${lan}: rơi hàng chờ`).toBe("UNMATCHED");
          expect(bill, `lượt ${lan}: phiếu gộp VOID`).toBe("VOID");
          expect(the, `lượt ${lan}: phiếu thẻ HUY`).toBe("HUY");
          expect(phanBo, `lượt ${lan}: không phân bổ`).toBe(0);
        }
        expect(await soVetHuy(), `lượt ${lan}: tối đa MỘT vết huỷ phiếu thẻ`).toBeLessThanOrEqual(1);
      }
      // Ghi lại phân bố (không khẳng định tỉ lệ — phụ thuộc lịch chạy của máy).
      console.info(`[HN6-DH-07] 8 lượt: ${tienVao} lượt tiền vào phiếu, ${hangCho} lượt rơi hàng chờ`);
    });

    it("[HN6-DH-07e] TẤT ĐỊNH — 'Kiểm tra' thấy PAID commit TRƯỚC, dừng học SAU ⇒ tiền KHÔNG mất: Payment giữ nguyên, phiếu thẻ DA_THU + phiếu gộp PAID NGUYÊN VẸN (kể cả updatedAt), 0 vết huỷ phiếu thẻ; dừng học chỉ làm phần của nó", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const m = maGd();
      const kiem = await xuLy(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma, amount: TONG }));
      expect(kiem.status, "fixture: tiền đã vào phiếu thẻ").toBe("DA_THU");
      const soPay = await soPayment();
      expect(soPay, "fixture: tiền đã được ghi vào đơn").toBeGreaterThan(0);
      const truocThe = await phieuPos(p.intentId);
      const truocBill = await phieuGopDb(g.billId);
      expect(truocThe.status).toBe("DA_THU");
      expect(truocBill.status).toBe("PAID");
      const truocPhanBo = await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } });

      const kq = await dungHoc();
      expect(kq.ok, `dừng học phải thành công (tiền vào phiếu gộp không gắn riêng bé nào ⇒ bé không có dư): ${!kq.ok ? kq.error : ""}`).toBe(true);
      if (!kq.ok) return;
      expect(kq.soPhieuTheDaHuy, "phiếu thẻ ĐÃ THU không phải phiếu mở ⇒ không huỷ").toBe(0);
      expect(kq.phieuGop, "phiếu gộp đã PAID ⇒ không còn là 'phiếu gộp đang mở' ⇒ không đụng").toBeNull();
      expect(await phieuPos(p.intentId), "phiếu thẻ nguyên vẹn").toEqual(truocThe);
      expect(await phieuGopDb(g.billId), "phiếu gộp nguyên vẹn").toEqual(truocBill);
      expect(await soPayment(), "dừng học không đẻ / xoá bút toán").toBe(soPay);
      expect(await db.paymentAllocation.count({ where: { paymentRequest: { orderId: DON } } })).toBe(truocPhanBo);
      expect((await btThe(m))?.status, "giao dịch vẫn MATCHED").toBe("MATCHED");
      expect(await soVetHuy(), "không vết huỷ phiếu thẻ").toBe(0);
      // Đối chứng: dừng học vẫn chạy phần của nó.
      expect((await dongDb(A)).status).toBe("STOPPED");
    });

    it("[HN6-DH-07b] HAI lượt dừng học (bé A ‖ bé B) cùng đơn, cùng phiếu gộp ⇒ cả hai thành công, phiếu thẻ HUY ĐÚNG MỘT LẦN (một vết), không ném", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const [a, b] = await Promise.all([dungHoc(), dungHoc({ orderItemId: B })]);
      expect(a.ok, `A: ${!a.ok ? a.error : ""}`).toBe(true);
      expect(b.ok, `B: ${!b.ok ? b.error : ""}`).toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
      expect(await soVetHuy(), "một vết huỷ").toBe(1);
      expect((a.ok ? a.soPhieuTheDaHuy : 0) + (b.ok ? b.soPhieuTheDaHuy : 0), "đúng một lượt huỷ được phiếu thẻ").toBe(1);
    });

    it("[HN6-DH-07c] dừng học ‖ nút 'Huỷ phiếu thẻ' (tay) trên CÙNG phiếu ⇒ kết cục cuối giống nhau (phiếu thẻ HUY, phiếu gộp VOID), đúng MỘT vết huỷ, không ném", async () => {
      for (let lan = 0; lan < 4; lan++) {
        await dungFixture();
        const { g, p } = await dungPhieuGopVaThe();
        const [dung, tay] = await Promise.all([
          dungHoc(),
          huyPhieuThe({ orderId: DON, intentId: p.intentId, lyDo: "MO_NHAM", xacNhanKhachChuaQuet: true, actor: ACTOR, now: sau(NOW, 41 * PHUT) }),
        ]);
        expect(dung.ok, `lượt ${lan}: dừng học — ${!dung.ok ? dung.error : ""}`).toBe(true);
        expect((await phieuPos(p.intentId)).status, `lượt ${lan}`).toBe("HUY");
        expect((await phieuGopDb(g.billId)).status, `lượt ${lan}`).toBe("VOID");
        expect(await soVetHuy(), `lượt ${lan}: một vết huỷ`).toBe(1);
        // Hoặc tay huỷ trước (rồi dừng học thấy 0 phiếu mở), hoặc dừng học trước (rồi tay thấy phiếu đã huỷ).
        if (tay.ok) expect(dung.ok && dung.soPhieuTheDaHuy, `lượt ${lan}: tay đã huỷ ⇒ dừng học không còn gì để huỷ`).toBe(0);
        else expect(dung.ok && dung.soPhieuTheDaHuy, `lượt ${lan}: dừng học huỷ ⇒ tay bị từ chối`).toBe(1);
      }
    });

    it("[HN6-DH-07d] ĐỌC LẠI DƯỚI KHOÁ ĐƠN: dừng học bị chặn ở khoá; trong lúc chờ có kẻ khác ĐÓNG phiếu thẻ (HET_HAN) ⇒ dừng học thấy sự thật MỚI, không huỷ phiếu đã đóng, không ném", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const giu = await giuKhoaDon(DON, async (tx) => {
        await tx.posPaymentIntent.update({ where: { id: p.intentId }, data: { status: "HET_HAN" } });
      });
      const dangChay = dungHoc();
      // `finally`: dù khẳng định dưới đỏ, khoá PHẢI nhả — không thì transaction giữ khoá treo ca đứng sau (luật 18).
      let biChan: boolean;
      try {
        biChan = await choCoNguoiChoKhoa(dangChay);
      } finally {
        await giu.nha();
      }
      expect(biChan, "dừng học BỊ CHẶN ở khoá đơn (chờ nó nhả)").toBe(true);
      const kq = await dangChay;
      expect(kq.ok, `dừng học phải thành công: ${!kq.ok ? kq.error : ""}`).toBe(true);
      expect(kq.ok && kq.soPhieuTheDaHuy, "phiếu thẻ đã HET_HAN trong lúc chờ ⇒ không còn phiếu mở").toBe(0);
      expect((await phieuPos(p.intentId)).status, "HET_HAN giữ nguyên, không bị ghi đè thành HUY").toBe("HET_HAN");
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
      expect(await soVetHuy()).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-08] LỖI GIỮA CHỪNG ⇒ CUỘN NGƯỢC TOÀN BỘ (tất cả hoặc không gì)", () => {
    it("[HN6-DH-08a] bước đổi trạng thái phiếu gộp NÉM sau khi phiếu thẻ đã HUY ⇒ dừng học thất bại và KHÔNG một dòng nào còn lại (phiếu thẻ vẫn CHO_QUET, phiếu gộp OPEN, đợt PENDING, bé ACTIVE, 0 vết)", async () => {
      await dungPhieuGopVaThe();
      const truoc = await chup();
      h.cay = async () => {
        throw new Error("cấy lỗi: nổ SAU khi đã huỷ phiếu thẻ và VOID đợt");
      };
      await expect(dungHoc()).rejects.toThrow(/cấy lỗi/);
      h.cay = null;
      expect(await chup(), "cuộn ngược sạch").toBe(truoc);
    });

    it("[HN6-DH-08b] bước đổi trạng thái phiếu gộp trả { ok:false } (bất khả dưới khoá, nhưng NẾU xảy ra) ⇒ dừng học KHÔNG trả thành công và KHÔNG commit nửa vời (luật rollback: sau phép ghi chỉ `throw`)", async () => {
      await dungPhieuGopVaThe();
      const truoc = await chup();
      const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
      h.cay = async () => ({ ok: false as const, error: "cấy lỗi: phiếu vừa đổi" });
      const kq = await dungHoc().catch((e: unknown) => e);
      h.cay = null;
      loi.mockRestore();
      // Hoặc `{ ok:false }` hoặc ném — nhưng TUYỆT ĐỐI không `{ ok:true }`; và DB y nguyên.
      expect(kq instanceof Error || (typeof kq === "object" && kq !== null && "ok" in kq && (kq as { ok: boolean }).ok === false), "không trả thành công").toBe(true);
      expect(await chup(), "cuộn ngược sạch — không đợt VOID, không phiếu thẻ HUY, không bé STOPPED").toBe(truoc);
    });

    it("[HN6-DH-08c] ĐỐI CHỨNG: cùng cảnh, KHÔNG cấy lỗi ⇒ thành công (chứng minh 08a/08b đỏ-vì-cấy chứ không đỏ-vì-fixture)", async () => {
      await dungPhieuGopVaThe();
      const kq = await dungHoc();
      expect(kq.ok).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-09] THÂN DÙNG CHUNG — 'đổi khoá' đi qua `dungHocTrongTx` nên cũng huỷ phiếu thẻ cùng phiếu gộp", () => {
    it("[HN6-DH-09] gọi `dungHocTrongTx` với `ketThucGhiDanh:false` (đúng cách đổi khoá gọi) ⇒ phiếu thẻ HUY cùng phiếu gộp VOID", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const kq = await ghiTienChoDon(DON, (tx, so) =>
        dungHocTrongTx(tx, so, {
          orderId: DON,
          orderItemId: A,
          lyDo: "PH_CHU_DONG",
          buoiCuoiId: null,
          ghiChu: null,
          phanDu: [],
          actor: ACTOR,
          now: NOW_DUNG,
          ketThucGhiDanh: false,
        }),
      );
      expect(kq.ok, `${!kq.ok ? kq.error : ""}`).toBe(true);
      expect(kq.ok && kq.soPhieuTheDaHuy).toBe(1);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      expect((await phieuGopDb(g.billId)).status).toBe("VOID");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-DH-10] XEM TRƯỚC nói đúng điều máy chủ sắp làm (luật 12)", () => {
    const xem = () => xemTruocDungHoc({ orderId: DON, orderItemId: A, lyDo: "PH_CHU_DONG", now: NOW_DUNG });

    it("[HN6-DH-10] có phiếu thẻ MỞ ⇒ `phieuGop.soPhieuTheMo = 1`; chưa mở thẻ ⇒ 0; phiếu thẻ đã HUY/HET_HAN/CAN_XU_LY không tính; phiếu gộp không chứa bé ⇒ `phieuGop = null`", async () => {
      const x0 = await xem();
      expect(x0.ok && x0.data.phieuGop, "chưa có phiếu gộp").toBeNull();

      const g = await phatPhieu(DON, [DOT_A, DOT_B]);
      const x1 = await xem();
      expect(x1.ok && x1.data.phieuGop?.soPhieuTheMo, "có phiếu gộp, chưa mở thẻ").toBe(0);

      const p = await moPhieu(DON, DOT_A, NOW);
      const x2 = await xem();
      expect(x2.ok && x2.data.phieuGop?.soPhieuTheMo, "thẻ đang chờ quẹt").toBe(1);
      expect(x2.ok && x2.data.phieuGop?.ma).toBe(g.ma);

      // Cùng câu hỏi với đường ghi: sau khi dừng học thật, đúng 1 phiếu bị huỷ (xem trước không nói dối).
      const kq = await dungHoc();
      expect(kq.ok && kq.soPhieuTheDaHuy, "xem trước = đường ghi").toBe(x2.ok ? x2.data.phieuGop?.soPhieuTheMo : -1);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
    });

    it("[HN6-DH-10b] phiếu thẻ HUY (đã huỷ tay) không tính là 'mở' trong bản xem trước", async () => {
      await dungPhieuGopVaThe();
      const p = (await db.posPaymentIntent.findFirstOrThrow({ where: { paymentBill: { orderId: DON } } })).id;
      await db.posPaymentIntent.update({ where: { id: p }, data: { status: "HUY" } });
      const x = await xem();
      expect(x.ok && x.data.phieuGop?.soPhieuTheMo).toBe(0);
    });

    it("[HN6-DH-10c] XEM TRƯỚC đếm ĐÚNG thứ đường ghi SẼ huỷ: phiếu thẻ MỞ nhưng còn yêu cầu SỐNG (dữ liệu vi phạm bất biến — 05c) KHÔNG được đếm, vì đường ghi để nguyên nó; đối chứng: phiếu MỞ sạch vẫn đếm", async () => {
      const { p } = await dungPhieuGopVaThe();
      const sach = await xem();
      expect(sach.ok && sach.data.phieuGop?.soPhieuTheMo, "đối chứng: phiếu MỞ sạch ⇒ đếm 1").toBe(1);
      await chenYeuCauSongTrenPhieuMo(p.intentId);
      const x = await xem();
      expect(x.ok && x.data.phieuGop?.soPhieuTheMo, "phiếu mang yêu cầu sống ⇒ không đếm (đường ghi bỏ qua)").toBe(0);
      // Xem trước = đường ghi: dừng học thật huỷ ĐÚNG số phiếu mà xem trước đã nói.
      const kq = await dungHoc();
      expect(kq.ok && kq.soPhieuTheDaHuy).toBe(0);
      expect((await phieuPos(p.intentId)).status, "phiếu mang yêu cầu sống GIỮ NGUYÊN").toBe("CHO_QUET");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VIỆC 6 (chốt, rà đối kháng): sau khi dừng học huỷ kèm phiếu thẻ, MÀN ĐƠN của sale phải còn báo khi có giao dịch quẹt theo mã cũ nằm hàng chờ tay — đo bằng chính đường mà trang đơn đọc
  // (`docPhieuPosTho` + `docPhieuGopDangMo` → `dungPhieuPosChoDon`), không dựng tay view.
  describe("[HN6-DH-12] MÀN CỦA SALE sau dừng học: giao dịch quẹt theo mã cũ ⇒ hộp báo 'ĐỪNG cho khách quẹt lại'", () => {
    const manDon = async () => dungPhieuPosChoDon({ ds: await docPhieuPosTho(DON), phieuMo: await docPhieuGopDangMo(DON), now: sau(NOW_DUNG, 5 * PHUT) });

    it("[HN6-DH-12a] file về SAU dừng học (đúng mã cũ, đúng số) ⇒ X UNMATCHED + màn đơn có hộp với câu CHỜ KẾ TOÁN (choKeToan, tông cảnh báo); ĐỐI CHỨNG: TRƯỚC khi file về màn không có hộp; SAU khi kế toán xử lý (IGNORED) hộp biến mất", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      expect((await dungHoc()).ok, "fixture: dừng học thành công").toBe(true);
      expect((await phieuPos(p.intentId)).status, "fixture: phiếu thẻ đã HUY").toBe("HUY");
      expect(await manDon(), "ĐỐI CHỨNG: chưa có giao dịch nào về ⇒ phiếu HUY trên phiếu gộp đã đóng không lên màn").toBeNull();

      const m = maGd();
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, soTien: TONG })]);
      const bt = await btThe(m);
      expect(bt?.status, "fixture: giao dịch nằm hàng chờ tay").toBe("UNMATCHED");

      const view = await manDon();
      expect(view, "có hộp báo cho sale").not.toBeNull();
      expect(view?.intentId).toBe(p.intentId);
      expect(view?.hienThi).toBe("HUY");
      expect(view?.choKeToan).toBe(true);
      expect(view?.mucDo).toBe("canh_bao");
      expect(view?.thongDiep).toBe(CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN);

      // Kế toán xử lý xong (bỏ qua) ⇒ cờ tắt ⇒ cảnh báo tự hết, không "vĩnh viễn".
      await db.bankTransaction.update({ where: { id: bt!.id }, data: { status: "IGNORED" } });
      expect(await manDon(), "xử lý xong ⇒ hộp biến mất").toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  describe("[HN6-DH-13] BÁO NGƯỜI TẠO PHIẾU THẺ khi dừng học huỷ kèm (thông báo SAU commit)", () => {
    const baoCho = (userId: string, intentId: string) =>
      db.staffNotification.findMany({ where: { userId, dedupeKey: `pos.the-huy-cung:${intentId}` } });

    it("[HN6-DH-13a] quản lý (KHÔNG phải người tạo phiếu) bấm dừng học ⇒ người tạo phiếu thẻ nhận ĐÚNG MỘT thông báo trỏ trang đơn, có mã phiếu và lệnh 'ĐỪNG cho khách quẹt'; người bấm không tự nhận", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const kq = await dungHoc({ actor: A_KT });
      expect(kq.ok, `dừng học bởi người khác: ${!kq.ok ? kq.error : ""}`).toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      const bao = await baoCho(SALE, p.intentId);
      expect(bao, "người tạo phiếu được báo").toHaveLength(1);
      expect(bao[0]!.href).toBe(`/orders/${DON}`);
      expect(bao[0]!.body).toContain(g.ma);
      expect(bao[0]!.body).toMatch(/ĐỪNG cho khách quẹt/);
      expect(await baoCho(KT, p.intentId), "người bấm không tự nhận").toHaveLength(0);
    });

    it("[HN6-DH-13b] ĐỐI CHỨNG DƯƠNG — chính người tạo phiếu bấm dừng học ⇒ KHÔNG báo họ (họ vừa thấy hộp xác nhận)", async () => {
      const { p } = await dungPhieuGopVaThe();
      expect((await dungHoc()).ok).toBe(true);
      expect((await phieuPos(p.intentId)).status).toBe("HUY");
      expect(await baoCho(SALE, p.intentId)).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  describe("[HN6-DH-11] đường HUỶ PHIẾU GỘP BẰNG TAY không đổi (đối chứng)", () => {
    it("[HN6-DH-11] 'Huỷ phiếu' (huyPhieuGop) khi thẻ ĐANG CHỜ vẫn bị từ chối đúng câu — luật 7 của Việc 1 không đổi; chỉ DỪNG HỌC (quyết toán do hệ thống) mới huỷ kèm thẻ", async () => {
      const { g, p } = await dungPhieuGopVaThe();
      const truoc = await chup();
      const r = await huyPhieuGop({ orderId: DON, billId: g.billId, lyDo: "", actor: ACTOR, now: sau(NOW, 41 * PHUT) });
      expect(r).toEqual({ ok: false, error: "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước" });
      expect(await chup(), "từ chối ⇒ không ghi gì").toBe(truoc);
      expect((await phieuPos(p.intentId)).status).toBe("CHO_QUET");
    });
  });
});
