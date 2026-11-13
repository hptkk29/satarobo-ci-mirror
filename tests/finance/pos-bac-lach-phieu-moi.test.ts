// tests/finance/pos-bac-lach-phieu-moi.test.ts — VIỆC 5: GIAO DỊCH KẾ TOÁN ĐÃ BÁC KHÔNG ĐƯỢC LÁCH QUA PHIẾU THẺ MỚI. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-huy-sai-ma.test.ts` / `pos-hai-nut-sai-ma.test.ts`).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §8. Mọi ca đi qua ĐÚNG cửa đời thật: phiếu mở bằng `moPhieuPos`, giao dịch gõ sai bằng `nhapLoPos` (file),
// "Chưa thấy" bằng `xuLyKetQuaPos` NOT_FOUND, yêu cầu bằng `guiSaiMa` / `tuChoiSaiMa`, huỷ phiếu thẻ bằng `huyPhieuThe`, huỷ phiếu gộp bằng `huyPhieuGop`,
// hết hạn bằng `moPhieuPos` (thay inline) hoặc `chayPollerPos`. CHỈ MỘT chỗ chèn thẳng bảng: `[HN5-DB-08b]` giả lập vết bác đến GIỮA lúc xem trước và lúc gửi.
// (VIỆC 6 · a2: `[HN5-DB-03]` từng giả lập cổng huỷ của Việc 4 BỊ HỎNG vì đường thật chặn huỷ sau khi bị bác; cổng ấy đã bỏ nên ca nay đi đường thật, không giả lập.)
//
// ── LỖ ĐÃ ĐO (agent A, lượt ghép Việc 3×4) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// "Giao dịch X đã bị kế toán BÁC" của Việc 3 khoá theo (PHIẾU THẺ, giao dịch): dòng `TU_CHOI` + `@@unique([intentId, bankTransactionId])` +
// `locUngVien` + `soLanBiBac`. Phiếu thẻ chỉ sống 24 giờ và THAY ĐƯỢC (hết hạn · huỷ · phiếu gộp đổi mã) trong khi ĐƠN và mã sống tiếp ⇒ phiếu thẻ MỚI
// "chưa từng bị bác": X quẹt trong 5 phút cuối đời phiếu cũ, kế toán bác, phiếu cũ hết hạn, "Thẻ POS" mở phiếu mới dùng lại cùng mã ⇒ X lại là ứng viên
// DUY NHẤT ghi chú rỗng ⇒ TỰ GHI NHẬN: tiền vào đơn KHÔNG qua kế toán, đúng giao dịch kế toán vừa nói "không phải của khách này".
//
// ── LUẬT SAU VÁ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Bộ nhớ "đã bị bác" khoá theo (ĐƠN, giao dịch): mọi phiếu thẻ của MỌI phiếu gộp của CÙNG đơn đều thấy dòng `TU_CHOI` của nhau. Ca phân định phạm vi ĐƠN với
// phạm vi PHIẾU GỘP là `[HN5-DB-05]` (huỷ phiếu gộp + phát lại mã MỚI: phiếu gộp đổi, đơn vẫn một). Đơn KHÁC không bị ảnh hưởng (`[HN5-DB-06]`).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm có `now` đều được truyền mốc tuyệt đối. Ca "bị chặn" luôn kèm ẢNH CHỤP trước/sau (`chup`) và ĐỐI CHỨNG DƯƠNG
// (cùng cảnh, KHÔNG có vết bác ⇒ TỰ GHI NHẬN — chứng minh chính cảnh đó là lỗ, không phải cảnh tự chặn).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { huyPhieuGop, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { FakePosProvider } from "@/lib/payments/pos/provider/fake";
import { chayPollerPos } from "@/lib/payments/pos/poller";
import { docPhieuPosTho, docPhieuPosView, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { xuLyKetQuaPos } from "@/lib/payments/pos/xu-ly-ket-qua";
import { laCauChuaThay } from "@/lib/payments/pos/thong-diep-pos";
import { timUngVienSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { CAU_KHONG_UNG_VIEN, cauKhongUngVien } from "@/lib/payments/pos/sai-ma";
import { guiSaiMa, tuChoiSaiMa } from "@/lib/payments/pos/sai-ma-ghi";
import { huyPhieuThe } from "@/lib/payments/pos/huy-phieu-the-db";
import type { KetQuaHuyPhieuThe } from "@/lib/payments/pos/huy-phieu-the";

// Mỗi ca chạy cảnh HAI LẦN (có vết bác · đối chứng không vết bác), mỗi lần ~15 lượt DB — nới trần để một máy bận không làm đỏ ca và làm hỏng ca đứng sau
// (vitest không huỷ được promise đang chạy — luật 18).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

if (!RUN_DB_TESTS) console.warn(`[HN5-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos5bl-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS5BL";

const KT = `${T}kt`; // Kế toán — người quyết yêu cầu + người nhập file
const SALE = `${T}sale`; // người lập đơn + mở phiếu + gửi yêu cầu + bấm huỷ
const CS1 = `${T}cs1`;
const DON = `${T}don`; // hai bé, hai đợt
const DON_PHU = `${T}don-phu`; // đơn KHÁC cùng cơ sở, cùng số tiền với DOT_A — đối chứng chéo đơn
const A = `${T}item-a`;
const B = `${T}item-b`;
const D = `${T}item-d`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const DOT_D = `${T}dot-d`;
const MAY1 = `${PFX}MAY01`; // máy DUY NHẤT của CS1 ⇒ `moPhieuPos` tự chọn
const SDT_PH = "0399812366";
const EMAIL_PH = "ph.fx.pos5bl@test.local";
const ACTOR = { id: SALE, name: "Sale fixture HN5" };
const A_KT = { id: KT, name: "Kế toán fixture HN5" };
const NGUOI = [KT, SALE];
const DON_CUA_TEST = [DON, DON_PHU];

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B;

const GIAY = 1_000;
const PHUT = 60 * GIAY;
const z = (iso: string) => new Date(iso);
const sau = (moc: Date, ms: number) => new Date(moc.getTime() + ms);

/** Lúc mở phiếu thẻ P1 (hết hạn 24 giờ sau = 2026-10-07T10:00:00Z). */
const NOW = z("2026-10-06T10:00:00Z");

/** Hai lịch giờ. `CUOI_DOI` = X quẹt trong 2 phút CUỐI đời P1 (đường hết hạn). `GIUA_DOI` = lịch của `[HN4-DB-13e]` (đường huỷ — P1 còn xa hạn). */
type Lich = {
  gioKhac: string;
  gioX: string;
  chuaThay1: Date;
  gui1: Date;
  bac1: Date;
};
const CUOI_DOI: Lich = {
  gioKhac: "2026-10-06T17:20:00+07:00", // 10:20Z — khách KHÁC, quẹt sớm: ngoài cửa sổ của phiếu mới
  gioX: "2026-10-07T16:58:00+07:00", // 09:58:00Z — 2 phút trước hạn của P1
  chuaThay1: z("2026-10-07T09:59:00Z"),
  gui1: z("2026-10-07T09:59:10Z"),
  bac1: z("2026-10-07T09:59:30Z"),
};
const GIUA_DOI: Lich = {
  gioKhac: "2026-10-06T17:20:00+07:00", // 10:20Z
  gioX: "2026-10-06T17:38:00+07:00", // 10:38Z
  chuaThay1: z("2026-10-06T10:40:00Z"),
  gui1: z("2026-10-06T10:41:00Z"),
  bac1: z("2026-10-06T10:42:00Z"),
};

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
let soRrn = 0;
/** Mỗi dòng một RRN riêng: RRN trùng giữa dòng thanh toán và dòng hủy là một luật loại ứng viên khác (không phải thứ bộ này đo). */
const rrn = () => String(112233445000 + ++soRrn);

/** Quản trị tối cao: thấy MỌI cơ sở — các ca ở đây KHÔNG đo phạm vi cơ sở (đã có `pos-hai-nut-sai-ma` / `pos-da-vai-co-so`). */
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

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { providerTxnId: { startsWith: PFX } };

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
  await db.emailLog.deleteMany({ where: { OR: [{ contextType: "Order", contextId: { in: DON_CUA_TEST } }, { toEmail: EMAIL_PH }] } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { actorId: { in: NGUOI } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.posTxnSource.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: DON_CUA_TEST } } } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: DON_CUA_TEST } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.creditBalance.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.payment.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.bankTransaction.deleteMany({ where: LOC_BT });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.order.deleteMany({ where: { id: { in: DON_CUA_TEST } } });
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
  await db.center.create({ data: { id: CS1, name: "CS1 fixture POS5BL", slug: CS1, address: "211 Nguyễn Hữu Thọ" } });
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });

  const taoDon = (id: string, code: string, tong: number) =>
    db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture HN5",
        customerPhone: SDT_PH,
        customerEmail: EMAIL_PH,
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
  await taoDon(DON, "ORD-269985-000601", TONG);
  await taoDong(DON, A, DOT_A, "Bé A HN5", DOT_TIEN_A, 1);
  await taoDong(DON, B, DOT_B, "Bé B HN5", DOT_TIEN_B, 2);
  await taoDon(DON_PHU, "ORD-269985-000602", DOT_TIEN_A);
  await taoDong(DON_PHU, D, DOT_D, "Bé D HN5", DOT_TIEN_A, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** Nút "Xuất QR" của một dòng: phát phiếu gộp cho các đợt. */
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

const phieuPos = (id: string) => db.posPaymentIntent.findUniqueOrThrow({ where: { id } });
const phieuGopDb = (id: string) => db.paymentBill.findUniqueOrThrow({ where: { id } });

function dong(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: DOT_TIEN_A,
    thoiGian: "2026-10-06T17:31:35+07:00",
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

/** Sale bấm Kiểm tra ⇒ "Chưa thấy giao dịch" (kết quả NOT_FOUND vào ĐÚNG đường `xuLyKetQuaPos`; poller cũng đi đường này). */
async function chuaThay(intentId: string, now: Date) {
  const kq = await xuLyKetQuaPos({ intentId, ketQua: { kind: "NOT_FOUND" } satisfies PosCheckResult, triggeredBy: "SALE", now, nguonDuLieu: "FAKE" });
  expect(laCauChuaThay(kq.thongDiep), `phải ra câu 'Chưa thấy': ${kq.thongDiep}`).toBe(true);
  return kq;
}

const guiCho = (orderId: string, intentId: string, bankTransactionId: string, now: Date) =>
  guiSaiMa({ orderId, intentId, bankTransactionId, actor: ACTOR, now });

const yeuCauCua = (intentId: string) => db.posSaiMaYeuCau.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } });
const soTuChoi = (orderId = DON) => db.posSaiMaYeuCau.count({ where: { trangThai: "TU_CHOI", intent: { paymentBill: { orderId } } } });
const soYeuCau = (orderId = DON) => db.posSaiMaYeuCau.count({ where: { intent: { paymentBill: { orderId } } } });
const soPayment = (orderId = DON) => db.payment.count({ where: { orderId } });

/** Bấm "Huỷ phiếu thẻ" — chính hàm `huyPhieuTheAction` gọi (có tick, lý do "mở nhầm"). */
function huy(intentId: string, now: Date): Promise<KetQuaHuyPhieuThe> {
  return huyPhieuThe({ orderId: DON, intentId, lyDo: "MO_NHAM", xacNhanKhachChuaQuet: true, actor: ACTOR, now });
}

/**
 * Ảnh chụp MỌI thứ một lượt gửi / từ chối có thể đổi. `updatedAt` nằm trong hàng ⇒ một phép ghi vô hình cũng làm nó lệch; AuditLog, thông báo, sự kiện đếm số dòng.
 * Hai ảnh bằng nhau ⇒ lượt kia KHÔNG ghi gì.
 */
async function chup(orderIds: string[] = DON_CUA_TEST): Promise<string> {
  const co = { orderId: { in: orderIds } };
  const [bills, lines, dots, intents, pays, allocs, bts, poss, yc, orders, audit, thongBao, suKien, nhatKy] = await Promise.all([
    db.paymentBill.findMany({ where: co, orderBy: { id: "asc" } }),
    db.paymentBillLine.findMany({ where: { bill: co }, orderBy: { id: "asc" } }),
    db.paymentRequest.findMany({ where: co, orderBy: { id: "asc" } }),
    db.posPaymentIntent.findMany({ where: { paymentBill: co }, orderBy: { id: "asc" } }),
    db.payment.findMany({ where: co, orderBy: { id: "asc" } }),
    db.paymentAllocation.findMany({ where: { paymentRequest: co }, orderBy: { id: "asc" } }),
    db.bankTransaction.findMany({ where: LOC_BT, orderBy: { id: "asc" } }),
    db.posCardTransaction.findMany({ where: { maGiaoDich: { startsWith: PFX } }, orderBy: { id: "asc" } }),
    db.posSaiMaYeuCau.findMany({ where: { intent: { paymentBill: co } }, orderBy: { id: "asc" } }),
    db.order.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: { in: orderIds } } }),
    db.staffNotification.count({ where: { userId: { in: NGUOI } } }),
    db.domainEvent.count({ where: { type: "phieu-gop.da-chia" } }),
    db.posCheckLog.count({ where: { intent: { paymentBill: co } } }),
  ]);
  return JSON.stringify({ bills, lines, dots, intents, pays, allocs, bts, poss, yc, orders, audit, thongBao, suKien, nhatKy });
}

/**
 * Chèn THẲNG một dòng yêu cầu `TU_CHOI` (bỏ qua `guiSaiMa` / `tuChoiSaiMa`) — CHỈ cho `[HN5-DB-08b]`, nơi dựng "vết bác đến giữa lúc xem trước và lúc gửi".
 * Đường thật không dựng được cảnh đó (phiếu cũ còn `CAN_XU_LY` giữ X thì phiếu mới không mở được — T21), nên đây là GIẢ LẬP, ghi rõ ở ca.
 * Hợp lệ với cả năm CHECK + hai UNIQUE từng phần của migration `20261010090000_pos_sai_ma_yeu_cau`.
 */
async function chenTuChoi(o: { intentId: string; bankTransactionId: string; createdAt: Date }) {
  return db.posSaiMaYeuCau.create({
    data: {
      intentId: o.intentId,
      bankTransactionId: o.bankTransactionId,
      centerId: CS1,
      kieu: "CHO_KE_TOAN",
      trangThai: "TU_CHOI",
      lyDo: "NHIEU_UNG_VIEN",
      nguoiGuiId: SALE,
      createdAt: o.createdAt,
      nguoiQuyetId: KT,
      quyetLuc: sau(o.createdAt, PHUT),
      lyDoTuChoi: "Không phải giao dịch của khách",
    },
  });
}

/** Dữ liệu MỚI hơn phiếu mới (một giao dịch khác số tiền) ⇒ `duLieuThieu = false` — nếu thiếu, X lọt vào phiếu mới cũng chỉ ra CHO_KE_TOAN và lỗ bị che. */
async function nhapDuLieuMoi(gioIso: string) {
  await nhapFile([dong({ maGiaoDich: maGd(), soTien: 999_000, thoiGian: gioIso })]);
}

type Canh = {
  g: Awaited<ReturnType<typeof phatPhieu>>;
  p1: Awaited<ReturnType<typeof moPhieu>>;
  mX: string;
  mKhac: string;
  btX: string;
  btKhac: string;
  /** Giao dịch Z (chỉ khi truyền `coZ`): quẹt SAU lúc gửi X nên P1 không thấy, nhưng phiếu mới thấy. */
  btZ: string | null;
  bac: boolean;
};

/**
 * CẢNH GỐC — đúng hình dạng của lỗ:
 *   · phiếu gộp (mã M) + phiếu thẻ P1 mở lúc `NOW` + "Chưa thấy giao dịch";
 *   · file có HAI giao dịch cùng số phải thu, ghi chú RỖNG: `khac` (khách khác, quẹt sớm — ngoài cửa sổ của phiếu mới) và X (quẹt gần cuối đời P1);
 *   · `bac = true` ⇒ sale gửi X cho P1 (hai ứng viên ⇒ chờ kế toán) rồi kế toán BÁC X ⇒ P1 về `CHO_QUET`, X vẫn UNMATCHED.
 * `bac = false` ⇒ CÙNG cảnh nhưng KHÔNG có yêu cầu nào (đối chứng dương: chỉ khác đúng một yếu tố — vết bác).
 */
async function canhGoc(lich: Lich, o: { bac: boolean; coZ?: string }): Promise<Canh> {
  const g = await phatPhieu(DON, [DOT_A]);
  const p1 = await moPhieu(DON, DOT_A, NOW);
  expect(p1.code5, "phiếu thẻ dùng ĐÚNG mã của phiếu gộp").toBe(g.ma);
  await chuaThay(p1.intentId, lich.chuaThay1);
  const mKhac = maGd();
  const mX = maGd();
  const mZ = o.coZ ? maGd() : null;
  await nhapFile([
    dong({ maGiaoDich: mKhac, soTien: g.tongTien, thoiGian: lich.gioKhac }),
    dong({ maGiaoDich: mX, soTien: g.tongTien, thoiGian: lich.gioX }),
    ...(mZ && o.coZ ? [dong({ maGiaoDich: mZ, soTien: g.tongTien, thoiGian: o.coZ })] : []),
  ]);
  const btX = await btId(mX);
  const btKhac = await btId(mKhac);
  const btZ = mZ ? await btId(mZ) : null;
  if (o.bac) {
    const kq = await guiCho(DON, p1.intentId, btX, lich.gui1);
    expect(kq, "hai ứng viên ⇒ gửi kế toán").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
    const yc = (await yeuCauCua(p1.intentId))[0]!;
    const tc = await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: lich.bac1 });
    expect(tc, "kế toán bác X").toMatchObject({ ok: true, trangThai: "TU_CHOI" });
    expect((await phieuPos(p1.intentId)).status, "bác ⇒ P1 về CHO_QUET (MỞ)").toBe("CHO_QUET");
    expect((await btThe(mX))?.status, "X vẫn nằm hàng chờ").toBe("UNMATCHED");
    expect(await soTuChoi(), "đúng MỘT vết bác trong đơn").toBe(1);
  }
  return { g, p1, mX, mKhac, btX, btKhac, btZ, bac: o.bac };
}

/** Phiếu thẻ MỚI do một đường thay phiếu cũ tạo ra. `moLuc` = `createdAt` của nó. */
type PhieuMoi = { intentId: string; code5: string; moLuc: Date };

/**
 * Chạy MỘT đường thay-phiếu-thẻ hai lần — CÓ vết bác rồi ĐỐI CHỨNG (cùng đường, KHÔNG vết bác) — và đòi:
 *   · có vết bác ⇒ X KHÔNG còn là ứng viên của phiếu mới (màn), gửi thẳng cho phiếu mới bị TỪ CHỐI ở máy chủ, 0 dòng đổi, 0 Payment, X vẫn UNMATCHED;
 *   · không vết bác ⇒ cùng đường, X là ứng viên DUY NHẤT ghi chú rỗng ⇒ TỰ GHI NHẬN, đúng 1 Payment (chứng minh cảnh là LỖ, không phải cảnh tự chặn).
 * Khẳng định phần "có vết bác" dùng `expect.soft` để CẢ BA khẳng định cùng hiện trên mã chưa vá (dòng đỏ đầy đủ); đối chứng dùng `expect` cứng.
 */
async function chayDuong(ten: string, lich: Lich, tao: (c: Canh) => Promise<PhieuMoi>) {
  // ── (1) CÓ vết bác ──
  const c = await canhGoc(lich, { bac: true });
  const moi = await tao(c);
  expect(moi.intentId, `${ten}: phiếu thẻ MỚI`).not.toBe(c.p1.intentId);
  // X phải NẰM TRONG cửa sổ [mở phiếu mới − 5′, nay] — nếu không, "không là ứng viên" là do cửa sổ chứ không do vết bác (và ca xanh vì lý do sai).
  const x = (await btThe(c.mX))!.posCardTransaction!;
  expect(x.thoiGianGiaoDich.getTime(), `${ten}: X quẹt TRONG cửa sổ 5′ của phiếu mới`).toBeGreaterThanOrEqual(moi.moLuc.getTime() - 5 * PHUT);
  expect(x.thoiGianGiaoDich.getTime(), `${ten}: …và trước lúc mở phiếu mới`).toBeLessThanOrEqual(moi.moLuc.getTime());
  await chuaThay(moi.intentId, sau(moi.moLuc, 20 * GIAY));

  const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: moi.intentId, now: sau(moi.moLuc, 25 * GIAY) });
  expect.soft(tim.ok, `${ten}: bước tìm chạy được`).toBe(true);
  expect.soft(tim.ok && tim.ungVien.map((u) => u.bankTransactionId), `${ten}: X ĐÃ BỊ BÁC không còn là ứng viên của phiếu mới`).toEqual([]);

  const truoc = await chup();
  const kq = await guiCho(DON, moi.intentId, c.btX, sau(moi.moLuc, 30 * GIAY));
  expect.soft(kq.ok, `${ten}: gửi X cho phiếu mới phải bị TỪ CHỐI — nhận ${JSON.stringify(kq)}`).toBe(false);
  expect.soft(await chup(), `${ten}: bị từ chối ⇒ KHÔNG đổi một dòng nào`).toBe(truoc);
  expect.soft(await soPayment(), `${ten}: tiền vào đơn KHÔNG qua kế toán`).toBe(0);
  expect.soft((await btThe(c.mX))?.status, `${ten}: X vẫn nằm hàng chờ`).toBe("UNMATCHED");
  expect.soft(await soTuChoi(), `${ten}: vết bác còn nguyên`).toBe(1);

  // ── (2) ĐỐI CHỨNG DƯƠNG: cùng đường, KHÔNG vết bác ──
  await dungFixture();
  const s = await canhGoc(lich, { bac: false });
  const moiS = await tao(s);
  expect(moiS.intentId, `${ten} (đối chứng): phiếu thẻ MỚI`).not.toBe(s.p1.intentId);
  await chuaThay(moiS.intentId, sau(moiS.moLuc, 20 * GIAY));
  const timS = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: moiS.intentId, now: sau(moiS.moLuc, 25 * GIAY) });
  expect(timS.ok && timS.ungVien.map((u) => u.bankTransactionId), `${ten} (đối chứng): chưa bị bác ⇒ X là ứng viên DUY NHẤT`).toEqual([s.btX]);
  expect(timS.ok && timS.ungVien[0]?.xemTruoc, `${ten} (đối chứng): …ghi chú rỗng, đủ dữ liệu ⇒ tự ghi nhận`).toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
  const kqS = await guiCho(DON, moiS.intentId, s.btX, sau(moiS.moLuc, 30 * GIAY));
  expect(kqS, `${ten} (đối chứng)`).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
  expect(await soPayment(), `${ten} (đối chứng): tiền ghi ĐÚNG một lần`).toBe(1);
}

// ═════════════════════════════════════════════════════════════════════════════
// CÁC CA
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!RUN_DB_TESTS)("[HN5-DB] giao dịch kế toán đã BÁC không lách được qua phiếu thẻ MỚI — bảng THẬT", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-01..04] mọi đường làm đổi PHIẾU THẺ mà phiếu gộp / đơn sống tiếp", () => {
    it("[HN5-DB-01] HẾT HẠN rồi 'Thẻ POS' mở phiếu mới DÙNG LẠI mã (đường probe của agent A): X quẹt ≤ 5′ cuối đời P1, bị bác ⇒ phiếu mới KHÔNG nhận X", async () => {
      await chayDuong("hết hạn · thay inline", CUOI_DOI, async (c) => {
        const moLuc = z("2026-10-07T10:00:10Z"); // 10 giây sau hạn của P1
        await nhapDuLieuMoi("2026-10-07T17:00:20+07:00"); // 10:00:20Z — mới hơn phiếu mới ⇒ dữ liệu đủ
        const p2 = await moPhieu(DON, DOT_A, moLuc);
        expect(p2.code5, "dùng lại ĐÚNG mã (cùng phiếu gộp)").toBe(c.g.ma);
        expect((await phieuPos(c.p1.intentId)).status, "P1 bị thay inline").toBe("HET_HAN");
        return { intentId: p2.intentId, code5: p2.code5, moLuc };
      });
    });

    it("[HN5-DB-02] HẾT HẠN do POLLER ghi `HET_HAN` (không phải sale bấm) rồi mới 'Thẻ POS' mở phiếu mới ⇒ cùng kết cục", async () => {
      await chayDuong("hết hạn · poller", CUOI_DOI, async (c) => {
        const moLuc = z("2026-10-07T10:00:10Z");
        await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
        const kq = await chayPollerPos({ dongHo: () => z("2026-10-07T10:00:05Z"), provider: new FakePosProvider() });
        expect(kq.hetHan, "poller ghi HET_HAN cho P1").toBeGreaterThanOrEqual(1);
        expect((await phieuPos(c.p1.intentId)).status, "P1 do poller đóng — 'Thẻ POS' sau đó không phải thay gì").toBe("HET_HAN");
        const p2 = await moPhieu(DON, DOT_A, moLuc);
        expect(p2.code5).toBe(c.g.ma);
        return { intentId: p2.intentId, code5: p2.code5, moLuc };
      });
    });

    it("[HN5-DB-03] HUỶ TAY (Việc 4): sau khi bị bác sale HUỶ ĐƯỢC bằng đường THẬT (VIỆC 6 · a2: nút mở lại) ⇒ phiếu mới VẪN không nhận X — thứ giữ là bộ nhớ theo ĐƠN, không phải cổng huỷ", async () => {
      // Trước VIỆC 6 ca này khẳng định đường thật BỊ CHẶN (`SAI_MA_BI_TU_CHOI`) rồi GIẢ LẬP cổng huỷ hỏng bằng cách ép `HUY` tay để chứng minh bộ nhớ đứng một mình. Cổng riêng ấy đã bỏ
      // (chủ dự án chốt 10/10/2026), nên "cổng huỷ hỏng" chính là đường thật — ca đi thẳng bằng `huyPhieuThe`, không còn giả lập. Biến thể huỷ NGAY sau từ chối (câu lưu = câu từ chối)
      // nằm ở `pos-huy-sai-ma.test.ts` `[HN4-DB-13e]`; ca này là biến thể SAU KHI sale bấm Kiểm tra lại (câu lưu = 'Chưa thấy' trần).
      await chayDuong(
        "huỷ tay",
        GIUA_DOI,
        async (c) => {
          const moLuc = z("2026-10-06T10:42:30Z");
          await nhapDuLieuMoi("2026-10-06T17:42:40+07:00"); // 10:42:40Z
          // CÙNG đường cho cả hai lần chạy: có vết bác (c.bac) và đối chứng chưa bị bác — huỷ ĐƯỢC bằng đường thật.
          await chuaThay(c.p1.intentId, z("2026-10-06T10:42:10Z"));
          const r = await huy(c.p1.intentId, z("2026-10-06T10:42:20Z"));
          expect(r.ok, `huỷ được (${c.bac ? "SAU khi kế toán đã bác" : "đối chứng: chưa bị bác"}) — ${r.ok ? "" : r.error}`).toBe(true);
          expect((await phieuPos(c.p1.intentId)).status, "P1 đã HUY").toBe("HUY");
          const p2 = await moPhieu(DON, DOT_A, moLuc);
          expect(p2.code5, "mở lại dùng ĐÚNG mã").toBe(c.g.ma);
          return { intentId: p2.intentId, code5: p2.code5, moLuc };
        },
      );
    });

    it("[HN5-DB-04] hết hạn ⇒ phiếu mới P2 SẠCH (chưa từng bị bác) ⇒ sale HUỶ P2 (Việc 4 cho phép) ⇒ mở P3: vết bác của P1 vẫn đi theo ĐƠN", async () => {
      await chayDuong("hết hạn → huỷ P2 sạch → P3", CUOI_DOI, async (c) => {
        await nhapDuLieuMoi("2026-10-07T17:00:40+07:00"); // 10:00:40Z — mới hơn P3 (10:00:30Z)
        const p2 = await moPhieu(DON, DOT_A, z("2026-10-07T10:00:10Z"));
        expect(p2.code5).toBe(c.g.ma);
        await chuaThay(p2.intentId, z("2026-10-07T10:00:15Z"));
        const r = await huy(p2.intentId, z("2026-10-07T10:00:20Z"));
        expect(r.ok, `P2 chưa từng bị bác ⇒ Việc 4 cho huỷ — ${r.ok ? "" : r.error}`).toBe(true);
        const moLuc = z("2026-10-07T10:00:30Z");
        const p3 = await moPhieu(DON, DOT_A, moLuc);
        expect(p3.code5).toBe(c.g.ma);
        expect((await phieuPos(c.p1.intentId)).status).toBe("HET_HAN");
        expect((await phieuPos(p2.intentId)).status).toBe("HUY");
        return { intentId: p3.intentId, code5: p3.code5, moLuc };
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-05] CA PHÂN ĐỊNH PHẠM VI: phiếu GỘP đổi mã (huỷ + phát lại) — ĐƠN vẫn một", () => {
    it("[HN5-DB-05] hết hạn ⇒ huỷ phiếu gộp (được: thẻ đã quá hạn, 'Chưa thấy') ⇒ phát phiếu gộp MÃ MỚI ⇒ mở P3: X bị bác ở phiếu gộp CŨ vẫn không vào được — phạm vi PHIẾU GỘP để lọt ca này, phạm vi ĐƠN chặn", async () => {
      await chayDuong("đổi phiếu gộp", CUOI_DOI, async (c) => {
        await nhapDuLieuMoi("2026-10-07T17:00:20+07:00"); // 10:00:20Z
        const huyGop = await huyPhieuGop({ orderId: DON, billId: c.g.billId, lyDo: "", actor: ACTOR, now: z("2026-10-07T10:00:05Z") });
        expect(huyGop.ok, `huỷ phiếu gộp được sau khi thẻ quá hạn — ${huyGop.ok ? "" : huyGop.error}`).toBe(true);
        expect((await phieuGopDb(c.g.billId)).status, "phiếu gộp cũ VOID").toBe("VOID");
        const g2 = await phatPhieu(DON, [DOT_A]);
        expect(g2.billId, "phiếu gộp MỚI").not.toBe(c.g.billId);
        expect(g2.ma, "…mang MÃ MỚI").not.toBe(c.g.ma);
        const moLuc = z("2026-10-07T10:00:10Z");
        const p3 = await moPhieu(DON, DOT_A, moLuc);
        expect(p3.code5, "phiếu thẻ mới mang mã của phiếu gộp MỚI").toBe(g2.ma);
        expect((await phieuPos(c.p1.intentId)).status, "P1 bị 'Thẻ POS' của phiếu gộp mới đẩy sang HUY (phiếu gộp của nó không còn OPEN)").toBe("HUY");
        const bill3 = await db.posPaymentIntent.findUniqueOrThrow({ where: { id: p3.intentId }, select: { paymentBillId: true } });
        expect(bill3.paymentBillId, "P3 thuộc phiếu gộp MỚI, khác phiếu gộp của dòng TU_CHOI").not.toBe(c.g.billId);
        return { intentId: p3.intentId, code5: p3.code5, moLuc };
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-06] ĐỐI CHỨNG DƯƠNG CHÉO ĐƠN: bác ở đơn A KHÔNG cấm oan đơn B", () => {
    it("[HN5-DB-06] X bị bác ở DON (phiếu thẻ của DON đã HẾT HẠN — xem ghi chú dưới về phiếu còn hạn); phiếu thẻ của DON_PHU (cùng cơ sở, cùng máy, cùng số tiền) VẪN thấy X, KHÔNG dính `DA_BI_TU_CHOI_TRUOC`, TỰ GHI NHẬN vào DON_PHU; DON không có thêm đồng nào", async () => {
      const c = await canhGoc(CUOI_DOI, { bac: true });
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00"); // 10:00:20Z — mới hơn phiếu của DON_PHU
      // P1 của DON đã quá hạn (10:00:00Z) nhưng chưa ai ghi HET_HAN: `canhTranh` chỉ đếm phiếu CÒN HẠN ⇒ không tạo `CO_PHIEU_THE_CANH_TRANH` giả.
      // ⚠️ GIỚI HẠN ĐÃ BIẾT (rà đối kháng Việc 5, R-5f): đối chứng này đúng KHI phiếu thẻ của đơn đã bác X không còn mở/còn hạn. Nếu nó còn CHO_QUET còn hạn đúng số tiền thì
      // `canhTranh` (sai-ma-doc.ts) vẫn đếm nó là đối thủ nhận được X — dù từ Việc 5 nó không bao giờ nhận được X — nên đơn B ra `CO_PHIEU_THE_CANH_TRANH` ⇒ chờ kế toán
      // (hướng AN TOÀN, không cấm oan: B vẫn thấy X và gửi kế toán được). Không ca nào khoá điều đó; ghi ở docs §8.11.
      const g2 = await phatPhieu(DON_PHU, [DOT_D]);
      const moLuc = z("2026-10-07T10:00:10Z");
      const pb = await moPhieu(DON_PHU, DOT_D, moLuc);
      expect(pb.code5).toBe(g2.ma);
      await chuaThay(pb.intentId, sau(moLuc, 20 * GIAY));
      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON_PHU, intentId: pb.intentId, now: sau(moLuc, 25 * GIAY) });
      expect(tim.ok && tim.ungVien.map((u) => u.bankTransactionId), "đơn B vẫn thấy X").toEqual([c.btX]);
      const xt = tim.ok ? tim.ungVien[0]!.xemTruoc : null;
      expect(xt?.lyDo ?? [], "vết bác của đơn A KHÔNG lan sang đơn B (soLanBiBac đếm THEO ĐƠN)").not.toContain("DA_BI_TU_CHOI_TRUOC");
      expect(xt, "…và đơn B tự ghi nhận như luật cũ").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
      const kq = await guiSaiMa({ orderId: DON_PHU, intentId: pb.intentId, bankTransactionId: c.btX, actor: ACTOR, now: sau(moLuc, 30 * GIAY) });
      expect(kq).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(DON_PHU), "tiền vào ĐÚNG đơn B").toBe(1);
      expect(await soPayment(DON), "đơn A không có thêm đồng nào").toBe(0);
      expect((await btThe(c.mX))?.status).toBe("MATCHED");
      expect(await soTuChoi(DON), "vết bác của đơn A còn nguyên").toBe(1);
      expect(await soTuChoi(DON_PHU), "đơn B không có vết bác").toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-07] `soLanBiBac` đếm THEO ĐƠN: sau một lần bị bác, mọi đề nghị kế tiếp của đơn (kể cả trên phiếu thẻ MỚI) phải do kế toán xác nhận", () => {
    it("[HN5-DB-07] phiếu mới chỉ còn Z (X bị bác bị loại): Z là ứng viên duy nhất, ghi chú rỗng nhưng VẪN chờ kế toán (`DA_BI_TU_CHOI_TRUOC`); ĐỐI CHỨNG: chưa từng bị bác ⇒ tự ghi nhận", async () => {
      const gioZ = "2026-10-07T17:00:05+07:00"; // 10:00:05Z — SAU lúc gửi X (09:59:10Z) nên P1 không thấy; TRƯỚC phiếu mới (10:00:10Z) nên P2 thấy
      const c = await canhGoc(CUOI_DOI, { bac: true, coZ: gioZ });
      expect(c.btZ, "Z đã vào file").not.toBeNull();
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
      const moLuc = z("2026-10-07T10:00:10Z");
      const p2 = await moPhieu(DON, DOT_A, moLuc);
      expect(p2.code5).toBe(c.g.ma);
      await chuaThay(p2.intentId, sau(moLuc, 20 * GIAY));

      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: sau(moLuc, 25 * GIAY) });
      expect.soft(tim.ok && tim.ungVien.map((u) => u.bankTransactionId), "danh sách đúng bằng [Z]: X đã bị bác bị loại").toEqual([c.btZ]);
      expect.soft(tim.ok && tim.ungVien[0]?.xemTruoc, "một ứng viên, ghi chú rỗng — nhưng đơn đã có vết bác").toEqual({
        quyet: "CHO_KE_TOAN",
        lyDo: ["DA_BI_TU_CHOI_TRUOC"],
      });
      const kq = await guiCho(DON, p2.intentId, c.btZ!, sau(moLuc, 30 * GIAY));
      expect.soft(kq, "gửi Z ⇒ chờ kế toán, KHÔNG tự ghi nhận").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET", lyDo: ["DA_BI_TU_CHOI_TRUOC"] });
      expect.soft(await soPayment(), "không đi vòng quanh kế toán").toBe(0);

      // ĐỐI CHỨNG DƯƠNG: cùng cảnh nhưng đơn CHƯA từng bị bác (không có X) ⇒ Z là ứng viên duy nhất ⇒ tự ghi nhận.
      await dungFixture();
      const g = await phatPhieu(DON, [DOT_A]);
      const p1 = await moPhieu(DON, DOT_A, NOW);
      await chuaThay(p1.intentId, CUOI_DOI.chuaThay1);
      const mZ2 = maGd();
      await nhapFile([dong({ maGiaoDich: maGd(), soTien: g.tongTien, thoiGian: CUOI_DOI.gioKhac }), dong({ maGiaoDich: mZ2, soTien: g.tongTien, thoiGian: gioZ })]);
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
      const p2s = await moPhieu(DON, DOT_A, moLuc);
      await chuaThay(p2s.intentId, sau(moLuc, 20 * GIAY));
      const timS = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2s.intentId, now: sau(moLuc, 25 * GIAY) });
      expect(timS.ok && timS.ungVien.map((u) => u.bankTransactionId), "đối chứng: Z là ứng viên duy nhất").toEqual([await btId(mZ2)]);
      expect(timS.ok && timS.ungVien[0]?.xemTruoc, "đối chứng: chưa từng bị bác ⇒ tự ghi nhận").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-08] MÁY CHỦ TÍNH LẠI dưới khoá — xem trước ≠ quyết", () => {
    it("[HN5-DB-08a] client GIẢ id: gửi thẳng X cho phiếu thẻ mới (không qua bước tìm) bị từ chối; ảnh chụp trước = sau; 0 yêu cầu mới; 0 Payment", async () => {
      const c = await canhGoc(CUOI_DOI, { bac: true });
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
      const moLuc = z("2026-10-07T10:00:10Z");
      const p2 = await moPhieu(DON, DOT_A, moLuc);
      await chuaThay(p2.intentId, sau(moLuc, 20 * GIAY));
      const truoc = await chup();
      const soYcTruoc = await soYeuCau();
      const kq = await guiCho(DON, p2.intentId, c.btX, sau(moLuc, 30 * GIAY));
      expect.soft(kq.ok, `gửi thẳng X cho phiếu mới — nhận ${JSON.stringify(kq)}`).toBe(false);
      expect.soft(kq.ok ? null : kq.error, "có câu từ chối").toEqual(expect.any(String));
      expect.soft(await chup(), "cổng đứng TRƯỚC phép ghi đầu tiên: không đổi một dòng nào").toBe(truoc);
      expect.soft(await soYeuCau(), "không sinh thêm yêu cầu").toBe(soYcTruoc);
      expect.soft(await yeuCauCua(p2.intentId), "phiếu mới không có yêu cầu nào").toEqual([]);
      expect.soft(await soPayment()).toBe(0);
      expect.soft((await phieuPos(p2.intentId)).status, "phiếu mới KHÔNG bị kéo sang CAN_XU_LY").toBe("CHO_QUET");
    });

    it("[HN5-DB-08b] GIẢ LẬP vết bác đến GIỮA lúc xem trước và lúc gửi: xem trước còn thấy X (tự ghi nhận); sau khi vết bác của phiếu cũ nằm trong đơn, máy chủ tính LẠI và từ chối", async () => {
      // Cảnh KHÔNG có vết bác: P1 hết hạn, P2 mở, X là ứng viên duy nhất.
      const c = await canhGoc(CUOI_DOI, { bac: false });
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
      const moLuc = z("2026-10-07T10:00:10Z");
      const p2 = await moPhieu(DON, DOT_A, moLuc);
      await chuaThay(p2.intentId, sau(moLuc, 20 * GIAY));
      const xem = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: sau(moLuc, 25 * GIAY) });
      expect(xem.ok && xem.ungVien.map((u) => u.bankTransactionId), "xem trước (chưa có vết bác): thấy X").toEqual([c.btX]);
      expect(xem.ok && xem.ungVien[0]?.xemTruoc.quyet, "…và nhãn nói 'tự ghi nhận'").toBe("TU_GHI_NHAN");

      // Vết bác đến sau lần xem (GIẢ LẬP — đường thật không dựng được: P1 còn CAN_XU_LY giữ X thì P2 không mở được).
      await chenTuChoi({ intentId: c.p1.intentId, bankTransactionId: c.btX, createdAt: sau(moLuc, 26 * GIAY) });
      const truoc = await chup();
      const kq = await guiCho(DON, p2.intentId, c.btX, sau(moLuc, 30 * GIAY));
      expect.soft(kq.ok, `gửi theo bản xem trước CŨ — nhận ${JSON.stringify(kq)}`).toBe(false);
      expect.soft(await chup(), "bị từ chối ⇒ không đổi một dòng nào").toBe(truoc);
      expect.soft(await soPayment(), "không một đồng nào vào đơn").toBe(0);
      expect.soft((await btThe(c.mX))?.status).toBe("UNMATCHED");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-09] ĐỐI CHỨNG: các cổng CŨ không bị đụng", () => {
    it("[HN5-DB-09] cùng phiếu thẻ: gửi lại đúng cặp (phiếu, X) vẫn bị `LOI_DA_BI_BAC` ở cổng bấm lặp (DB còn UNIQUE cặp); X không còn trong danh sách của CHÍNH phiếu bị bác", async () => {
      const c = await canhGoc(CUOI_DOI, { bac: true });
      await chuaThay(c.p1.intentId, z("2026-10-07T09:59:40Z"));
      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.p1.intentId, now: z("2026-10-07T09:59:45Z") });
      expect(tim.ok && tim.ungVien.map((u) => u.bankTransactionId), "chính phiếu bị bác: X không còn (như trước Việc 5)").toEqual([c.btKhac]);
      const lai = await guiCho(DON, c.p1.intentId, c.btX, z("2026-10-07T09:59:50Z"));
      expect(lai.ok).toBe(false);
      expect(lai.ok ? "" : lai.error).toMatch(/từ chối/);
      expect(await soPayment()).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-10] rà đối kháng: vết bác CHỈ là yêu cầu `TU_CHOI` — yêu cầu `DA_GHI_NHAN` của đợt trước KHÔNG làm bẩn đợt sau", () => {
    it("[HN5-DB-10] đợt 1 sale tự ghi nhận (hàng DA_GHI_NHAN) ⇒ đợt 2 (phiếu gộp + phiếu thẻ MỚI) chỉ còn một ứng viên ghi chú rỗng vẫn TỰ GHI NHẬN, `lyDo` rỗng", async () => {
      // Mã cần canh: bộ lọc `trangThai: "TU_CHOI"` của `docGiaoDichDaBiBac`. Bỏ nó thì `soLanBiBac` đếm cả DA_GHI_NHAN ⇒ MỌI đơn nhiều đợt đã từng tự ghi nhận
      // bị ép chờ kế toán với câu 'Kế toán đã từ chối…' (nói dối) — cấm oan hàng loạt. Trước ca này chỉ lưới ghim chữ (`[HN5-L1]`/`[HN5-W2]`) giữ vế lọc ấy.
      const g1 = await phatPhieu(DON, [DOT_A]);
      const p1 = await moPhieu(DON, DOT_A, NOW);
      await chuaThay(p1.intentId, z("2026-10-06T10:40:00Z"));
      const mX = maGd();
      await nhapFile([dong({ maGiaoDich: mX, soTien: g1.tongTien, thoiGian: "2026-10-06T17:31:35+07:00" })]); // 10:31:35Z — một giao dịch, ghi chú rỗng
      const btX = await btId(mX);
      const kq1 = await guiCho(DON, p1.intentId, btX, z("2026-10-06T10:41:00Z"));
      expect(kq1, "đợt 1: ứng viên duy nhất ⇒ tự ghi nhận").toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect(await soTuChoi(), "đơn CHƯA từng có vết bác").toBe(0);
      expect(await db.posSaiMaYeuCau.count({ where: { trangThai: "DA_GHI_NHAN", intent: { paymentBill: { orderId: DON } } } }), "…chỉ có một hàng DA_GHI_NHAN").toBe(1);

      const g2 = await phatPhieu(DON, [DOT_B]);
      const moLuc = z("2026-10-06T11:00:00Z");
      const p2 = await moPhieu(DON, DOT_B, moLuc);
      expect(p2.code5, "đợt 2 là phiếu gộp MỚI").toBe(g2.ma);
      expect(p2.code5).not.toBe(g1.ma);
      const mY = maGd();
      await nhapFile([
        dong({ maGiaoDich: mY, soTien: g2.tongTien, thoiGian: "2026-10-06T17:58:00+07:00" }), // 10:58Z — trong cửa sổ 5′ của phiếu thẻ mới
        dong({ maGiaoDich: maGd(), soTien: 999_000, thoiGian: "2026-10-06T18:00:20+07:00" }), // 11:00:20Z — dữ liệu mới hơn phiếu ⇒ đủ
      ]);
      await chuaThay(p2.intentId, sau(moLuc, 30 * GIAY));
      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: sau(moLuc, 40 * GIAY) });
      expect(tim.ok && tim.ungVien.map((u) => u.bankTransactionId), "đợt 2 thấy đúng Y").toEqual([await btId(mY)]);
      expect(tim.ok && tim.ungVien[0]?.xemTruoc, "…và vẫn tự ghi nhận: yêu cầu DA_GHI_NHAN không phải vết bác").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-11] rà đối kháng: giao dịch bị bác loại khỏi danh sách ⇒ câu trả KHÔNG được là 'Không thấy giao dịch nào'", () => {
    it("[HN5-DB-11] X (duy nhất) bị bác ở phiếu cũ ⇒ phiếu mới: danh sách trống + câu 'kế toán đã từ chối…ĐỪNG quẹt lại'; gửi thẳng X cũng nhận ĐÚNG câu ấy; ĐỐI CHỨNG: đơn sạch, trống ⇒ câu 'Không thấy'; còn ứng viên khác ⇒ không câu", async () => {
      // Mã TRƯỚC: `cau = hienThi.length === 0 ? CAU_KHONG_UNG_VIEN : null` và `guiSaiMa` cũng trả CAU_KHONG_UNG_VIEN — X có thật nhưng màn nói "không thấy",
      // không cấm quẹt lại; phiếu mới có `saiMa = null` nên hộp phiếu còn mời quẹt (R-5a). Câu phải đến từ MỘT hàm (`cauKhongUngVien`) cho cả hai cửa.
      const c = await canhGoc(CUOI_DOI, { bac: true });
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
      const moLuc = z("2026-10-07T10:00:10Z");
      const p2 = await moPhieu(DON, DOT_A, moLuc);
      expect(p2.code5).toBe(c.g.ma);
      await chuaThay(p2.intentId, sau(moLuc, 20 * GIAY));
      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: sau(moLuc, 25 * GIAY) });
      expect.soft(tim.ok && tim.ungVien, "X bị bác ⇒ danh sách trống").toEqual([]);
      expect.soft(tim.ok && tim.cau, "…và câu nói đúng sự thật (có giao dịch, kế toán đã từ chối)").toBe(cauKhongUngVien(1));
      expect.soft(tim.ok && tim.cau, "…không phải 'Không thấy giao dịch nào'").not.toBe(CAU_KHONG_UNG_VIEN);
      const truoc = await chup();
      const kq = await guiCho(DON, p2.intentId, c.btX, sau(moLuc, 30 * GIAY));
      expect.soft(kq.ok ? null : kq.error, "gửi thẳng X: cùng câu với bước tìm (một nguồn)").toBe(cauKhongUngVien(1));
      expect.soft(await chup(), "bị từ chối ⇒ không đổi một dòng nào").toBe(truoc);

      // ĐỐI CHỨNG 1: đơn SẠCH, cửa sổ không có giao dịch nào ⇒ câu 'Không thấy' như đặc tả.
      await dungFixture();
      await phatPhieu(DON, [DOT_A]);
      const s1 = await moPhieu(DON, DOT_A, NOW);
      await nhapDuLieuMoi("2026-10-06T17:00:20+07:00"); // 10:00:20Z — dữ liệu mới hơn phiếu
      await chuaThay(s1.intentId, sau(NOW, 20 * GIAY));
      const timS = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: s1.intentId, now: sau(NOW, 25 * GIAY) });
      expect(timS.ok && timS.ungVien, "đối chứng: đơn sạch, không có giao dịch").toEqual([]);
      expect(timS.ok && timS.cau, "đối chứng: câu 'Không thấy' nguyên văn").toBe(CAU_KHONG_UNG_VIEN);

      // ĐỐI CHỨNG 2: X bị bác nhưng còn Z ⇒ danh sách [Z], không câu nào (câu chỉ dành cho danh sách TRỐNG).
      await dungFixture();
      const z2 = await canhGoc(CUOI_DOI, { bac: true, coZ: "2026-10-07T17:00:05+07:00" });
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
      const p2z = await moPhieu(DON, DOT_A, moLuc);
      await chuaThay(p2z.intentId, sau(moLuc, 20 * GIAY));
      const timZ = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2z.intentId, now: sau(moLuc, 25 * GIAY) });
      expect(timZ.ok && timZ.ungVien.map((u) => u.bankTransactionId), "đối chứng: còn Z").toEqual([z2.btZ]);
      expect(timZ.ok && timZ.cau, "đối chứng: có ứng viên ⇒ không câu").toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN5-DB-12] rà đối kháng: view của phiếu thẻ MỚI mang cờ `donDaCoVetBac` (đọc từ CÙNG nguồn với bộ nhớ bác), đơn khác/đơn sạch thì không", () => {
    it("[HN5-DB-12] đơn đã có vết bác ⇒ phiếu thẻ cũ lẫn MỚI đều true (cả `docPhieuPosView` lẫn `docPhieuPosTho`); ĐỐI CHỨNG: đơn sạch false; đơn KHÁC (DON_PHU) false dù DON có vết bác", async () => {
      // Mã TRƯỚC: không có cờ này ⇒ hộp phiếu MỚI (saiMa = null) không biết đơn từng có giao dịch bị bác và vẫn mời quẹt không kèm lời cảnh báo nào (R-5a).
      const c = await canhGoc(CUOI_DOI, { bac: true });
      await nhapDuLieuMoi("2026-10-07T17:00:20+07:00");
      const moLuc = z("2026-10-07T10:00:10Z");
      const p2 = await moPhieu(DON, DOT_A, moLuc);
      expect(p2.intentId).not.toBe(c.p1.intentId);
      const v2 = await docPhieuPosView(p2.intentId, sau(moLuc, 20 * GIAY));
      expect(v2?.saiMa, "phiếu mới chưa từng có yêu cầu riêng").toBeNull();
      expect(v2?.donDaCoVetBac, "…nhưng ĐƠN của nó đã có vết bác").toBe(true);
      expect((await docPhieuPosView(c.p1.intentId, sau(moLuc, 20 * GIAY)))?.donDaCoVetBac, "phiếu cũ cùng đơn: true").toBe(true);
      const tho = await docPhieuPosTho(DON);
      expect(tho.length, "màn đơn đọc cả hai phiếu").toBeGreaterThanOrEqual(2);
      expect(tho.map((p) => p.donDaCoVetBac), "đường đọc của màn đơn: mọi phiếu của đơn đều true").toEqual(tho.map(() => true));

      // ĐỐI CHỨNG: đơn KHÁC cùng cơ sở không bị lan.
      await phatPhieu(DON_PHU, [DOT_D]);
      const pb = await moPhieu(DON_PHU, DOT_D, sau(moLuc, 40 * GIAY));
      expect((await docPhieuPosView(pb.intentId, sau(moLuc, 50 * GIAY)))?.donDaCoVetBac, "đối chứng: đơn khác ⇒ false").toBe(false);

      // ĐỐI CHỨNG: đơn sạch.
      await dungFixture();
      await phatPhieu(DON, [DOT_A]);
      const s1 = await moPhieu(DON, DOT_A, NOW);
      expect((await docPhieuPosView(s1.intentId, sau(NOW, 20 * GIAY)))?.donDaCoVetBac, "đối chứng: đơn sạch ⇒ false").toBe(false);
    });
  });
});
