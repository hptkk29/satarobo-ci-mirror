// tests/finance/pos-hai-nut-sai-ma.test.ts — VIỆC 3: SALE NHẬP SAI MÃ TRÊN MÁY POS, KHÁCH ĐÃ QUẸT THÀNH CÔNG. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-hai-nut.test.ts` / `pos-gd1.test.ts`).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §5. Đi qua ĐÚNG cửa đời thật: tạo phiếu bằng `taoPhieuGop` / `moPhieuPos`, giao dịch
// gõ sai bằng `nhapLoPos` (file), "Chưa thấy" bằng `xuLyKetQuaPos` NOT_FOUND, rồi `guiSaiMa` / `duyetSaiMa` / `tuChoiSaiMa`.
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm có `now` đều được truyền mốc tuyệt đối. Ca "bị từ chối" luôn kèm ảnh chụp TRƯỚC/SAU
// (luật rollback — cổng đứng trước phép ghi đầu tiên). Ca "KHÔNG được" luôn kèm đối chứng dương (luật 11).
//
// ⚠️ Hook `h.truocTien` bọc `xuLyKetQuaPos`: cho phép dựng đúng ca "trạng thái đổi GIỮA lúc giữ và lúc ghi tiền" (hai transaction
// nối tiếp không thể đua bằng thời gian một cách tất định) — nó chỉ chạy việc của test rồi gọi hàm THẬT.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { getHandlers } from "@/lib/events/registry";
import { ganTienTheoCon, TIEN_TO_GO_GAN } from "@/lib/finance/ghi-tien-don";
import { huyPhieuGop, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { BANG_CHU, sinhMa } from "@/lib/payments/ma-phieu";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { FakePosProvider } from "@/lib/payments/pos/provider/fake";
import { chayPollerPos } from "@/lib/payments/pos/poller";
import { dongBoPhieuPosSauNhap } from "@/lib/payments/pos/dong-bo-sau-nhap";
import { docPhieuPosView, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { kiemTraPhieuPos, xuLyKetQuaPos, type TriggeredBy } from "@/lib/payments/pos/xu-ly-ket-qua";
import { laCauChuaThay } from "@/lib/payments/pos/thong-diep-pos";
import { CAU_CHO_KE_TOAN, CAU_KHONG_UNG_VIEN, cauTuChoi, khoangCachMa, lanCanMa } from "@/lib/payments/pos/sai-ma";
import { docHangChoSaiMa, timUngVienSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { duyetSaiMa, guiSaiMa, tuChoiSaiMa } from "@/lib/payments/pos/sai-ma-ghi";

// Bọc `xuLyKetQuaPos`: chạy `h.truocTien` (nếu có) RỒI gọi hàm thật. `kiemTraPhieuPos` giữ nguyên hàm thật của nó.
const h = vi.hoisted(() => ({ truocTien: null as null | (() => Promise<void>), sauTien: null as null | (() => Promise<void>) }));
vi.mock("@/lib/payments/pos/xu-ly-ket-qua", async (goc) => {
  const m = await goc<typeof import("@/lib/payments/pos/xu-ly-ket-qua")>();
  return {
    ...m,
    xuLyKetQuaPos: async (...a: Parameters<typeof m.xuLyKetQuaPos>) => {
      if (h.truocTien) await h.truocTien();
      const kq = await m.xuLyKetQuaPos(...a);
      if (h.sauTien) await h.sauTien();
      return kq;
    },
  };
});

// Ca dài nhất (DB-10: chín vế bộ lọc, mỗi vế dựng giao dịch rồi tìm lại) mất ~4,2 s trên máy rảnh — SÁT trần 5 s mặc định. Quá giờ không chỉ đỏ ca đó
// mà còn LÀM HỎNG các ca đứng sau (vitest không huỷ được promise đang chạy — luật 18). Đo ở cấy lỗi M68: máy bận ⇒ DB-10 đỏ vì quá giờ.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

if (!RUN_DB_TESTS) console.warn(`[HN3-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos3hn-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS3HN";

const KT = `${T}kt`; // Kế toán HO — vai HO_ACCOUNTANT (nhận báo POS) + người nhập file
const KT2 = `${T}kt2`; // Kế toán HO thứ hai — "người khác" để duyệt
const ADMIN = `${T}admin`;
const SALE = `${T}sale`;
const SALE2 = `${T}sale2`;
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const LEAD = `${T}lead`;
const DON = `${T}don`; // hai bé, hai đợt
const DON_RIENG = `${T}don-rieng`; // MỘT bé, MỘT đợt — "đơn thu đủ ⇒ 1 biên nhận"
const DON_PHU = `${T}don-phu`; // đơn thứ hai cùng cơ sở, cùng số tiền với DOT_A — phiếu thẻ cạnh tranh
const A = `${T}item-a`;
const B = `${T}item-b`;
const C = `${T}item-c`;
const D = `${T}item-d`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const DOT_C = `${T}dot-c`;
const DOT_D = `${T}dot-d`;
const MAY1 = `${PFX}MAY01`; // CS1
const MAY2 = `${PFX}MAY02`; // CS2
const MAY3 = `${PFX}MAY03`; // CS1, máy thứ hai
const SDT_PH = "0399812388";
const EMAIL_PH = "ph.fx.pos3hn@test.local";
const TPL = "FX_POS3HN_BIEN_NHAN";
const ACTOR = { id: SALE, name: "Sale fixture HN3" };
const ACTOR2 = { id: SALE2, name: "Sale 2 fixture HN3" };
const A_KT = { id: KT, name: "Kế toán fixture HN3" };
const A_KT2 = { id: KT2, name: "Kế toán 2 fixture HN3" };

/**
 * Người xem cấp CƠ SỞ — quyền `payments:*` neo ở đúng một cơ sở (hình dạng `resolveScope` đọc; khuôn `pos-gd1-schema.test.ts`).
 * `timUngVienSaiMa`/`docHangChoSaiMa` NHẬN client đã scope, nên ca đo phạm vi phải đưa vào client scope THẬT.
 */
function actorCoSo(centerId: string): Actor {
  return {
    userId: KT,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      { action: "payments:pos-check", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_SALES_CSM", centerScope: [centerId] },
      { action: "payments:manage", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] },
    ],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}
/** Quản trị tối cao: thấy MỌI cơ sở — cho các ca KHÔNG đo phạm vi (thay cho `db` trần, vốn không đúng kiểu client đã scope). */
const ACTOR_TAT_CA = {
  userId: ADMIN,
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

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B;
const DOT_TIEN_C = 4_000_000;

const PHUT = 60_000;
/** Lúc tạo phiếu thẻ. */
const NOW = new Date("2026-10-06T10:00:00Z");
/** Giờ quẹt (giờ VN) = 10:31:35Z — SAU lúc tạo phiếu, trong cửa sổ [mở − 5′, nay]. */
const GIO_QUET = "2026-10-06T17:31:35+07:00";
/** Sale bấm Kiểm tra ⇒ "Chưa thấy giao dịch". */
const KIEM = new Date(NOW.getTime() + 40 * PHUT);
/** Sale bấm "Tôi nhập sai mã trên máy". */
const GUI = new Date(NOW.getTime() + 45 * PHUT);
/** Kế toán duyệt / từ chối. */
const QUYET = new Date(NOW.getTime() + 60 * PHUT);

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;

/** Gõ SAI đúng một ký tự (ký tự cuối) — không bao giờ qua checksum (vét cạn Đ17). */
const saiMotKyTu = (ma: string) => ma.slice(0, 4) + (ma[4] === "X" ? "Y" : "X");
/**
 * Đổi chỗ hai ký tự KỀ NHAU đầu tiên mà KHÁC nhau. Vét cạn 413.343 mã hợp lệ (09/10/2026): không phép đổi chỗ kề nào ở BỐN vị trí cho ra một mã hợp lệ khác.
 * Phải KHÁC nhau: đổi chỗ hai ký tự giống nhau trả lại CHÍNH mã đúng — bản cũ rơi vào đó khi ba ký tự đầu giống nhau (~0,14% mã).
 */
const doiChoKe = (ma: string) => {
  for (let i = 0; i < ma.length - 1; i += 1) if (ma[i] !== ma[i + 1]) return ma.slice(0, i) + ma[i + 1] + ma[i] + ma.slice(i + 2);
  throw new Error(`mã ${ma} gồm toàn ký tự giống nhau — không đổi chỗ được`);
};

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { providerTxnId: { startsWith: PFX } };
const DON_CUA_TEST = [DON, DON_RIENG, DON_PHU];
const NGUOI = [KT, KT2, ADMIN, SALE, SALE2];

async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], equals: DON } } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], equals: DON_RIENG } } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], equals: DON_PHU } } });
  await db.posSaiMaYeuCau.deleteMany({ where: { intent: { paymentBill: { orderId: { in: DON_CUA_TEST } } } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: { orderId: { in: DON_CUA_TEST } } } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: { in: DON_CUA_TEST } } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.emailLog.deleteMany({ where: { OR: [{ contextType: "Order", contextId: { in: DON_CUA_TEST } }, { toEmail: EMAIL_PH }] } });
  await db.emailTemplate.deleteMany({ where: { code: TPL } });
  await db.auditLog.deleteMany({
    where: { OR: [{ entityType: "Order", entityId: { in: DON_CUA_TEST } }, { actorId: { in: NGUOI } }, { entityId: LEAD }] },
  });
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
  await db.posAgent.deleteMany({ where: { merchantCode: { startsWith: PFX } } });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.order.deleteMany({ where: { id: { in: DON_CUA_TEST } } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: NGUOI } } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: NGUOI } }, { email: EMAIL_PH }, { phone: { in: [SDT_PH, "84399812388"] } }] } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function vai(code: string): Promise<string> {
  const r = await db.roleDef.upsert({ where: { code }, create: { code, name: code }, update: {}, select: { id: true } });
  return r.id;
}

async function dungFixture() {
  h.truocTien = null;
  h.sauTien = null;
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", "Kế toán HO fixture HN3"],
    [KT2, "ACCOUNTANT", "Kế toán HO 2 fixture HN3"],
    [ADMIN, "SUPER_ADMIN", "Quản trị fixture HN3"],
    [SALE, "SALES_CSM", "Sale fixture HN3"],
    [SALE2, "SALES_CSM", "Sale 2 fixture HN3"],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  // `effectiveFrom` TUYỆT ĐỐI (luật 19). "Báo POS" gửi HO_ACCOUNTANT ∪ SUPER_ADMIN, đọc từ VAI (UserOrgRole).
  const HIEU_LUC = new Date("2026-01-01T00:00:00Z");
  await db.userOrgRole.create({
    data: { userId: ADMIN, orgUnitId: `${T}ou-goc`, roleId: await vai("SUPER_ADMIN"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
  });
  for (const k of [KT, KT2]) {
    await db.userOrgRole.create({
      data: { userId: k, orgUnitId: `${T}ou-ho`, roleId: await vai("HO_ACCOUNTANT"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
    });
  }
  for (const [id, ten] of [
    [CS1, "CS1 fixture POS3HN"],
    [CS2, "CS2 fixture POS3HN"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: "QTTFBKATK", centerId: CS2 } });
  await db.posTerminal.create({ data: { maThietBi: MAY3, maQuay: "QTT3RDHN3", centerId: CS1 } });
  await db.emailTemplate.create({
    data: {
      code: TPL,
      name: "Biên nhận fixture HN3",
      trigger: "PAYMENT_RECEIPT",
      subject: "Biên nhận {{order_code}}",
      bodyText: "Đã thanh toán {{total_amount}} · {{payment_method}}",
      bodyHtml: "<p>Đã thanh toán {{total_amount}} · {{payment_method}}</p>",
    },
  });
  await db.lead.create({
    data: { id: LEAD, parentName: "PH fixture HN3", phone: "0399812377", assignedToId: SALE, status: "CHO_QUYET_DINH" },
  });

  const taoDon = async (id: string, code: string, tong: number, leadId: string | null) =>
    db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture HN3",
        customerPhone: SDT_PH,
        customerEmail: EMAIL_PH,
        totalAmount: tong,
        centerId: CS1,
        ...(leadId ? { leadId } : {}),
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
  await taoDon(DON, "ORD-269979-000301", TONG, LEAD);
  await taoDong(DON, A, DOT_A, "Bé A HN3", DOT_TIEN_A, 1);
  await taoDong(DON, B, DOT_B, "Bé B HN3", DOT_TIEN_B, 2);
  await taoDon(DON_RIENG, "ORD-269979-000302", DOT_TIEN_C, null);
  await taoDong(DON_RIENG, C, DOT_C, "Bé C HN3", DOT_TIEN_C, 1);
  await taoDon(DON_PHU, "ORD-269979-000303", DOT_TIEN_A, null);
  await taoDong(DON_PHU, D, DOT_D, "Bé D HN3", DOT_TIEN_A, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** Nút "Xuất QR" của một dòng: phát phiếu gộp cho các đợt. */
async function phatPhieu(orderId: string, ids: string[], actor = ACTOR) {
  const r = await taoPhieuGop({ orderId, paymentRequestIds: ids, actor });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}

/** Nút "Thẻ POS": mở phiếu thẻ trên máy chỉ định (mặc định MAY1 — CS1 có HAI máy nên bắt buộc chọn). */
async function moPhieu(orderId: string, dot: string, o: { may?: string; now?: Date; actor?: { id: string; name: string } } = {}) {
  const mayId = (await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: o.may ?? MAY1 } })).id;
  const r = await moPhieuPos({
    orderId,
    paymentRequestId: dot,
    posTerminalId: mayId,
    actor: o.actor ?? ACTOR,
    now: o.now ?? NOW,
  });
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
    thoiGian: GIO_QUET,
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: "998877665544",
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
    include: { allocations: true },
  });
const btId = async (ma: string) => (await btThe(ma))!.id;

/** Sale bấm Kiểm tra ⇒ "Chưa thấy giao dịch" (kết quả NOT_FOUND vào ĐÚNG đường `xuLyKetQuaPos`). */
async function chuaThay(intentId: string, now: Date = KIEM) {
  const kq = await xuLyKetQuaPos({ intentId, ketQua: { kind: "NOT_FOUND" } satisfies PosCheckResult, triggeredBy: "SALE", now, nguonDuLieu: "FAKE" });
  expect(laCauChuaThay(kq.thongDiep), `phải ra câu 'Chưa thấy': ${kq.thongDiep}`).toBe(true);
  return kq;
}

type Canh = {
  /** Phiếu thẻ cho đợt nào của đơn nào. */
  orderId: string;
  dot: string;
  ids?: string[];
  may?: string;
};

/**
 * Dựng cảnh chuẩn: phiếu gộp + phiếu thẻ + "Chưa thấy" + MỘT giao dịch gõ sai mã đã vào hàng chờ (qua file).
 * `dienGiai` nhận hàm của mã đúng (để gõ sai CHÍNH mã của phiếu này).
 */
async function dungCanh(c: Canh, dienGiai: (maDung: string) => string, o: { soTien?: number; may?: string; gio?: string } = {}) {
  const may = c.may ?? MAY1;
  const g = await phatPhieu(c.orderId, c.ids ?? [c.dot]);
  const p = await moPhieu(c.orderId, c.dot, { may });
  expect(p.code5).toBe(g.ma);
  await chuaThay(p.intentId);
  const m = maGd();
  await nhapFile([
    dong({
      maGiaoDich: m,
      dienGiai: dienGiai(g.ma),
      soTien: o.soTien ?? g.tongTien,
      maThietBi: o.may ?? may,
      ...(o.gio ? { thoiGian: o.gio } : {}),
    }),
  ]);
  return { g, p, m, bt: await btId(m), intentId: p.intentId, ma: g.ma, billId: g.billId };
}

const guiCho = (orderId: string, intentId: string, bankTransactionId: string, o: { actor?: { id: string; name: string }; now?: Date } = {}) =>
  guiSaiMa({ orderId, intentId, bankTransactionId, actor: o.actor ?? ACTOR, now: o.now ?? GUI });

const yeuCauCua = (intentId: string) => db.posSaiMaYeuCau.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } });
const soPayment = (orderId = DON) => db.payment.count({ where: { orderId } });
const soPhanBo = (orderId = DON) => db.paymentAllocation.count({ where: { paymentRequest: { orderId } } });
const suKienDaChia = (orderId: string) =>
  db.domainEvent.findMany({ where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], equals: orderId } }, orderBy: { createdAt: "asc" } });

/** Chạy handler THẬT trên mọi sự kiện DA_CHIA của đơn — như dispatcher làm. */
async function chayHandler(orderId: string): Promise<number> {
  ensureHandlersRegistered();
  const evs = await suKienDaChia(orderId);
  for (const e of evs) {
    for (const hd of getHandlers(e.type)) {
      await hd({ id: e.id, type: e.type, payload: e.payloadJson as Record<string, unknown> });
    }
  }
  return evs.length;
}
const bienNhan = (orderId: string) => db.emailLog.count({ where: { contextType: "Order", contextId: orderId } });
const thongBaoNguoi = (userId: string, tienTo: string) => db.staffNotification.findMany({ where: { userId, dedupeKey: { startsWith: tienTo } } });

/** Ảnh chụp mọi thứ một lượt gửi/duyệt/từ chối có thể đổi. `updatedAt` nằm trong hàng ⇒ một phép ghi vô hình cũng làm nó lệch. */
async function chup(orderIds: string[] = DON_CUA_TEST): Promise<string> {
  const [bills, intents, reqs, pays, allocs, bts, poss, yc, audit, thongBao, suKien] = await Promise.all([
    db.paymentBill.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    db.posPaymentIntent.findMany({ where: { paymentBill: { orderId: { in: orderIds } } }, orderBy: { id: "asc" } }),
    db.paymentRequest.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    db.payment.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    db.paymentAllocation.findMany({ where: { paymentRequest: { orderId: { in: orderIds } } }, orderBy: { id: "asc" } }),
    db.bankTransaction.findMany({ where: LOC_BT, orderBy: { id: "asc" } }),
    db.posCardTransaction.findMany({ where: { maGiaoDich: { startsWith: PFX } }, orderBy: { id: "asc" } }),
    db.posSaiMaYeuCau.findMany({ where: { intent: { paymentBill: { orderId: { in: orderIds } } } }, orderBy: { id: "asc" } }),
    db.auditLog.count({ where: { entityType: "Order", entityId: { in: orderIds } } }),
    db.staffNotification.count({ where: { userId: { in: NGUOI } } }),
    db.domainEvent.count({ where: { type: "phieu-gop.da-chia" } }),
  ]);
  return JSON.stringify({ bills, intents, reqs, pays, allocs, bts, poss, yc, audit, thongBao, suKien });
}

const LOI_BANG = (kq: { ok: boolean; error?: string }) => (kq.ok ? "" : (kq.error ?? ""));

// ─────────────────────────────────────────────────────────────────────────────
// 01 · đo hiện trạng
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] sale nhập sai mã — hiện trạng + hai bậc xử lý", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-DB-01] ĐO HIỆN TRẠNG: giao dịch gõ sai mã nhập bằng file ⇒ dòng POS CAN_XU_LY + giao dịch UNMATCHED; phiếu thẻ còn CHO_QUET, câu 'Chưa thấy'", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    const bt = await btThe(c.m);
    expect(bt?.status).toBe("UNMATCHED");
    const pos = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: c.m } });
    expect(pos.matchStatus).toBe("CAN_XU_LY");
    expect(pos.matchReason).toBe("Không có mã phiếu 5 ký tự trong ghi chú");
    expect(pos.dienGiai).toBe(saiMotKyTu(c.ma));
    const p = await phieuPos(c.intentId);
    expect(p.status).toBe("CHO_QUET");
    expect(p.bankTransactionId).toBeNull();
    expect(p.lastResultKind).toBe("NOT_FOUND");
    expect(laCauChuaThay(p.lastResultMessage)).toBe(true);
    expect(await yeuCauCua(c.intentId)).toEqual([]);
  });

  it("[HN3-DB-02] TỰ GHI NHẬN: gõ sai MỘT ký tự ⇒ đúng 1 Payment, 1 phân bổ, phiếu gộp PAID, giao dịch MATCHED, phiếu thẻ DA_THU; đơn thu đủ ⇒ ĐÚNG 1 biên nhận", async () => {
    const c = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
    const truoc = await soPayment(DON_RIENG);
    expect(truoc).toBe(0);

    const kq = await guiCho(DON_RIENG, c.intentId, c.bt);
    expect(kq).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN", daCo: false });

    const yc = await yeuCauCua(c.intentId);
    expect(yc).toHaveLength(1);
    expect(yc[0]).toMatchObject({ kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN", lyDo: "", nguoiGuiId: SALE, nguoiQuyetId: null, centerId: CS1 });

    // Đường tiền CHUNG với khớp tự động: đúng như thể mã được gõ đúng.
    const bt = await btThe(c.m);
    expect(bt?.status).toBe("MATCHED");
    expect(bt?.allocations).toHaveLength(1);
    expect(await soPayment(DON_RIENG), "ĐÚNG MỘT Payment").toBe(1);
    expect(await soPhanBo(DON_RIENG)).toBe(1);
    const pay = await db.payment.findFirstOrThrow({ where: { orderId: DON_RIENG } });
    expect(pay.method).toBe("card_pos");
    expect(pay.accountantStatus).toBe("PENDING");
    expect(pay.amount).toBe(DOT_TIEN_C);
    expect(pay.note, "marker tự khớp — gỡ gắn tìm lại dòng gốc bằng nó").toContain(`[auto:card_pos:${c.m}]`);
    expect((await phieuGopDb(c.billId)).status).toBe("PAID");

    const p = await phieuPos(c.intentId);
    expect(p.status).toBe("DA_THU");
    expect(p.bankTransactionId).toBe(bt!.id);
    expect(p.lastTriggeredBy).toBe("SALE");

    // Dòng POS: mã đúng + lý do; GHI CHÚ GỐC nguyên chữ gõ sai (bản ghi của ngân hàng không sửa).
    const pos = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: c.m } });
    expect(pos.maPhieu).toBe(c.ma);
    expect(pos.matchStatus).toBe("TU_KHOP");
    expect(pos.matchReason).toBe(`Khớp phiếu ${c.ma} (xác nhận nhập sai mã)`);
    expect(pos.dienGiai, "ghi chú gốc KHÔNG đổi").toBe(saiMotKyTu(c.ma));
    expect(bt?.content).toBe(saiMotKyTu(c.ma));

    // Dấu vết: AuditLog có người bấm + ghi chú gốc + mã đúng + nguồn.
    const au = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON_RIENG, action: { startsWith: "POS_SAI_MA_" } }, orderBy: { createdAt: "asc" } });
    expect(au.map((a) => a.action)).toEqual(["POS_SAI_MA_GUI", "POS_SAI_MA_GHI_NHAN"]);
    for (const a of au) expect(a.actorId).toBe(SALE);
    const nv = au[0]!.newValues as Record<string, unknown>;
    expect(nv).toMatchObject({ ghiChuGoc: saiMotKyTu(c.ma), maDung: c.ma, nguon: "SALE_XAC_NHAN_SAI_MA", kieu: "TU_GHI_NHAN", conPhaiThu: DOT_TIEN_C });

    // Sinh phiếu thu + chuyển đổi như thường: MỘT sự kiện, handler chốt đơn + ĐÚNG 1 biên nhận.
    expect(await suKienDaChia(DON_RIENG)).toHaveLength(1);
    expect(await bienNhan(DON_RIENG)).toBe(0);
    expect(await chayHandler(DON_RIENG)).toBe(1);
    expect(await bienNhan(DON_RIENG), "đơn thu đủ ⇒ 1 biên nhận").toBe(1);
    await chayHandler(DON_RIENG);
    expect(await bienNhan(DON_RIENG), "chạy handler lần hai vẫn 1").toBe(1);
  });

  it("[HN3-DB-02b] đổi chỗ hai ký tự kề và ghi chú RỖNG cũng tự ghi nhận; đợt lẻ ⇒ KHÔNG biên nhận, sale được báo 1", async () => {
    for (const [dienGiai, kyHieu] of [
      [doiChoKe, "đổi chỗ"],
      [() => "", "rỗng"],
    ] as const) {
      await dungFixture();
      const c = await dungCanh({ orderId: DON, dot: DOT_A }, dienGiai);
      const kq = await guiCho(DON, c.intentId, c.bt);
      expect(kq, kyHieu).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(DON), `${kyHieu}: đúng 1 Payment`).toBe(1);
      expect((await phieuPos(c.intentId)).status).toBe("DA_THU");
      expect(await chayHandler(DON)).toBe(1);
      expect(await bienNhan(DON), "đợt lẻ ⇒ 0 biên nhận").toBe(0);
      const baoSale = await db.staffNotification.count({ where: { userId: SALE, dedupeKey: { startsWith: "phieu-gop.da-chia:" } } });
      expect(baoSale, "sale phụ trách được báo").toBe(1);
    }
  });

  it("[HN3-DB-03] SONG SONG: 3 lượt gửi ‖ nhập lại file ‖ Kiểm tra ⇒ đúng 1 yêu cầu, 1 bộ Payment/phân bổ/sự kiện (không ghi đôi)", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    const fake = new FakePosProvider();
    const kiem = (now: Date) => kiemTraPhieuPos({ intentId: c.intentId, provider: fake, triggeredBy: "SALE", now, nguoiKiemId: null });
    // Năm luồng cùng lúc = bằng cỡ pool kết nối mặc định (5): mỗi lượt gửi GIỮ một kết nối trong lúc chờ khoá đơn; nhiều hơn thế là thử
    // pool chứ không thử tính đúng đắn (các ca đua của GĐ1 dùng 3 luồng).
    const kq = await Promise.all([
      ...Array.from({ length: 3 }, () => guiCho(DON, c.intentId, c.bt)),
      nhapFile([dong({ maGiaoDich: c.m, dienGiai: saiMotKyTu(c.ma), soTien: DOT_TIEN_A })]),
      kiem(new Date(KIEM.getTime() + 60_000)),
    ]);
    const gui = kq.slice(0, 3) as Awaited<ReturnType<typeof guiCho>>[];
    expect(gui.filter((r) => r.ok), "ít nhất một lượt thành công").not.toHaveLength(0);
    for (const r of gui) if (!r.ok) expect(r.error).not.toMatch(/Unique constraint|Invalid .*invocation|P2002/i);
    expect(await yeuCauCua(c.intentId)).toHaveLength(1);
    expect(await soPayment()).toBe(1);
    expect(await soPhanBo()).toBe(1);
    expect(await suKienDaChia(DON)).toHaveLength(1);
    expect((await btThe(c.m))?.allocations).toHaveLength(1);
    expect((await phieuPos(c.intentId)).status).toBe("DA_THU");
  });

  // ── KHỚP TỰ ĐỘNG × TỰ GHI NHẬN: hai đường cùng tiêu MỘT phiếu ────────────────────────────────────────────────────────────────────
  // DB-03 ở trên đua BA lượt gửi với CÙNG giao dịch — đường tự động không có cách nào khớp dòng gõ sai mã, nên nó chỉ thử "không ghi đôi"
  // giữa các lượt gửi. Cách DUY NHẤT để khớp tự động và tự ghi nhận cùng nhắm vào một khoản tiền là GIAO DỊCH THỨ HAI mang ĐÚNG mã (khách
  // thấy lỗi, quẹt lại): giao dịch thứ nhất (gõ sai) do sale xác nhận, giao dịch thứ hai do đường tự động khớp. Cả hai cùng trỏ vào MỘT
  // phiếu gộp ⇒ phiếu chỉ được tiêu MỘT lần. Ba khe giờ: SAU phép ghi tiền của sale · GIỮA lúc giữ và lúc ghi tiền · đua thật.
  it("[HN3-DB-03b] khớp tự động đến NGAY SAU phép ghi tiền của sale (khách quẹt lại đúng mã) ⇒ KHÔNG Payment thứ hai; giao dịch thứ hai nằm lại UNMATCHED; đúng 1 biên nhận", async () => {
    const c = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
    const m2 = maGd();
    h.sauTien = async () => {
      h.sauTien = null;
      await nhapFile([dong({ maGiaoDich: m2, dienGiai: c.ma, soTien: DOT_TIEN_C })]);
    };
    const kq = await guiCho(DON_RIENG, c.intentId, c.bt);
    expect(kq).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
    expect(h.sauTien, "hook phải đã chạy — nếu không, ca này không thử gì").toBeNull();

    expect(await soPayment(DON_RIENG), "ĐÚNG MỘT Payment").toBe(1);
    expect(await soPhanBo(DON_RIENG)).toBe(1);
    expect((await btThe(c.m))?.status, "giao dịch sale xác nhận được ghi").toBe("MATCHED");
    const t2 = await btThe(m2);
    expect(t2?.status, "giao dịch thứ hai KHÔNG được tiêu tiền lần nữa").toBe("UNMATCHED");
    expect(t2?.allocations).toHaveLength(0);
    expect((await phieuGopDb(c.billId)).status).toBe("PAID");
    expect(await suKienDaChia(DON_RIENG)).toHaveLength(1);
    expect(await chayHandler(DON_RIENG)).toBe(1);
    expect(await bienNhan(DON_RIENG), "đơn thu đủ ⇒ ĐÚNG 1 biên nhận").toBe(1);
  });

  it("[HN3-DB-03c] khớp tự động chen vào GIỮA lúc sale giữ giao dịch và lúc ghi tiền ⇒ vẫn đúng 1 Payment (của giao dịch thứ hai); yêu cầu KHÔNG được báo 'đã ghi nhận'", async () => {
    const c = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
    const m2 = maGd();
    h.truocTien = async () => {
      h.truocTien = null;
      await nhapFile([dong({ maGiaoDich: m2, dienGiai: c.ma, soTien: DOT_TIEN_C })]);
    };
    const kq = await guiCho(DON_RIENG, c.intentId, c.bt);
    expect(h.truocTien, "hook phải đã chạy — nếu không, ca này không thử gì").toBeNull();

    expect(await soPayment(DON_RIENG), "ĐÚNG MỘT Payment").toBe(1);
    expect(await soPhanBo(DON_RIENG)).toBe(1);
    expect((await btThe(m2))?.status, "đường tự động thắng khe này").toBe("MATCHED");
    const t1 = await btThe(c.m);
    expect(t1?.status, "giao dịch gõ sai KHÔNG được ghi tiền").toBe("UNMATCHED");
    expect(t1?.allocations).toHaveLength(0);
    // Sale KHÔNG được nghe "đã ghi nhận" cho một khoản mà tiền của nó chưa được ghi; và không yêu cầu nào mang trạng thái ĐÃ GHI.
    if (kq.ok) expect(kq.trangThai, "không báo thành công giả").not.toBe("DA_GHI_NHAN");
    expect((await yeuCauCua(c.intentId)).filter((y) => y.trangThai === "DA_GHI_NHAN")).toEqual([]);
    expect(await suKienDaChia(DON_RIENG)).toHaveLength(1);
  });

  it("[HN3-DB-03d] ĐUA THẬT, bốn vòng: lượt gửi ‖ khớp tự động (giao dịch đúng mã) ⇒ mỗi vòng đúng 1 Payment/1 phân bổ/1 sự kiện/1 biên nhận, đúng MỘT giao dịch được ghi", async () => {
    const thang: string[] = [];
    for (let vong = 1; vong <= 4; vong += 1) {
      if (vong > 1) await dungFixture();
      const c = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
      const m2 = maGd();
      const [gui] = await Promise.all([
        guiCho(DON_RIENG, c.intentId, c.bt),
        nhapFile([dong({ maGiaoDich: m2, dienGiai: c.ma, soTien: DOT_TIEN_C })]),
      ]);
      if (!gui.ok) expect(gui.error, `vòng ${vong}`).not.toMatch(/Unique constraint|Invalid .*invocation|P2002|deadlock/i);
      expect(await soPayment(DON_RIENG), `vòng ${vong}: ĐÚNG MỘT Payment`).toBe(1);
      expect(await soPhanBo(DON_RIENG), `vòng ${vong}`).toBe(1);
      expect(await suKienDaChia(DON_RIENG), `vòng ${vong}`).toHaveLength(1);
      const [t1, t2] = [await btThe(c.m), await btThe(m2)];
      const matched = [t1, t2].filter((t) => t?.status === "MATCHED");
      expect(matched, `vòng ${vong}: đúng MỘT giao dịch được ghi`).toHaveLength(1);
      expect([t1, t2].filter((t) => t?.status === "UNMATCHED"), `vòng ${vong}: giao dịch còn lại ở lại hàng chờ`).toHaveLength(1);
      // Yêu cầu chỉ được ở trạng thái ĐÃ GHI khi chính giao dịch của nó được ghi.
      const daGhi = (await yeuCauCua(c.intentId)).filter((y) => y.trangThai === "DA_GHI_NHAN");
      expect(daGhi.length, `vòng ${vong}: yêu cầu ĐÃ GHI ⇔ giao dịch gõ sai được ghi`).toBe(t1?.status === "MATCHED" ? 1 : 0);
      expect((await phieuGopDb(c.billId)).status, `vòng ${vong}`).toBe("PAID");
      expect(await chayHandler(DON_RIENG), `vòng ${vong}`).toBe(1);
      expect(await bienNhan(DON_RIENG), `vòng ${vong}: ĐÚNG 1 biên nhận`).toBe(1);
      thang.push(t1?.status === "MATCHED" ? "sale" : "tự động");
    }
    console.info(`[HN3-DB-03d] bên thắng mỗi vòng: ${thang.join(" · ")}`);
  });

  it("[HN3-DB-04] HAI sale, HAI phiếu thẻ, MỘT giao dịch: đúng một bên giữ được, bên thua nhận câu tử tế và KHÔNG dòng nào đổi", async () => {
    // Hai phiếu thẻ cùng số tiền, cùng máy ⇒ giao dịch gõ sai là ứng viên của CẢ HAI.
    const c1 = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    const g2 = await phatPhieu(DON_PHU, [DOT_D], ACTOR2);
    const p2 = await moPhieu(DON_PHU, DOT_D, { actor: ACTOR2 });
    expect(p2.code5).toBe(g2.ma);
    await chuaThay(p2.intentId);

    const [k1, k2] = await Promise.all([
      guiCho(DON, c1.intentId, c1.bt),
      guiCho(DON_PHU, p2.intentId, c1.bt, { actor: ACTOR2 }),
    ]);
    const thang = [k1, k2].filter((r) => r.ok);
    const thua = [k1, k2].filter((r) => !r.ok);
    expect(thang, "đúng một bên giữ được").toHaveLength(1);
    expect(thua).toHaveLength(1);
    expect(LOI_BANG(thua[0]!)).toMatch(/đang được giữ cho phiếu khác/);
    const tatCa = await db.posSaiMaYeuCau.findMany({ where: { bankTransactionId: c1.bt } });
    expect(tatCa, "một giao dịch một yêu cầu").toHaveLength(1);
    // Có phiếu thẻ cạnh tranh ⇒ không bao giờ tự ghi nhận: bên thắng chờ kế toán.
    expect(thang[0]).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN" });
    expect(await soPayment(DON)).toBe(0);
    expect(await soPayment(DON_PHU)).toBe(0);
  });

  it("[HN3-DB-04b] BẤM ĐÚP (cùng người, cùng cặp) idempotent: lần hai trả đúng yêu cầu cũ và KHÔNG ghi gì", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    const k1 = await guiCho(DON, c.intentId, c.bt);
    expect(k1).toMatchObject({ ok: true, daCo: false });
    const truoc = await chup();
    const k2 = await guiCho(DON, c.intentId, c.bt);
    expect(k2).toMatchObject({ ok: true, daCo: true, yeuCauId: (k1 as { yeuCauId: string }).yeuCauId });
    expect(await chup(), "lần bấm thứ hai không đổi một dòng nào").toBe(truoc);
  });

  it("[HN3-DB-05] CHỜ KẾ TOÁN: hai ứng viên ⇒ yêu cầu CHO_DUYET, phiếu thẻ CAN_XU_LY gắn giao dịch; sale thấy câu chờ; báo kế toán KHÔNG chứa ghi chú gốc", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    const m2 = maGd();
    await nhapFile([dong({ maGiaoDich: m2, dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445566" })]);

    const kq = await guiCho(DON, c.intentId, c.bt);
    expect(kq).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET", daCo: false });
    expect((kq as { lyDo: string[] }).lyDo).toContain("NHIEU_UNG_VIEN");

    const yc = (await yeuCauCua(c.intentId))[0]!;
    expect(yc).toMatchObject({ kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET", nguoiGuiId: SALE, nguoiQuyetId: null });
    expect(yc.lyDo).toContain("NHIEU_UNG_VIEN");
    const p = await phieuPos(c.intentId);
    expect(p.status).toBe("CAN_XU_LY");
    expect(p.bankTransactionId, "phiếu GIỮ giao dịch sale chọn").toBe(c.bt);
    expect(p.lastResultMessage).toBe(CAU_CHO_KE_TOAN);
    expect((await btThe(c.m))?.status, "chưa ghi tiền").toBe("UNMATCHED");
    expect(await soPayment()).toBe(0);

    // View: sale thấy đúng câu + trạng thái.
    const v = await docPhieuPosView(c.intentId, GUI);
    expect(v?.hienThi).toBe("CAN_XU_LY");
    expect(v?.thongDiep).toBe(CAU_CHO_KE_TOAN);
    expect(v?.choKeToan).toBe(true);
    expect(v?.saiMa).toMatchObject({ trangThai: "CHO_DUYET", hieuLuc: "CHO_DUYET", lyDoTuChoi: null });

    // Thông báo tới người nhận báo POS; nội dung KHÔNG mang ghi chú gốc / số thẻ / tên phụ huynh.
    const bao = await thongBaoNguoi(KT, "pos.sai-ma:");
    expect(bao).toHaveLength(1);
    expect(bao[0]!.dedupeKey).toBe(`pos.sai-ma:${yc.id}`);
    const chu = `${bao[0]!.title} ${bao[0]!.body}`;
    expect(chu).toContain(c.ma);
    expect(chu).not.toContain("411111");
    expect(chu).not.toContain("Phụ huynh fixture");
    expect(await thongBaoNguoi(ADMIN, "pos.sai-ma:")).toHaveLength(1);
    expect(await thongBaoNguoi(SALE, "pos.sai-ma:"), "sale không nhận báo dành cho kế toán").toHaveLength(0);

    // T21: phiếu thẻ đang chờ kế toán ⇒ KHÔNG mở được phiếu mới, KHÔNG huỷ được phiếu gộp.
    const may1 = await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: MAY1 } });
    const moMoi = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, posTerminalId: may1.id, actor: ACTOR, now: GUI });
    expect(moMoi, "đúng câu T21, không phải lỗi chọn máy").toEqual({
      ok: false,
      error: "Giao dịch thẻ trước còn chờ kế toán xử lý — xử lý xong mới thu thẻ tiếp",
    });
    const huy = await huyPhieuGop({ orderId: DON, billId: c.billId, lyDo: "", actor: ACTOR, now: GUI });
    expect(huy).toEqual({
      ok: false,
      error: "Giao dịch thẻ của mã này còn chờ kế toán xử lý — xử lý xong mới huỷ được phiếu",
    });
    expect((await phieuGopDb(c.billId)).status).toBe("OPEN");
  });

  it("[HN3-DB-05b] Kiểm tra bình thường lúc chờ duyệt KHÔNG đè câu 'Chờ kế toán xác nhận…'", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445567" })]);
    await guiCho(DON, c.intentId, c.bt);
    const kq = await kiemTraPhieuPos({
      intentId: c.intentId,
      provider: new FakePosProvider(),
      triggeredBy: "SALE" as TriggeredBy,
      now: new Date(GUI.getTime() + 30_000),
      nguoiKiemId: null,
    });
    expect(kq.status).toBe("CAN_XU_LY");
    const p = await phieuPos(c.intentId);
    expect(p.lastResultMessage).toBe(CAU_CHO_KE_TOAN);
    expect((await docPhieuPosView(c.intentId, GUI))?.thongDiep).toBe(CAU_CHO_KE_TOAN);
    // Câu LƯU có thể cũ (một đường ghi nào đó đè nó): VIEW vẫn nói theo YÊU CẦU, không theo câu lưu — phép ghim ở mức DB cho dòng
    // CHO_DUYET → CAU_CHO_KE_TOAN của dungPhieuPosView (cấy lỗi M17: bản đầu của ca này xanh dù dòng đó bị gỡ, vì câu lưu tình cờ trùng).
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { lastResultMessage: "Câu lưu cũ — không được hiện" } });
    expect((await docPhieuPosView(c.intentId, GUI))?.thongDiep, "view suy từ yêu cầu, không đọc câu lưu").toBe(CAU_CHO_KE_TOAN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 06..08 · duyệt, từ chối, đua
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] kế toán duyệt / từ chối", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Cảnh chờ duyệt: hai ứng viên cùng tiền ⇒ chờ kế toán. */
  async function canhChoDuyet(o: { orderId?: string; dot?: string } = {}) {
    const orderId = o.orderId ?? DON;
    const dot = o.dot ?? DOT_A;
    const c = await dungCanh({ orderId, dot }, () => "");
    const bt2 = maGd();
    await nhapFile([dong({ maGiaoDich: bt2, dienGiai: "", soTien: c.g.tongTien, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445568" })]);
    const kq = await guiCho(orderId, c.intentId, c.bt);
    expect(kq).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN" });
    const yc = (await yeuCauCua(c.intentId))[0]!;
    return { ...c, yc, bt2, orderId };
  }

  it("[HN3-DB-06] DUYỆT ⇒ DA_GHI_NHAN + phiếu thẻ DA_THU + đúng 1 bộ Payment + audit người duyệt + báo người gửi; TỰ DUYỆT bị từ chối, ảnh chụp không đổi", async () => {
    const c = await canhChoDuyet();

    // Người gửi tự duyệt: bị từ chối, 0 dòng đổi.
    const truoc = await chup();
    const tu = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: ACTOR, now: QUYET });
    expect(tu.ok).toBe(false);
    expect(LOI_BANG(tu)).toMatch(/người khác/);
    expect(await chup(), "tự duyệt không đổi một dòng nào").toBe(truoc);

    // Đối chứng dương: kế toán KHÁC duyệt được.
    const kq = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET });
    expect(kq).toMatchObject({ ok: true, trangThai: "DA_GHI_NHAN" });
    const yc = await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } });
    expect(yc).toMatchObject({ trangThai: "DA_GHI_NHAN", nguoiQuyetId: KT });
    expect(yc.quyetLuc?.getTime()).toBe(QUYET.getTime());
    expect((await btThe(c.m))?.status).toBe("MATCHED");
    expect(await soPayment()).toBe(1);
    expect(await soPhanBo()).toBe(1);
    expect((await phieuPos(c.intentId)).status).toBe("DA_THU");
    expect((await phieuGopDb(c.billId)).status).toBe("PAID");
    expect(await suKienDaChia(DON)).toHaveLength(1);
    const au = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: "POS_SAI_MA_DUYET" } });
    expect(au).toHaveLength(1);
    expect(au[0]!.actorId, "người duyệt thật").toBe(KT);

    // Báo người gửi kết quả (khoá `pos.sai-ma-kq:`).
    const kqBao = await thongBaoNguoi(SALE, "pos.sai-ma-kq:");
    expect(kqBao).toHaveLength(1);
    expect(kqBao[0]!.dedupeKey).toBe(`pos.sai-ma-kq:${c.yc.id}`);

    // Duyệt lần hai: đã xử lý ⇒ từ chối, không ghi đôi.
    const lai = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT2, now: new Date(QUYET.getTime() + PHUT) });
    expect(lai.ok).toBe(false);
    expect(await soPayment()).toBe(1);
  });

  it("[HN3-DB-07] TỪ CHỐI: lý do ngắn bị từ chối; hợp lệ ⇒ TU_CHOI, phiếu CHO_QUET + nhả giao dịch; phiếu KHÁC thấy lại giao dịch, chính phiếu này thì không", async () => {
    const c = await canhChoDuyet();
    // Lý do < 5 ký tự: 0 dòng đổi.
    const truoc = await chup();
    const ngan = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: "no", actor: A_KT, now: QUYET });
    expect(ngan.ok).toBe(false);
    expect(await chup()).toBe(truoc);
    // Người gửi tự từ chối cũng không.
    const tuTu = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: "không phải giao dịch của khách", actor: ACTOR, now: QUYET });
    expect(tuTu.ok).toBe(false);
    expect(await chup()).toBe(truoc);

    const lyDo = "Đây là giao dịch của khách khác";
    const kq = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo, actor: A_KT, now: QUYET });
    expect(kq).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
    const yc = await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } });
    expect(yc).toMatchObject({ trangThai: "TU_CHOI", nguoiQuyetId: KT, lyDoTuChoi: lyDo });
    const p = await phieuPos(c.intentId);
    expect(p.status).toBe("CHO_QUET");
    expect(p.bankTransactionId, "NHẢ giao dịch").toBeNull();
    expect((await btThe(c.m))?.status, "giao dịch giữ UNMATCHED").toBe("UNMATCHED");
    expect((await phieuGopDb(c.billId)).status, "phiếu gộp vẫn OPEN").toBe("OPEN");
    expect(await soPayment()).toBe(0);
    expect(p.lastResultMessage).toBe(cauTuChoi(lyDo));
    const au = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON, action: "POS_SAI_MA_TU_CHOI" } });
    expect(au).toHaveLength(1);
    expect(au[0]!.reason).toBe(lyDo);
    expect((await thongBaoNguoi(SALE, "pos.sai-ma-kq:")).length, "báo người gửi").toBe(1);

    // ĐỐI CHỨNG DƯƠNG #1: một phiếu thẻ KHÁC (đơn khác, cùng tiền, cùng máy) thấy lại giao dịch vừa nhả.
    const g2 = await phatPhieu(DON_PHU, [DOT_D], ACTOR2);
    const p2 = await moPhieu(DON_PHU, DOT_D, { actor: ACTOR2 });
    expect(p2.code5).toBe(g2.ma);
    await chuaThay(p2.intentId);
    const tim2 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON_PHU, intentId: p2.intentId, now: GUI });
    expect(tim2.ok, "phiếu khác tìm được").toBe(true);
    expect(tim2.ok && tim2.ungVien.map((u) => u.bankTransactionId)).toContain(c.bt);
    // ĐỐI CHỨNG DƯƠNG #2: chính phiếu này KHÔNG còn thấy giao dịch đã bị bác ở danh sách của mình…
    const tim1 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim1.ok, "phiếu này tìm được (chỉ là không còn giao dịch bị bác)").toBe(true);
    expect(tim1.ok && tim1.ungVien.map((u) => u.bankTransactionId)).not.toContain(c.bt);
    // …và gửi lại đúng cặp bị từ chối ở cổng.
    await chuaThay(c.intentId, new Date(GUI.getTime() + PHUT));
    const lai = await guiCho(DON, c.intentId, c.bt, { now: new Date(GUI.getTime() + 2 * PHUT) });
    expect(lai.ok).toBe(false);
    expect(LOI_BANG(lai)).toMatch(/từ chối/);
    // Cổng huỷ phiếu gộp vẫn chặn: phiếu thẻ đã về CHO_QUET (khách có thể đang quẹt).
    const huy = await huyPhieuGop({ orderId: DON, billId: c.billId, lyDo: "", actor: ACTOR, now: new Date(GUI.getTime() + 3 * PHUT) });
    expect(huy.ok).toBe(false);
  });

  it("[HN3-DB-08] ĐUA duyệt ‖ từ chối ×4 (2 + 2): đúng một bên thắng; tiền ghi ⇔ DA_GHI_NHAN (không ghi tiền cho yêu cầu đã bị bác)", async () => {
    const c = await canhChoDuyet();
    const kq = await Promise.all([
      duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET }),
      tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT2, now: QUYET }),
      duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT2, now: QUYET }),
      tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: "Giao dịch của phụ huynh khác", actor: A_KT, now: QUYET }),
    ]);
    const thang = kq.filter((r) => r.ok);
    expect(thang, "đúng MỘT bên quyết được").toHaveLength(1);
    for (const r of kq) if (!r.ok) expect(r.error).toMatch(/đã được xử lý|đang ghi|không còn/i);
    const yc = await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } });
    expect(["DA_GHI_NHAN", "TU_CHOI"]).toContain(yc.trangThai);
    expect(await soPayment(), "tiền ghi ⇔ DA_GHI_NHAN").toBe(yc.trangThai === "DA_GHI_NHAN" ? 1 : 0);
    expect((await btThe(c.m))?.status).toBe(yc.trangThai === "DA_GHI_NHAN" ? "MATCHED" : "UNMATCHED");
    expect((await phieuPos(c.intentId)).status).toBe(yc.trangThai === "DA_GHI_NHAN" ? "DA_THU" : "CHO_QUET");
  });

  it("[HN3-DB-27] mỗi cổng của bước DUYỆT (trước pha tiền) từ chối bằng câu RIÊNG, ảnh chụp y hệt; hoàn nguyên thì duyệt ĐƯỢC (đối chứng dương)", async () => {
    const c = await canhChoDuyet();
    const datPhieu = (data: Record<string, unknown>) => () => db.posPaymentIntent.update({ where: { id: c.intentId }, data });
    const bang: [string, () => Promise<unknown>, () => Promise<unknown>, string | RegExp][] = [
      [
        "giao dịch đã bị kế toán BỎ QUA ở nơi khác",
        () => db.bankTransaction.update({ where: { id: c.bt }, data: { status: "IGNORED" } }),
        () => db.bankTransaction.update({ where: { id: c.bt }, data: { status: "UNMATCHED" } }),
        "Giao dịch đã được xử lý ở nơi khác (gắn tay / bỏ qua / gỡ gắn) — không còn gì để duyệt",
      ],
      [
        "phiếu thẻ không còn giữ giao dịch này",
        datPhieu({ status: "CHO_QUET", bankTransactionId: null }),
        datPhieu({ status: "CAN_XU_LY", bankTransactionId: c.bt }),
        "Phiếu thẻ không còn giữ giao dịch này — tải lại trang",
      ],
      [
        "phiếu gộp không còn mở",
        () => db.paymentBill.update({ where: { id: c.billId }, data: { status: "PAID" } }),
        () => db.paymentBill.update({ where: { id: c.billId }, data: { status: "OPEN" } }),
        "Phiếu gộp không còn mở — không ghi tiền tự động được; từ chối yêu cầu hoặc xử lý tay",
      ],
      [
        "số phải thu của phiếu đã đổi",
        () => db.paymentRequest.update({ where: { id: DOT_A }, data: { amountDue: DOT_TIEN_A - 1_000 } }),
        () => db.paymentRequest.update({ where: { id: DOT_A }, data: { amountDue: DOT_TIEN_A } }),
        /^Số phải thu của phiếu đã đổi \(còn .*đ, giao dịch .*đ\) — không ghi tự động được; từ chối hoặc gắn tay$/,
      ],
      [
        "đơn đã huỷ",
        () => db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } }),
        () => db.order.update({ where: { id: DON }, data: { status: "PENDING_PAYMENT" } }),
        "Đơn không nhận tiền được (nháp / đã huỷ / đã hoàn / đã xoá)",
      ],
    ];
    for (const [ten, ap, hoan, cau] of bang) {
      await ap();
      const antes = await chup();
      const kq = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET });
      expect(kq.ok, `${ten}: phải từ chối`).toBe(false);
      if (typeof cau === "string") expect(kq.ok === false && kq.error, ten).toBe(cau);
      else expect(kq.ok === false && kq.error, ten).toMatch(cau);
      expect(await chup(), `${ten}: không dòng nào đổi`).toBe(antes);
      expect((await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } })).trangThai, `${ten}: yêu cầu vẫn CHO_DUYET`).toBe("CHO_DUYET");
      await hoan();
    }
    // ĐỐI CHỨNG DƯƠNG: hoàn nguyên mọi thứ ⇒ cùng một lệnh duyệt ĐƯỢC, ghi đúng 1 Payment.
    const ok = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET });
    expect(ok).toMatchObject({ ok: true, trangThai: "DA_GHI_NHAN" });
    expect(await soPayment()).toBe(1);
  }, 30_000);

  it("[HN3-DB-28] mỗi cổng của bước TỪ CHỐI từ chối bằng câu RIÊNG, ảnh chụp y hệt, phiếu thẻ KHÔNG bị nhả; hoàn nguyên thì từ chối ĐƯỢC (đối chứng dương)", async () => {
    const c = await canhChoDuyet();
    const LY_DO = "Giao dịch của khách khác";
    const datYc = (data: Record<string, unknown>) => () => db.posSaiMaYeuCau.update({ where: { id: c.yc.id }, data });
    const veChoDuyet = datYc({ trangThai: "CHO_DUYET", dangGhiLuc: null, nguoiQuyetId: null, quyetLuc: null, lyDoTuChoi: null });
    const bang: [string, () => Promise<unknown>, () => Promise<unknown>, string][] = [
      [
        "giao dịch đã bị kế toán BỎ QUA / gắn tay ở nơi khác",
        () => db.bankTransaction.update({ where: { id: c.bt }, data: { status: "IGNORED" } }),
        () => db.bankTransaction.update({ where: { id: c.bt }, data: { status: "UNMATCHED" } }),
        "Giao dịch đã được xử lý ở nơi khác (gắn tay / bỏ qua / gỡ gắn) — không còn gì để duyệt",
      ],
      [
        "giao dịch đã được GỠ GẮN (vẫn UNMATCHED nhưng mang ghi chú gỡ gắn)",
        () => db.bankTransaction.update({ where: { id: c.bt }, data: { unmatchedNote: `${TIEN_TO_GO_GAN}nhầm đơn` } }),
        () => db.bankTransaction.update({ where: { id: c.bt }, data: { unmatchedNote: null } }),
        "Giao dịch đã được xử lý ở nơi khác (gắn tay / bỏ qua / gỡ gắn) — không còn gì để duyệt",
      ],
      [
        "phiếu thẻ không còn giữ giao dịch này",
        () => db.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "CHO_QUET", bankTransactionId: null } }),
        () => db.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "CAN_XU_LY", bankTransactionId: c.bt } }),
        "Phiếu thẻ không còn giữ giao dịch này — tải lại trang",
      ],
      [
        "yêu cầu đang GHI TIỀN (không từ chối được yêu cầu đang ghi tiền)",
        datYc({ trangThai: "DANG_GHI", dangGhiLuc: QUYET, nguoiQuyetId: KT, quyetLuc: QUYET }),
        veChoDuyet,
        "Yêu cầu đang ghi nhận — thử lại sau ít phút",
      ],
      [
        "yêu cầu đã được GHI NHẬN",
        datYc({ trangThai: "DA_GHI_NHAN", nguoiQuyetId: KT, quyetLuc: QUYET }),
        veChoDuyet,
        "Yêu cầu đã được xử lý",
      ],
      [
        "yêu cầu đã bị TỪ CHỐI trước đó",
        datYc({ trangThai: "TU_CHOI", nguoiQuyetId: KT, quyetLuc: QUYET, lyDoTuChoi: "đã bác từ trước" }),
        veChoDuyet,
        "Yêu cầu đã được xử lý",
      ],
    ];
    for (const [ten, ap, hoan, cau] of bang) {
      await ap();
      const antes = await chup();
      const kq = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: LY_DO, actor: A_KT, now: QUYET });
      expect(kq, ten).toEqual({ ok: false, error: cau });
      expect(await chup(), `${ten}: không dòng nào đổi`).toBe(antes);
      await hoan();
    }
    // ĐỐI CHỨNG DƯƠNG: hoàn nguyên mọi thứ ⇒ cùng lệnh từ chối ĐƯỢC; giao dịch nhả về hàng chờ, phiếu thẻ về CHO_QUET.
    const ok = await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: LY_DO, actor: A_KT, now: QUYET });
    expect(ok).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
    expect((await phieuPos(c.intentId)).status).toBe("CHO_QUET");
    expect((await phieuPos(c.intentId)).bankTransactionId).toBeNull();
    expect((await btThe(c.m))?.status).toBe("UNMATCHED");
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 09..10 · bộ lọc ứng viên (từng vế + đối chứng dương)
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] ứng viên — mỗi vế loại một giao dịch, KÈM đối chứng dương", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Danh sách id giao dịch ứng viên — NÉM nếu việc tìm bị từ chối: ca "không có ứng viên" không được xanh vì tìm hỏng. */
  const timIds = async (orderId: string, intentId: string, now = GUI) => {
    const r = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId, intentId, now });
    if (!r.ok) throw new Error(`timUngVienSaiMa bị từ chối: ${r.error}`);
    return r.ungVien.map((u) => u.bankTransactionId);
  };

  it("[HN3-DB-09] VOID / hoàn một phần / hủy: dòng hủy trỏ vào gốc (maGiaoDichGoc), dòng hủy cùng RRN, cột hoàn một phần ⇒ KHÔNG là ứng viên; gỡ dòng ấy ⇒ lại là ứng viên", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    expect(await timIds(DON, c.intentId), "đối chứng gốc: là ứng viên").toEqual([c.bt]);

    // (i) dòng Hủy trỏ `maGiaoDichGoc` vào gốc (giả lập hủy chưa được lõi xét xong: chèn thẳng, không qua nhập lô).
    const huy = `${PFX}HUY001`;
    await db.posCardTransaction.create({
      data: {
        maGiaoDich: huy, loaiGiaoDich: "Hủy", hinhThuc: "Thẻ", trangThai: "Thành công", soTien: -DOT_TIEN_A,
        thoiGianGiaoDich: new Date("2026-10-06T10:35:00Z"), dienGiai: "", maGiaoDichGoc: c.m, maThietBi: MAY1,
        centerId: CS1, matchStatus: "CAN_XU_LY", matchReason: "Chưa thấy giao dịch gốc",
      },
    });
    expect(await timIds(DON, c.intentId), "có dòng hủy trỏ vào ⇒ loại").toEqual([]);
    await db.posCardTransaction.delete({ where: { maGiaoDich: huy } });
    expect(await timIds(DON, c.intentId), "gỡ dòng hủy ⇒ lại là ứng viên").toEqual([c.bt]);

    // (ii) dòng KHÔNG-phải-thanh-toán CÙNG RRN (agent: VOID dùng chung RRN với gốc, không mang mã gốc).
    const voidRrn = `${PFX}VOID02`;
    await db.posCardTransaction.create({
      data: {
        maGiaoDich: voidRrn, loaiGiaoDich: "Hủy", hinhThuc: "Thẻ", trangThai: "Thành công", soTien: -DOT_TIEN_A,
        thoiGianGiaoDich: new Date("2026-10-06T10:36:00Z"), dienGiai: "", maGiaoDichThe: "998877665544", maThietBi: MAY1,
        centerId: CS1, matchStatus: "CAN_XU_LY",
      },
    });
    expect(await timIds(DON, c.intentId), "dòng hủy cùng RRN ⇒ loại").toEqual([]);
    await db.posCardTransaction.delete({ where: { maGiaoDich: voidRrn } });
    expect(await timIds(DON, c.intentId)).toEqual([c.bt]);

    // (iii) cột Hoàn/Hủy ghi MỘT PHẦN trên chính dòng gốc.
    await db.posCardTransaction.update({ where: { maGiaoDich: c.m }, data: { trangThaiHoanHuy: "Hoàn một phần" } });
    expect(await timIds(DON, c.intentId), "hoàn một phần ⇒ loại").toEqual([]);
    await db.posCardTransaction.update({ where: { maGiaoDich: c.m }, data: { trangThaiHoanHuy: null } });
    expect(await timIds(DON, c.intentId), "bỏ cột ⇒ lại là ứng viên").toEqual([c.bt]);

    // (iv) cảnh báo hủy sau ghi nhận còn mở.
    await db.posCardTransaction.update({ where: { maGiaoDich: c.m }, data: { canhBaoHuy: true } });
    expect(await timIds(DON, c.intentId)).toEqual([]);
    await db.posCardTransaction.update({ where: { maGiaoDich: c.m }, data: { canhBaoHuy: false } });
    expect(await timIds(DON, c.intentId)).toEqual([c.bt]);
  });

  it("[HN3-DB-10] bộ lọc từng vế: lệch 1 đồng · khác máy · máy CS2 (Q-E) · máy của phiếu TẮT · máy đổi cơ sở · ngoài cửa sổ · đã gỡ gắn · đã gắn phiếu khác · đã có yêu cầu giữ — mỗi vế một đối chứng dương", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A, may: MAY1 }, saiMotKyTu);
    expect(await timIds(DON, c.intentId), "đối chứng gốc").toEqual([c.bt]);

    // — lệch 1 đồng: giao dịch ±1 đồng không phải ứng viên; số khớp thì có.
    const lech = maGd();
    await nhapFile([dong({ maGiaoDich: lech, dienGiai: "", soTien: DOT_TIEN_A + 1, thoiGian: "2026-10-06T17:33:00+07:00", maGiaoDichThe: "5544332211" })]);
    expect(await timIds(DON, c.intentId), "lệch +1 đồng bị loại").toEqual([c.bt]);
    await db.posCardTransaction.update({ where: { maGiaoDich: lech }, data: { soTien: DOT_TIEN_A } });
    expect((await timIds(DON, c.intentId)).sort(), "đúng số thì thành ứng viên").toEqual([c.bt, await btId(lech)].sort());
    await db.posCardTransaction.update({ where: { maGiaoDich: lech }, data: { soTien: DOT_TIEN_A - 1 } });
    expect(await timIds(DON, c.intentId), "lệch −1 đồng bị loại").toEqual([c.bt]);

    // — khác máy CÙNG cơ sở (phiếu đã chốt MAY1): MAY3 không phải máy của phiếu.
    const may3 = maGd();
    await nhapFile([dong({ maGiaoDich: may3, dienGiai: "", soTien: DOT_TIEN_A, maThietBi: MAY3, maQuay: "QTT3RDHN3", thoiGian: "2026-10-06T17:34:00+07:00", maGiaoDichThe: "6655443322" })]);
    expect(await timIds(DON, c.intentId), "khác máy bị loại").toEqual([c.bt]);
    // Phiếu CHƯA chốt máy ⇒ mọi máy ĐANG BẬT của cơ sở đơn.
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { posTerminalId: null } });
    expect((await timIds(DON, c.intentId)).sort(), "phiếu chưa chốt máy ⇒ cả máy thứ hai của cơ sở").toEqual([c.bt, await btId(may3)].sort());
    const may1 = await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: MAY1 } });
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { posTerminalId: may1.id } });

    // — máy CS2 (quẹt chéo cơ sở, Q-E): giao dịch của máy cơ sở khác không phải ứng viên.
    const cheo = maGd();
    await nhapFile([dong({ maGiaoDich: cheo, dienGiai: "", soTien: DOT_TIEN_A, maThietBi: MAY2, maQuay: "QTTFBKATK", thoiGian: "2026-10-06T17:35:00+07:00", maGiaoDichThe: "7766554433" })]);
    expect(await timIds(DON, c.intentId), "máy CS2 bị loại").toEqual([c.bt]);
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { posTerminalId: null } });
    expect(await timIds(DON, c.intentId), "kể cả khi phiếu chưa chốt máy (chỉ máy của CƠ SỞ ĐƠN)").not.toContain(await btId(cheo));
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { posTerminalId: may1.id } });

    // — máy của phiếu bị TẮT: không ứng viên + câu riêng; bật lại ⇒ lại có.
    await db.posTerminal.update({ where: { id: may1.id }, data: { active: false } });
    const tat = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tat).toMatchObject({ ok: false });
    expect(!tat.ok && tat.error).toMatch(/Máy POS của phiếu này đã bị tắt/);
    await db.posTerminal.update({ where: { id: may1.id }, data: { active: true } });
    expect(await timIds(DON, c.intentId)).toEqual([c.bt]);

    // — máy ĐỔI CƠ SỞ sau khi mở phiếu (đường tiền chặn Q-E theo cơ sở HIỆN TẠI của máy): máy sang CS2 ⇒ không ứng viên; về CS1 ⇒ có.
    await db.posTerminal.update({ where: { id: may1.id }, data: { centerId: CS2 } });
    const doi = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(doi.ok, "máy không còn thuộc cơ sở của đơn").toBe(false);
    await db.posTerminal.update({ where: { id: may1.id }, data: { centerId: CS1 } });
    expect(await timIds(DON, c.intentId)).toEqual([c.bt]);

    // — NGOÀI CỬA SỔ thời gian: trước (mở − 5′) và sau hiện tại bị loại.
    const som = maGd();
    await nhapFile([dong({ maGiaoDich: som, dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T16:54:59+07:00", maGiaoDichThe: "1100223344" })]); // 09:54:59Z < 09:55:00Z
    const vua = maGd();
    await nhapFile([dong({ maGiaoDich: vua, dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T16:55:00+07:00", maGiaoDichThe: "1100223355" })]); // đúng biên 09:55:00Z
    const muon = maGd();
    await nhapFile([dong({ maGiaoDich: muon, dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:45:01+07:00", maGiaoDichThe: "1100223366" })]); // 10:45:01Z > GUI
    const dsCuaSo = await timIds(DON, c.intentId);
    expect(dsCuaSo, "sớm hơn biên 1 giây bị loại").not.toContain(await btId(som));
    expect(dsCuaSo, "đúng biên (mở − 5′) được nhận").toContain(await btId(vua));
    expect(dsCuaSo, "sau thời điểm hiện tại bị loại").not.toContain(await btId(muon));
    expect(await timIds(DON, c.intentId, new Date("2026-10-06T10:45:01Z")), "đối chứng: dời 'hiện tại' qua giao dịch ấy thì nhận").toContain(await btId(muon));

    // — ĐÃ GỠ GẮN (kế toán đã quyết).
    await db.bankTransaction.update({ where: { id: c.bt }, data: { unmatchedNote: "Đã gỡ gắn: nhầm đơn" } });
    expect(await timIds(DON, c.intentId), "đã gỡ gắn ⇒ loại").not.toContain(c.bt);
    await db.bankTransaction.update({ where: { id: c.bt }, data: { unmatchedNote: null } });
    expect(await timIds(DON, c.intentId)).toContain(c.bt);

    // — ĐÃ GẮN PHIẾU THẺ KHÁC: một phiếu khác đang giữ giao dịch thì phiếu này không thấy.
    const g2 = await phatPhieu(DON_PHU, [DOT_D], ACTOR2);
    const p2 = await moPhieu(DON_PHU, DOT_D, { actor: ACTOR2, may: MAY1 });
    expect(p2.code5).toBe(g2.ma);
    await chuaThay(p2.intentId); // phiếu thứ hai cũng đang 'Chưa thấy' ⇒ việc tìm của nó KHÔNG bị từ chối vì lý do khác
    expect(await timIds(DON_PHU, p2.intentId), "đối chứng: phiếu thứ hai thấy giao dịch này khi chưa ai giữ").toContain(c.bt);
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "CAN_XU_LY", bankTransactionId: c.bt } });
    expect(await timIds(DON_PHU, p2.intentId), "đã gắn phiếu thẻ khác ⇒ loại").not.toContain(c.bt);
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "CHO_QUET", bankTransactionId: null } });
    expect(await timIds(DON_PHU, p2.intentId)).toContain(c.bt);

    // — ĐÃ CÓ YÊU CẦU GIỮ (sống): không ai khác thấy nó.
    const kq = await guiCho(DON, c.intentId, c.bt);
    expect(kq.ok).toBe(true);
    expect(await timIds(DON_PHU, p2.intentId), "đang bị yêu cầu của phiếu khác giữ ⇒ loại").not.toContain(c.bt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11..12 · trạng thái đổi giữa chừng, DANG_GHI mồ côi
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] trạng thái đổi GIỮA lúc giữ và lúc ghi tiền / sập giữa chừng", () => {
  beforeEach(dungFixture);
  afterAll(don);

  async function canhChoDuyet() {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445569" })]);
    await guiCho(DON, c.intentId, c.bt);
    return { ...c, yc: (await yeuCauCua(c.intentId))[0]! };
  }

  it("[HN3-DB-11] phiếu gộp đổi giữa chừng (QR trả trước ngay trước lúc ghi) ⇒ duyệt KHÔNG chia: 0 Payment mới, yêu cầu về CHO_DUYET kèm lý do", async () => {
    const c = await canhChoDuyet();
    h.truocTien = async () => {
      // Khách vừa trả bằng QR ngay trước khi ghi: phiếu gộp không còn mở.
      await db.paymentBill.update({ where: { id: c.billId }, data: { status: "CLOSED" } });
    };
    const kq = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET });
    h.truocTien = null;
    expect(kq.ok, "báo cho kế toán biết CHƯA ghi được").toBe(false);
    expect(await soPayment(), "0 Payment").toBe(0);
    expect((await btThe(c.m))?.status).toBe("UNMATCHED");
    const yc = await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } });
    expect(yc.trangThai, "về CHO_DUYET để kế toán xử lý").toBe("CHO_DUYET");
    expect(yc.lyDo).toContain("GHI_TU_DONG_KHONG_DUOC");
    expect(yc.nguoiQuyetId, "bước duyệt chưa thành ⇒ không giữ người duyệt").toBeNull();
    expect((await phieuPos(c.intentId)).bankTransactionId, "vẫn giữ giao dịch").toBe(c.bt);
  });

  it("[HN3-DB-12] DANG_GHI mồ côi: sập TRƯỚC tiền ⇒ thử lại (sau 2′) ghi đúng 1 lần; sập SAU tiền ⇒ chỉ chốt, 0 Payment mới; chưa đủ 2′ ⇒ từ chối", async () => {
    // (a) sập TRƯỚC tiền.
    const c = await canhChoDuyet();
    h.truocTien = async () => {
      throw new Error("sập trước khi ghi tiền");
    };
    const sap = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET }).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    h.truocTien = null;
    expect(sap.ok).toBe(false);
    const ycKet = await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } });
    expect(ycKet.trangThai, "kẹt ở DANG_GHI, có mốc").toBe("DANG_GHI");
    expect(ycKet.dangGhiLuc?.getTime()).toBe(QUYET.getTime());
    expect(await soPayment()).toBe(0);
    // Chưa đủ 2′: từ chối.
    const som = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT2, now: new Date(QUYET.getTime() + 60_000) });
    expect(som.ok).toBe(false);
    expect(LOI_BANG(som)).toMatch(/đang ghi/i);
    // Đủ 2′: thử lại ghi đúng 1 lần.
    const lai = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT2, now: new Date(QUYET.getTime() + 3 * 60_000) });
    expect(lai).toMatchObject({ ok: true, trangThai: "DA_GHI_NHAN" });
    expect(await soPayment()).toBe(1);
    expect((await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } })).nguoiQuyetId).toBe(KT2);
  });

  it("[HN3-DB-12b] sập SAU tiền (tiền đã vào, yêu cầu còn DANG_GHI) ⇒ thử lại chỉ CHỐT trạng thái, KHÔNG ghi Payment mới", async () => {
    const c = await canhChoDuyet();
    h.sauTien = async () => {
      throw new Error("sập sau khi ghi tiền");
    };
    const sap = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET }).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    h.sauTien = null;
    expect(sap.ok).toBe(false);
    expect((await db.posSaiMaYeuCau.findUniqueOrThrow({ where: { id: c.yc.id } })).trangThai).toBe("DANG_GHI");
    expect(await soPayment(), "tiền ĐÃ vào").toBe(1);
    expect((await btThe(c.m))?.status).toBe("MATCHED");
    const lai = await duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT2, now: new Date(QUYET.getTime() + 3 * 60_000) });
    expect(lai).toMatchObject({ ok: true, trangThai: "DA_GHI_NHAN" });
    expect(await soPayment(), "KHÔNG ghi thêm").toBe(1);
    expect(await soPhanBo()).toBe(1);
    expect(await suKienDaChia(DON)).toHaveLength(1);
  });

  it("[HN3-DB-18] tự ghi nhận nhưng số phải thu ĐỔI sau khi giữ ⇒ yêu cầu về CHO_DUYET kèm GHI_TU_DONG_KHONG_DUOC; sale thấy 'đã chuyển kế toán' (không báo thành công)", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    h.truocTien = async () => {
      // Một đồng khác vừa vào đợt này từ đường khác ⇒ còn phải thu lệch đúng số giao dịch.
      const bt = await db.bankTransaction.create({
        data: { provider: "SEPAY", providerTxnId: `${PFX}KHAC01`, amount: 1_000, transferredAt: new Date("2026-10-06T10:20:00Z"), status: "MATCHED" },
      });
      await db.paymentAllocation.create({ data: { bankTransactionId: bt.id, paymentRequestId: DOT_A, amount: 1_000, roundingWaived: 0, centerId: CS1 } });
    };
    const kq = await guiCho(DON, c.intentId, c.bt);
    h.truocTien = null;
    expect(kq).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "CHO_DUYET" });
    expect((kq as { thongDiep: string }).thongDiep).toMatch(/kế toán/i);
    expect(await soPayment()).toBe(0);
    const yc = (await yeuCauCua(c.intentId))[0]!;
    expect(yc.trangThai).toBe("CHO_DUYET");
    expect(yc.lyDo).toContain("GHI_TU_DONG_KHONG_DUOC");
    expect(yc.kieu, "kieu LÚC GỬI giữ nguyên").toBe("TU_GHI_NHAN");
    // Kế toán nhận báo.
    expect((await thongBaoNguoi(KT, "pos.sai-ma:")).length).toBe(1);
    // Phiếu thẻ: lệch số ⇒ LECH_TIEN, vẫn giữ giao dịch.
    expect((await phieuPos(c.intentId)).bankTransactionId).toBe(c.bt);
    await db.paymentAllocation.deleteMany({ where: { bankTransaction: { providerTxnId: `${PFX}KHAC01` } } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13..17 · luật rollback, gắn tay, maXacNhan, G-A, dữ liệu thiếu
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] cổng — từ chối thì KHÔNG dòng nào đổi; gắn tay; mã xác nhận; dữ liệu thiếu", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-DB-13] LUẬT ROLLBACK: mọi từ chối ở cổng ⇒ ảnh chụp 8 bảng y hệt trước/sau", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    const khac = maGd();
    await nhapFile([dong({ maGiaoDich: khac, dienGiai: "", soTien: DOT_TIEN_A + 5_000, thoiGian: "2026-10-06T17:32:00+07:00", maGiaoDichThe: "9090909090" })]);

    const btKhac = await btId(khac);
    const truoc = await chup();
    const nhieu: [string, () => Promise<{ ok: boolean }>][] = [
      ["giao dịch không phải ứng viên (lệch tiền)", () => guiCho(DON, c.intentId, btKhac)],
      ["id giao dịch không tồn tại", () => guiCho(DON, c.intentId, "khong-co-giao-dich")],
      ["phiếu thuộc đơn khác (IDOR)", () => guiCho(DON_RIENG, c.intentId, c.bt)],
      ["phiếu không tồn tại", () => guiCho(DON, "khong-co-phieu", c.bt)],
      ["phiếu đã quá hạn", () => guiCho(DON, c.intentId, c.bt, { now: new Date(NOW.getTime() + 25 * 60 * PHUT) })],
      ["yêu cầu không tồn tại (duyệt)", () => duyetSaiMa({ orderId: DON, yeuCauId: "khong-co", actor: A_KT, now: QUYET })],
      ["yêu cầu không tồn tại (từ chối)", () => tuChoiSaiMa({ orderId: DON, yeuCauId: "khong-co", lyDo: "đủ dài rồi", actor: A_KT, now: QUYET })],
    ];
    for (const [ten, chay] of nhieu) {
      const kq = await chay();
      expect(kq.ok, ten).toBe(false);
      expect(await chup(), `${ten}: không dòng nào đổi`).toBe(truoc);
    }
    // ĐỐI CHỨNG DƯƠNG: cùng cảnh, gửi đúng thì được.
    expect((await guiCho(DON, c.intentId, c.bt)).ok).toBe(true);
  });

  it("[HN3-DB-14] GẮN TAY ‖ DUYỆT: đúng một bên; yêu cầu thành 'đã xử lý ở nơi khác' (suy ra), hộp phiếu in câu đúng, không ghi đôi", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445570" })]);
    await guiCho(DON, c.intentId, c.bt);
    const yc = (await yeuCauCua(c.intentId))[0]!;

    const [gan, duyet] = await Promise.all([
      ganTienTheoCon({ bankTransactionId: c.bt, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: DOT_TIEN_A }], actor: A_KT, nguoiGan: { loai: "KE_TOAN" } }),
      duyetSaiMa({ orderId: DON, yeuCauId: yc.id, actor: A_KT2, now: QUYET }),
    ]);
    expect([gan.ok, duyet.ok].filter(Boolean).length, "đúng MỘT bên ghi tiền (cả hai có thể báo thành công nếu duyệt chạy sau và chỉ chốt, nhưng Payment chỉ 1)").toBeGreaterThanOrEqual(1);
    expect(await soPayment(), "tiền chỉ vào MỘT lần").toBe(1);
    expect((await btThe(c.m))?.status).toBe("MATCHED");
  });

  it("[HN3-DB-14b] kế toán GẮN TAY trước: yêu cầu CHO_DUYET thành 'đã xử lý ở nơi khác'; duyệt báo đã xử lý; hộp phiếu KHÔNG còn nói 'chờ kế toán'", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445571" })]);
    await guiCho(DON, c.intentId, c.bt);
    const yc = (await yeuCauCua(c.intentId))[0]!;
    // Kế toán bỏ qua giao dịch (đường "Không phải học phí") — không biết gì về yêu cầu (V71).
    await db.bankTransaction.update({ where: { id: c.bt }, data: { status: "IGNORED", unmatchedNote: "Không phải học phí" } });
    const v = await docPhieuPosView(c.intentId, QUYET);
    expect(v?.saiMa?.hieuLuc).toBe("DA_XU_LY_NGOAI");
    expect(v?.thongDiep).not.toBe(CAU_CHO_KE_TOAN);
    expect(v?.thongDiep).toMatch(/xử lý giao dịch này ở nơi khác/);
    const kq = await duyetSaiMa({ orderId: DON, yeuCauId: yc.id, actor: A_KT, now: QUYET });
    expect(kq.ok).toBe(false);
    expect(await soPayment()).toBe(0);
  });

  it("[HN3-DB-15] `maXacNhan` khác code5 của phiếu ⇒ ném TRƯỚC pha tiền, 0 ghi; đúng code5 thì chạy (đối chứng dương)", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "CAN_XU_LY", bankTransactionId: c.bt } });
    const truoc = await chup();
    const ketQua: PosCheckResult = { kind: "PAID", providerTxnId: c.m, amount: DOT_TIEN_A, paidAt: GIO_QUET };
    // `xuLyKetQuaPos` ở đây là hàm BỌC — nó gọi hàm thật.
    const maKhac = c.ma === sinhMa(7) ? sinhMa(8) : sinhMa(7);
    await expect(
      xuLyKetQuaPos({ intentId: c.intentId, ketQua, triggeredBy: "SALE", now: GUI, nguonDuLieu: "FAKE", maXacNhan: maKhac }),
    ).rejects.toThrow(/Mã xác nhận không phải mã của phiếu/);
    expect(await chup(), "ném trước pha tiền ⇒ 0 dòng đổi").toBe(truoc);
    const dung = await xuLyKetQuaPos({ intentId: c.intentId, ketQua, triggeredBy: "SALE", now: GUI, nguonDuLieu: "FAKE", maXacNhan: c.ma });
    expect(dung.status).toBe("DA_THU");
    expect(await soPayment()).toBe(1);
  });

  it("[HN3-DB-16] G-A: có dòng mang ĐÚNG mã của phiếu trong cửa sổ ⇒ gửi bị từ chối (đó là việc của nút Kiểm tra); gỡ dòng ấy ⇒ gửi được", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    const mangMa = `${PFX}GA0001`;
    await db.posCardTransaction.create({
      data: {
        maGiaoDich: mangMa, loaiGiaoDich: "Thanh toán", hinhThuc: "Thẻ", trangThai: "Thất bại", soTien: 1_000_000,
        thoiGianGiaoDich: new Date("2026-10-06T10:20:00Z"), dienGiai: `be Nam ${c.ma}`, maThietBi: MAY3, centerId: CS1,
        matchStatus: "BO_QUA", matchReason: "Giao dịch Thất bại",
      },
    });
    const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim.ok).toBe(false);
    expect(!tim.ok && tim.error).toContain(`Có giao dịch mang mã ${c.ma}`);
    const truoc = await chup();
    const kq = await guiCho(DON, c.intentId, c.bt);
    expect(kq.ok).toBe(false);
    expect(LOI_BANG(kq)).toContain(`Có giao dịch mang mã ${c.ma}`);
    expect(await chup()).toBe(truoc);
    await db.posCardTransaction.delete({ where: { maGiaoDich: mangMa } });
    expect((await guiCho(DON, c.intentId, c.bt)).ok).toBe(true);
  });

  it("[HN3-DB-17] DỮ LIỆU THIẾU ⇒ ÉP chờ kế toán (DU_LIEU_THIEU): máy đồng bộ hết phiên · dòng bị từ chối chưa giải · file chưa phủ lúc sau mở phiếu — mỗi vế một đối chứng dữ liệu đủ", async () => {
    // (a) cơ sở có máy đồng bộ ĐANG BẬT mà phiên EXPIRED.
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    const agent = await db.posAgent.create({
      data: { centerId: CS1, merchantCode: `${PFX}MC01`, active: true, sessionState: "EXPIRED", lastHeartbeatAt: new Date(GUI.getTime() - 10_000) },
    });
    const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim.ok && tim.ungVien[0]?.xemTruoc.quyet, "agent hết phiên ⇒ chờ kế toán").toBe("CHO_KE_TOAN");
    expect(tim.ok && tim.ungVien[0]?.xemTruoc.lyDo).toContain("DU_LIEU_THIEU");
    // Đối chứng: phiên sẵn sàng + nhịp tim mới ⇒ tự ghi nhận.
    await db.posAgent.update({ where: { id: agent.id }, data: { sessionState: "READY" } });
    const tim2 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim2.ok && tim2.ungVien[0]?.xemTruoc.quyet, "agent sẵn sàng ⇒ tự ghi nhận").toBe("TU_GHI_NHAN");

    // (b) dòng BỊ TỪ CHỐI của máy đồng bộ chưa giải trong cửa sổ.
    await db.posTxnSource.create({
      data: {
        maGiaoDich: `${PFX}TC0001`, nguon: "AGENT", posAgentId: agent.id, lanDauThay: new Date("2026-10-06T10:30:00Z"), lanCuoiThay: new Date("2026-10-06T10:30:00Z"),
        bam: "a".repeat(64), thoiGianGiaoDich: new Date("2026-10-06T10:30:00Z"), tuChoi: "FIELD_TOO_LONG", centerId: CS1,
      },
    });
    const tim3 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim3.ok && tim3.ungVien[0]?.xemTruoc.lyDo, "có dòng bị từ chối chưa giải").toContain("DU_LIEU_THIEU");
    await db.posTxnSource.deleteMany({ where: { maGiaoDich: `${PFX}TC0001` } });
    expect((await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI }).then((r) => r.ok && r.ungVien[0]?.xemTruoc.quyet)), "gỡ dòng ⇒ tự ghi nhận").toBe("TU_GHI_NHAN");
    await db.posAgent.delete({ where: { id: agent.id } });

    // (c) chế độ FILE: dữ liệu của cơ sở KHÔNG có giao dịch nào mới hơn lúc mở phiếu.
    // Giao dịch đang xét quẹt lúc 09:57Z — TRƯỚC lúc mở phiếu (10:00Z) nhưng trong cửa sổ (mở − 5′) — và là giao dịch DUY NHẤT của
    // cơ sở ⇒ dữ liệu file chưa phủ tới lúc sau mở phiếu.
    await db.posCardTransaction.update({ where: { maGiaoDich: c.m }, data: { thoiGianGiaoDich: new Date("2026-10-06T09:57:00Z") } });
    await db.bankTransaction.update({ where: { id: c.bt }, data: { transferredAt: new Date("2026-10-06T09:57:00Z") } });
    const tim4 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim4.ok && tim4.ungVien[0]?.xemTruoc.lyDo, "FILE chưa phủ lúc sau mở phiếu").toContain("DU_LIEU_THIEU");
    // Đối chứng: một giao dịch KHÁC của cơ sở đã sau lúc mở phiếu ⇒ dữ liệu phủ tới đó ⇒ đủ.
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "khong lien quan", soTien: 1_234_000, thoiGian: "2026-10-06T17:40:00+07:00", maGiaoDichThe: "5656565656" })]);
    const tim5 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim5.ok && tim5.ungVien[0]?.xemTruoc.quyet).toBe("TU_GHI_NHAN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19..21 · câu từ chối bền, vòng sau khi bị bác, không ứng viên
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] sau từ chối: câu bền, vòng đề nghị kế tiếp, không ứng viên", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-DB-20] CÂU TỪ CHỐI BỀN: sau từ chối chạy poller (NOT_FOUND) và đồng bộ sau import ⇒ câu lưu bị ghi đè 'Chưa thấy…' nhưng VIEW vẫn nói kế toán đã bác", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445572" })]);
    await guiCho(DON, c.intentId, c.bt);
    const yc = (await yeuCauCua(c.intentId))[0]!;
    const lyDo = "Giao dịch của khách khác";
    expect((await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo, actor: A_KT, now: QUYET })).ok).toBe(true);

    const muon = new Date(NOW.getTime() + 90 * PHUT);
    await chayPollerPos({ dongHo: () => muon, provider: new FakePosProvider() });
    await dongBoPhieuPosSauNhap({ now: new Date(muon.getTime() + 10 * 60_000), nguoiKiemId: KT, nguoiBam: { id: KT, name: "Kế toán" } });
    const p = await phieuPos(c.intentId);
    expect(p.status).toBe("CHO_QUET");
    expect(laCauChuaThay(p.lastResultMessage), "câu LƯU đã bị lượt kiểm sau ghi đè").toBe(true);

    const v = await docPhieuPosView(c.intentId, new Date(muon.getTime() + 20 * 60_000));
    expect(v?.saiMa).toMatchObject({ trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: lyDo });
    expect(v?.thongDiep).toSatisfy((s: string | null) => laCauChuaThay(s));
  });

  it("[HN3-DB-21] sau một lần bị bác, giao dịch Y còn lại là ứng viên DUY NHẤT với ghi chú rỗng ⇒ VẪN chờ kế toán (DA_BI_TU_CHOI_TRUOC); phiếu chưa từng bị bác ⇒ tự ghi nhận", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    const y = maGd();
    await nhapFile([dong({ maGiaoDich: y, dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445573" })]);
    // Phiếu CHƯA từng bị bác nhưng có HAI ứng viên ⇒ chờ kế toán; kế toán bác X.
    await guiCho(DON, c.intentId, c.bt);
    const yc = (await yeuCauCua(c.intentId))[0]!;
    expect((await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: QUYET })).ok).toBe(true);
    // Giờ chỉ còn Y: đúng 1 ứng viên, ghi chú rỗng — nhưng phiếu này đã bị bác một lần.
    await chuaThay(c.intentId, new Date(QUYET.getTime() + PHUT));
    const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: new Date(QUYET.getTime() + 2 * PHUT) });
    expect(tim.ok && tim.ungVien.map((u) => u.bankTransactionId)).toEqual([await btId(y)]);
    expect(tim.ok && tim.ungVien[0]?.xemTruoc).toMatchObject({ quyet: "CHO_KE_TOAN" });
    expect(tim.ok && tim.ungVien[0]?.xemTruoc.lyDo).toEqual(["DA_BI_TU_CHOI_TRUOC"]);
    const kq = await guiCho(DON, c.intentId, await btId(y), { now: new Date(QUYET.getTime() + 3 * PHUT) });
    expect(kq).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
    expect(await soPayment(), "không đi vòng quanh kế toán").toBe(0);

    // ĐỐI CHỨNG DƯƠNG: cùng cảnh nhưng phiếu CHƯA từng bị bác ⇒ đúng một ứng viên, ghi chú rỗng ⇒ tự ghi nhận.
    await dungFixture();
    const s = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    const tim2 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: s.intentId, now: GUI });
    expect(tim2.ok && tim2.ungVien[0]?.xemTruoc).toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
  });

  it("[HN3-DB-22] KHÔNG ứng viên ⇒ câu nguyên văn đặc tả; không tạo yêu cầu", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "", { soTien: DOT_TIEN_A + 1 });
    const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim).toMatchObject({ ok: true, ungVien: [], cau: CAU_KHONG_UNG_VIEN });
    const kq = await guiCho(DON, c.intentId, c.bt);
    expect(kq.ok).toBe(false);
    expect(await yeuCauCua(c.intentId)).toEqual([]);
  });

  it("[HN3-DB-23] DANH SÁCH ứng viên cho UI: giờ quẹt, số tiền, 4 số cuối thẻ, ghi chú ĐÃ LÀM SẠCH; không lộ giao dịch khác số tiền", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "Huynh ‮gnah​ ZDZ4X <b>");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "KHAC SO TIEN", soTien: DOT_TIEN_A + 1000, thoiGian: "2026-10-06T17:33:00+07:00", maGiaoDichThe: "3232323232" })]);
    const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(tim.ok).toBe(true);
    if (!tim.ok) return;
    expect(tim.ungVien).toHaveLength(1);
    const u = tim.ungVien[0]!;
    expect(u).toMatchObject({ bankTransactionId: c.bt, soTien: DOT_TIEN_A, soTheCuoi: "1234" });
    expect(u.gioQuet).toBe("2026-10-06T17:31:35+07:00");
    expect(u.ghiChu, "không ký tự điều hướng/zero-width").toBe("Huynh gnah ZDZ4X <b>");
    expect(JSON.stringify(tim), "không lộ số thẻ đầy đủ / mã giao dịch").not.toMatch(/411111|FXPOS3HN/);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] phạm vi cơ sở — người xem cơ sở khác KHÔNG thấy phiếu, ứng viên, hàng chờ (kèm đối chứng dương)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-DB-24] cơ sở KHÁC: tìm ứng viên ⇒ 'Không tìm thấy phiếu POS'; hàng chờ trống; CÙNG cảnh, người cơ sở ĐÚNG và Hội sở THẤY", async () => {
    // Hai ứng viên ⇒ gửi xong là yêu cầu CHO_DUYET (đơn ở CS1).
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445581" })]);
    const cs1 = actorCoSo(CS1);
    const cs2 = actorCoSo(CS2);

    // (a) bước TÌM.
    const timCs2 = await timUngVienSaiMa({ sdb: scopedDb(cs2), orderId: DON, intentId: c.intentId, now: GUI });
    expect(timCs2).toEqual({ ok: false, error: "Không tìm thấy phiếu POS" });
    const timCs1 = await timUngVienSaiMa({ sdb: scopedDb(cs1), orderId: DON, intentId: c.intentId, now: GUI });
    expect(timCs1.ok && timCs1.ungVien, "ĐỐI CHỨNG DƯƠNG: cơ sở đúng thấy cả hai ứng viên").toHaveLength(2);
    const timTatCa = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
    expect(timTatCa.ok && timTatCa.ungVien, "ĐỐI CHỨNG DƯƠNG: Hội sở thấy cả hai").toHaveLength(2);

    // (b) hàng chờ của kế toán.
    expect((await guiCho(DON, c.intentId, c.bt)).ok).toBe(true);
    const hangCs2 = await docHangChoSaiMa(scopedDb(cs2), cs2, QUYET);
    expect(hangCs2).toEqual({ cho: [], hauKiem: [], theoGiaoDich: {}, soCanXuLy: 0 });
    const hangCs1 = await docHangChoSaiMa(scopedDb(cs1), cs1, QUYET);
    expect(hangCs1.cho, "ĐỐI CHỨNG DƯƠNG: cơ sở đúng thấy đúng một yêu cầu").toHaveLength(1);
    expect(hangCs1.cho[0]).toMatchObject({ hieuLuc: "CHO_DUYET", maDon: "ORD-269979-000301", orderId: DON, maPhieu: c.ma });
    expect(hangCs1.theoGiaoDich).toEqual({ [c.bt]: { hieuLuc: "CHO_DUYET", kieu: "CHO_KE_TOAN" } });
    expect(hangCs1.soCanXuLy).toBe(1);
    const hangTatCa = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, QUYET);
    expect(hangTatCa.cho, "ĐỐI CHỨNG DƯƠNG: Hội sở thấy đúng một yêu cầu").toHaveLength(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] mỗi cổng của bước GỬI từ chối bằng câu RIÊNG và KHÔNG đổi dòng nào (kèm đối chứng dương)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-DB-25] phiếu không còn chờ quẹt · chưa Kiểm tra · kết quả kiểm khác 'Chưa thấy' · phiếu đã gắn giao dịch · phiếu gộp không còn mở · đơn đã huỷ — mỗi cổng một câu, ảnh chụp y hệt", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
    const khac = maGd();
    await nhapFile([dong({ maGiaoDich: khac, dienGiai: "", soTien: DOT_TIEN_A + 5_000, thoiGian: "2026-10-06T17:32:00+07:00", maGiaoDichThe: "7171717171" })]);
    const btKhac = await btId(khac);

    const datPhieu = (data: Record<string, unknown>) => () => db.posPaymentIntent.update({ where: { id: c.intentId }, data });
    const bang: [string, () => Promise<unknown>, () => Promise<unknown>, string][] = [
      ["phiếu thẻ không còn CHO_QUET", datPhieu({ status: "THAT_BAI" }), datPhieu({ status: "CHO_QUET" }), "Phiếu thu thẻ không còn chờ quẹt"],
      [
        "chưa bấm Kiểm tra (chưa có kết quả nào)",
        datPhieu({ lastResultKind: null }),
        datPhieu({ lastResultKind: "NOT_FOUND" }),
        "Bấm Kiểm tra thanh toán trước — chỉ dùng khi hệ thống báo 'Chưa thấy giao dịch'",
      ],
      [
        "kết quả kiểm gần nhất KHÔNG phải 'Chưa thấy giao dịch'",
        datPhieu({ lastResultKind: "PROVIDER_ERROR" }),
        datPhieu({ lastResultKind: "NOT_FOUND" }),
        "Bấm Kiểm tra thanh toán trước — chỉ dùng khi hệ thống báo 'Chưa thấy giao dịch'",
      ],
      ["phiếu thẻ đã gắn một giao dịch", datPhieu({ bankTransactionId: btKhac }), datPhieu({ bankTransactionId: null }), "Phiếu thẻ này đã nhận một giao dịch"],
      [
        "phiếu gộp không còn mở",
        () => db.paymentBill.update({ where: { id: c.billId }, data: { status: "PAID" } }),
        () => db.paymentBill.update({ where: { id: c.billId }, data: { status: "OPEN" } }),
        "Phiếu gộp không còn mở — tải lại trang",
      ],
      [
        "đơn đã huỷ",
        () => db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } }),
        () => db.order.update({ where: { id: DON }, data: { status: "PENDING_PAYMENT" } }),
        "Đơn không nhận tiền được (nháp / đã huỷ / đã hoàn / đã xoá)",
      ],
    ];
    for (const [ten, ap, hoan, cau] of bang) {
      await ap();
      const antes = await chup();
      const kq = await guiCho(DON, c.intentId, c.bt);
      expect(kq, ten).toEqual({ ok: false, error: cau });
      expect(await chup(), `${ten}: không dòng nào đổi`).toBe(antes);
      expect(await yeuCauCua(c.intentId), `${ten}: không tạo yêu cầu`).toEqual([]);
      await hoan();
    }
    // ĐỐI CHỨNG DƯƠNG: hoàn nguyên mọi thứ ⇒ cùng một lệnh gửi ĐƯỢC.
    const ok = await guiCho(DON, c.intentId, c.bt);
    expect(ok).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
    expect(await soPayment()).toBe(1);
  }, 30_000);
});

describe.skipIf(!RUN_DB_TESTS)("[HN3-DB] người gửi KHÔNG quyết được yêu cầu của chính mình (cổng ở lib; CHECK của DB là lưới cuối)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-DB-26] TỰ TỪ CHỐI và TỰ DUYỆT bị từ chối với câu riêng, ảnh chụp y hệt; NGƯỜI KHÁC từ chối được (đối chứng dương)", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "5656565656" })]);
    // Hai ứng viên ⇒ yêu cầu CHO_DUYET do SALE gửi.
    expect((await guiCho(DON, c.intentId, c.bt)).ok).toBe(true);
    const yc = (await yeuCauCua(c.intentId))[0]!;
    expect(yc).toMatchObject({ trangThai: "CHO_DUYET", nguoiGuiId: SALE });
    const cau = "Cần người khác duyệt — không tự duyệt yêu cầu do chính mình gửi";

    const truoc = await chup();
    expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: "tự từ chối không được", actor: ACTOR, now: QUYET })).toEqual({ ok: false, error: cau });
    expect(await chup(), "tự từ chối: không dòng nào đổi").toBe(truoc);
    expect(await duyetSaiMa({ orderId: DON, yeuCauId: yc.id, actor: ACTOR, now: QUYET })).toEqual({ ok: false, error: cau });
    expect(await chup(), "tự duyệt: không dòng nào đổi").toBe(truoc);
    expect(await soPayment(), "không ghi tiền").toBe(0);

    // ĐỐI CHỨNG DƯƠNG: người khác (kế toán) quyết được cùng yêu cầu ấy.
    expect((await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: "người khác từ chối được", actor: A_KT, now: QUYET })).ok).toBe(true);
    expect((await yeuCauCua(c.intentId))[0]).toMatchObject({ trangThai: "TU_CHOI", nguoiQuyetId: KT });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RV · RÀ ĐỐI KHÁNG VIỆC 3 (09/10/2026) — mỗi ca viết TRƯỚC khi vá, có dòng đỏ ghi ở docs §5.11
// ─────────────────────────────────────────────────────────────────────────────

/** Cảnh hai đơn cùng cơ sở/máy/số tiền (DON·DOT_A ‖ DON_PHU·DOT_D), T1 + T2 ghi chú rỗng. B (DON_PHU) là phiếu "kia". */
async function dungHaiPhieuHaiGiaoDich() {
  const a = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
  const g2 = await phatPhieu(DON_PHU, [DOT_D], ACTOR2);
  const p2 = await moPhieu(DON_PHU, DOT_D, { actor: ACTOR2 });
  expect(p2.code5).toBe(g2.ma);
  await chuaThay(p2.intentId);
  const m2 = maGd();
  await nhapFile([dong({ maGiaoDich: m2, dienGiai: "", soTien: DOT_TIEN_A, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445599" })]);
  return { a, b: { g: g2, p: p2 }, t1: a.bt, t2: await btId(m2), m2 };
}
const timCho = (orderId: string, intentId: string, now: Date = GUI) => timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId, intentId, now });

describe.skipIf(!RUN_DB_TESTS)("[HN3-RV] rà đối kháng: tín hiệu cạnh tranh không được MẤT khi phiếu kia đã giữ một giao dịch / đã THẤT BẠI", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-RV-01] B ĐÃ GỬI kế toán giữ T1 ⇒ A thấy T2 vẫn là CHỜ KẾ TOÁN (CO_PHIEU_THE_CANH_TRANH), gửi T2 KHÔNG tự ghi nhận", async () => {
    const { a, b, t1, t2 } = await dungHaiPhieuHaiGiaoDich();
    // Trước khi B gửi: B thấy HAI ứng viên, cả hai chờ kế toán.
    const truocB = await timCho(DON_PHU, b.p.intentId);
    expect(truocB.ok && truocB.ungVien.map((u) => u.xemTruoc.quyet)).toEqual(["CHO_KE_TOAN", "CHO_KE_TOAN"]);

    const gB = await guiCho(DON_PHU, b.p.intentId, t1, { actor: ACTOR2 });
    expect(gB).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });

    // A bấm SAU: T1 đã bị giữ ⇒ chỉ còn T2. Sự mơ hồ T1/T2 (lý do B phải chờ kế toán) KHÔNG được biến mất.
    const tA = await timCho(DON, a.intentId);
    if (!tA.ok) throw new Error(tA.error);
    expect(tA.ungVien).toHaveLength(1);
    expect(tA.ungVien[0]!.bankTransactionId).toBe(t2);
    expect(tA.ungVien[0]!.xemTruoc, "nhãn nút nói đúng điều SẮP xảy ra").toMatchObject({ quyet: "CHO_KE_TOAN" });
    expect(tA.ungVien[0]!.xemTruoc.lyDo).toContain("CO_PHIEU_THE_CANH_TRANH");

    const truoc = await soPayment(DON);
    const gA = await guiCho(DON, a.intentId, t2);
    expect(gA, "máy chủ KHÔNG nâng bậc thành tự ghi nhận").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
    expect(await soPayment(DON)).toBe(truoc);
    expect(await soPayment(DON_PHU)).toBe(0);
  });

  it("[HN3-RV-01b] ĐỐI CHỨNG DƯƠNG: yêu cầu của B đã được DUYỆT (không còn sống) ⇒ A bấm T2 ⇒ TỰ GHI NHẬN như cũ", async () => {
    const { a, b, t1, t2 } = await dungHaiPhieuHaiGiaoDich();
    await guiCho(DON_PHU, b.p.intentId, t1, { actor: ACTOR2 });
    const yc = (await yeuCauCua(b.p.intentId))[0]!;
    const dq = await duyetSaiMa({ orderId: DON_PHU, yeuCauId: yc.id, actor: A_KT, now: QUYET });
    expect(dq.ok, "fixture: kế toán duyệt phải ghi được").toBe(true);
    expect((await yeuCauCua(b.p.intentId))[0]!.trangThai).toBe("DA_GHI_NHAN");

    const sau = new Date(QUYET.getTime() + PHUT);
    const tA = await timCho(DON, a.intentId, sau);
    if (!tA.ok) throw new Error(tA.error);
    expect(tA.ungVien.map((u) => u.bankTransactionId)).toEqual([t2]);
    expect(tA.ungVien[0]!.xemTruoc).toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
    const gA = await guiCho(DON, a.intentId, t2, { now: sau });
    expect(gA).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
  });

  it("[HN3-RV-01c] yêu cầu SỐNG của phiếu khác nhưng giao dịch của nó ở MÁY KHÁC ⇒ KHÔNG cạnh tranh, A vẫn tự ghi nhận — chỉ cạnh tranh THẬT mới leo bậc", async () => {
    const { a, b, t1, t2 } = await dungHaiPhieuHaiGiaoDich();
    await guiCho(DON_PHU, b.p.intentId, t1, { actor: ACTOR2 });
    // Dời giao dịch T1 (đang bị B giữ) sang MÁY khác của cùng cơ sở ⇒ không còn cạnh tranh trên máy của A.
    await db.posCardTransaction.updateMany({ where: { bankTransactionId: t1 }, data: { maThietBi: MAY3 } });
    const tA = await timCho(DON, a.intentId);
    if (!tA.ok) throw new Error(tA.error);
    expect(tA.ungVien.map((u) => u.bankTransactionId)).toEqual([t2]);
    expect(tA.ungVien[0]!.xemTruoc, "khác máy ⇒ không cạnh tranh").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
  });

  it("[HN3-RV-02] phiếu kia THẤT BẠI (vẫn là phiếu MỞ — khách quẹt lại, gõ sai mã) ⇒ giao dịch duy nhất của A phải CHỜ KẾ TOÁN, không tự ghi vào đơn A", async () => {
    const a = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    const g2 = await phatPhieu(DON_PHU, [DOT_D], ACTOR2);
    const p2 = await moPhieu(DON_PHU, DOT_D, { actor: ACTOR2 });
    expect(p2.code5).toBe(g2.ma);
    await xuLyKetQuaPos({ intentId: p2.intentId, ketQua: { kind: "FAILED" } satisfies PosCheckResult, triggeredBy: "SALE", now: KIEM, nguonDuLieu: "FAKE" });
    expect((await phieuPos(p2.intentId)).status, "fixture: phiếu kia phải THAT_BAI").toBe("THAT_BAI");

    const tA = await timCho(DON, a.intentId);
    if (!tA.ok) throw new Error(tA.error);
    expect(tA.ungVien).toHaveLength(1);
    expect(tA.ungVien[0]!.xemTruoc).toMatchObject({ quyet: "CHO_KE_TOAN" });
    expect(tA.ungVien[0]!.xemTruoc.lyDo).toContain("CO_PHIEU_THE_CANH_TRANH");
    const gA = await guiCho(DON, a.intentId, a.bt);
    expect(gA).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
    expect(await soPayment(DON)).toBe(0);
  });

  it("[HN3-RV-02b] ĐỐI CHỨNG: phiếu kia đã HUỶ VÀ phiếu gộp của nó không còn mở (mã đã chết) ⇒ cùng cảnh, A TỰ GHI NHẬN — chính phiếu THẤT BẠI mới là thứ leo bậc ở ca trên", async () => {
    const a = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    const g2 = await phatPhieu(DON_PHU, [DOT_D], ACTOR2);
    const p2 = await moPhieu(DON_PHU, DOT_D, { actor: ACTOR2 });
    expect(p2.code5).toBe(g2.ma);
    await xuLyKetQuaPos({ intentId: p2.intentId, ketQua: { kind: "FAILED" } satisfies PosCheckResult, triggeredBy: "SALE", now: KIEM, nguonDuLieu: "FAKE" });
    await db.posPaymentIntent.update({ where: { id: p2.intentId }, data: { status: "HUY" } });
    // ⚠️ Việc 4 (10/10/2026): phiếu HUY mà phiếu gộp VẪN MỞ (sale huỷ TAY) vẫn là đối thủ — xem [HN4-DB-18b]. Bản đầu của ca này chỉ đặt HUY trên
    // phiếu gộp còn OPEN và ghim ngược lại; HUY "thật" của Việc 3 chỉ sinh ra khi phiếu gộp đã đổi, nên mô phỏng đúng thế: gộp B không còn OPEN.
    await db.paymentBill.update({ where: { id: g2.billId }, data: { status: "VOID" } });
    const tA = await timCho(DON, a.intentId);
    if (!tA.ok) throw new Error(tA.error);
    expect(tA.ungVien[0]!.xemTruoc).toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
  });
});

/** Một token cách `maDung` đúng 1 ký tự (không hợp lệ) mà cũng cách ≤ 1 một MÃ HỢP LỆ KHÁC `b` — tìm bằng chính `lanCanMa`. */
function tokenGanHaiMa(maDung: string): { t: string; b: string } {
  for (let p = 0; p < maDung.length; p += 1) {
    for (const c of BANG_CHU) {
      if (c === maDung[p]) continue;
      const t = maDung.slice(0, p) + c + maDung.slice(p + 1);
      const b = lanCanMa(t).find((m) => m !== maDung && khoangCachMa(t, m) <= 1);
      if (b && khoangCachMa(t, maDung) === 1) return { t, b };
    }
  }
  throw new Error(`không dựng được token gần hai mã từ ${maDung}`);
}

describe.skipIf(!RUN_DB_TESTS)("[HN3-RV] rà đối kháng: DÂY NỐI `phieuKhac`/`dangMo` của phanLoaiSaiMa (luật 14 — lưới thuần chỉ cấp cho nó mảng dựng sẵn)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-RV-04] ghi chú cũng gần mã của một phiếu gộp KHÁC đang MỞ ⇒ GAN_MA_PHIEU_KHAC (chờ kế toán); phiếu kia ĐÃ ĐÓNG hoặc không tồn tại ⇒ tự ghi nhận (hai đối chứng)", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, (ma) => tokenGanHaiMa(ma).t);
    const { b } = tokenGanHaiMa(c.ma);
    // (0) Không có phiếu nào mang mã `b` ⇒ ghi chú gần đúng một mã duy nhất ⇒ tự ghi nhận.
    const khong = await timCho(DON, c.intentId);
    if (!khong.ok) throw new Error(khong.error);
    expect(khong.ungVien[0]!.xemTruoc, "không phiếu nào mang mã b").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
    // (1) Phiếu gộp của đơn khác mang mã `b` và đang MỞ.
    const g2 = await phatPhieu(DON_PHU, [DOT_D], ACTOR2);
    await db.paymentBill.update({ where: { id: g2.billId }, data: { matchKey: b } });
    const mo = await timCho(DON, c.intentId);
    if (!mo.ok) throw new Error(mo.error);
    expect(mo.ungVien[0]!.xemTruoc).toMatchObject({ quyet: "CHO_KE_TOAN" });
    expect(mo.ungVien[0]!.xemTruoc.lyDo).toContain("GAN_MA_PHIEU_KHAC");
    // (2) Cùng phiếu ấy nhưng ĐÃ ĐÓNG (không còn mở) ⇒ hết mơ hồ.
    await db.paymentBill.update({ where: { id: g2.billId }, data: { status: "PAID" } });
    const dong2 = await timCho(DON, c.intentId);
    if (!dong2.ok) throw new Error(dong2.error);
    expect(dong2.ungVien[0]!.xemTruoc, "phiếu kia đã đóng").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HN3-RV] rà đối kháng: tiền do ĐƯỜNG KHÁC ghi giữa lúc giữ và lúc ghi tiền — yêu cầu không được nhận công", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-RV-03] kế toán GẮN TAY chính giao dịch ấy vào đơn NGAY SAU khi sale giữ ⇒ đúng 1 Payment (bút toán gắn tay), yêu cầu KHÔNG thành 'sale tự ghi nhận', không audit POS_SAI_MA_GHI_NHAN, sale được báo 'xử lý ở nơi khác'", async () => {
    const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
    h.truocTien = async () => {
      h.truocTien = null;
      const g = await ganTienTheoCon({ bankTransactionId: c.bt, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: DOT_TIEN_A }], actor: A_KT, nguoiGan: { loai: "KE_TOAN" } });
      expect(g.ok, "fixture: gắn tay phải ghi được").toBe(true);
    };
    const kq = await guiCho(DON, c.intentId, c.bt);
    expect(h.truocTien, "hook phải đã chạy — nếu không, ca này không thử gì").toBeNull();

    const pays = await db.payment.findMany({ where: { orderId: DON } });
    expect(pays, "tiền vào ĐÚNG MỘT lần").toHaveLength(1);
    expect(pays[0]!.note, "và là bút toán GẮN TAY, không phải của đường tự ghi nhận").toContain("Gắn tay giao dịch");

    expect(kq).toMatchObject({ ok: true, trangThai: "CHO_DUYET" });
    expect(kq.ok && kq.thongDiep, "sale KHÔNG nghe 'Đã ghi nhận…' cho một khoản do người khác ghi").toMatch(/xử lý giao dịch này ở nơi khác/);
    const yc = (await yeuCauCua(c.intentId))[0]!;
    expect(yc.trangThai, "yêu cầu không được nhận công ghi tiền").not.toBe("DA_GHI_NHAN");
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_SAI_MA_GHI_NHAN" } }), "không audit 'sale tự ghi nhận'").toBe(0);
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_SAI_MA_XU_LY_NGOAI" } }), "audit đúng điều đã xảy ra").toBe(1);

    // Hàng chờ của kế toán: dòng này là "đã xử lý ở nơi khác", vào hậu kiểm, KHÔNG chip 'Sale tự xác nhận' (hieuLuc ≠ DA_GHI_NHAN).
    const hang = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, QUYET);
    expect(hang.cho).toHaveLength(0);
    expect(hang.hauKiem.map((d) => d.hieuLuc)).toEqual(["DA_XU_LY_NGOAI"]);
  });
});
