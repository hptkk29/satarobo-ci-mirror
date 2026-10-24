// tests/finance/pos-ban-tay-bi-bac.test.ts — VIỆC 6 · MỤC 1: SALE KHÔNG GẮN TAY ĐƯỢC GIAO DỊCH KẾ TOÁN ĐÃ BÁC CHO CHÍNH ĐƠN ĐÓ. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-bac-lach-phieu-moi.test.ts` / `pos-sai-ma-action-that.test.ts`).
//
// ── LỖ (R-5g, rà đối kháng Việc 5 — F1; chủ dự án chốt ĐÓNG 10/10/2026) ──────────────────────────────────────────────────────────────────────────
// Việc 5 đóng đường SAI-MÃ: giao dịch X kế toán đã BÁC cho đơn A không còn tự ghi nhận vào A. Nhưng đường GẮN TAY (`ganGiaoDichTheoConAction` →
// `ganTienTheoCon`) KHÔNG đọc vết bác: ở cơ sở bật `billing.flexV1Enabled`, sale / quản lý cơ sở (`payments:record`) bấm "Gắn vào đơn" là X vào A —
// đúng khoản kế toán vừa nói "không phải của khách này". `Payment` ghi ra mang `accountantStatus: PENDING` nên kế toán còn thấy, nhưng tiền đã vào sổ công nợ.
//
// ── LUẬT SAU VÁ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   · người gắn KHÔNG có `payments:manage` (sale · quản lý cơ sở) ∧ giao dịch có dòng `TU_CHOI` cho CÙNG ĐƠN (`docGiaoDichDaBiBac` — hàm DÙNG CHUNG với Việc 5)
//     ⇒ TỪ CHỐI, câu nói thật + việc nên làm, cổng đứng TRƯỚC phép ghi đầu tiên và tính LẠI dưới khoá đơn;
//   · kế toán (`payments:manage`) vẫn gắn được — "quyết định cuối" (V71);
//   · ĐƠN KHÁC vẫn thấy / gắn được giao dịch ấy; giao dịch chưa từng bị bác thì gắn như cũ.
//
// Mỗi ca "không được" kèm ca "được" (luật 11): ĐỐI CHỨNG DƯƠNG nằm NGAY TRONG cảnh (cùng X, đổi đúng một yếu tố). Ca dựng cảnh đi ĐÚNG cửa đời thật: phiếu gộp
// `taoPhieuGop`, phiếu thẻ `moPhieuPos`, "Chưa thấy" `xuLyKetQuaPos`, file `nhapLoPos`, yêu cầu `guiSaiMa`, bác `tuChoiSaiMa`; gắn tay đi qua server action THẬT
// (phiên → `checkPermission` v1/v2 THẬT → `resolveActor` → `scopedDb` + `passesScope` → lib → Postgres). Chỉ mock `@/lib/auth` và `next/cache`.
//
// ⚠️ Cờ `billing.flexV1Enabled` BẬT cho cả bộ (mặc định TẮT ⇒ sale bị chặn ở cổng cũ và ca "không được" xanh vì LÝ DO SAI): mọi ca "bị chặn" đòi ĐÚNG câu mới,
// không chỉ `ok: false`. Ca `[GTB-DB-10]` tắt cờ để chứng minh cổng cũ vẫn đứng TRƯỚC và nói câu cũ.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; name: string; email: string; role: string; roles: string[] } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
// Chỉ thay `revalidatePath` / `revalidateTag` (cần store của Next); `unstable_cache` giữ nguyên — `safeCache` tự rơi về "gọi thẳng" ngoài request context.
vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { taoPhieuGop } from "@/lib/finance/phieu-gop";
import { CAU_GAN_TAY_DA_BI_BAC, ganTienTheoCon, goGanTheoCon, khoaDonTrongTx, type NguoiGan } from "@/lib/finance/ghi-tien-don";
import { nhapLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { xuLyKetQuaPos } from "@/lib/payments/pos/xu-ly-ket-qua";
import { laCauChuaThay } from "@/lib/payments/pos/thong-diep-pos";
import { docGiaoDichDaBiBac } from "@/lib/payments/pos/sai-ma-doc";
import { guiSaiMa, tuChoiSaiMa } from "@/lib/payments/pos/sai-ma-ghi";
import { ganGiaoDichTheoConAction, taiChiTietDonDeGan } from "@/app/(admin)/admin/bien-dong-so-du/_gan-theo-con";
import { ganGiaoDichVaoDon } from "@/app/(admin)/admin/bien-dong-so-du/_actions";

if (!RUN_DB_TESTS) console.warn(`[GTB-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

// Mỗi cảnh ~15 lượt DB, mỗi ca 1–3 cảnh × hai chế độ RBAC — nới trần để một máy bận không làm đỏ ca rồi làm hỏng ca đứng sau (vitest không huỷ được promise — luật 18).
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const T = "fx-pos6a1-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS6A1";
const KHOA_CO = "billing.flexV1Enabled";

const DON = `${T}don`; // hai bé, hai đợt
const DON_PHU = `${T}don-phu`; // đơn KHÁC cùng cơ sở, hai bé hai đợt, đợt D cùng số tiền với DOT_A — đối chứng chéo đơn (KHÔNG đủ tiền sau một lần gắn ⇒ không cấp tài khoản phụ huynh)
const A = `${T}item-a`;
const B = `${T}item-b`;
const D = `${T}item-d`;
const E = `${T}item-e`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const DOT_D = `${T}dot-d`;
const DOT_E = `${T}dot-e`;
const DON_CUA_TEST = [DON, DON_PHU];
const MAY1 = `${PFX}MAY01`;
const SDT_PH = "0399812377";
const EMAIL_PH = "ph.fx.pos6a1@test.local";

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B;

const GIAY = 1_000;
const PHUT = 60 * GIAY;
const z = (iso: string) => new Date(iso);
const sau = (moc: Date, ms: number) => new Date(moc.getTime() + ms);

/** Lúc mở phiếu thẻ P1 (hết hạn 24 giờ sau = 2026-10-07T10:00:00Z). */
const NOW = z("2026-10-06T10:00:00Z");
/** X quẹt trong 2 phút CUỐI đời P1 (khoảng cửa sổ của phiếu thẻ MỚI nếu P1 hết hạn). */
const LICH = {
  gioKhac: "2026-10-06T17:20:00+07:00", // 10:20Z — khách KHÁC, quẹt sớm: ngoài cửa sổ của phiếu mới
  gioX: "2026-10-07T16:58:00+07:00", // 09:58:00Z
  chuaThay1: z("2026-10-07T09:59:00Z"),
  gui1: z("2026-10-07T09:59:10Z"),
  bac1: z("2026-10-07T09:59:30Z"),
};

// VIỆC 6 · a1 — thêm `sa` (Quản trị tối cao: giữ `payments:manage` qua `isSuperAdmin`, KHÔNG qua dòng RolePermission) và `gv1` (Giáo viên: KHÔNG có quyền tiền nào) cho
// BẢNG TỔ HỢP `[GTB-DB-04]` — hai đầu của trục quyền mà sáu người cũ không phủ.
// VIỆC 6 (chốt) — thêm `multi` (sale@CS1 + kế toán@CS2) và `multi2` (kế toán@CS1 + sale@CS2): NGƯỜI ĐA VAI Ở HAI CƠ SỞ. Rà đối kháng chốt phát hiện: `checkPermission("payments:manage")` gọi
// TRẦN trả true cho kế toán ở BẤT KỲ cơ sở nào (seed GLOBAL) ⇒ `multi` bị coi là kế toán TẠI CƠ SỞ CỦA ĐƠN (CS1, nơi họ chỉ là sale) và gắn lại được khoản kế toán đã bác. Mỗi người có DANH SÁCH vai
// (khuôn `pos-da-vai-co-so.test.ts`).
type VaiGan = { vai: string; donVi: "HO" | "CS1" | "CS2" };
type Nguoi = "sale1" | "sale2" | "qlcs1" | "kt1" | "kt2" | "ktHo" | "sa" | "gv1" | "multi" | "multi2";
const NGUOI: Record<Nguoi, { role: Role; vais: VaiGan[] }> = {
  sale1: { role: "SALES_CSM", vais: [{ vai: "CENTER_SALES_CSM", donVi: "CS1" }] },
  sale2: { role: "SALES_CSM", vais: [{ vai: "CENTER_SALES_CSM", donVi: "CS2" }] },
  qlcs1: { role: "CENTER_MANAGER", vais: [{ vai: "CENTER_MANAGER", donVi: "CS1" }] },
  kt1: { role: "ACCOUNTANT", vais: [{ vai: "CENTER_ACCOUNTANT", donVi: "CS1" }] },
  kt2: { role: "ACCOUNTANT", vais: [{ vai: "CENTER_ACCOUNTANT", donVi: "CS2" }] },
  ktHo: { role: "ACCOUNTANT", vais: [{ vai: "HO_ACCOUNTANT", donVi: "HO" }] },
  sa: { role: "SUPER_ADMIN", vais: [{ vai: "SUPER_ADMIN", donVi: "HO" }] },
  gv1: { role: "TEACHER", vais: [{ vai: "TEACHER", donVi: "CS1" }] },
  // sale@CS1 + kế toán@CS2 — đơn của test ở CS1 ⇒ ở đó họ CHỈ là sale.
  multi: {
    role: "SALES_CSM",
    vais: [
      { vai: "CENTER_SALES_CSM", donVi: "CS1" },
      { vai: "CENTER_ACCOUNTANT", donVi: "CS2" },
    ],
  },
  // kế toán@CS1 + sale@CS2 — ở CS1 là kế toán ⇒ ĐỐI CHỨNG DƯƠNG của `multi`.
  multi2: {
    role: "ACCOUNTANT",
    vais: [
      { vai: "CENTER_ACCOUNTANT", donVi: "CS1" },
      { vai: "CENTER_SALES_CSM", donVi: "CS2" },
    ],
  },
};
const DS = Object.keys(NGUOI) as Nguoi[];
const email = (n: Nguoi) => `${T}${n}@ci.test`;
const id = {} as Record<Nguoi, string>;
let CS1 = "";

const phien = (n: Nguoi) => ({ user: { id: id[n], name: `Fixture ${n}`, email: email(n), role: NGUOI[n].role, roles: [NGUOI[n].role] } });
const chonCheDo = (v2: boolean) => {
  process.env.RBAC_V2_ENABLED = v2 ? "true" : "false";
};
const CHE_DO = [true, false] as const;
const ten = (v2: boolean) => (v2 ? "v2 (PROD)" : "v1 (mặc định local/CI)");

/** Người gắn là sale (cửa DUY NHẤT của sale: server action) — `actor` của lib cửa sổ phiếu thẻ cũng là sale1. */
const actorLib = (n: Nguoi) => ({ id: id[n], name: `Fixture ${n}` });
const NGUOI_KE_TOAN: NguoiGan = { loai: "KE_TOAN" };
/** Đúng thứ action truyền cho người KHÔNG phải kế toán: hàm DÙNG CHUNG của Việc 5, không bọc, không viết lại. */
const NGUOI_KHAC: NguoiGan = { loai: "KHAC", docGiaoDichDaBiBac };

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
let soRrn = 0;
/** Mỗi dòng một RRN riêng: RRN trùng giữa dòng thanh toán và dòng hủy là một luật loại ứng viên khác (không phải thứ bộ này đo). */
const rrn = () => String(112233446000 + ++soRrn);

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { providerTxnId: { startsWith: PFX } };

/** Dọn dữ liệu của MỘT cảnh (đơn, phiếu, giao dịch…). KHÔNG đụng người dùng / vai (dựng một lần ở `beforeAll`). */
async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: T } } });
  await db.posSaiMaYeuCau.deleteMany({ where: { intent: { paymentBill: { orderId: { in: DON_CUA_TEST } } } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: { orderId: { in: DON_CUA_TEST } } } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: { orderId: { in: DON_CUA_TEST } } } });
  const nguoi = Object.values(id).filter(Boolean);
  await db.staffNotification.deleteMany({ where: { userId: { in: nguoi } } });
  await db.staffNotification.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: nguoi } } });
  await db.emailLog.deleteMany({ where: { OR: [{ contextType: "Order", contextId: { in: DON_CUA_TEST } }, { toEmail: EMAIL_PH }] } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { actorId: { in: nguoi } }] } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: DON_CUA_TEST } } });
  await db.posTxnSource.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { tenFile: `${T}fixture.xlsx` } });
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
}

async function donNguoi() {
  const us = await db.user.findMany({ where: { email: { startsWith: T } }, select: { id: true } });
  const xs = us.map((u) => u.id);
  if (xs.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: xs } } });
    await db.user.deleteMany({ where: { id: { in: xs } } });
  }
}

async function dungDon() {
  await don();
  const taoDon = (idDon: string, code: string, tong: number) =>
    db.order.create({
      data: {
        id: idDon,
        code,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture GTB",
        customerPhone: SDT_PH,
        customerEmail: EMAIL_PH,
        totalAmount: tong,
        centerId: CS1,
        createdById: id.sale1,
      },
    });
  const taoDong = async (orderId: string, itemId: string, dotId: string, ten2: string, tien: number, thuTu: number) => {
    await db.orderItem.create({
      data: { id: itemId, orderId, type: "COURSE_ENROLLMENT", itemName: ten2, quantity: 1, unitPrice: tien, totalPrice: tien },
    });
    await db.paymentRequest.create({
      data: { id: dotId, orderId, orderItemId: itemId, centerId: CS1, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: thuTu },
    });
  };
  await taoDon(DON, "ORD-269986-000701", TONG);
  await taoDong(DON, A, DOT_A, "Bé A GTB", DOT_TIEN_A, 1);
  await taoDong(DON, B, DOT_B, "Bé B GTB", DOT_TIEN_B, 2);
  await taoDon(DON_PHU, "ORD-269986-000702", TONG);
  await taoDong(DON_PHU, D, DOT_D, "Bé D GTB", DOT_TIEN_A, 1);
  await taoDong(DON_PHU, E, DOT_E, "Bé E GTB", DOT_TIEN_B, 2);
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — đi ĐÚNG cửa đời thật
// ─────────────────────────────────────────────────────────────────────────────

async function phatPhieu(orderId: string, ids: string[]) {
  const r = await taoPhieuGop({ orderId, paymentRequestIds: ids, actor: actorLib("sale1") });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}

async function moPhieu(orderId: string, dot: string, now: Date) {
  const r = await moPhieuPos({ orderId, paymentRequestId: dot, actor: actorLib("sale1"), now });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  return r.phieu;
}

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
async function nhapFile(dongs: DongPos[]) {
  const batch = await db.posImportBatch.create({ data: { tenFile: `${T}fixture.xlsx`, importedById: id.kt1, soLoTong: 1 } });
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: [], nguoiNhapId: id.kt1 });
  expect(kq.loi, "không dòng nào được lỗi").toEqual([]);
  await db.posImportBatch.update({ where: { id: batch.id }, data: { soLoXong: 1, trangThai: "XONG" } });
}

const btThe = (ma: string) =>
  db.bankTransaction.findUnique({
    where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: ma } },
    include: { allocations: true, posCardTransaction: true },
  });
const btId = async (ma: string) => (await btThe(ma))!.id;
const btTrangThai = async (idBt: string) => (await db.bankTransaction.findUniqueOrThrow({ where: { id: idBt }, select: { status: true } })).status;

/** Sale bấm Kiểm tra ⇒ "Chưa thấy giao dịch". */
async function chuaThay(intentId: string, now: Date) {
  const kq = await xuLyKetQuaPos({ intentId, ketQua: { kind: "NOT_FOUND" } satisfies PosCheckResult, triggeredBy: "SALE", now, nguonDuLieu: "FAKE" });
  expect(laCauChuaThay(kq.thongDiep), `phải ra câu 'Chưa thấy': ${kq.thongDiep}`).toBe(true);
}

const yeuCauCua = (intentId: string) => db.posSaiMaYeuCau.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } });
const soTuChoi = (orderId = DON) => db.posSaiMaYeuCau.count({ where: { trangThai: "TU_CHOI", intent: { paymentBill: { orderId } } } });
const soPayment = (orderId = DON) => db.payment.count({ where: { orderId } });
const soPhanBo = (orderId = DON) => db.paymentAllocation.count({ where: { paymentRequest: { orderId } } });

/** Ảnh chụp MỌI thứ một lượt gắn có thể đổi. Hai ảnh bằng nhau ⇒ lượt kia KHÔNG ghi gì (kể cả bản ghi vô hình: `updatedAt` nằm trong hàng). */
async function chup(orderIds: string[] = DON_CUA_TEST): Promise<string> {
  const co = { orderId: { in: orderIds } };
  const [bills, dots, intents, pays, allocs, bts, poss, yc, orders, audit, suKien, nhatKy] = await Promise.all([
    db.paymentBill.findMany({ where: co, orderBy: { id: "asc" } }),
    db.paymentRequest.findMany({ where: co, orderBy: { id: "asc" } }),
    db.posPaymentIntent.findMany({ where: { paymentBill: co }, orderBy: { id: "asc" } }),
    db.payment.findMany({ where: co, orderBy: { id: "asc" } }),
    db.paymentAllocation.findMany({ where: { paymentRequest: co }, orderBy: { id: "asc" } }),
    db.bankTransaction.findMany({ where: LOC_BT, orderBy: { id: "asc" } }),
    db.posCardTransaction.findMany({ where: { maGiaoDich: { startsWith: PFX } }, orderBy: { id: "asc" } }),
    db.posSaiMaYeuCau.findMany({ where: { intent: { paymentBill: co } }, orderBy: { id: "asc" } }),
    db.order.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" } }),
    db.auditLog.count({ where: { OR: [{ entityType: "Order", entityId: { in: orderIds } }, { entityType: "BankTransaction", action: "TXN_CHIA_THEO_CON" }] } }),
    db.domainEvent.count({ where: { type: "phieu-gop.da-chia" } }),
    db.posCheckLog.count({ where: { intent: { paymentBill: co } } }),
  ]);
  return JSON.stringify({ bills, dots, intents, pays, allocs, bts, poss, yc, orders, audit, suKien, nhatKy });
}

type Canh = { ma: string; billId: string; intentId: string; mX: string; btX: string; btKhac: string; tien: number };

/**
 * CẢNH GỐC — hình dạng của lỗ (khuôn `canhGoc` của `pos-bac-lach-phieu-moi.test.ts`):
 *   · phiếu gộp (mã M) + phiếu thẻ P1 mở lúc `NOW` + "Chưa thấy giao dịch";
 *   · file có HAI giao dịch cùng số phải thu, ghi chú RỖNG: `khac` (khách khác, quẹt sớm) và X (quẹt gần cuối đời P1);
 *   · `bac = true` ⇒ sale gửi X cho P1 (hai ứng viên ⇒ chờ kế toán) rồi kế toán BÁC X ⇒ X vẫn UNMATCHED, P1 về `CHO_QUET`, đơn có ĐÚNG MỘT vết bác.
 * `bac = false` ⇒ CÙNG cảnh nhưng chưa ai gửi / bác gì (đối chứng: chỉ khác đúng một yếu tố — vết bác).
 */
async function canhGoc(o: { bac: boolean }): Promise<Canh> {
  const g = await phatPhieu(DON, [DOT_A]);
  const p1 = await moPhieu(DON, DOT_A, NOW);
  expect(p1.code5, "phiếu thẻ dùng ĐÚNG mã của phiếu gộp").toBe(g.ma);
  await chuaThay(p1.intentId, LICH.chuaThay1);
  const mKhac = maGd();
  const mX = maGd();
  await nhapFile([
    dong({ maGiaoDich: mKhac, soTien: g.tongTien, thoiGian: LICH.gioKhac }),
    dong({ maGiaoDich: mX, soTien: g.tongTien, thoiGian: LICH.gioX }),
  ]);
  const btX = await btId(mX);
  const btKhac = await btId(mKhac);
  expect(g.tongTien, "phiếu gộp đúng một đợt A").toBe(DOT_TIEN_A);
  if (o.bac) {
    const kq = await guiSaiMa({ orderId: DON, intentId: p1.intentId, bankTransactionId: btX, actor: actorLib("sale1"), now: LICH.gui1 });
    expect(kq, "hai ứng viên ⇒ gửi kế toán").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
    const yc = (await yeuCauCua(p1.intentId))[0]!;
    const tc = await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: "Không phải giao dịch của khách", actor: actorLib("kt1"), now: LICH.bac1 });
    expect(tc, "kế toán bác X").toMatchObject({ ok: true, trangThai: "TU_CHOI" });
    expect(await btTrangThai(btX), "X vẫn nằm hàng chờ").toBe("UNMATCHED");
    expect(await soTuChoi(), "đúng MỘT vết bác trong đơn").toBe(1);
    expect(await soTuChoi(DON_PHU), "đơn khác không có vết bác").toBe(0);
  }
  return { ma: g.ma, billId: g.billId, intentId: p1.intentId, mX, btX, btKhac, tien: g.tongTien };
}

/** Một lần bấm "Gắn vào đơn" của `nguoi` — đúng server action, đúng phiên, đúng RBAC của chế độ đang chọn. */
async function gan(nguoi: Nguoi | null, bankTransactionId: string, orderId: string, dot: string, soTien: number) {
  h.session = nguoi ? phien(nguoi) : null;
  return ganGiaoDichTheoConAction({ bankTransactionId, orderId, dong: [{ paymentRequestId: dot, soTien }] });
}

const DA_GAN_THANH_CONG = { ok: true } as const;

// ═════════════════════════════════════════════════════════════════════════════
// CÁC CA
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!RUN_DB_TESTS)("[GTB-DB] sale không gắn tay được giao dịch kế toán đã BÁC cho chính đơn đó — action THẬT + RBAC v1/v2 + Postgres THẬT", () => {
  const rbacGoc = process.env.RBAC_V2_ENABLED;
  let coTruoc: { key: string; valueJson: unknown } | null = null;

  beforeAll(async () => {
    assertTestDb();
    await donNguoi();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const n of DS) {
      const u = await seedUser({ email: email(n), name: `${T}${n}`, role: NGUOI[n].role });
      id[n] = u.id;
      for (const g of NGUOI[n].vais) {
        const [vai, dv] = await Promise.all([
          db.roleDef.findUniqueOrThrow({ where: { code: g.vai }, select: { id: true } }),
          db.orgUnit.findUniqueOrThrow({ where: { code: g.donVi }, select: { id: true } }),
        ]);
        // `effectiveFrom` TUYỆT ĐỐI (luật 19) — default của cột là `now()` của DB.
        await db.userOrgRole.create({
          data: { userId: u.id, orgUnitId: dv.id, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
        });
      }
    }
    // Cờ thu học phí linh hoạt BẬT toàn hệ — nhớ giá trị cũ để trả lại.
    coTruoc = await db.systemSetting.findUnique({ where: { key: KHOA_CO }, select: { key: true, valueJson: true } });
    await db.systemSetting.upsert({ where: { key: KHOA_CO }, create: { key: KHOA_CO, valueJson: true }, update: { valueJson: true } });
  });

  beforeEach(async () => {
    h.session = null;
    await dungDon();
  });

  afterAll(async () => {
    try {
      h.session = null;
      if (rbacGoc === undefined) delete process.env.RBAC_V2_ENABLED;
      else process.env.RBAC_V2_ENABLED = rbacGoc;
      await don();
      await donNguoi();
      if (coTruoc) {
        await db.systemSetting.update({ where: { key: KHOA_CO }, data: { valueJson: coTruoc.valueJson as never } });
      } else {
        await db.systemSetting.deleteMany({ where: { key: KHOA_CO } });
      }
    } finally {
      await disconnectDb();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-01] SALE / QUẢN LÝ CƠ SỞ gắn tay X (đã bị bác cho DON) vào DON ⇒ TỪ CHỐI đúng câu mới, 0 dòng đổi; sai cơ sở / chưa đăng nhập / cửa cờ-tắt ⇒ câu riêng; ĐỐI CHỨNG DƯƠNG ngay trong cảnh: sale gắn giao dịch CHƯA TỪNG BỊ BÁC (cùng đơn, cùng đợt) ⇒ được — cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await canhGoc({ bac: true });
      chonCheDo(v2);
      const truoc = await chup();

      // (a) KHÔNG phải kế toán + đã bị bác cho CHÍNH đơn này ⇒ chặn, ĐÚNG câu mới.
      for (const nguoi of ["sale1", "qlcs1"] as const) {
        const kq = await gan(nguoi, c.btX, DON, DOT_A, c.tien);
        expect.soft(kq, `${ten(v2)}: ${nguoi} gắn X (bị bác cho DON)`).toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
        expect.soft(await chup(), `${ten(v2)}: ${nguoi} bị từ chối ⇒ KHÔNG đổi một dòng nào (cổng đứng TRƯỚC phép ghi đầu tiên)`).toBe(truoc);
      }
      expect.soft(await soPayment(), `${ten(v2)}: không một đồng nào vào đơn`).toBe(0);
      expect.soft(await btTrangThai(c.btX), `${ten(v2)}: X vẫn nằm hàng chờ`).toBe("UNMATCHED");
      expect.soft(await soTuChoi(), `${ten(v2)}: vết bác còn nguyên`).toBe(1);

      // (b) Các cổng KHÁC vẫn nói câu CỦA CHÚNG — cổng mới không nuốt chúng và không đứng trước chúng.
      for (const nguoi of ["sale2", "kt2"] as const) {
        expect(await gan(nguoi, c.btX, DON, DOT_A, c.tien), `${ten(v2)}: ${nguoi} (cơ sở CS2) không thấy đơn của CS1`).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      }
      expect(await gan(null, c.btX, DON, DOT_A, c.tien), `${ten(v2)}: chưa đăng nhập`).toEqual({ ok: false, error: "Chưa đăng nhập" });
      // Cửa CỜ-TẮT (`ganGiaoDichVaoDon`, rót toàn đơn) CHỈ kế toán — sale không tới được nó (nên nó không cần cổng này).
      h.session = phien("sale1");
      expect(await ganGiaoDichVaoDon(c.btX, DON), `${ten(v2)}: sale không dùng được cửa cờ-tắt`).toEqual({ ok: false, error: "Chỉ kế toán mới làm được việc này" });
      expect(await chup(), `${ten(v2)}: các lượt bị từ chối ở trên KHÔNG đổi một dòng nào`).toBe(truoc);

      // (c) ĐỐI CHỨNG DƯƠNG: CÙNG cảnh, CÙNG đơn, CÙNG đợt — giao dịch `khac` CHƯA từng bị bác ⇒ sale gắn được.
      const ok = await gan("sale1", c.btKhac, DON, DOT_A, c.tien);
      expect(ok, `${ten(v2)}: sale gắn giao dịch chưa từng bị bác — ${JSON.stringify(ok)}`).toMatchObject(DA_GAN_THANH_CONG);
      expect(await soPayment(), `${ten(v2)}: đúng một Payment`).toBe(1);
      expect(await btTrangThai(c.btKhac), `${ten(v2)}: giao dịch kia MATCHED`).toBe("MATCHED");
      expect(await btTrangThai(c.btX), `${ten(v2)}: X vẫn UNMATCHED`).toBe("UNMATCHED");
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-02] KẾ TOÁN cơ sở và KẾ TOÁN HỘI SỞ (`payments:manage`) vẫn gắn được chính X đã bị bác cho DON — quyết định cuối (V71); ĐỐI CHỨNG của [GTB-DB-01]: cùng cảnh, đổi đúng người bấm — cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      for (const nguoi of ["kt1", "ktHo"] as const) {
        await dungDon();
        const c = await canhGoc({ bac: true });
        chonCheDo(v2);
        const truocTuChoi = await soTuChoi();
        const kq = await gan(nguoi, c.btX, DON, DOT_A, c.tien);
        expect(kq, `${ten(v2)}: ${nguoi} — ${JSON.stringify(kq)}`).toMatchObject(DA_GAN_THANH_CONG);
        expect(await soPayment(), `${ten(v2)}: ${nguoi} — ĐÚNG một Payment`).toBe(1);
        expect(await soPhanBo(), `${ten(v2)}: ${nguoi} — đúng một phân bổ`).toBe(1);
        expect(await btTrangThai(c.btX), `${ten(v2)}: ${nguoi} — X MATCHED`).toBe("MATCHED");
        expect(await soTuChoi(), `${ten(v2)}: ${nguoi} — vết bác KHÔNG bị xoá (lịch sử giữ nguyên)`).toBe(truocTuChoi);
        const pay = await db.payment.findFirstOrThrow({ where: { orderId: DON } });
        expect(pay.note, `${ten(v2)}: ${nguoi} — là bút toán GẮN TAY`).toContain("Gắn tay giao dịch");
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-03] ĐƠN KHÁC vẫn thấy X: sale gắn đúng X (đã bị bác cho DON) vào DON_PHU ⇒ được — 1 Payment ở DON_PHU, 0 ở DON, vết bác của DON còn nguyên, DON_PHU không có vết bác — cả hai chế độ", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await canhGoc({ bac: true });
      chonCheDo(v2);
      // CHÍNH sale bị chặn ở DON (đối chứng cùng người, cùng giao dịch — đổi đúng một yếu tố: ĐƠN).
      expect.soft(await gan("sale1", c.btX, DON, DOT_A, c.tien), `${ten(v2)}: DON bị chặn`).toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
      // Bị chặn phải là bị chặn TRƯỚC phép ghi đầu tiên: không một phân bổ nào mồ côi ở DON (một refusal trả về SAU khi đã ghi phân bổ thì `return` không rollback).
      expect.soft(await soPhanBo(DON), `${ten(v2)}: DON không có phân bổ nào (cổng đứng trước phép ghi đầu tiên)`).toBe(0);
      const kq = await gan("sale1", c.btX, DON_PHU, DOT_D, c.tien);
      expect(kq, `${ten(v2)}: DON_PHU nhận X — ${JSON.stringify(kq)}`).toMatchObject(DA_GAN_THANH_CONG);
      expect(await soPayment(DON_PHU), `${ten(v2)}: tiền vào ĐÚNG đơn khác`).toBe(1);
      expect(await soPayment(DON), `${ten(v2)}: DON không có thêm đồng nào`).toBe(0);
      expect(await btTrangThai(c.btX), `${ten(v2)}: X MATCHED`).toBe("MATCHED");
      expect(await soTuChoi(DON), `${ten(v2)}: vết bác của DON còn nguyên`).toBe(1);
      expect(await soTuChoi(DON_PHU), `${ten(v2)}: DON_PHU không bị lan vết bác`).toBe(0);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BẢNG TỔ HỢP quyền × giao dịch × đơn — mỗi ô đi qua server action THẬT, đủ mười một "người" (kể cả ẩn danh, hai đầu của trục quyền và hai người ĐA VAI) × ba cặp (giao dịch, đơn), cả v1 lẫn v2.
  //   · xDon  = X (kế toán ĐÃ BÁC cho DON) → DON      — đúng cặp bị bác;
  //   · xPhu  = X → DON_PHU                          — CÙNG giao dịch, ĐƠN KHÁC;
  //   · khacDon = `khac` (chưa từng bị bác) → DON    — CÙNG đơn, giao dịch KHÁC.
  // Chỉ MỘT ô trong mười một người × ba cặp đổi kết quả theo vết bác: (sale1 | qlcs1 | multi) × xDon. Mọi ô còn lại phải giống hệt lúc chưa có vết bác — đó là phần "đối chứng dương" của bảng.
  // Hai chuỗi câu (không quyền · không thấy đơn · chưa đăng nhập) là câu CỦA CÁC CỔNG CŨ: cổng mới không được nuốt chúng, không được đứng trước chúng.
  it("[GTB-DB-04] BẢNG TỔ HỢP quyền × bị-bác × đơn: chỉ (sale | quản lý cơ sở | đa vai chỉ-là-sale-ở-đơn) × (X → DON) bị chặn bằng câu mới; kế toán cơ sở / Hội sở / Quản trị tối cao gắn được cả ba cặp; sai cơ sở · không quyền · ẩn danh nghe câu của cổng CŨ — v1 và v2", { timeout: 300_000 }, async () => {
    const DUOC = "DUOC";
    const CAU_KHONG_QUYEN = "Không có quyền ghi nhận tiền";
    const CAU_KHONG_DON = "Không tìm thấy đơn hàng";
    const CAU_CHUA_DANG_NHAP = "Chưa đăng nhập";
    type Hang = { nguoi: Nguoi | null; xDon: string; xPhu: string; khacDon: string };
    const dongBang = (nguoi: Nguoi | null, tatCa: string): Hang => ({ nguoi, xDon: tatCa, xPhu: tatCa, khacDon: tatCa });
    const BANG: readonly Hang[] = [
      { nguoi: "sale1", xDon: CAU_GAN_TAY_DA_BI_BAC, xPhu: DUOC, khacDon: DUOC },
      { nguoi: "qlcs1", xDon: CAU_GAN_TAY_DA_BI_BAC, xPhu: DUOC, khacDon: DUOC },
      // VIỆC 6 (chốt): sale@CS1 + kế toán@CS2 — ở đơn CS1 họ CHỈ là sale ⇒ bị chặn như sale1 (bản trước coi họ là kế toán vì `payments:manage` trần).
      { nguoi: "multi", xDon: CAU_GAN_TAY_DA_BI_BAC, xPhu: DUOC, khacDon: DUOC },
      // ĐỐI CHỨNG DƯƠNG: kế toán@CS1 + sale@CS2 — ở đơn CS1 họ LÀ kế toán ⇒ gắn được cả ba cặp.
      dongBang("multi2", DUOC),
      dongBang("kt1", DUOC),
      dongBang("ktHo", DUOC),
      dongBang("sa", DUOC),
      dongBang("sale2", CAU_KHONG_DON), // CS2 không thấy đơn của CS1 — câu của cổng PHẠM VI
      dongBang("kt2", CAU_KHONG_DON),
      dongBang("gv1", CAU_KHONG_QUYEN), // không giữ payments:record lẫn payments:manage — câu của cổng QUYỀN
      dongBang(null, CAU_CHUA_DANG_NHAP),
    ];
    const ten0 = (n: Nguoi | null) => n ?? "ẩn danh";
    /** Ba ô của một hàng: [mã ô, giao dịch ("X" | "khac"), đơn, đợt, kết quả mong đợi]. */
    const o3 = (h: Hang) =>
      [
        ["X→DON", "X", DON, DOT_A, h.xDon],
        ["X→DON_PHU", "X", DON_PHU, DOT_D, h.xPhu],
        ["khac→DON", "khac", DON, DOT_A, h.khacDon],
      ] as const;
    // Bảng phải đủ mười một người × ba cặp: ô bị bỏ sót là ô không ai đo.
    expect(BANG.flatMap(o3).length, "11 người × 3 cặp").toBe(33);
    expect(BANG.filter((h) => o3(h).some((x) => x[4] === CAU_GAN_TAY_DA_BI_BAC)).map((h) => h.nguoi), "ô chặn bằng câu mới chỉ thuộc sale + quản lý cơ sở + người đa vai chỉ là sale tại cơ sở của đơn").toEqual(["sale1", "qlcs1", "multi"]);

    for (const v2 of CHE_DO) {
      // (1) Ô BỊ TỪ CHỐI dùng chung MỘT cảnh: từ chối thì không đổi gì nên cảnh không bị "ăn" mất — và chính điều đó được đo (ảnh chụp trước = sau).
      await dungDon();
      const c0 = await canhGoc({ bac: true });
      chonCheDo(v2);
      const truoc = await chup();
      for (const h of BANG) {
        for (const [oMa, loai, orderId, dot, mong] of o3(h)) {
          if (mong === DUOC) continue;
          const kq = await gan(h.nguoi, loai === "X" ? c0.btX : c0.btKhac, orderId, dot, c0.tien);
          expect.soft(kq, `${ten(v2)} · ${ten0(h.nguoi)} · ${oMa} phải bị từ chối đúng câu`).toEqual({ ok: false, error: mong });
        }
      }
      expect.soft(await chup(), `${ten(v2)}: MỌI ô bị từ chối không đổi một dòng nào (cổng đứng TRƯỚC phép ghi đầu tiên)`).toBe(truoc);

      // (2) Ô ĐƯỢC: mỗi ô một cảnh mới — gắn xong là giao dịch / đợt đã "ăn".
      for (const h of BANG) {
        for (const [oMa, loai, orderId, dot, mong] of o3(h)) {
          if (mong !== DUOC) continue;
          await dungDon();
          const c = await canhGoc({ bac: true });
          chonCheDo(v2);
          const bt = loai === "X" ? c.btX : c.btKhac;
          const kq = await gan(h.nguoi, bt, orderId, dot, c.tien);
          expect.soft(kq, `${ten(v2)} · ${ten0(h.nguoi)} · ${oMa} phải được — ${JSON.stringify(kq)}`).toMatchObject(DA_GAN_THANH_CONG);
          expect.soft(await soPayment(orderId), `${ten(v2)} · ${ten0(h.nguoi)} · ${oMa}: đúng một Payment ở đơn đích`).toBe(1);
          expect.soft(await soPayment(orderId === DON ? DON_PHU : DON), `${ten(v2)} · ${ten0(h.nguoi)} · ${oMa}: đơn kia không có thêm đồng nào`).toBe(0);
          expect.soft(await btTrangThai(bt), `${ten(v2)} · ${ten0(h.nguoi)} · ${oMa}: giao dịch MATCHED`).toBe("MATCHED");
          expect.soft(await soTuChoi(), `${ten(v2)} · ${ten0(h.nguoi)} · ${oMa}: vết bác KHÔNG bị xoá`).toBe(1);
        }
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-05] VẾT BÁC BỀN: kế toán GẮN X (đè lên lời bác) rồi GỠ GẮN ⇒ dòng `TU_CHOI` còn nguyên ⇒ sale vẫn không gắn lại được X vào DON (đúng câu, 0 dòng đổi); ĐỐI CHỨNG cùng cảnh: X vào DON_PHU thì được; kế toán gắn lại được DON — v1 và v2", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await canhGoc({ bac: true });
      chonCheDo(v2);
      const kt = await gan("kt1", c.btX, DON, DOT_A, c.tien);
      expect(kt, `${ten(v2)}: fixture — kế toán gắn đè lên lời bác — ${JSON.stringify(kt)}`).toMatchObject(DA_GAN_THANH_CONG);
      const go = await goGanTheoCon({ bankTransactionId: c.btX, orderId: DON, lyDo: "Gắn nhầm — fixture GTB", actor: actorLib("kt1") });
      expect(go.ok, `${ten(v2)}: fixture — kế toán gỡ gắn — ${JSON.stringify(go)}`).toBe(true);
      expect(await btTrangThai(c.btX), `${ten(v2)}: X về hàng chờ`).toBe("UNMATCHED");
      expect(await soTuChoi(), `${ten(v2)}: vết bác sống sót qua gắn + gỡ`).toBe(1);

      const truoc = await chup();
      expect.soft(await gan("sale1", c.btX, DON, DOT_A, c.tien), `${ten(v2)}: sale gắn lại X vào DON`).toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
      expect.soft(await chup(), `${ten(v2)}: bị từ chối ⇒ không đổi một dòng nào`).toBe(truoc);

      // ĐỐI CHỨNG DƯƠNG — cùng cảnh, đổi đúng một yếu tố mỗi lần.
      const sangPhu = await gan("sale1", c.btX, DON_PHU, DOT_D, c.tien);
      expect(sangPhu, `${ten(v2)}: đơn KHÁC vẫn nhận X — ${JSON.stringify(sangPhu)}`).toMatchObject(DA_GAN_THANH_CONG);
      expect(await soPayment(DON_PHU), `${ten(v2)}: một Payment ở DON_PHU`).toBe(1);
    }
    // Và kế toán gắn lại được chính DON (người bấm là yếu tố duy nhất đổi).
    await dungDon();
    const c2 = await canhGoc({ bac: true });
    chonCheDo(true);
    expect(await gan("kt1", c2.btX, DON, DOT_A, c2.tien)).toMatchObject(DA_GAN_THANH_CONG);
    expect((await goGanTheoCon({ bankTransactionId: c2.btX, orderId: DON, lyDo: "Gắn nhầm — fixture GTB", actor: actorLib("kt1") })).ok).toBe(true);
    expect(await gan("kt1", c2.btX, DON, DOT_A, c2.tien), "kế toán gắn lại sau khi gỡ").toMatchObject(DA_GAN_THANH_CONG);
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-09] KHÔNG CHẶN OAN việc gắn tay thường ngày: ngay trong đơn ĐANG CÓ vết bác của giao dịch KHÁC, sale vẫn gắn được giao dịch CHUYỂN KHOẢN (SEPAY) vào đợt còn lại; bảng yêu cầu sai mã không đổi — v1 và v2", async () => {
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await canhGoc({ bac: true });
      chonCheDo(v2);
      expect(await soTuChoi(), "fixture: đơn có đúng một vết bác (của X)").toBe(1);
      const ck = await db.bankTransaction.create({
        data: {
          provider: "SEPAY",
          providerTxnId: `${PFX}CK${v2 ? "V2" : "V1"}0001`,
          amount: DOT_TIEN_B,
          transferredAt: z("2026-10-08T03:00:00Z"),
          status: "UNMATCHED",
          content: "PH CHUYEN HOC PHI BE B",
        },
      });
      const truocYc = JSON.stringify(await db.posSaiMaYeuCau.findMany({ where: { intent: { paymentBill: { orderId: DON } } }, orderBy: { id: "asc" } }));
      const kq = await gan("sale1", ck.id, DON, DOT_B, DOT_TIEN_B);
      expect(kq, `${ten(v2)}: sale gắn giao dịch chuyển khoản — ${JSON.stringify(kq)}`).toMatchObject(DA_GAN_THANH_CONG);
      expect(await soPayment(DON), `${ten(v2)}: một Payment`).toBe(1);
      expect(await btTrangThai(ck.id), `${ten(v2)}: chuyển khoản MATCHED`).toBe("MATCHED");
      expect(await btTrangThai(c.btX), `${ten(v2)}: X (đã bị bác) vẫn nằm hàng chờ`).toBe("UNMATCHED");
      expect(JSON.stringify(await db.posSaiMaYeuCau.findMany({ where: { intent: { paymentBill: { orderId: DON } } }, orderBy: { id: "asc" } })), `${ten(v2)}: bảng yêu cầu sai mã không bị gắn tay đụng tới`).toBe(truocYc);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MỤC (e) — luật 12: bảng chia là lời hứa mà máy chủ CHẮC CHẮN từ chối khi (X, đơn) đã bị bác ⇒ nói ngay ở bước CHỌN ĐƠN (`taiChiTietDonDeGan`), trước khi người ta điền số.
  // Màn đi theo chiều giao dịch → đơn: bảng giao dịch là danh sách TOÀN CỤC (giấu X khỏi nó là giấu khỏi MỌI đơn, vỡ luật "đơn khác vẫn thấy"), nên không có "danh sách giao dịch
  // gắn được cho MỘT đơn" để lọc — điểm duy nhất biết cả hai vế (giao dịch, đơn) trước khi người dùng nhập là lượt nạp chi tiết đơn.
  it("[GTB-DB-11] BÁO TRƯỚC ở bước chọn đơn: sale / quản lý cơ sở chọn DON cho X (đã bị bác) nghe ĐÚNG câu mới và KHÔNG nạp bảng chia; kế toán · Hội sở · Quản trị tối cao nạp được; sale chọn DON_PHU cho X, hoặc DON cho giao dịch chưa từng bị bác ⇒ nạp được; cổng CŨ giữ câu của chúng; lượt nạp KHÔNG ghi gì — v1 và v2", async () => {
    const nap = async (nguoi: Nguoi | null, bt: string, orderId: string) => {
      h.session = nguoi ? phien(nguoi) : null;
      return taiChiTietDonDeGan(orderId, bt);
    };
    for (const v2 of CHE_DO) {
      await dungDon();
      const c = await canhGoc({ bac: true });
      chonCheDo(v2);
      const truoc = await chup();

      // (a) BỊ BÁO TRƯỚC: không phải kế toán + đúng cặp (X, DON).
      // VIỆC 6 (chốt): `multi` = sale@CS1 + kế toán@CS2 — ở đơn CS1 họ CHỈ là sale ⇒ cũng bị báo trước.
      for (const nguoi of ["sale1", "qlcs1", "multi"] as const) {
        expect.soft(await nap(nguoi, c.btX, DON), `${ten(v2)}: ${nguoi} chọn DON cho X`).toEqual({ error: CAU_GAN_TAY_DA_BI_BAC });
      }

      // (b) ĐỐI CHỨNG DƯƠNG — đổi đúng MỘT yếu tố mỗi lần: người bấm · đơn · giao dịch.
      for (const nguoi of ["kt1", "ktHo", "sa", "multi2"] as const) {
        const ct = await nap(nguoi, c.btX, DON);
        expect.soft("error" in ct ? ct.error : ct.orderId, `${ten(v2)}: ${nguoi} (giữ payments:manage) nạp được bảng chia cho X → DON`).toBe(DON);
      }
      const phu = await nap("sale1", c.btX, DON_PHU);
      expect.soft("error" in phu ? phu.error : phu.orderId, `${ten(v2)}: sale chọn DON_PHU cho CHÍNH X (đơn KHÁC)`).toBe(DON_PHU);
      const khac = await nap("sale1", c.btKhac, DON);
      expect.soft("error" in khac ? khac.error : khac.orderId, `${ten(v2)}: sale chọn DON cho giao dịch CHƯA từng bị bác`).toBe(DON);

      // (c) Cổng CŨ đứng TRƯỚC và giữ câu của chúng.
      expect.soft(await nap("sale2", c.btX, DON), `${ten(v2)}: sai cơ sở`).toEqual({ error: "Không tìm thấy đơn hàng" });
      expect.soft(await nap("gv1", c.btX, DON), `${ten(v2)}: không quyền`).toEqual({ error: "Không có quyền ghi nhận tiền" });
      expect.soft(await nap(null, c.btX, DON), `${ten(v2)}: ẩn danh`).toEqual({ error: "Chưa đăng nhập" });

      // (d) Cờ TẮT ⇒ câu CŨ của cổng cờ, không phải câu bác (cổng cờ đứng trước).
      await db.systemSetting.update({ where: { key: KHOA_CO }, data: { valueJson: false } });
      try {
        expect.soft(await nap("sale1", c.btX, DON), `${ten(v2)}: cơ sở tắt cờ`).toEqual({
          error: "Cơ sở của đơn này chưa bật thu học phí linh hoạt — chỉ kế toán mới gắn được giao dịch",
        });
      } finally {
        await db.systemSetting.update({ where: { key: KHOA_CO }, data: { valueJson: true } });
      }

      // (e) Báo trước KHÔNG phải cổng: lượt nạp không ghi gì, và cổng thật vẫn chặn khi người ta bỏ qua màn (gọi action thẳng).
      expect.soft(await chup(), `${ten(v2)}: các lượt nạp KHÔNG đổi một dòng nào`).toBe(truoc);
      expect.soft(await gan("sale1", c.btX, DON, DOT_A, c.tien), `${ten(v2)}: bỏ qua màn, gọi action thẳng vẫn bị chặn`).toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-06] PHẠM VI ĐƠN: phiếu thẻ P1 (nơi dòng `TU_CHOI` đứng) đã HẾT HẠN và 'Thẻ POS' mở phiếu MỚI P2 dùng lại mã ⇒ sale VẪN không gắn tay được X vào DON; kế toán vẫn gắn được", async () => {
    chonCheDo(true);
    const c = await canhGoc({ bac: true });
    // Dữ liệu MỚI hơn phiếu mới (một giao dịch khác số tiền) — không ảnh hưởng vì ca này đo cổng gắn tay, nhưng giữ cảnh y hệt ca Việc 5.
    await nhapFile([dong({ maGiaoDich: maGd(), soTien: 999_000, thoiGian: "2026-10-07T17:00:20+07:00" })]);
    const p2 = await moPhieu(DON, DOT_A, z("2026-10-07T10:00:10Z"));
    expect(p2.intentId, "phiếu thẻ MỚI").not.toBe(c.intentId);
    expect(p2.code5, "dùng lại ĐÚNG mã (cùng phiếu gộp)").toBe(c.ma);
    expect((await db.posPaymentIntent.findUniqueOrThrow({ where: { id: c.intentId } })).status, "P1 bị thay inline").toBe("HET_HAN");
    const yeuCauCuaP2 = await yeuCauCua(p2.intentId);
    expect(yeuCauCuaP2, "phiếu mới CHƯA từng có yêu cầu riêng — vết bác chỉ nằm ở phiếu CŨ").toEqual([]);

    const truoc = await chup();
    expect.soft(await gan("sale1", c.btX, DON, DOT_A, c.tien), "sale vẫn bị chặn: vết bác đi theo ĐƠN, không theo phiếu thẻ").toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
    expect.soft(await chup(), "bị chặn ⇒ không đổi một dòng nào").toBe(truoc);
    expect.soft(await soPayment()).toBe(0);

    // ĐỐI CHỨNG DƯƠNG cùng cảnh: kế toán gắn được.
    const kq = await gan("kt1", c.btX, DON, DOT_A, c.tien);
    expect(kq, `kế toán gắn được — ${JSON.stringify(kq)}`).toMatchObject(DA_GAN_THANH_CONG);
    expect(await soPayment()).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[GTB-DB-L] tầng LIB (`ganTienTheoCon` gọi thẳng, không qua phiên): cổng nằm TRONG khoá đơn", () => {
    it("[GTB-DB-L1] `nguoiGan: KHAC` + giao dịch đã bị bác cho đơn ⇒ từ chối đúng câu, 0 dòng đổi; ĐỐI CHỨNG: cùng lời gọi với `KE_TOAN` ⇒ ghi, đúng một Payment, vết bác không bị xoá", async () => {
      const c = await canhGoc({ bac: true });
      const truoc = await chup();
      const chan = await ganTienTheoCon({ bankTransactionId: c.btX, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: c.tien }], actor: actorLib("sale1"), nguoiGan: NGUOI_KHAC });
      expect.soft(chan, "KHÁC kế toán").toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
      expect.soft(await chup(), "bị từ chối ⇒ KHÔNG đổi một dòng nào").toBe(truoc);
      expect.soft(await soPayment()).toBe(0);

      const duoc = await ganTienTheoCon({ bankTransactionId: c.btX, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: c.tien }], actor: actorLib("kt1"), nguoiGan: NGUOI_KE_TOAN });
      expect(duoc, "kế toán").toMatchObject(DA_GAN_THANH_CONG);
      expect(await soPayment(), "đúng một Payment").toBe(1);
      expect(await soTuChoi(), "vết bác còn nguyên").toBe(1);
    });

    it("[GTB-DB-L2] vết bác được hỏi theo ĐƠN CỦA LỜI GỌI: cùng một người KHÁC-kế-toán gắn X vào DON bị chặn, vào DON_PHU (đơn khác) được — hàm đọc nhận ĐÚNG orderId", async () => {
      const c = await canhGoc({ bac: true });
      const hoi: string[] = [];
      const dem: NguoiGan = {
        loai: "KHAC",
        docGiaoDichDaBiBac: async (tx, orderId) => {
          hoi.push(orderId);
          return docGiaoDichDaBiBac(tx, orderId);
        },
      };
      const a = await ganTienTheoCon({ bankTransactionId: c.btX, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: c.tien }], actor: actorLib("sale1"), nguoiGan: dem });
      expect(a, "DON").toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
      expect(await soPhanBo(DON), "bị chặn TRƯỚC phép ghi đầu tiên: không phân bổ mồ côi ở DON").toBe(0);
      const b = await ganTienTheoCon({ bankTransactionId: c.btX, orderId: DON_PHU, dong: [{ paymentRequestId: DOT_D, soTien: c.tien }], actor: actorLib("sale1"), nguoiGan: dem });
      expect(b, `DON_PHU — ${JSON.stringify(b)}`).toMatchObject(DA_GAN_THANH_CONG);
      expect(hoi, "hàm đọc được hỏi MỘT lần cho mỗi đơn, đúng đơn của lời gọi").toEqual([DON, DON_PHU]);
    });

    it("[GTB-DB-L3] người KHÁC: hàm đọc vết bác được hỏi ĐÚNG MỘT lần mỗi lượt gắn (không bỏ sót, không hỏi lặp); giao dịch chưa từng bị bác ⇒ gắn được", async () => {
      const c = await canhGoc({ bac: false });
      let lanHoi = 0;
      const dem: NguoiGan = {
        loai: "KHAC",
        docGiaoDichDaBiBac: async (tx, orderId) => {
          lanHoi += 1;
          return docGiaoDichDaBiBac(tx, orderId);
        },
      };
      const kq = await ganTienTheoCon({ bankTransactionId: c.btKhac, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: c.tien }], actor: actorLib("sale1"), nguoiGan: dem });
      expect(kq, "chưa từng bị bác ⇒ gắn được").toMatchObject(DA_GAN_THANH_CONG);
      expect(lanHoi, "người KHÁC: hỏi đúng một lần").toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-07] TÍNH LẠI DƯỚI KHOÁ — vết bác đến GIỮA lúc sale bắt đầu gắn và lúc nắm được khoá đơn: lượt gắn đọc LẠI trong khoá và từ chối; ĐỐI CHỨNG: cùng cảnh KHÔNG có vết bác đến ⇒ lượt gắn (cũng chờ khoá) ghi bình thường", async () => {
    const dungKhoa = async (chenVetBac: boolean) => {
      await dungDon();
      const c = await canhGoc({ bac: false });
      let moKhoa!: () => void;
      const daGiu = new Promise<void>((r) => (moKhoa = r));
      let nha!: () => void;
      const choNha = new Promise<void>((r) => (nha = r));
      // Bên GIỮ khoá đơn (đóng vai `tuChoiSaiMa`: bác một giao dịch DƯỚI khoá đơn rồi commit).
      const giu = db.$transaction(
        async (tx) => {
          await khoaDonTrongTx(tx, DON);
          moKhoa();
          await choNha;
          if (chenVetBac) {
            await tx.posSaiMaYeuCau.create({
              data: {
                intentId: c.intentId,
                bankTransactionId: c.btX,
                centerId: CS1,
                kieu: "CHO_KE_TOAN",
                trangThai: "TU_CHOI",
                lyDo: "NHIEU_UNG_VIEN",
                nguoiGuiId: id.sale1,
                createdAt: LICH.gui1,
                nguoiQuyetId: id.kt1,
                quyetLuc: sau(LICH.gui1, PHUT),
                lyDoTuChoi: "Không phải giao dịch của khách",
              },
            });
          }
        },
        { timeout: 60_000, maxWait: 60_000 },
      );
      await daGiu;
      // Lượt gắn của sale: tới SAU khi khoá đã bị giữ ⇒ phải CHỜ khoá. (Gọi lib thẳng: cùng cổng, bỏ phần phiên.)
      const ganX = ganTienTheoCon({ bankTransactionId: c.btX, orderId: DON, dong: [{ paymentRequestId: DOT_A, soTien: c.tien }], actor: actorLib("sale1"), nguoiGan: NGUOI_KHAC });
      // Chờ tới khi lượt gắn THẬT SỰ xếp hàng ở khoá advisory của đơn (không ngủ cứng: đọc `pg_locks` của CHÍNH database này).
      const han = Date.now() + 20_000;
      for (;;) {
        const r = await db.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        if ((r[0]?.n ?? 0) >= 1) break;
        if (Date.now() > han) throw new Error("lượt gắn không xếp hàng ở khoá đơn trong 20 giây — fixture không dựng được cảnh đua");
        await new Promise((res) => setTimeout(res, 25));
      }
      nha();
      await giu;
      return { c, kq: await ganX };
    };

    const co = await dungKhoa(true);
    expect.soft(co.kq, "vết bác đã commit TRƯỚC khi lượt gắn nắm khoá ⇒ lượt gắn phải thấy nó và từ chối").toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
    expect.soft(await soPayment(), "không một đồng nào vào đơn").toBe(0);
    expect.soft(await soPhanBo(), "không phân bổ nào").toBe(0);
    expect.soft(await btTrangThai(co.c.btX), "X vẫn nằm hàng chờ").toBe("UNMATCHED");
    expect.soft(await soTuChoi(), "vết bác đến giữa chừng còn nguyên").toBe(1);

    // ĐỐI CHỨNG: cùng cảnh, KHÔNG có vết bác nào đến ⇒ chờ khoá rồi ghi bình thường (chứng minh việc CHỜ KHOÁ không tự sinh ra từ chối).
    const khong = await dungKhoa(false);
    expect(khong.kq, "không có vết bác ⇒ gắn được").toMatchObject(DA_GAN_THANH_CONG);
    expect(await soPayment()).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VIỆC 6 (chốt) — NGƯỜI ĐA VAI. `payments:manage` seed GLOBAL ⇒ `checkPermission("payments:manage")` TRẦN trả true cho kế toán ở BẤT KỲ cơ sở nào. Bản trước coi `multi` (sale@CS1 + kế toán@CS2) là
  // "kế toán" ở đơn CS1 và gắn lại được đúng khoản kế toán vừa bác. Hai cửa phải cùng đóng: cửa chia-theo-con (`ganGiaoDichTheoConAction`) và cửa CŨ rót-toàn-đơn (`ganGiaoDichVaoDon`, chỉ kế toán —
  // nó không đọc vết bác với BẤT KỲ AI nên nếu để `multi` lọt qua đây thì cổng V71 bị lách bằng lời gọi trực tiếp).
  it("[GTB-DB-12] NGƯỜI ĐA VAI: sale@CS1 + kế toán@CS2 KHÔNG gắn lại được X (đã bị bác cho DON) ở CS1 — cả cửa chia-theo-con lẫn cửa cũ rót-toàn-đơn; ĐỐI CHỨNG DƯƠNG: kế toán@CS1 + sale@CS2 gắn được cả hai cửa — v1 và v2", async () => {
    for (const v2 of CHE_DO) {
      // (1) multi bị từ chối ở CẢ HAI cửa, không đổi một dòng nào.
      await dungDon();
      const c = await canhGoc({ bac: true });
      chonCheDo(v2);
      const truoc = await chup();
      expect.soft(await gan("multi", c.btX, DON, DOT_A, c.tien), `${ten(v2)}: multi — cửa chia-theo-con`).toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
      h.session = phien("multi");
      const cuaCuMulti = await ganGiaoDichVaoDon(c.btX, DON);
      expect.soft(cuaCuMulti.ok, `${ten(v2)}: multi — cửa cũ rót-toàn-đơn phải đóng: ${JSON.stringify(cuaCuMulti)}`).toBe(false);
      expect.soft(await chup(), `${ten(v2)}: multi bị từ chối ở cả hai cửa ⇒ 0 dòng đổi`).toBe(truoc);

      // (2) ĐỐI CHỨNG DƯƠNG — multi2 qua cửa chia-theo-con; mỗi cửa một cảnh mới (gắn xong là giao dịch đã "ăn").
      await dungDon();
      const c2 = await canhGoc({ bac: true });
      chonCheDo(v2);
      expect.soft(await gan("multi2", c2.btX, DON, DOT_A, c2.tien), `${ten(v2)}: multi2 — cửa chia-theo-con`).toMatchObject(DA_GAN_THANH_CONG);
      expect.soft(await soPayment(DON), `${ten(v2)}: multi2 — một Payment`).toBe(1);

      await dungDon();
      const c3 = await canhGoc({ bac: true });
      chonCheDo(v2);
      h.session = phien("multi2");
      const cuaCuMulti2 = await ganGiaoDichVaoDon(c3.btX, DON);
      expect.soft(cuaCuMulti2.ok, `${ten(v2)}: multi2 — cửa cũ rót-toàn-đơn: ${JSON.stringify(cuaCuMulti2)}`).toBe(true);
      expect.soft(await btTrangThai(c3.btX), `${ten(v2)}: multi2 — giao dịch MATCHED`).toBe("MATCHED");
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-08] THỨ TỰ TỪ CHỐI nói thật: giao dịch đã bị bác nhưng sau đó KẾ TOÁN ĐÃ GẮN (MATCHED) ⇒ sale nghe 'đã được gắn rồi', không nghe câu bác (câu bác đúng nhưng cũ); gắn lại bởi kế toán cũng nghe câu đó", async () => {
    chonCheDo(true);
    const c = await canhGoc({ bac: true });
    const kt = await gan("kt1", c.btX, DON, DOT_A, c.tien);
    expect(kt, `fixture: kế toán gắn trước — ${JSON.stringify(kt)}`).toMatchObject(DA_GAN_THANH_CONG);
    const truoc = await chup();
    expect.soft(await gan("sale1", c.btX, DON, DOT_A, c.tien), "sale gắn tiếp một giao dịch ĐÃ MATCHED").toEqual({ ok: false, error: "Giao dịch này đã được gắn rồi" });
    expect.soft(await chup(), "không đổi gì").toBe(truoc);
  });

  // ───────────────────────────────────────────────────────────────────────────
  it("[GTB-DB-10] CỔNG CŨ vẫn đứng TRƯỚC: cơ sở TẮT cờ thu học phí linh hoạt ⇒ sale nghe câu CŨ ('chỉ kế toán mới gắn được'), không nghe câu bác; kế toán cơ sở đó vẫn gắn được", async () => {
    chonCheDo(true);
    const c = await canhGoc({ bac: true });
    await db.systemSetting.update({ where: { key: KHOA_CO }, data: { valueJson: false } });
    try {
      const truoc = await chup();
      const kq = await gan("sale1", c.btX, DON, DOT_A, c.tien);
      expect.soft(kq, "sale ở cơ sở tắt cờ").toEqual({ ok: false, error: "Cơ sở của đơn này chưa bật thu học phí linh hoạt — chỉ kế toán mới gắn được giao dịch" });
      expect.soft(await chup()).toBe(truoc);
      const kt = await gan("kt1", c.btX, DON, DOT_A, c.tien);
      expect(kt, `kế toán vẫn gắn được khi cờ tắt — ${JSON.stringify(kt)}`).toMatchObject(DA_GAN_THANH_CONG);
    } finally {
      await db.systemSetting.update({ where: { key: KHOA_CO }, data: { valueJson: true } });
    }
  });
});
