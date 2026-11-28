// tests/finance/pos-huy-sai-ma.test.ts — NÚT "HUỶ PHIẾU THẺ" (Việc 4) × YÊU CẦU "TÔI NHẬP SAI MÃ" (Việc 3). Postgres THẬT, đọc BẢNG THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-huy-phieu-the.test.ts` / `pos-hai-nut-sai-ma.test.ts`).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §6.9 mục 4 + §7.5-A (F6/F9). Hai nhánh làm song song nên lúc ghép nút huỷ nhận hai cờ BẰNG THÂN TẠM
// trả `false` (`yeu-cau-sai-ma-dang-giu.ts`); đây là nơi ĐO chúng bằng bảng `PosSaiMaYeuCau` thật. Mọi ca đi qua ĐÚNG cửa đời thật:
// phiếu mở bằng `moPhieuPos`, giao dịch gõ sai bằng `nhapLoPos` (file), "Chưa thấy" bằng `xuLyKetQuaPos` NOT_FOUND, yêu cầu bằng
// `guiSaiMa` / `duyetSaiMa` / `tuChoiSaiMa`, huỷ bằng `huyPhieuThe` (lib) hoặc `huyPhieuTheAction` (action). CHỈ bốn nhóm ca cố ý chèn thẳng
// `posSaiMaYeuCau` — [13b] yêu cầu sống trên phiếu CHO_QUET · [13d] bảng sự thật của hai hàm đọc · [13f] dòng mang `centerId` lệch · [13i] yêu cầu mồ côi
// trên phiếu HUY: đường thật không bao giờ tạo ra các trạng thái đó, và chính vì vậy cờ "đang giữ" là LỚP THỨ HAI.
//
// ── VÌ SAO BỘ NÀY TỒN TẠI: nút huỷ nói chuyện với yêu cầu "nhập sai mã" ở HAI chỗ, và mỗi chỗ có một ca nguy hiểm riêng ────────────────
//   · ĐƯỜNG THẬT của Việc 3 chuyển phiếu `CHO_QUET → CAN_XU_LY` ngay lúc GỬI, nên cổng ① (trạng thái) nói trước và cờ "yêu cầu đang giữ"
//     chưa bao giờ tới lượt — bộ DB cũ xanh 527/527 mà thân hàm vẫn trả `false`. Lớp thứ hai chỉ lộ ra khi dữ liệu vi phạm bất biến.
//   · SAU TỪ CHỐI phiếu về `CHO_QUET` (MỞ) + NOT_FOUND + một câu lưu là CÂU TỪ CHỐI (`cauTuChoi(lyDo)`, CHỈ ĐỂ HIỆN NGAY) mà poller ghi đè sau vài phút.
//     Trước VIỆC 6 (cổng riêng V4.2) huỷ bị CHẶN ở đây, vì: kế toán bác X ⇒ sale huỷ ⇒ mở phiếu mới ⇒ gửi LẠI X — bản Việc 3 đếm `soLanBiBac` /
//     `daBiBacChoPhieu` THEO PHIẾU THẺ nên phiếu mới "chưa từng bị bác" ⇒ tiền vào đơn KHÔNG qua kế toán. VIỆC 5 đã khoá bộ nhớ bác theo ĐƠN
//     (`daBiBacChoDon`) nên ca lách ấy bị chặn dù cổng huỷ HỎNG (`tests/finance/pos-bac-lach-phieu-moi.test.ts`).
//     VIỆC 6 · a2 (chủ dự án chốt 10/10/2026): sau từ chối sale HUỶ ĐƯỢC theo cổng thường (đã gỡ cờ + mã `SAI_MA_BI_TU_CHOI`). Bộ này nay đo CHIỀU NGƯỢC LẠI,
//     bằng bảng THẬT: huỷ được NGAY sau từ chối và sau khi poller ghi đè (không nhấp nháy, màn = máy chủ), và huỷ → mở phiếu mới cùng mã → gửi lại X
//     thì X KHÔNG tự ghi nhận (`[13e]`, `[HN6-A2-*]`).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm có `now` đều được truyền mốc tuyệt đối; riêng nhóm gọi ACTION (action tự đọc `new Date()`) dùng
// `vi.useFakeTimers({ toFake: ["Date"] })`. Ca "bị từ chối" luôn kèm ẢNH CHỤP trước/sau (`chup`) và ĐỐI CHỨNG DƯƠNG (luật 11).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  /** Chạy NGAY TRƯỚC khi `xuLyKetQuaPos` làm việc — dựng đúng ca "đổi GIỮA lúc giữ giao dịch và lúc ghi tiền" (hai transaction nối tiếp). */
  truocTien: null as null | (() => Promise<void>),
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
vi.mock("@/lib/payments/pos/xu-ly-ket-qua", async (goc) => {
  const m = await goc<typeof import("@/lib/payments/pos/xu-ly-ket-qua")>();
  return {
    ...m,
    xuLyKetQuaPos: async (...a: Parameters<typeof m.xuLyKetQuaPos>) => {
      if (h.truocTien) await h.truocTien();
      return m.xuLyKetQuaPos(...a);
    },
  };
});

// Ca đua chạy nhiều vòng, mỗi vòng dựng lại cảnh — quá giờ không chỉ đỏ ca đó mà còn LÀM HỎNG các ca đứng sau (vitest không huỷ được
// promise đang chạy — luật 18).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { getHandlers } from "@/lib/events/registry";
import { khoaDonTrongTx, khoaGiaoDichTrongTx } from "@/lib/finance/ghi-tien-don";
import { taoPhieuGop } from "@/lib/finance/phieu-gop";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult } from "@/lib/payments/pos/provider/kieu";
import { FakePosProvider } from "@/lib/payments/pos/provider/fake";
import { chayPollerPos } from "@/lib/payments/pos/poller";
import { dongBoPhieuPosSauNhap } from "@/lib/payments/pos/dong-bo-sau-nhap";
import { docPhieuPosView, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { khoaPhieuPosTrongTx, xuLyKetQuaPos } from "@/lib/payments/pos/xu-ly-ket-qua";
import { laCauChuaThay, thongDiepPos } from "@/lib/payments/pos/thong-diep-pos";
import { CAU_BI_BAC_KHONG_CON_UNG_VIEN, cauTuChoi, nutNhapSaiMa } from "@/lib/payments/pos/sai-ma";
import { docHangChoSaiMa, timUngVienSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { duyetSaiMa, guiSaiMa, tuChoiSaiMa } from "@/lib/payments/pos/sai-ma-ghi";
import { huyPhieuThe } from "@/lib/payments/pos/huy-phieu-the-db";
import { choPhepHuyPhieuThe, type KetQuaHuyPhieuThe } from "@/lib/payments/pos/huy-phieu-the";
import { coYeuCauSaiMaDangGiu, yeuCauSaiMaMoiNhat } from "@/lib/payments/pos/yeu-cau-sai-ma-dang-giu";
import {
  CAU_THIEU_XAC_NHAN_MANH,
  CAU_TU_CHOI_HUY_PHIEU_THE,
  ghepCauTuChoiHuy,
  MA_TU_CHOI_HUY_PHIEU_THE,
  type MaLyDoHuyPhieuThe,
  type MaTuChoiHuyPhieuThe,
} from "@/lib/payments/pos/huy-phieu-the-cau";
import type { HuyPhieuTheInput } from "@/lib/validators/huy-phieu-the";
import { huyPhieuTheAction } from "@/app/(admin)/admin/orders/_actions";

if (!RUN_DB_TESTS) console.warn(`[HN4-DB-13] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos4sm-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS4SM";

const KT = `${T}kt`; // Kế toán — người quyết yêu cầu + người nhập file
const KT2 = `${T}kt2`;
const ADMIN = `${T}admin`;
const SALE = `${T}sale`; // người lập đơn + mở phiếu + gửi yêu cầu + bấm huỷ
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON = `${T}don`; // hai bé, hai đợt
const DON_RIENG = `${T}don-rieng`; // MỘT bé, MỘT đợt — "đơn thu đủ ⇒ 1 biên nhận"
const DON_PHU = `${T}don-phu`; // đơn thứ hai cùng cơ sở — phiếu thẻ của ĐƠN KHÁC
const A = `${T}item-a`;
const B = `${T}item-b`;
const C = `${T}item-c`;
const D = `${T}item-d`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const DOT_C = `${T}dot-c`;
const DOT_D = `${T}dot-d`;
const MAY1 = `${PFX}MAY01`; // CS1 — máy DUY NHẤT của CS1 ⇒ `moPhieuPos` tự chọn
const MAY2 = `${PFX}MAY02`; // CS2
const SDT_PH = "0399812399";
const EMAIL_PH = "ph.fx.pos4sm@test.local";
const TPL = "FX_POS4SM_BIEN_NHAN";
const TEN_SALE = "Sale fixture HN4SM";
const ACTOR = { id: SALE, name: TEN_SALE };
const A_KT = { id: KT, name: "Kế toán fixture HN4SM" };
const A_KT2 = { id: KT2, name: "Kế toán 2 fixture HN4SM" };
const NGUOI = [KT, KT2, ADMIN, SALE];
const DON_CUA_TEST = [DON, DON_RIENG, DON_PHU];

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B;
const DOT_TIEN_C = 4_000_000;

const PHUT = 60_000;
const sau = (moc: Date, ms: number) => new Date(moc.getTime() + ms);
const luc = (hhmmss: string) => new Date(`2026-10-06T${hhmmss}Z`);

/** Lúc mở phiếu thẻ. */
const NOW = luc("10:00:00");
/** Giờ quẹt (giờ VN) = 10:31:35Z — SAU lúc mở phiếu, trong cửa sổ [mở − 5′, nay]. */
const GIO_QUET = "2026-10-06T17:31:35+07:00";
/** Sale bấm Kiểm tra ⇒ "Chưa thấy giao dịch". */
const KIEM = sau(NOW, 40 * PHUT);
/** Sale bấm "Tôi nhập sai mã trên máy". */
const GUI = sau(NOW, 45 * PHUT);
/** Kế toán duyệt / từ chối. */
const QUYET = sau(NOW, 60 * PHUT);
/** Sale bấm "Huỷ phiếu thẻ" — SAU mọi bước trên, còn xa hạn 24 giờ. */
const HUY_LUC = sau(NOW, 65 * PHUT);

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
const ghep = (ma: MaTuChoiHuyPhieuThe) => ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE[ma]);

/** Gõ SAI đúng một ký tự (ký tự cuối) — không bao giờ qua checksum. */
const saiMotKyTu = (ma: string) => ma.slice(0, 4) + (ma[4] === "X" ? "Y" : "X");

/** Quản trị tối cao: thấy MỌI cơ sở — cho các ca KHÔNG đo phạm vi (khuôn `pos-hai-nut-sai-ma.test.ts`). */
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
  await db.emailTemplate.deleteMany({ where: { code: TPL } });
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
  await db.user.deleteMany({ where: { OR: [{ id: { in: NGUOI } }, { email: EMAIL_PH }, { phone: { in: [SDT_PH, "84399812399"] } }] } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  h.truocTien = null;
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", A_KT.name],
    [KT2, "ACCOUNTANT", A_KT2.name],
    [ADMIN, "SUPER_ADMIN", "Quản trị fixture HN4SM"],
    [SALE, "SALES_CSM", TEN_SALE],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  for (const [id, ten] of [
    [CS1, "CS1 fixture POS4SM"],
    [CS2, "CS2 fixture POS4SM"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: "QTTFBKATK", centerId: CS2 } });
  await db.emailTemplate.create({
    data: {
      code: TPL,
      name: "Biên nhận fixture HN4SM",
      trigger: "PAYMENT_RECEIPT",
      subject: "Biên nhận {{order_code}}",
      bodyText: "Đã thanh toán {{total_amount}} · {{payment_method}}",
      bodyHtml: "<p>Đã thanh toán {{total_amount}} · {{payment_method}}</p>",
    },
  });

  const taoDon = (id: string, code: string, tong: number) =>
    db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture HN4SM",
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
  await taoDon(DON, "ORD-269986-000501", TONG);
  await taoDong(DON, A, DOT_A, "Bé A HN4SM", DOT_TIEN_A, 1);
  await taoDong(DON, B, DOT_B, "Bé B HN4SM", DOT_TIEN_B, 2);
  await taoDon(DON_RIENG, "ORD-269986-000502", DOT_TIEN_C);
  await taoDong(DON_RIENG, C, DOT_C, "Bé C HN4SM", DOT_TIEN_C, 1);
  await taoDon(DON_PHU, "ORD-269986-000503", DOT_TIEN_A);
  await taoDong(DON_PHU, D, DOT_D, "Bé D HN4SM", DOT_TIEN_A, 1);
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
async function moPhieu(orderId: string, dot: string, now: Date = NOW) {
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

/** Sale bấm Kiểm tra ⇒ "Chưa thấy giao dịch" (kết quả NOT_FOUND vào ĐÚNG đường `xuLyKetQuaPos`; poller cũng đi đường này). */
async function chuaThay(intentId: string, now: Date = KIEM) {
  const kq = await xuLyKetQuaPos({ intentId, ketQua: { kind: "NOT_FOUND" } satisfies PosCheckResult, triggeredBy: "SALE", now, nguonDuLieu: "FAKE" });
  expect(laCauChuaThay(kq.thongDiep), `phải ra câu 'Chưa thấy': ${kq.thongDiep}`).toBe(true);
  return kq;
}

type Canh = { orderId: string; dot: string };

/**
 * Cảnh chuẩn: phiếu gộp + phiếu thẻ + "Chưa thấy" + MỘT giao dịch gõ sai mã đã vào hàng chờ (qua file).
 * `dienGiai` nhận mã đúng và trả ghi chú trên máy.
 */
async function dungCanh(c: Canh, dienGiai: (maDung: string) => string, o: { soTien?: number; gio?: string; rrn?: string } = {}) {
  const g = await phatPhieu(c.orderId, [c.dot]);
  const p = await moPhieu(c.orderId, c.dot);
  expect(p.code5).toBe(g.ma);
  await chuaThay(p.intentId);
  const m = maGd();
  await nhapFile([
    dong({
      maGiaoDich: m,
      dienGiai: dienGiai(g.ma),
      soTien: o.soTien ?? g.tongTien,
      ...(o.gio ? { thoiGian: o.gio } : {}),
      ...(o.rrn ? { maGiaoDichThe: o.rrn } : {}),
    }),
  ]);
  return { g, p, m, bt: await btId(m), intentId: p.intentId, ma: g.ma, billId: g.billId, orderId: c.orderId };
}

const guiCho = (orderId: string, intentId: string, bankTransactionId: string, o: { now?: Date } = {}) =>
  guiSaiMa({ orderId, intentId, bankTransactionId, actor: ACTOR, now: o.now ?? GUI });

const yeuCauCua = (intentId: string) => db.posSaiMaYeuCau.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } });

/** Cảnh chờ duyệt: HAI ứng viên cùng tiền ⇒ chờ kế toán (khuôn `canhChoDuyet` của Việc 3). */
async function canhChoDuyet(o: Canh = { orderId: DON, dot: DOT_A }) {
  const c = await dungCanh(o, () => "");
  const m2 = maGd();
  await nhapFile([dong({ maGiaoDich: m2, dienGiai: "", soTien: c.g.tongTien, thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445568" })]);
  const kq = await guiCho(o.orderId, c.intentId, c.bt);
  expect(kq).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
  const yc = (await yeuCauCua(c.intentId))[0]!;
  return { ...c, yc, bt2: await btId(m2) };
}

// ── Lịch "GIỮA ĐỜI" (VIỆC 6 · a2) — cùng lịch của `[HN5-DB-03]` / bản `[HN4-DB-13e]` cũ ────────────────────────────────────────────────────────────────
// P1 mở 10:00Z; khách KHÁC quẹt 10:20Z (NGOÀI cửa sổ của phiếu mới); X quẹt 10:38Z — nằm TRONG cửa sổ [mở − 5′, nay] của phiếu mới mở 10:42:30Z. Nếu X nằm ngoài cửa sổ thì "X không là ứng viên"
// là do cửa sổ chứ không do vết bác, và ca xanh vì lý do sai (bài học `chayDuong` của Việc 5).
const GIO_KHAC = "2026-10-06T17:20:00+07:00"; // 10:20Z
const GIO_X = "2026-10-06T17:38:00+07:00"; // 10:38Z
const LY_DO_BAC = "Không phải giao dịch của khách";

/**
 * Cảnh: phiếu gộp + P1 mở lúc `NOW` + "Chưa thấy" + file có HAI giao dịch cùng số phải thu, ghi chú RỖNG (`mKhac` ngoài cửa sổ của phiếu mới, X trong cửa sổ).
 * `bac` ⇒ sale gửi X (hai ứng viên ⇒ chờ kế toán) và kế toán BÁC X lúc 10:42:00Z ⇒ P1 về CHO_QUET mang CÂU TỪ CHỐI (chưa ai bấm Kiểm tra lại). `bac = false` ⇒ CÙNG cảnh, KHÔNG yêu cầu nào
 * (đối chứng dương: chỉ khác đúng một yếu tố). Một giao dịch KHÁC số tiền, quẹt SAU lúc mở phiếu mới, được nhập sau cùng ⇒ dữ liệu của máy "mới hơn phiếu mới" ⇒ phiếu mới không bị coi là thiếu dữ liệu
 * — nếu thiếu, X lọt vào phiếu mới cũng chỉ ra CHO_KE_TOAN và lỗ bị che.
 */
async function canhGiuaDoi(o: { bac: boolean; lyDo?: string }) {
  const g = await phatPhieu(DON, [DOT_A]);
  const p1 = await moPhieu(DON, DOT_A, NOW);
  expect(p1.code5, "phiếu thẻ dùng ĐÚNG mã của phiếu gộp").toBe(g.ma);
  await chuaThay(p1.intentId, luc("10:40:00"));
  const mKhac = maGd();
  const mX = maGd();
  await nhapFile([
    dong({ maGiaoDich: mKhac, dienGiai: "", soTien: g.tongTien, thoiGian: GIO_KHAC, maGiaoDichThe: "112233445581" }),
    dong({ maGiaoDich: mX, dienGiai: "", soTien: g.tongTien, thoiGian: GIO_X, maGiaoDichThe: "112233445582" }),
  ]);
  const btX = await btId(mX);
  if (o.bac) {
    expect(await guiCho(DON, p1.intentId, btX, { now: luc("10:41:00") }), "hai ứng viên ⇒ gửi kế toán").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
    const yc = (await yeuCauCua(p1.intentId))[0]!;
    const tc = await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: o.lyDo ?? LY_DO_BAC, actor: A_KT, now: luc("10:42:00") });
    expect(tc, "kế toán bác X").toMatchObject({ ok: true, trangThai: "TU_CHOI" });
    const sauBac = await phieuPos(p1.intentId);
    expect(sauBac.status, "bác ⇒ P1 về CHO_QUET (MỞ)").toBe("CHO_QUET");
    expect(sauBac.lastResultMessage, "câu lưu NGAY sau từ chối = câu từ chối (chưa ai bấm Kiểm tra lại)").toBe(cauTuChoi(o.lyDo ?? LY_DO_BAC));
    expect((await btThe(mX))?.status, "X vẫn nằm hàng chờ").toBe("UNMATCHED");
  }
  await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: 999_000, thoiGian: "2026-10-06T17:42:40+07:00", maGiaoDichThe: "112233445583" })]);
  return { g, p1, mX, mKhac, btX };
}

/** Bấm "Huỷ phiếu thẻ" — chính hàm `huyPhieuTheAction` gọi. Mặc định: có tick, lý do "mở nhầm", SAU mọi bước của Việc 3. */
function huy(intentId: string, o: { orderId?: string; now?: Date; lyDo?: MaLyDoHuyPhieuThe } = {}): Promise<KetQuaHuyPhieuThe> {
  return huyPhieuThe({
    orderId: o.orderId ?? DON,
    intentId,
    lyDo: o.lyDo ?? "MO_NHAM",
    xacNhanKhachChuaQuet: true,
    actor: ACTOR,
    now: o.now ?? HUY_LUC,
  });
}

type TrangThaiYc = "CHO_DUYET" | "DANG_GHI" | "DA_GHI_NHAN" | "TU_CHOI";
/**
 * Chèn THẲNG một dòng yêu cầu (bỏ qua `guiSaiMa`) — dựng trạng thái mà ĐƯỜNG THẬT không bao giờ tạo (yêu cầu sống trên phiếu CHO_QUET) hoặc
 * một bảng sự thật có thứ tự. Hợp lệ với cả năm CHECK + hai UNIQUE từng phần của migration `20261010090000_pos_sai_ma_yeu_cau`.
 */
async function chenYeuCau(o: { intentId: string; bankTransactionId: string; trangThai: TrangThaiYc; createdAt: Date; centerId?: string; lyDoTuChoi?: string }) {
  const choKeToan = o.trangThai === "CHO_DUYET" || o.trangThai === "TU_CHOI";
  return db.posSaiMaYeuCau.create({
    data: {
      intentId: o.intentId,
      bankTransactionId: o.bankTransactionId,
      centerId: o.centerId ?? CS1,
      kieu: choKeToan ? "CHO_KE_TOAN" : "TU_GHI_NHAN",
      trangThai: o.trangThai,
      lyDo: choKeToan ? "NHIEU_UNG_VIEN" : "",
      nguoiGuiId: SALE,
      createdAt: o.createdAt,
      ...(o.trangThai === "DANG_GHI" ? { dangGhiLuc: o.createdAt } : {}),
      ...(o.trangThai === "TU_CHOI"
        ? { nguoiQuyetId: KT, quyetLuc: sau(o.createdAt, PHUT), lyDoTuChoi: o.lyDoTuChoi ?? "Không phải giao dịch của khách" }
        : {}),
    },
  });
}

/** Hai hàm đọc nhận `db` (màn) hoặc `tx` (máy chủ) — ca đọc trần dùng `db`. Ép kiểu một chỗ này. */
type KhachDocYc = Parameters<typeof coYeuCauSaiMaDangGiu>[0];
const khachDoc = db as unknown as KhachDocYc;
/**
 * VIỆC 6 · a2: `[đang giữ, trạng thái yêu cầu MỚI NHẤT, lý do từ chối của nó]` — thay cho cặp boolean `[đang giữ, mới nhất bị từ chối]` (cờ thứ hai ĐÃ GỠ). Lý do của dòng MỚI NHẤT là thứ máy chủ
 * so với câu lưu để nhận ra "câu lưu là câu từ chối" (`laCauLuuTuChoiSaiMa`), nên bảng sự thật phải đo cả nó.
 */
const haiCo = async (intentId: string): Promise<[boolean, string | null, string | null]> => {
  const moiNhat = await yeuCauSaiMaMoiNhat(khachDoc, intentId);
  return [await coYeuCauSaiMaDangGiu(khachDoc, intentId), moiNhat?.trangThai ?? null, moiNhat?.lyDoTuChoi ?? null];
};

/**
 * Phán quyết "huỷ được không" của MÁY CHỦ, đo KHÔNG ghi gì: gọi `huyPhieuThe` THẬT nhưng KHÔNG tick. Cổng luật đứng TRƯỚC cổng tick (`[HN4-S-W8]`) và cổng tick đứng TRƯỚC phép ghi, nên
 * "cho huỷ" ⇔ máy chủ dừng ở `CAU_THIEU_XAC_NHAN_MANH` (chưa ghi dòng nào); "không cho" ⇔ trả đúng câu của mã từ chối. Lấy phán quyết từ CHÍNH đường ghi, không từ bản sao của luật.
 */
async function maySau(intentId: string, now: Date = HUY_LUC, orderId: string = DON): Promise<"CHO_HUY" | MaTuChoiHuyPhieuThe> {
  const kq = await huyPhieuThe({ orderId, intentId, lyDo: "MO_NHAM", xacNhanKhachChuaQuet: false, actor: ACTOR, now });
  if (kq.ok) throw new Error("máy chủ huỷ mà KHÔNG có tick — phá luật xác nhận mạnh");
  if (kq.error === CAU_THIEU_XAC_NHAN_MANH) return "CHO_HUY";
  const ma = MA_TU_CHOI_HUY_PHIEU_THE.find((m) => ghep(m) === kq.error);
  if (!ma) throw new Error(`câu lỗi lạ của máy chủ: ${kq.error}`);
  return ma;
}
/** Phán quyết của MÀN (`docPhieuPosView(...).huyPhieuThe`) quy về cùng kiểu với `maySau`. */
async function manSau(intentId: string, now: Date = HUY_LUC): Promise<"CHO_HUY" | MaTuChoiHuyPhieuThe> {
  const v = await docPhieuPosView(intentId, now);
  if (!v) throw new Error("không dựng được view");
  return v.huyPhieuThe.huyDuoc ? "CHO_HUY" : v.huyPhieuThe.ma;
}

const soPayment = (orderId = DON) => db.payment.count({ where: { orderId } });
const soPhanBo = (orderId = DON) => db.paymentAllocation.count({ where: { paymentRequest: { orderId } } });
const soVetHuy = (orderId = DON) => db.auditLog.count({ where: { entityType: "Order", entityId: orderId, action: "POS_PHIEU_HUY" } });
const suKienDaChia = (orderId: string) =>
  db.domainEvent.findMany({ where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], equals: orderId } }, orderBy: { createdAt: "asc" } });
const bienNhan = (orderId: string) => db.emailLog.count({ where: { contextType: "Order", contextId: orderId } });

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

/**
 * Ảnh chụp MỌI thứ một lượt huỷ / gửi / duyệt / từ chối có thể đổi. `updatedAt` nằm trong hàng ⇒ một phép ghi vô hình cũng làm nó lệch;
 * AuditLog, thông báo, sự kiện đếm số dòng. Hai ảnh bằng nhau ⇒ lượt kia KHÔNG ghi gì.
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

/** Mọi lượt của một vòng đua phải XONG (không ném): deadlock / P2002 rò ra ngoài là ca đỏ, không phải "một bên thua". */
function phaiXong<T>(kq: PromiseSettledResult<T>[], ngucCanh: string): T[] {
  kq.forEach((r, i) => expect(r.status, `${ngucCanh}, bên ${i}: ${r.status === "rejected" ? String(r.reason) : ""}`).toBe("fulfilled"));
  return kq.map((r) => (r as PromiseFulfilledResult<T>).value);
}

/** BẤT BIẾN "không yêu cầu mồ côi": mọi yêu cầu CÒN SỐNG nằm trên phiếu thẻ đang GIỮ đúng giao dịch của nó (CAN_XU_LY / LECH_TIEN / DA_THU). */
async function khongYeuCauMoCoi(orderId: string, ngucCanh: string) {
  const rows = await db.posSaiMaYeuCau.findMany({ where: { intent: { paymentBill: { orderId } } }, include: { intent: true } });
  for (const r of rows) {
    if (r.trangThai === "TU_CHOI") continue;
    expect(["CAN_XU_LY", "LECH_TIEN", "DA_THU"], `${ngucCanh}: yêu cầu ${r.trangThai} nằm trên phiếu thẻ ${r.intent.status}`).toContain(r.intent.status);
    expect(r.intent.bankTransactionId, `${ngucCanh}: phiếu thẻ phải GIỮ giao dịch của yêu cầu`).toBe(r.bankTransactionId);
  }
}

// ── Bộ gá ĐUA XÁC ĐỊNH (khuôn `pos-huy-phieu-the.test.ts`): kẻ khác GIỮ khoá ĐƠN trong một transaction riêng ───────────────────────────
/**
 * Chờ tới khi lượt `dangChay` BỊ CHẶN ở khoá advisory (khoá ĐƠN): có ít nhất một phiên đang CHỜ khoá advisory ở DB này (lọc theo oid — cụm
 * 5432 dùng chung với phiên khác). `true` khi thấy người chờ; `false` khi lượt đã xong mà chưa ai chờ hoặc quá 8 giây. Không bao giờ ném.
 * Ca gọi phải KHẲNG ĐỊNH kết quả — chính khẳng định ấy là bằng chứng "lượt này chờ khoá đơn".
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

/**
 * VIỆC 6 · a2 — như `choCoNguoiChoKhoa` nhưng đợi ĐỦ `n` phiên đang chờ khoá advisory (lọc theo oid của DB này). `true` khi đủ; `false` khi lượt `dangChay` đã xong mà chưa đủ, hoặc quá 8 giây.
 * Dùng để XẾP HÀNG hai lượt ở khoá ĐƠN theo ĐÚNG thứ tự mong muốn (`epThuTu`).
 */
async function choDuNguoiCho(n: number, dangChay: Promise<unknown>): Promise<boolean> {
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
    if ((r[0]?.n ?? 0) >= n) return true;
    if (performance.now() - batDau > 8_000) return false;
    await new Promise((x) => setTimeout(x, 25));
  }
  return false;
}

/**
 * ÉP THỨ TỰ hai lượt cùng đi qua khoá ĐƠN (VIỆC 6 · a2): một kẻ giữ khoá đơn → `truoc` xếp hàng và ĐÃ chờ → `sau` xếp hàng sau nó và ĐÃ chờ → kẻ giữ nhả. Khoá advisory cấp theo thứ tự xếp hàng
 * nên `truoc` chạy xong TRƯỚC `sau` — cả hai thứ tự được thử một cách XÁC ĐỊNH, không trông vào độ trễ ngẫu nhiên (khác `[HN4-DB-13h6]`). Trả `[kết quả truoc, kết quả sau]`; mọi lượt phải XONG (không ném).
 */
async function epThuTu<A, B>(truoc: () => Promise<A>, sau: () => Promise<B>, orderId: string = DON): Promise<[A, B]> {
  let daKhoa!: () => void;
  const choDaKhoa = new Promise<void>((xong) => {
    daKhoa = xong;
  });
  let nha!: () => void;
  const choNha = new Promise<void>((xong) => {
    nha = xong;
  });
  const giu = db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await khoaDonTrongTx(tx, orderId);
      daKhoa();
      await choNha;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await Promise.race([choDaKhoa, giu]);
  const a = truoc();
  const aXepHang = await choDuNguoiCho(1, a);
  const b = sau();
  const bXepHang = await choDuNguoiCho(2, b);
  nha();
  const [rGiu, ra, rb] = await Promise.allSettled([giu, a, b]);
  expect(aXepHang, "lượt thứ nhất đã XẾP HÀNG ở khoá đơn trước khi lượt thứ hai bắt đầu").toBe(true);
  expect(bXepHang, "lượt thứ hai đã xếp hàng SAU lượt thứ nhất").toBe(true);
  expect(rGiu.status, `kẻ giữ khoá: ${rGiu.status === "rejected" ? String(rGiu.reason) : ""}`).toBe("fulfilled");
  expect(ra.status, `lượt thứ nhất: ${ra.status === "rejected" ? String(ra.reason) : ""}`).toBe("fulfilled");
  expect(rb.status, `lượt thứ hai: ${rb.status === "rejected" ? String(rb.reason) : ""}`).toBe("fulfilled");
  return [(ra as PromiseFulfilledResult<A>).value, (rb as PromiseFulfilledResult<B>).value];
}

// ═════════════════════════════════════════════════════════════════════════════
// CÁC CA
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!RUN_DB_TESTS)("[HN4-DB-13] huỷ phiếu thẻ × yêu cầu 'nhập sai mã' — bảng THẬT", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13a] ĐƯỜNG THẬT: cổng ① (trạng thái) nói trước — cờ chưa bao giờ tới lượt", () => {
    it("[HN4-DB-13a] gửi yêu cầu CHỜ KẾ TOÁN ⇒ phiếu CAN_XU_LY ⇒ huỷ bị từ chối `CAN_XU_LY`, 0 dòng đổi. ĐỐI CHỨNG: chưa gửi thì cùng phiếu huỷ ĐƯỢC", async () => {
      const c = await canhChoDuyet();
      expect((await phieuPos(c.intentId)).status).toBe("CAN_XU_LY");
      expect(c.yc.trangThai).toBe("CHO_DUYET");
      const truoc = await chup();
      expect(await huy(c.intentId)).toEqual({ ok: false, error: ghep("CAN_XU_LY") });
      expect(await chup(), "cổng đứng TRƯỚC phép ghi đầu tiên: không đổi một dòng nào").toBe(truoc);
      expect(await soVetHuy()).toBe(0);

      // ĐỐI CHỨNG DƯƠNG: cùng cảnh nhưng sale CHƯA gửi yêu cầu nào ⇒ huỷ được (cảnh không tự gây từ chối).
      await dungFixture();
      const s = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
      expect(await yeuCauCua(s.intentId)).toEqual([]);
      const ok = await huy(s.intentId);
      expect(ok.ok, `đối chứng dương: ${ok.ok ? "" : ok.error}`).toBe(true);
      expect((await phieuPos(s.intentId)).status).toBe("HUY");
    });

    it("[HN4-DB-13a2] yêu cầu đã GHI NHẬN (tự ghi nhận · rồi duyệt) ⇒ phiếu DA_THU ⇒ huỷ bị từ chối `DA_THU`, 0 dòng đổi, đúng 1 Payment", async () => {
      // (i) TỰ GHI NHẬN: một ứng viên, ghi chú rỗng.
      const c = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
      expect(await guiCho(DON_RIENG, c.intentId, c.bt)).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect((await phieuPos(c.intentId)).status).toBe("DA_THU");
      const truoc = await chup();
      expect(await huy(c.intentId, { orderId: DON_RIENG })).toEqual({ ok: false, error: ghep("DA_THU") });
      expect(await chup()).toBe(truoc);
      expect(await soPayment(DON_RIENG), "tiền đã ghi đúng một lần").toBe(1);

      // (ii) DUYỆT: kế toán khác bấm duyệt yêu cầu chờ duyệt ⇒ cùng kết cục.
      await dungFixture();
      const d = await canhChoDuyet();
      expect(await duyetSaiMa({ orderId: DON, yeuCauId: d.yc.id, actor: A_KT, now: QUYET })).toMatchObject({ ok: true, trangThai: "DA_GHI_NHAN" });
      expect((await phieuPos(d.intentId)).status).toBe("DA_THU");
      const truoc2 = await chup();
      expect(await huy(d.intentId)).toEqual({ ok: false, error: ghep("DA_THU") });
      expect(await chup()).toBe(truoc2);
      expect(await soPayment()).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13b] LỚP THỨ HAI: dữ liệu vi phạm bất biến — yêu cầu SỐNG nằm trên phiếu CHO_QUET", () => {
    it.each(["CHO_DUYET", "DANG_GHI", "DA_GHI_NHAN"] as const)(
      "[HN4-DB-13b] yêu cầu %s trên phiếu CHO_QUET (chèn thẳng) ⇒ `CO_YEU_CAU_SAI_MA`, 0 dòng đổi. ĐỐI CHỨNG: gỡ yêu cầu ấy ⇒ huỷ được",
      async (trangThai) => {
        const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
        expect((await phieuPos(c.intentId)).status).toBe("CHO_QUET");
        expect((await phieuPos(c.intentId)).bankTransactionId, "phiếu CHƯA giữ giao dịch (cổng ② 'đã nhận giao dịch' không che cờ)").toBeNull();
        await chenYeuCau({ intentId: c.intentId, bankTransactionId: c.bt, trangThai, createdAt: GUI });
        const truoc = await chup();
        expect(await huy(c.intentId)).toEqual({ ok: false, error: ghep("CO_YEU_CAU_SAI_MA") });
        expect(await chup(), "cổng đứng TRƯỚC phép ghi đầu tiên: không đổi một dòng nào").toBe(truoc);
        expect(await soVetHuy()).toBe(0);

        // ĐỐI CHỨNG DƯƠNG: đúng MỘT yếu tố đổi (yêu cầu biến mất) ⇒ cùng phiếu huỷ được.
        await db.posSaiMaYeuCau.deleteMany({ where: { intentId: c.intentId } });
        const ok = await huy(c.intentId);
        expect(ok.ok, `đối chứng dương: ${ok.ok ? "" : ok.error}`).toBe(true);
        expect((await phieuPos(c.intentId)).status).toBe("HUY");
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13c] SAU TỪ CHỐI (VIỆC 6 · a2 viết lại): huỷ ĐƯỢC theo cổng thường — ngay sau từ chối lẫn sau khi poller ghi đè; không nhấp nháy; màn và máy chủ cùng một phán quyết", () => {
    it("[HN4-DB-13c] từ chối ⇒ phiếu CHO_QUET mang CÂU TỪ CHỐI ⇒ màn và máy chủ cùng nói CHO HUỶ; poller + đồng bộ sau nhập ghi đè 'Chưa thấy…' ⇒ VẪN cho huỷ (cùng phán quyết); gửi yêu cầu MỚI ⇒ CAN_XU_LY chặn lại; từ chối lần hai ⇒ huỷ ĐƯỢC và huỷ THẬT chạy", async () => {
      const c = await canhChoDuyet();
      const lyDo = "Đây là giao dịch của khách khác";
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo, actor: A_KT, now: QUYET })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      const sauTuChoi = await phieuPos(c.intentId);
      expect(sauTuChoi.status, "phiếu về CHO_QUET (MỞ)").toBe("CHO_QUET");
      expect(sauTuChoi.bankTransactionId, "NHẢ giao dịch").toBeNull();
      expect(sauTuChoi.lastResultMessage, "câu lưu ngay sau từ chối: câu từ chối (KHÔNG phải 'Chưa thấy')").toBe(cauTuChoi(lyDo));

      // (1) NGAY SAU từ chối — câu lưu là câu từ chối. Bỏ cờ riêng mà không nhận ra câu này thì máy chủ nói CHUA_NGA_NGU (sai nghĩa) rồi vài phút sau tự đổi — nút nhấp nháy.
      const truoc1 = await chup();
      expect(await manSau(c.intentId), "màn: ngay sau từ chối").toBe("CHO_HUY");
      expect(await maySau(c.intentId), "máy chủ: ngay sau từ chối").toBe("CHO_HUY");
      expect(await chup(), "phép thử không ghi gì (dừng ở cổng tick)").toBe(truoc1);

      // (2) Poller + đồng bộ sau nhập GHI ĐÈ câu lưu bằng 'Chưa thấy…' — không dữ kiện nào về tiền đổi ⇒ CÙNG phán quyết.
      const muon = sau(NOW, 90 * PHUT);
      await chayPollerPos({ dongHo: () => muon, provider: new FakePosProvider() });
      await dongBoPhieuPosSauNhap({ now: sau(muon, 10 * PHUT), nguoiKiemId: KT, nguoiBam: { id: KT, name: A_KT.name } });
      const sauGhiDe = await phieuPos(c.intentId);
      expect(sauGhiDe.status).toBe("CHO_QUET");
      expect(laCauChuaThay(sauGhiDe.lastResultMessage), "câu LƯU đã bị lượt kiểm sau ghi đè thành 'Chưa thấy…'").toBe(true);
      // Hàm thuần: cùng đầu vào, cờ TẮT (câu không còn là câu từ chối) ⇒ 'chưa thấy' trần tự nó đã cho huỷ.
      expect(
        choPhepHuyPhieuThe({
          status: sauGhiDe.status,
          lastResultKind: sauGhiDe.lastResultKind,
          lastResultMessage: sauGhiDe.lastResultMessage,
          code5: sauGhiDe.code5,
          daNhanGiaoDich: false,
          coGiaoDichChoTay: false,
          coYeuCauSaiMaDangGiu: false,
          cauLuuLaCauTuChoiSaiMa: false,
          coDongTheChuaKetLuan: false,
          phieuGopConMo: true,
          daHetHan: false,
        }).huyDuoc,
        "'Chưa thấy' trần cho huỷ",
      ).toBe(true);

      const chonHuy = sau(muon, 20 * PHUT);
      const truoc2 = await chup();
      expect(await manSau(c.intentId, chonHuy), "màn: sau khi câu lưu bị ghi đè").toBe("CHO_HUY");
      expect(await maySau(c.intentId, chonHuy), "máy chủ: sau khi câu lưu bị ghi đè — CÙNG phán quyết với lúc ngay sau từ chối").toBe("CHO_HUY");
      expect(await chup(), "không đổi một dòng nào").toBe(truoc2);
      expect(await soVetHuy()).toBe(0);

      // (3) V76: sale gửi yêu cầu MỚI (giao dịch còn lại) ⇒ yêu cầu SỐNG ⇒ phiếu CAN_XU_LY ⇒ huỷ bị từ chối `CAN_XU_LY` (màn và máy chủ).
      const lai = await guiCho(DON, c.intentId, c.bt2, { now: sau(muon, 30 * PHUT) });
      expect(lai, "gửi yêu cầu MỚI sau khi bị bác").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
      expect((await phieuPos(c.intentId)).status).toBe("CAN_XU_LY");
      expect(await huy(c.intentId, { now: sau(muon, 35 * PHUT) })).toEqual({ ok: false, error: ghep("CAN_XU_LY") });
      expect(await manSau(c.intentId, sau(muon, 35 * PHUT))).toBe("CAN_XU_LY");
      // Yêu cầu mới nhất là yêu cầu SỐNG ⇒ trạng thái mới nhất CHO_DUYET (không còn lý do từ chối); cờ 'đang giữ' BẬT.
      expect(await haiCo(c.intentId), "[đang giữ, trạng thái mới nhất, lý do]").toEqual([true, "CHO_DUYET", null]);

      // (4) Kế toán từ chối LẦN HAI (lý do KHÁC) ⇒ phiếu lại về CHO_QUET mang câu từ chối của lần hai ⇒ huỷ ĐƯỢC, và huỷ THẬT chạy (có tick) — chỉ MỘT vết.
      const yc2 = (await yeuCauCua(c.intentId)).find((y) => y.trangThai === "CHO_DUYET")!;
      const lyDo2 = "Giao dịch thứ hai cũng không phải của khách";
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: yc2.id, lyDo: lyDo2, actor: A_KT, now: sau(muon, 40 * PHUT) })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      expect((await phieuPos(c.intentId)).lastResultMessage, "câu lưu = câu từ chối của lần HAI").toBe(cauTuChoi(lyDo2));
      expect(await haiCo(c.intentId), "yêu cầu mới nhất = lần hai, mang lý do lần hai").toEqual([false, "TU_CHOI", lyDo2]);
      const chonHuy2 = sau(muon, 41 * PHUT);
      expect(await manSau(c.intentId, chonHuy2), "màn: sau lần từ chối thứ hai").toBe("CHO_HUY");
      expect(await maySau(c.intentId, chonHuy2), "máy chủ: sau lần từ chối thứ hai").toBe("CHO_HUY");
      expect(await huy(c.intentId, { now: chonHuy2 }), "huỷ THẬT sau từ chối").toEqual({ ok: true, intentId: c.intentId, code5: c.ma });
      expect((await phieuPos(c.intentId)).status).toBe("HUY");
      expect(await soVetHuy(), "đúng một vết huỷ").toBe(1);
      expect(await soPayment(), "huỷ không đụng tiền").toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13d] BẢNG SỰ THẬT của hai hàm đọc trên Postgres thật (VIỆC 6 · a2: hàm thứ hai trả trạng thái + lý do của yêu cầu MỚI NHẤT)", () => {
    it("[HN4-DB-13d] (đang giữ, trạng thái + lý do của yêu cầu MỚI NHẤT) theo từng lịch sử yêu cầu của phiếu — kể cả thứ tự createdAt ≠ thứ tự chèn, lý do là của lần MỚI NHẤT, và yêu cầu của phiếu KHÁC", async () => {
      const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
      const m2 = maGd();
      await nhapFile([dong({ maGiaoDich: m2, dienGiai: "", thoiGian: "2026-10-06T17:32:10+07:00", maGiaoDichThe: "112233445569" })]);
      const x = c.bt;
      const y = await btId(m2);
      const t1 = sau(NOW, 40 * PHUT);
      const t2 = sau(NOW, 50 * PHUT);

      type Hang = { tt: TrangThaiYc; bt: string; luc: Date; ly?: string };
      const bang: { ten: string; hang: Hang[]; mong: [boolean, string | null, string | null] }[] = [
        { ten: "chưa từng có yêu cầu", hang: [], mong: [false, null, null] },
        { ten: "MỘT yêu cầu bị từ chối", hang: [{ tt: "TU_CHOI", bt: x, luc: t1, ly: "lý do một" }], mong: [false, "TU_CHOI", "lý do một"] },
        {
          ten: "bị từ chối rồi gửi lại: dòng MỚI NHẤT còn sống (không lý do từ chối)",
          hang: [{ tt: "TU_CHOI", bt: x, luc: t1, ly: "lý do một" }, { tt: "CHO_DUYET", bt: y, luc: t2 }],
          mong: [true, "CHO_DUYET", null],
        },
        {
          ten: "createdAt ≠ thứ tự chèn: dòng SỐNG chèn TRƯỚC nhưng có createdAt MUỘN hơn — vẫn là mới nhất",
          hang: [{ tt: "CHO_DUYET", bt: y, luc: t2 }, { tt: "TU_CHOI", bt: x, luc: t1, ly: "lý do một" }],
          mong: [true, "CHO_DUYET", null],
        },
        {
          ten: "bị từ chối HAI lần: lý do là của lần MỚI NHẤT",
          hang: [{ tt: "TU_CHOI", bt: x, luc: t1, ly: "lý do một" }, { tt: "TU_CHOI", bt: y, luc: t2, ly: "lý do hai" }],
          mong: [false, "TU_CHOI", "lý do hai"],
        },
        {
          ten: "bị từ chối HAI lần, chèn lần MỚI trước: vẫn lý do của lần MỚI NHẤT theo createdAt",
          hang: [{ tt: "TU_CHOI", bt: y, luc: t2, ly: "lý do hai" }, { tt: "TU_CHOI", bt: x, luc: t1, ly: "lý do một" }],
          mong: [false, "TU_CHOI", "lý do hai"],
        },
        { ten: "đang chờ duyệt", hang: [{ tt: "CHO_DUYET", bt: x, luc: t1 }], mong: [true, "CHO_DUYET", null] },
        { ten: "đang ghi tiền", hang: [{ tt: "DANG_GHI", bt: x, luc: t1 }], mong: [true, "DANG_GHI", null] },
        { ten: "đã ghi nhận", hang: [{ tt: "DA_GHI_NHAN", bt: x, luc: t1 }], mong: [true, "DA_GHI_NHAN", null] },
      ];
      for (const b of bang) {
        await db.posSaiMaYeuCau.deleteMany({ where: { intentId: c.intentId } });
        for (const r of b.hang) await chenYeuCau({ intentId: c.intentId, bankTransactionId: r.bt, trangThai: r.tt, createdAt: r.luc, ...(r.ly ? { lyDoTuChoi: r.ly } : {}) });
        expect(await haiCo(c.intentId), b.ten).toEqual(b.mong);
      }

      // Yêu cầu của phiếu thẻ KHÁC (đơn khác) không đếm cho phiếu này — đọc THEO PHIẾU. Đối chứng: chính phiếu kia thì có.
      await db.posSaiMaYeuCau.deleteMany({ where: { intentId: c.intentId } });
      const k = await dungCanh({ orderId: DON_PHU, dot: DOT_D }, () => "", { rrn: "112233445570" });
      await chenYeuCau({ intentId: k.intentId, bankTransactionId: k.bt, trangThai: "CHO_DUYET", createdAt: GUI });
      expect(await haiCo(c.intentId), "yêu cầu của phiếu khác").toEqual([false, null, null]);
      expect(await haiCo(k.intentId), "đối chứng: chính phiếu có yêu cầu").toEqual([true, "CHO_DUYET", null]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13e] CA LÁCH — kế toán BÁC X ⇒ huỷ ⇒ mở phiếu mới cùng mã ⇒ gửi lại X (VIỆC 6 · a2: huỷ ĐƯỢC; X vẫn KHÔNG tự ghi nhận)", () => {
    it("[HN4-DB-13e] huỷ NGAY sau khi kế toán bác ĐƯỢC; 'Thẻ POS' mở phiếu MỚI dùng lại mã; X không còn là ứng viên và gửi lại bị từ chối đúng câu; 0 Payment/phân bổ/biên nhận/sự kiện chia tiền — ĐỐI CHỨNG: không vết bác thì X TỰ GHI NHẬN đúng 1 lần", async () => {
      // Kịch bản NGUYÊN VĂN của chủ dự án (10/10/2026): phiếu thẻ P1 + giao dịch X UNMATCHED sai mã ⇒ gửi yêu cầu ⇒ kế toán TỪ CHỐI ⇒ HUỶ P1 (phải được) ⇒ mở phiếu mới P2 CÙNG MÃ ⇒ gửi lại X cho P2
      // ⇒ X KHÔNG tự ghi nhận. Huỷ chạy NGAY sau từ chối (câu lưu = CÂU TỪ CHỐI, chưa ai bấm Kiểm tra lại) — biến thể "sau Kiểm tra lại" nằm ở `pos-bac-lach-phieu-moi.test.ts` `[HN5-DB-03]`.
      // Giờ chọn để phiếu MỚI vẫn THẤY X trong cửa sổ [mở − 5′, nay]: X quẹt 10:38:00Z, P2 mở 10:42:30Z ⇒ tìm từ 10:37:30Z. Khách KHÁC quẹt 10:20:00Z nằm ngoài cửa sổ ⇒ P2 chỉ còn MỘT ứng viên (X).
      const chay = async (bac: boolean) => {
        const { g, p1, mX, btX } = await canhGiuaDoi({ bac });
        const kqHuy = await huy(p1.intentId, { now: luc("10:42:20") });
        const p1Sau = await phieuPos(p1.intentId);
        // 'Mở lại' = bấm 'Thẻ POS' lần nữa: phiếu P1 đã HUY nên phải mở phiếu MỚI (nếu huỷ bị chặn, nó trả lại CHÍNH phiếu cũ).
        const lai = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: luc("10:42:30") });
        if (!lai.ok) throw new Error(`fixture: không mở lại được phiếu — ${lai.error}`);
        const p2 = lai.phieu;
        await chuaThay(p2.intentId, luc("10:43:00"));
        const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: luc("10:43:05") });
        const truocLai = await chup();
        const kqLai = await guiCho(DON, p2.intentId, btX, { now: luc("10:44:00") });
        const sauLai = await chup();
        return { g, p1, p2, mX, btX, kqHuy, p1Sau, tim, kqLai, truocLai, sauLai };
      };

      // ── (1) CÓ vết bác ──
      const r = await chay(true);
      expect.soft(r.kqHuy, "huỷ NGAY sau khi kế toán đã bác phải ĐƯỢC (cổng riêng SAI_MA_BI_TU_CHOI đã bỏ)").toEqual({ ok: true, intentId: r.p1.intentId, code5: r.g.ma });
      expect.soft(r.p1Sau.status, "P1 đã HUY").toBe("HUY");
      expect.soft(r.p2.intentId, "'Thẻ POS' mở phiếu MỚI, không trả lại phiếu cũ").not.toBe(r.p1.intentId);
      expect.soft(r.p2.code5, "…dùng lại ĐÚNG mã của phiếu gộp").toBe(r.g.ma);
      expect.soft(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } }), "hai phiếu thẻ của đơn: P1 (HUY) + P2").toBe(2);
      // X phải NẰM TRONG cửa sổ của P2 — nếu không, "không là ứng viên" là do cửa sổ chứ không do vết bác (và ca xanh vì lý do sai).
      const xThoiGian = (await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: r.mX } })).thoiGianGiaoDich.getTime();
      expect(xThoiGian, "X quẹt TRONG cửa sổ 5′ của phiếu mới").toBeGreaterThanOrEqual(luc("10:42:30").getTime() - 5 * PHUT);
      expect(xThoiGian, "…và trước lúc mở phiếu mới").toBeLessThanOrEqual(luc("10:42:30").getTime());
      expect.soft(r.tim.ok && r.tim.ungVien.map((u) => u.bankTransactionId), "X ĐÃ BỊ BÁC không còn là ứng viên của phiếu mới").toEqual([]);
      expect.soft(r.tim.ok && r.tim.cau, "…và câu nói đúng sự thật: CÓ giao dịch nhưng kế toán đã từ chối nó (không phải 'không thấy')").toBe(CAU_BI_BAC_KHONG_CON_UNG_VIEN);
      expect.soft(r.kqLai, "gửi lại X cho phiếu mới bị TỪ CHỐI đúng câu").toEqual({ ok: false, error: CAU_BI_BAC_KHONG_CON_UNG_VIEN });
      expect.soft(r.sauLai, "bị từ chối ⇒ KHÔNG đổi một dòng nào").toBe(r.truocLai);
      // HẬU QUẢ: không một đồng nào vào đơn, X vẫn nằm hàng chờ, phiếu gộp còn mở, đúng một dòng yêu cầu (dòng đã bác), đúng một vết huỷ.
      expect.soft(await soPayment(), "tiền vào đơn KHÔNG qua kế toán").toBe(0);
      expect.soft(await soPhanBo(), "không phân bổ").toBe(0);
      expect.soft(await db.receipt.count({ where: { payment: { orderId: DON } } }), "không biên lai (Receipt)").toBe(0);
      expect.soft(await suKienDaChia(DON), "không sự kiện chia tiền").toHaveLength(0);
      expect.soft(await bienNhan(DON), "không email biên nhận").toBe(0);
      expect.soft((await btThe(r.mX))?.status, "X vẫn UNMATCHED").toBe("UNMATCHED");
      expect.soft((await phieuGopDb(r.g.billId)).status).toBe("OPEN");
      expect.soft(await db.posSaiMaYeuCau.count({ where: { intent: { paymentBill: { orderId: DON } } } }), "số dòng yêu cầu").toBe(1);
      expect.soft(await soVetHuy(), "đúng MỘT vết huỷ").toBe(1);

      // ── (2) ĐỐI CHỨNG DƯƠNG: CÙNG đường, KHÔNG vết bác ⇒ X là ứng viên DUY NHẤT ghi chú rỗng ⇒ TỰ GHI NHẬN (chứng minh cảnh là LỖ, không phải cảnh tự chặn) ──
      await dungFixture();
      const s = await chay(false);
      expect(s.kqHuy.ok, "đối chứng: huỷ được khi chưa bị bác").toBe(true);
      expect(s.tim.ok && s.tim.ungVien.map((u) => u.bankTransactionId), "đối chứng: chưa bị bác ⇒ X là ứng viên DUY NHẤT").toEqual([s.btX]);
      expect(s.tim.ok && s.tim.ungVien[0]?.xemTruoc, "…ghi chú rỗng, đủ dữ liệu ⇒ tự ghi nhận").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
      expect(s.kqLai, "đối chứng").toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(), "đối chứng: tiền ghi ĐÚNG một lần").toBe(1);
      expect(await soPhanBo(), "đối chứng: một phân bổ").toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13k] HẾT HẠN sau từ chối (VIỆC 6 · a2: không còn là LỐI THOÁT DUY NHẤT — huỷ được ngay): phiếu cũ HET_HAN rồi 'Thẻ POS' mở phiếu MỚI", () => {
    it("[HN4-DB-13k] phiếu cũ bị bác rồi quá 24 giờ ⇒ 'Thẻ POS' mở phiếu MỚI (cũ HET_HAN): phiếu mới huỷ ĐƯỢC; ở ca này giao dịch bị bác nằm NGOÀI cửa sổ của phiếu mới nên không là ứng viên (X quẹt ≤ 5′ cuối đời phiếu cũ thì phiếu mới vẫn thấy X và chỉ Việc 5 chặn: pos-bac-lach-phieu-moi.test.ts [HN5-DB-01])", async () => {
      const c = await canhChoDuyet();
      expect((await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: QUYET })).ok).toBe(true);
      await chuaThay(c.intentId, sau(QUYET, PHUT)); // câu lưu 'Chưa thấy…'
      expect(await maySau(c.intentId, sau(QUYET, 2 * PHUT)), "trong hạn: máy chủ CHO huỷ (không còn cổng riêng vì từng bị từ chối)").toBe("CHO_HUY");

      // Quá hạn 24 giờ: "Thẻ POS" thay phiếu cũ (HET_HAN) bằng phiếu MỚI dùng lại CÙNG mã.
      const qua = sau(NOW, 25 * 60 * PHUT);
      const p2 = await moPhieu(DON, DOT_A, qua);
      expect(p2.intentId, "phiếu MỚI").not.toBe(c.intentId);
      expect(p2.code5, "dùng lại ĐÚNG mã").toBe(c.ma);
      expect((await phieuPos(c.intentId)).status, "phiếu cũ").toBe("HET_HAN");
      expect(await haiCo(c.intentId), "phiếu cũ vẫn mang yêu cầu 'bị bác'").toEqual([false, "TU_CHOI", "Không phải giao dịch của khách"]);
      expect(await haiCo(p2.intentId), "phiếu mới sạch").toEqual([false, null, null]);

      // Giao dịch đã bị bác (và giao dịch kia) nằm ngoài cửa sổ [mở − 5′, nay] của phiếu mới ⇒ KHÔNG là ứng viên ⇒ không đưa vào phiếu mới được.
      // (Điều này đúng vì GIỜ QUẸT của ca — 25 giờ trước. Nó KHÔNG chứng minh hết hạn là an toàn: lách trong cửa sổ 5′ được đo ở `[HN5-DB-01..05]`.)
      await chuaThay(p2.intentId, sau(qua, PHUT));
      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: sau(qua, 2 * PHUT) });
      expect(tim.ok, "tìm được (chỉ là không có ứng viên)").toBe(true);
      expect(tim.ok && tim.ungVien.map((u) => u.bankTransactionId), "X và giao dịch kia không còn là ứng viên").toEqual([]);

      // Phiếu mới huỷ được (cổng huỷ đọc THEO PHIẾU THẺ — bộ nhớ bác thì theo ĐƠN, hai thứ khác nhau).
      const ok = await huy(p2.intentId, { now: sau(qua, 3 * PHUT) });
      expect(ok.ok, `phiếu mới: ${ok.ok ? "" : ok.error}`).toBe(true);
      expect((await phieuPos(p2.intentId)).status).toBe("HUY");
      expect(await soVetHuy()).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13f] cổng đọc yêu cầu KHÔNG bị scope (phạm vi/quyền)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(HUY_LUC);
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

    const goi = (intentId: string) =>
      huyPhieuTheAction({ orderId: DON, intentId, lyDo: "MO_NHAM", xacNhanKhachChuaQuet: true } as HuyPhieuTheInput);

    it("[HN4-DB-13f] sale cơ sở CS1 huỷ phiếu của CS1; yêu cầu sai mã mang `centerId` CS2 (lệch) VẪN chặn — cổng tra bằng `tx` trần, không `scopedDb`/không lọc cơ sở. ĐỐI CHỨNG: gỡ yêu cầu ⇒ huỷ được", async () => {
      const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
      // Dòng vẫn thuộc đơn của CS1 (qua phiếu thẻ), chỉ cột `centerId` lệch — đúng thứ một lọc theo cơ sở sẽ làm biến mất khỏi tầm nhìn của sale CS1.
      await chenYeuCau({ intentId: c.intentId, bankTransactionId: c.bt, trangThai: "CHO_DUYET", createdAt: GUI, centerId: CS2 });
      // Sale CS1 không thấy dòng này qua client scope (đo thật, để ca không xanh vì lý do sai).
      const sdbCs1 = scopedDb(actorCoSo(CS1));
      expect(await sdbCs1.posSaiMaYeuCau.count({ where: { intentId: c.intentId } }), "client scope của CS1 KHÔNG thấy dòng CS2").toBe(0);
      expect(await db.posSaiMaYeuCau.count({ where: { intentId: c.intentId } }), "nhưng dòng CÓ trong DB").toBe(1);

      const truoc = await chup();
      expect(await goi(c.intentId)).toEqual({ ok: false, error: ghep("CO_YEU_CAU_SAI_MA") });
      expect(await chup(), "không đổi một dòng nào").toBe(truoc);
      expect(vi.mocked(revalidatePath), "từ chối thì không làm mới trang").not.toHaveBeenCalled();

      await db.posSaiMaYeuCau.deleteMany({ where: { intentId: c.intentId } });
      expect(await goi(c.intentId)).toEqual({ ok: true, intentId: c.intentId, code5: c.ma });
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(1);
    });

    it("[HN4-DB-13f2] cơ sở KHÁC: sale CS2 không huỷ được phiếu của CS1 (đơn ngoài phạm vi) dù phiếu huỷ được — yêu cầu sai mã không phải đường vòng qua cổng phạm vi", async () => {
      const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
      h.resolveActor.mockResolvedValue(actorCoSo(CS2));
      const truoc = await chup();
      expect(await goi(c.intentId)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(await chup()).toBe(truoc);
      // ĐỐI CHỨNG DƯƠNG: đúng cơ sở ⇒ cùng phiếu huỷ được.
      h.resolveActor.mockResolvedValue(actorCoSo(CS1));
      expect((await goi(c.intentId)).ok).toBe(true);
    });

    it("[HN6-A2-08] SAU TỪ CHỐI, sale CS1 huỷ qua ACTION THẬT (`huyPhieuTheAction`: phiên + quyền + phạm vi + IDOR + máy chủ): ok, phiếu HUY, làm mới trang đúng một lần; cơ sở KHÁC vẫn không huỷ được", async () => {
      const c = await canhChoDuyet();
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: LY_DO_BAC, actor: A_KT, now: QUYET })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      expect((await phieuPos(c.intentId)).lastResultMessage, "câu lưu = câu từ chối (chưa ai bấm Kiểm tra lại)").toBe(cauTuChoi(LY_DO_BAC));

      // ĐỐI CHỨNG ÂM: sale cơ sở khác (CS2) không huỷ được phiếu của CS1 dù cổng huỷ đã mở — phạm vi vẫn gác ở action.
      h.resolveActor.mockResolvedValue(actorCoSo(CS2));
      const truoc = await chup();
      expect(await goi(c.intentId)).toEqual({ ok: false, error: "Không tìm thấy đơn hàng" });
      expect(await chup(), "bị từ chối ⇒ không đổi một dòng nào").toBe(truoc);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();

      h.resolveActor.mockResolvedValue(actorCoSo(CS1));
      expect(await goi(c.intentId)).toEqual({ ok: true, intentId: c.intentId, code5: c.ma });
      expect((await phieuPos(c.intentId)).status).toBe("HUY");
      expect(await soVetHuy()).toBe(1);
      expect(vi.mocked(revalidatePath), "làm mới đúng một lần").toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13g] SAU HUỶ: phía sai mã của phiếu HUY bị từ chối ở MÁY CHỦ", () => {
    it("[HN4-DB-13g] tìm ứng viên / gửi yêu cầu cho phiếu HUY bị từ chối; phiếu KHÔNG 'sống lại' thành CAN_XU_LY; 0 yêu cầu; nút 'Tôi nhập sai mã' không còn. ĐỐI CHỨNG: TRƯỚC huỷ cùng giao dịch tìm được và gửi được", async () => {
      // ĐỐI CHỨNG DƯƠNG trước: cùng cảnh, CHƯA huỷ ⇒ thấy ứng viên.
      const c = await dungCanh({ orderId: DON, dot: DOT_A }, saiMotKyTu);
      const tim0 = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: GUI });
      expect(tim0.ok && tim0.ungVien.map((u) => u.bankTransactionId), "trước huỷ: ứng viên có X").toEqual([c.bt]);
      const v0 = await docPhieuPosView(c.intentId, GUI);
      expect(nutNhapSaiMa({ hienThi: v0!.hienThi, thongDiep: v0!.thongDiep }), "trước huỷ: nút hiện").toBe(true);

      expect((await huy(c.intentId)).ok).toBe(true);
      const p = await phieuPos(c.intentId);
      expect(p.status).toBe("HUY");
      // Chỉ MỘT cổng còn đứng giữa lời gửi và việc kéo phiếu HUY về CAN_XU_LY: lượt kiểm cuối vẫn là NOT_FOUND, giao dịch vẫn UNMATCHED,
      // phiếu gộp vẫn mở, đơn nhận tiền được, cửa sổ thời gian còn — gỡ cổng trạng thái là gửi lọt.
      expect(p.lastResultKind).toBe("NOT_FOUND");
      expect(p.bankTransactionId).toBeNull();
      expect((await btThe(c.m))?.status).toBe("UNMATCHED");
      expect((await phieuGopDb(c.billId)).status).toBe("OPEN");

      const truoc = await chup();
      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: c.intentId, now: sau(HUY_LUC, PHUT) });
      expect(tim, "tìm ứng viên cho phiếu HUY").toEqual({ ok: false, error: "Phiếu thu thẻ không còn chờ quẹt" });
      const gui = await guiCho(DON, c.intentId, c.bt, { now: sau(HUY_LUC, 2 * PHUT) });
      expect(gui, "gửi yêu cầu cho phiếu HUY").toEqual({ ok: false, error: "Phiếu thu thẻ không còn chờ quẹt" });
      expect(await chup(), "không đổi một dòng nào (kể cả 'phiếu sống lại')").toBe(truoc);
      expect(await yeuCauCua(c.intentId), "không tạo yêu cầu").toEqual([]);
      expect((await phieuPos(c.intentId)).status, "phiếu vẫn HUY").toBe("HUY");
      expect(await soPayment()).toBe(0);

      // Màn: phiếu HUY không còn nút nhập sai mã.
      const v1 = await docPhieuPosView(c.intentId, sau(HUY_LUC, 3 * PHUT));
      expect(v1?.hienThi).toBe("HUY");
      expect(nutNhapSaiMa({ hienThi: v1!.hienThi, thongDiep: v1!.thongDiep })).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13h] ĐUA huỷ × gửi / duyệt / từ chối / khớp tự động — đúng MỘT bên thắng, không ghi đôi, không mồ côi, không deadlock", () => {
    const VONG = 4;

    it("[HN4-DB-13h1] huỷ CHEN GIỮA lúc gửi giữ giao dịch và lúc ghi tiền (xác định, bằng hook) ⇒ huỷ nghe `CAN_XU_LY`; tiền ghi ĐÚNG MỘT LẦN; phiếu DA_THU, yêu cầu DA_GHI_NHAN", async () => {
      const c = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
      let kqHuy: KetQuaHuyPhieuThe | null = null;
      let phieuLucChen: string | null = null;
      let ycLucChen: string | null = null;
      h.truocTien = async () => {
        h.truocTien = null; // chỉ MỘT lần — chính lượt huỷ không gọi `xuLyKetQuaPos`, nhưng chắc chắn không lặp
        phieuLucChen = (await phieuPos(c.intentId)).status;
        ycLucChen = (await yeuCauCua(c.intentId))[0]?.trangThai ?? null;
        kqHuy = await huy(c.intentId, { orderId: DON_RIENG });
      };
      const kq = await guiCho(DON_RIENG, c.intentId, c.bt);
      h.truocTien = null;
      expect(phieuLucChen, "lúc huỷ chen vào, TX1 đã commit: phiếu đã CAN_XU_LY").toBe("CAN_XU_LY");
      expect(ycLucChen, "…và yêu cầu đang ghi tiền").toBe("DANG_GHI");
      expect(kqHuy).toEqual({ ok: false, error: ghep("CAN_XU_LY") });
      expect(kq).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(DON_RIENG)).toBe(1);
      expect(await soPhanBo(DON_RIENG)).toBe(1);
      expect((await phieuPos(c.intentId)).status).toBe("DA_THU");
      expect((await yeuCauCua(c.intentId))[0]?.trangThai).toBe("DA_GHI_NHAN");
      expect(await soVetHuy(DON_RIENG)).toBe(0);
    });

    it("[HN4-DB-13h2] huỷ TRƯỚC ⇒ gửi bị từ chối (phiếu HUY), 0 yêu cầu, 0 tiền · gửi TRƯỚC ⇒ huỷ bị từ chối (CAN_XU_LY/DA_THU) — cả hai thứ tự nối tiếp", async () => {
      // [huỷ → gửi]
      const a = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
      expect((await huy(a.intentId, { orderId: DON_RIENG })).ok).toBe(true);
      const g1 = await guiCho(DON_RIENG, a.intentId, a.bt, { now: sau(HUY_LUC, PHUT) });
      expect(g1).toEqual({ ok: false, error: "Phiếu thu thẻ không còn chờ quẹt" });
      expect(await yeuCauCua(a.intentId)).toEqual([]);
      expect(await soPayment(DON_RIENG)).toBe(0);
      expect((await phieuPos(a.intentId)).status).toBe("HUY");
      // [gửi → huỷ]
      await dungFixture();
      const b = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
      expect((await guiCho(DON_RIENG, b.intentId, b.bt)).ok).toBe(true);
      expect(await huy(b.intentId, { orderId: DON_RIENG })).toEqual({ ok: false, error: ghep("DA_THU") });
      expect(await soPayment(DON_RIENG)).toBe(1);
      expect(await soVetHuy(DON_RIENG)).toBe(0);
    });

    it("[HN4-DB-13h3] ĐUA gửi (tự ghi nhận) ‖ huỷ ‖ nhập file ĐÚNG MÃ (khớp tự động): tiền vào ĐÚNG MỘT LẦN, đúng 1 biên nhận, không yêu cầu mồ côi, huỷ ok ⇒ không yêu cầu", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        const nc = `vòng ${vong}`;
        if (vong > 0) await dungFixture();
        const c = await dungCanh({ orderId: DON_RIENG, dot: DOT_C }, saiMotKyTu, { soTien: DOT_TIEN_C });
        const mDung = maGd();
        const [gui, kqHuy] = phaiXong(
          await Promise.allSettled([
            guiCho(DON_RIENG, c.intentId, c.bt),
            huy(c.intentId, { orderId: DON_RIENG }),
            nhapFile([dong({ maGiaoDich: mDung, dienGiai: c.ma, soTien: DOT_TIEN_C, maGiaoDichThe: "998877665599" })]),
          ]),
          nc,
        ) as [Awaited<ReturnType<typeof guiCho>>, KetQuaHuyPhieuThe, KetQuaLoPos];

        expect(await soPayment(DON_RIENG), `${nc}: tiền vào ĐÚNG MỘT LẦN`).toBe(1);
        expect(await soPhanBo(DON_RIENG), `${nc}: một phân bổ`).toBe(1);
        expect((await phieuGopDb(c.billId)).status, `${nc}: phiếu gộp PAID`).toBe("PAID");
        expect(await db.bankTransaction.count({ where: { ...LOC_BT, status: "MATCHED" } }), `${nc}: đúng MỘT giao dịch MATCHED`).toBe(1);
        await khongYeuCauMoCoi(DON_RIENG, nc);

        const yc = await yeuCauCua(c.intentId);
        const p = await phieuPos(c.intentId);
        expect(yc.length, `${nc}: tối đa một yêu cầu`).toBeLessThanOrEqual(1);
        if (kqHuy.ok) {
          expect(p.status, `${nc}: huỷ thắng ⇒ phiếu HUY`).toBe("HUY");
          expect(yc, `${nc}: huỷ thắng ⇒ không yêu cầu`).toEqual([]);
          expect(gui.ok, `${nc}: huỷ thắng ⇒ gửi bị từ chối`).toBe(false);
          expect(await soVetHuy(DON_RIENG), `${nc}: một vết huỷ`).toBe(1);
        } else {
          expect(await soVetHuy(DON_RIENG), `${nc}: huỷ bị từ chối ⇒ không vết`).toBe(0);
          expect([ghep("CAN_XU_LY"), ghep("DA_THU"), ghep("PHIEU_GOP_DA_DONG")], `${nc}: huỷ bị từ chối vì tiền đã/đang vào`).toContain(kqHuy.error);
        }
        if (yc[0]?.trangThai === "DA_GHI_NHAN") {
          expect(p.status, `${nc}: yêu cầu ghi nhận ⇒ phiếu DA_THU`).toBe("DA_THU");
          expect((await btThe(c.m))?.status, `${nc}: giao dịch của yêu cầu MATCHED`).toBe("MATCHED");
        }
        // Một khoản — một sự kiện, một biên nhận (đơn thu đủ).
        expect(await suKienDaChia(DON_RIENG), `${nc}: một sự kiện đã chia`).toHaveLength(1);
        await chayHandler(DON_RIENG);
        expect(await bienNhan(DON_RIENG), `${nc}: đúng 1 biên nhận`).toBe(1);
      }
    });

    it("[HN4-DB-13h4] ĐUA duyệt ‖ huỷ ‖ nhập file ĐÚNG MÃ: huỷ KHÔNG BAO GIỜ thắng; tiền vào ĐÚNG MỘT LẦN; yêu cầu và phiếu nhất quán", async () => {
      for (let vong = 0; vong < VONG; vong += 1) {
        const nc = `vòng ${vong}`;
        if (vong > 0) await dungFixture();
        const c = await canhChoDuyet({ orderId: DON, dot: DOT_A });
        const mDung = maGd();
        const [duyet, kqHuy] = phaiXong(
          await Promise.allSettled([
            duyetSaiMa({ orderId: DON, yeuCauId: c.yc.id, actor: A_KT, now: QUYET }),
            huy(c.intentId),
            nhapFile([dong({ maGiaoDich: mDung, dienGiai: c.ma, soTien: c.g.tongTien, maGiaoDichThe: "998877665598" })]),
          ]),
          nc,
        ) as [Awaited<ReturnType<typeof duyetSaiMa>>, KetQuaHuyPhieuThe, KetQuaLoPos];

        expect(kqHuy.ok, `${nc}: huỷ không thắng một phiếu đang giữ yêu cầu`).toBe(false);
        expect(await soVetHuy(), `${nc}: không vết huỷ`).toBe(0);
        expect((await phieuPos(c.intentId)).status, `${nc}: phiếu KHÔNG HUY`).not.toBe("HUY");
        expect(await soPayment(), `${nc}: tiền vào ĐÚNG MỘT LẦN`).toBe(1);
        expect(await soPhanBo(), `${nc}: một phân bổ`).toBe(1);
        expect((await phieuGopDb(c.billId)).status, `${nc}: phiếu gộp PAID`).toBe("PAID");
        expect(await db.bankTransaction.count({ where: { ...LOC_BT, status: "MATCHED" } }), `${nc}: đúng MỘT giao dịch MATCHED`).toBe(1);
        await khongYeuCauMoCoi(DON, nc);
        const yc = (await yeuCauCua(c.intentId))[0]!;
        // Tiền ghi bởi YÊU CẦU ⇔ yêu cầu DA_GHI_NHAN ⇔ giao dịch của yêu cầu MATCHED.
        expect(yc.trangThai === "DA_GHI_NHAN", `${nc}: yêu cầu ghi nhận ⇔ duyệt thắng (${duyet.ok ? "ok" : duyet.error})`).toBe(duyet.ok);
        expect((await btThe(c.m))?.status === "MATCHED", `${nc}: X MATCHED ⇔ yêu cầu ghi nhận`).toBe(yc.trangThai === "DA_GHI_NHAN");
        // Một khoản — một sự kiện; đợt LẺ của đơn hai đợt ⇒ không biên nhận (V3 [HN3-DB-02b]) — dù bên nào thắng.
        expect(await suKienDaChia(DON), `${nc}: một sự kiện đã chia`).toHaveLength(1);
        await chayHandler(DON);
        expect(await bienNhan(DON), `${nc}: đợt lẻ ⇒ 0 biên nhận`).toBe(0);
      }
    });

    it("[HN4-DB-13h5] (VIỆC 6 · a2 viết lại) TỪ CHỐI → huỷ · huỷ → TỪ CHỐI (nối tiếp, hai thứ tự): kết cục KHÁC NHAU ở điểm đáng khác — huỷ SAU từ chối thắng (HUY, 1 vết); huỷ TRƯỚC bị từ chối CAN_XU_LY (CHO_QUET, 0 vết); bấm huỷ lại sau đó thì CÙNG kết cục cuối", async () => {
      // [từ chối → huỷ]: huỷ chạy sau khi từ chối đã commit ⇒ ĐƯỢC.
      const a = await canhChoDuyet();
      expect((await tuChoiSaiMa({ orderId: DON, yeuCauId: a.yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: QUYET })).ok).toBe(true);
      // Kết quả lưu hiện là 'Chưa thấy…' (sale vừa bấm Kiểm tra) — cổng thường cho huỷ.
      await chuaThay(a.intentId, sau(QUYET, PHUT));
      expect(await huy(a.intentId, { now: sau(QUYET, 2 * PHUT) })).toEqual({ ok: true, intentId: a.intentId, code5: a.ma });
      const ketCucA = [(await phieuPos(a.intentId)).status, (await yeuCauCua(a.intentId))[0]?.trangThai, await soVetHuy()];

      // [huỷ → từ chối]: huỷ TRƯỚC khi kế toán quyết ⇒ bị từ chối CAN_XU_LY, 0 vết; sau từ chối sale bấm huỷ LẠI ⇒ ĐƯỢC.
      await dungFixture();
      const b = await canhChoDuyet();
      expect(await huy(b.intentId), "huỷ TRƯỚC khi kế toán quyết").toEqual({ ok: false, error: ghep("CAN_XU_LY") });
      expect((await tuChoiSaiMa({ orderId: DON, yeuCauId: b.yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: QUYET })).ok).toBe(true);
      const ketCucBGiua = [(await phieuPos(b.intentId)).status, (await yeuCauCua(b.intentId))[0]?.trangThai, await soVetHuy()];
      expect(await huy(b.intentId, { now: sau(QUYET, 2 * PHUT) }), "huỷ lại SAU từ chối").toEqual({ ok: true, intentId: b.intentId, code5: b.ma });
      const ketCucB = [(await phieuPos(b.intentId)).status, (await yeuCauCua(b.intentId))[0]?.trangThai, await soVetHuy()];

      expect(ketCucA).toEqual(["HUY", "TU_CHOI", 1]);
      expect(ketCucBGiua, "giữa hai bước: lượt huỷ đầu bị từ chối nên KHÔNG để lại gì").toEqual(["CHO_QUET", "TU_CHOI", 0]);
      expect(ketCucB, "kết cục cuối của thứ tự thứ hai = kết cục của thứ tự thứ nhất").toEqual(ketCucA);
    });

    it("[HN4-DB-13h6] (VIỆC 6 · a2 viết lại) ĐUA từ chối ‖ huỷ ×4 vòng (lượt huỷ vào ngay · +15ms · +60ms · +150ms): đúng MỘT trong hai kết cục — huỷ chạy TRƯỚC (CAN_XU_LY, phiếu CHO_QUET, 0 vết) hoặc SAU (HUY, 1 vết); yêu cầu luôn TU_CHOI; không ném, không tiền", async () => {
      // Lệch pha tăng dần để CẢ HAI thứ tự đều có cơ hội xảy ra: `tuChoiSaiMa` có một lượt đọc sơ bộ TRƯỚC khi lấy khoá nên huỷ vào cùng lúc thường lấy khoá
      // trước (gặp CAN_XU_LY); huỷ vào trễ mới gặp phiếu đã về CHO_QUET mang CÂU TỪ CHỐI (không phải 'Chưa thấy…') — khi đó nếu quyết theo câu lưu thì lượt này nghe `CHUA_NGA_NGU`
      // (nhấp nháy). Trước VIỆC 6 lượt đó bị cờ chặn (`SAI_MA_BI_TU_CHOI`) nên "huỷ KHÔNG BAO GIỜ thắng"; nay nó ĐƯỢC — thứ cần canh là KHÔNG có kết cục thứ ba (nửa vời).
      // Cả hai thứ tự được ÉP xác định ở `[HN6-A2-05]` (khoá giữ tay); ca này giữ nguyên dạng đua tự nhiên để bắt lỗi thứ tự mà bộ gá xác định không dựng được.
      const TRE_MS = [0, 15, 60, 150];
      for (let vong = 0; vong < VONG; vong += 1) {
        const nc = `vòng ${vong}`;
        if (vong > 0) await dungFixture();
        const c = await canhChoDuyet();
        const [tc, kqHuy] = phaiXong(
          await Promise.allSettled([
            tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: QUYET }),
            (async () => {
              await new Promise((xong) => setTimeout(xong, TRE_MS[vong]));
              return huy(c.intentId);
            })(),
          ]),
          nc,
        ) as [Awaited<ReturnType<typeof tuChoiSaiMa>>, KetQuaHuyPhieuThe];
        expect(tc.ok, `${nc}: từ chối thành công`).toBe(true);
        expect((await yeuCauCua(c.intentId))[0]?.trangThai, `${nc}: yêu cầu TU_CHOI`).toBe("TU_CHOI");
        expect(await soPayment(), `${nc}: không tiền`).toBe(0);
        if (kqHuy.ok) {
          // Huỷ chạy SAU khi từ chối đã commit ⇒ ĐƯỢC.
          expect((await phieuPos(c.intentId)).status, `${nc}: huỷ thắng ⇒ phiếu HUY`).toBe("HUY");
          expect(await soVetHuy(), `${nc}: huỷ thắng ⇒ đúng MỘT vết`).toBe(1);
        } else {
          // Huỷ chạy TRƯỚC từ chối ⇒ phiếu còn CAN_XU_LY ⇒ bị từ chối đúng câu, KHÔNG để lại gì.
          expect(kqHuy.error, `${nc}: huỷ thua vì phiếu đang chờ kế toán`).toBe(ghep("CAN_XU_LY"));
          expect((await phieuPos(c.intentId)).status, `${nc}: huỷ thua ⇒ phiếu thẻ CHO_QUET (từ chối đã nhả giao dịch)`).toBe("CHO_QUET");
          expect(await soVetHuy(), `${nc}: huỷ thua ⇒ không vết`).toBe(0);
        }
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13j] THỨ TỰ KHOÁ: đơn → (giao dịch) → dòng phiếu — cùng một thứ tự ở cả hai đường", () => {
    it("[HN4-DB-13j] kẻ giữ đi đường của gửi/duyệt/từ chối (khoá ĐƠN, rồi khoá giao dịch, rồi khoá PHIẾU) trong lúc huỷ XẾP HÀNG ở khoá đơn ⇒ không deadlock, huỷ chạy sau và thấy sự thật mới", async () => {
      const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");

      let daKhoaDon!: () => void;
      const choKhoaDon = new Promise<void>((xong) => {
        daKhoaDon = xong;
      });
      let choPhepXinTiep!: () => void;
      const choXinTiep = new Promise<void>((xong) => {
        choPhepXinTiep = xong;
      });
      const giu = db.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await khoaDonTrongTx(tx, DON);
          daKhoaDon();
          await choXinTiep; // lượt huỷ đã XẾP HÀNG ở khoá đơn
          await khoaGiaoDichTrongTx(tx, c.bt);
          await khoaPhieuPosTrongTx(tx, c.intentId);
          // Đổi sự thật dưới khoá: phiếu thẻ thành DA_THU — huỷ thức dậy phải NGHE được điều này.
          await tx.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "DA_THU" } });
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      await Promise.race([choKhoaDon, giu]);

      const dangHuy = huy(c.intentId);
      const biChan = await choCoNguoiChoKhoa(dangHuy);
      choPhepXinTiep();
      const [rGiu, rHuy] = await Promise.allSettled([giu, dangHuy]);
      expect(biChan, "lượt huỷ phải CHỜ ở khoá đơn — nếu nó đã cầm khoá phiếu trước, kẻ giữ xin khoá phiếu sẽ tạo vòng chờ").toBe(true);
      expect(rGiu.status, `kẻ giữ: ${rGiu.status === "rejected" ? String(rGiu.reason) : ""}`).toBe("fulfilled");
      expect(rHuy.status, `lượt huỷ: ${rHuy.status === "rejected" ? String(rHuy.reason) : ""}`).toBe("fulfilled");
      if (rHuy.status === "fulfilled") expect(rHuy.value, "huỷ thức dậy ⇒ thấy DA_THU do kẻ giữ đặt").toEqual({ ok: false, error: ghep("DA_THU") });
      expect((await phieuPos(c.intentId)).status).toBe("DA_THU");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-13i] yêu cầu MỒ CÔI: yêu cầu giữ giao dịch + phiếu thẻ HUY (chỉ do dữ liệu vi phạm bất biến) — không rò, không mắc kẹt", () => {
    it("[HN4-DB-13i] duyệt VÀ từ chối đều bị từ chối (không ghi tiền, 0 dòng đổi); yêu cầu vẫn HIỆN ở hàng chờ kế toán; lối thoát = xử lý GIAO DỊCH ('bỏ qua') ⇒ yêu cầu thành 'xử lý ở nơi khác' và rời hàng chờ", async () => {
      const c = await dungCanh({ orderId: DON, dot: DOT_A }, () => "");
      const yc = await chenYeuCau({ intentId: c.intentId, bankTransactionId: c.bt, trangThai: "CHO_DUYET", createdAt: GUI });
      // Trạng thái 'sau lỗi': phiếu thẻ đã HUY (như thể cổng huỷ không có) mà yêu cầu còn giữ giao dịch.
      await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { status: "HUY" } });

      const truoc = await chup();
      // KHÔNG RÒ: duyệt từ chối — phiếu thẻ không còn giữ giao dịch này ⇒ 0 Payment, 0 phân bổ, giao dịch vẫn UNMATCHED.
      const duyet = await duyetSaiMa({ orderId: DON, yeuCauId: yc.id, actor: A_KT, now: QUYET });
      expect(duyet.ok).toBe(false);
      expect(duyet.ok ? "" : duyet.error).toMatch(/không còn giữ giao dịch/);
      expect(await chup(), "duyệt bị từ chối ⇒ không đổi một dòng nào").toBe(truoc);
      expect(await soPayment()).toBe(0);
      expect((await btThe(c.m))?.status).toBe("UNMATCHED");
      // TỪ CHỐI cũng bị chặn, bằng CHÍNH câu mà `[HN3-DB-28]` ghim ('phiếu thẻ không còn giữ giao dịch này') — hai nút Duyệt/Từ chối của kế toán đều KHÔNG giải
      // được dòng mồ côi. Ghi thẳng ra đây để không ai tưởng 'từ chối' là lối thoát: lối thoát có thật là xử lý GIAO DỊCH (bỏ qua / gắn tay), ngay dưới.
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: QUYET })).toEqual({
        ok: false,
        error: "Phiếu thẻ không còn giữ giao dịch này — tải lại trang",
      });
      expect(await chup(), "từ chối bị từ chối ⇒ không đổi một dòng nào").toBe(truoc);

      // KHÔNG MẮC KẸT (1): dòng còn NẰM Ở hàng chờ — kế toán thấy nó để xử lý.
      const hang1 = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, QUYET);
      expect(hang1.cho.map((d) => d.id), "yêu cầu mồ côi vẫn hiện ở hàng chờ").toContain(yc.id);
      // KHÔNG MẮC KẸT (2): lối thoát có sẵn của kế toán — bỏ qua giao dịch — đưa yêu cầu ra khỏi hàng chờ.
      await db.bankTransaction.update({ where: { id: c.bt }, data: { status: "IGNORED" } });
      const hang2 = await docHangChoSaiMa(SDB_TAT_CA, ACTOR_TAT_CA, sau(QUYET, PHUT));
      expect(hang2.cho.map((d) => d.id), "sau khi bỏ qua giao dịch").not.toContain(yc.id);
      expect(hang2.hauKiem.find((d) => d.id === yc.id)?.hieuLuc, "…và nằm ở hậu kiểm với nhãn 'xử lý ở nơi khác'").toBe("DA_XU_LY_NGOAI");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // [HN6-A2] VIỆC 6 · a2 (chủ dự án chốt 10/10/2026): MỞ LẠI nút "Huỷ phiếu thẻ" sau khi kế toán TỪ CHỐI yêu cầu sai mã. Kịch bản nguyên văn nằm ở `[HN4-DB-13e]`; ở đây là những thứ quanh nó:
  // hai lần từ chối liên tiếp (lý do khác nhau) · KHÔNG nhấp nháy theo câu lưu · đối chứng ÂM của việc nhận ra câu từ chối · đua huỷ ‖ gửi ÉP cả hai thứ tự · đơn KHÁC vẫn thấy X · dấu vết.
  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN6-A2] huỷ phiếu thẻ SAU khi kế toán từ chối — bảng THẬT", () => {
    it("[HN6-A2-02] HAI lần từ chối liên tiếp, lý do KHÁC nhau: huỷ mở theo lý do của lần MỚI NHẤT; huỷ xong thì CẢ HAI giao dịch đã bác (X, Y) đều không vào được phiếu mới, 0 tiền", async () => {
      const g = await phatPhieu(DON, [DOT_A]);
      const p1 = await moPhieu(DON, DOT_A, NOW);
      await chuaThay(p1.intentId, luc("10:36:00"));
      const mKhac = maGd();
      const mX = maGd();
      const mY = maGd();
      await nhapFile([
        dong({ maGiaoDich: mKhac, dienGiai: "", soTien: g.tongTien, thoiGian: GIO_KHAC, maGiaoDichThe: "112233445601" }),
        dong({ maGiaoDich: mX, dienGiai: "", soTien: g.tongTien, thoiGian: "2026-10-06T17:39:00+07:00", maGiaoDichThe: "112233445602" }),
        dong({ maGiaoDich: mY, dienGiai: "", soTien: g.tongTien, thoiGian: "2026-10-06T17:40:00+07:00", maGiaoDichThe: "112233445603" }),
      ]);
      const btX = await btId(mX);
      const btY = await btId(mY);
      const ly1 = "Giao dịch thứ nhất là của khách khác";
      const ly2 = "Giao dịch thứ hai cũng không phải của khách này";
      expect(cauTuChoi(ly1), "điều kiện tiên quyết: hai lần từ chối có HAI câu khác nhau").not.toBe(cauTuChoi(ly2));

      // Lần 1: gửi X (ba ứng viên ⇒ chờ kế toán) → bác.
      expect(await guiCho(DON, p1.intentId, btX, { now: luc("10:41:00") })).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
      const yc1 = (await yeuCauCua(p1.intentId))[0]!;
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: yc1.id, lyDo: ly1, actor: A_KT, now: luc("10:42:00") })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      expect((await phieuPos(p1.intentId)).lastResultMessage).toBe(cauTuChoi(ly1));
      // Sale (chưa kịp huỷ) gửi Y → kế toán bác lần hai.
      expect(await guiCho(DON, p1.intentId, btY, { now: luc("10:42:30") }), "gửi Y sau khi X bị bác").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
      const yc2 = (await yeuCauCua(p1.intentId)).find((y) => y.trangThai === "CHO_DUYET")!;
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: yc2.id, lyDo: ly2, actor: A_KT, now: luc("10:43:00") })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      const sau2 = await phieuPos(p1.intentId);
      expect(sau2.status).toBe("CHO_QUET");
      expect(sau2.lastResultMessage, "câu lưu = câu từ chối của lần HAI").toBe(cauTuChoi(ly2));
      expect(await haiCo(p1.intentId), "yêu cầu mới nhất = lần hai, mang lý do lần hai").toEqual([false, "TU_CHOI", ly2]);
      expect((await yeuCauCua(p1.intentId)).map((y) => y.trangThai), "hai yêu cầu, cả hai TU_CHOI").toEqual(["TU_CHOI", "TU_CHOI"]);

      // Huỷ phải mở theo lý do của lần MỚI NHẤT: so với lý do lần ĐẦU thì câu lưu không khớp ⇒ CHUA_NGA_NGU (bắt lỗi chọn nhầm yêu cầu cũ).
      const chonHuy = luc("10:43:20");
      expect(await manSau(p1.intentId, chonHuy), "màn").toBe("CHO_HUY");
      expect(await maySau(p1.intentId, chonHuy), "máy chủ").toBe("CHO_HUY");
      expect(await huy(p1.intentId, { now: chonHuy })).toEqual({ ok: true, intentId: p1.intentId, code5: g.ma });

      // Mở phiếu mới cùng mã: X (10:39:00Z) và Y (10:40:00Z) nằm TRONG cửa sổ [10:38:30, 10:43:30] của nó — cả hai đã bị bác ⇒ không còn ứng viên nào.
      await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: "", soTien: 999_000, thoiGian: "2026-10-06T17:43:40+07:00", maGiaoDichThe: "112233445604" })]);
      const p2 = await moPhieu(DON, DOT_A, luc("10:43:30"));
      expect(p2.intentId).not.toBe(p1.intentId);
      expect(p2.code5).toBe(g.ma);
      await chuaThay(p2.intentId, luc("10:43:45"));
      const tim = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: luc("10:43:50") });
      expect(tim.ok && tim.ungVien, "X và Y đều đã bị bác cho ĐƠN này").toEqual([]);
      expect(tim.ok && tim.cau).toBe(CAU_BI_BAC_KHONG_CON_UNG_VIEN);
      const truoc = await chup();
      for (const [ten, bt] of [["X", btX], ["Y", btY]] as const) {
        expect(await guiCho(DON, p2.intentId, bt, { now: luc("10:44:00") }), `gửi lại ${ten}`).toEqual({ ok: false, error: CAU_BI_BAC_KHONG_CON_UNG_VIEN });
      }
      expect(await chup(), "bị từ chối ⇒ không đổi một dòng nào").toBe(truoc);
      expect(await soPayment()).toBe(0);
      expect(await soVetHuy()).toBe(1);
    });

    it("[HN6-A2-03] KHÔNG nhấp nháy: ngay sau từ chối → poller ghi 'Chưa thấy' → lượt kiểm ghi câu 'ĐỪNG quẹt lại' (dòng treo) → lại 'Chưa thấy' ⇒ CHO_HUY · CHO_HUY · CHUA_NGA_NGU · CHO_HUY, màn = máy chủ ở MỌI bước, probe không ghi gì", async () => {
      const c = await canhChoDuyet();
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: "Không phải giao dịch của khách", actor: A_KT, now: QUYET })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      const CAU_TREO = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: c.ma, maTrangThai: "DANG_XU_LY" }).cau;

      const buoc = async (ten: string, now: Date, mong: "CHO_HUY" | MaTuChoiHuyPhieuThe) => {
        const truoc = await chup();
        const man = await manSau(c.intentId, now);
        const may = await maySau(c.intentId, now);
        expect(man, `${ten}: màn`).toBe(mong);
        expect(may, `${ten}: máy chủ`).toBe(mong);
        expect(await chup(), `${ten}: probe không ghi gì`).toBe(truoc);
      };
      expect((await phieuPos(c.intentId)).lastResultMessage, "bước 1: câu lưu là câu từ chối").toBe(cauTuChoi("Không phải giao dịch của khách"));
      await buoc("1 · ngay sau từ chối", sau(QUYET, PHUT), "CHO_HUY");
      await chuaThay(c.intentId, sau(QUYET, 2 * PHUT));
      await buoc("2 · 'Chưa thấy' trần", sau(QUYET, 3 * PHUT), "CHO_HUY");
      // Lượt kiểm sau ghi câu 'ĐỪNG quẹt lại' (dòng mang mã chưa ngã ngũ — cùng kind NOT_FOUND): thông tin MỚI HƠN thắng, dù yêu cầu mới nhất từng bị từ chối.
      await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_TREO } });
      await buoc("3 · câu 'ĐỪNG quẹt lại'", sau(QUYET, 4 * PHUT), "CHUA_NGA_NGU");
      await chuaThay(c.intentId, sau(QUYET, 5 * PHUT));
      await buoc("4 · lại 'Chưa thấy' trần", sau(QUYET, 6 * PHUT), "CHO_HUY");
    });

    it("[HN6-A2-04] ĐỐI CHỨNG ÂM của việc nhận ra câu từ chối: câu từ chối KHÔNG có yêu cầu bị từ chối đứng sau · lý do KHÁC · thêm một ký tự · yêu cầu SỐNG mới hơn ⇒ KHÔNG mở khoá (màn = máy chủ)", async () => {
      const c = await canhChoDuyet();
      const ly = "Không phải giao dịch của khách";
      expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: ly, actor: A_KT, now: QUYET })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
      const both = async (ten: string, mong: "CHO_HUY" | MaTuChoiHuyPhieuThe, now: Date = sau(QUYET, PHUT)) => {
        expect(await manSau(c.intentId, now), `${ten}: màn`).toBe(mong);
        expect(await maySau(c.intentId, now), `${ten}: máy chủ`).toBe(mong);
      };
      await both("neo dương: nguyên trạng sau từ chối", "CHO_HUY");

      // (a) câu lưu thêm MỘT ký tự — so ĐÚNG CHUỖI, không so tiền tố.
      await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { lastResultMessage: `${cauTuChoi(ly)} ` } });
      await both("(a) thêm một ký tự", "CHUA_NGA_NGU");
      // (b) câu của một lý do KHÁC lý do của yêu cầu mới nhất.
      await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { lastResultMessage: cauTuChoi("Lý do của một lần từ chối nào đó khác") } });
      await both("(b) lý do khác", "CHUA_NGA_NGU");
      // (c) đúng câu từ chối nhưng KHÔNG còn yêu cầu nào đứng sau nó (dữ liệu hỏng / bị xoá).
      await db.posPaymentIntent.update({ where: { id: c.intentId }, data: { lastResultMessage: cauTuChoi(ly) } });
      await both("neo dương: khôi phục đúng câu", "CHO_HUY");
      const y = (await yeuCauCua(c.intentId))[0]!;
      await db.posSaiMaYeuCau.delete({ where: { id: y.id } });
      await both("(c) không có yêu cầu nào", "CHUA_NGA_NGU");
      // (d) yêu cầu SỐNG mới hơn (chèn thẳng — đường thật chuyển phiếu sang CAN_XU_LY nên cổng ① nói trước) trên phiếu còn mang câu từ chối cũ ⇒ cổng ② `CO_YEU_CAU_SAI_MA` thắng.
      await chenYeuCau({ intentId: c.intentId, bankTransactionId: c.bt2, trangThai: "CHO_DUYET", createdAt: sau(QUYET, 2 * PHUT) });
      await both("(d) yêu cầu sống mới hơn", "CO_YEU_CAU_SAI_MA");
      expect(await soVetHuy()).toBe(0);
    });

    it("[HN6-A2-05] ĐUA huỷ ‖ gửi yêu cầu mới SAU từ chối — ÉP CẢ HAI THỨ TỰ bằng khoá đơn giữ tay: huỷ trước ⇒ gửi bị từ chối (phiếu không còn chờ quẹt), 0 yêu cầu mới; gửi trước ⇒ huỷ bị từ chối CAN_XU_LY; không yêu cầu mồ côi", async () => {
      const dungCanhDaBac = async () => {
        const c = await canhChoDuyet();
        expect(await tuChoiSaiMa({ orderId: DON, yeuCauId: c.yc.id, lyDo: LY_DO_BAC, actor: A_KT, now: QUYET })).toMatchObject({ ok: true, trangThai: "TU_CHOI" });
        return c;
      };
      const T_HUY = sau(QUYET, 2 * PHUT);
      const T_GUI = sau(QUYET, 3 * PHUT);

      // ── huỷ ĐẾN TRƯỚC ──
      const a = await dungCanhDaBac();
      const [huyA, guiA] = await epThuTu(
        () => huy(a.intentId, { now: T_HUY }),
        () => guiCho(DON, a.intentId, a.bt2, { now: T_GUI }),
      );
      expect(huyA, "huỷ thắng").toEqual({ ok: true, intentId: a.intentId, code5: a.ma });
      expect(guiA, "gửi thua vì phiếu đã HUY").toEqual({ ok: false, error: "Phiếu thu thẻ không còn chờ quẹt" });
      expect((await phieuPos(a.intentId)).status).toBe("HUY");
      expect((await yeuCauCua(a.intentId)).map((y) => y.trangThai), "KHÔNG yêu cầu mới").toEqual(["TU_CHOI"]);
      expect(await soVetHuy(), "một vết huỷ").toBe(1);
      expect(await soPayment()).toBe(0);
      await khongYeuCauMoCoi(DON, "huỷ trước");

      // ── gửi ĐẾN TRƯỚC ──
      await dungFixture();
      const b = await dungCanhDaBac();
      const [guiB, huyB] = await epThuTu(
        () => guiCho(DON, b.intentId, b.bt2, { now: T_GUI }),
        () => huy(b.intentId, { now: T_HUY }),
      );
      expect(guiB, "gửi thắng").toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
      expect(huyB, "huỷ thua vì phiếu đang chờ kế toán").toEqual({ ok: false, error: ghep("CAN_XU_LY") });
      expect((await phieuPos(b.intentId)).status).toBe("CAN_XU_LY");
      expect((await yeuCauCua(b.intentId)).map((y) => y.trangThai), "hai yêu cầu: lần bác + lần mới").toEqual(["TU_CHOI", "CHO_DUYET"]);
      expect(await soVetHuy(), "huỷ thua ⇒ không vết").toBe(0);
      expect(await soPayment()).toBe(0);
      await khongYeuCauMoCoi(DON, "gửi trước");
    });

    it("[HN6-A2-06] ĐỐI CHỨNG DƯƠNG CHÉO ĐƠN: X bị bác ở DON; phiếu thẻ của DON_PHU (cùng cơ sở, cùng máy, cùng số tiền) VẪN thấy X, KHÔNG dính DA_BI_TU_CHOI_TRUOC — trước lẫn sau khi DON huỷ và mở phiếu mới", async () => {
      const { g, p1, btX } = await canhGiuaDoi({ bac: true });
      const gPhu = await phatPhieu(DON_PHU, [DOT_D]);
      expect(gPhu.tongTien, "fixture: hai đơn cùng số tiền").toBe(g.tongTien);
      const huyP1 = await huy(p1.intentId, { now: luc("10:42:20") });
      expect(huyP1.ok, "DON huỷ P1 sau khi bị bác").toBe(true);
      // Phiếu thẻ của DON_PHU mở 10:42:25Z ⇒ cửa sổ [10:37:25, nay] CHỨA X (10:38:00Z).
      const pPhu = await moPhieu(DON_PHU, DOT_D, luc("10:42:25"));
      await chuaThay(pPhu.intentId, luc("10:42:50"));
      const xemPhu = async (ten: string, now: Date) => {
        const t = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON_PHU, intentId: pPhu.intentId, now });
        if (!t.ok) throw new Error(`${ten}: ${t.error}`);
        expect(t.ungVien.map((u) => u.bankTransactionId), `${ten}: DON_PHU vẫn thấy X`).toEqual([btX]);
        expect(t.ungVien[0]!.xemTruoc.lyDo, `${ten}: vết bác của DON KHÔNG lan sang DON_PHU`).not.toContain("DA_BI_TU_CHOI_TRUOC");
        return t.ungVien[0]!.xemTruoc;
      };
      // (1) P1 của DON đã HUY nhưng phiếu gộp của DON VẪN MỞ ⇒ P1 vẫn là "đối thủ" của DON_PHU (`[HN4-DB-18b]`: huỷ tay không gỡ tín hiệu cạnh tranh) ⇒ chờ kế toán — hướng AN TOÀN, lý do là phiếu
      // thẻ cạnh tranh CHỨ KHÔNG PHẢI vết bác: X vẫn là ứng viên của DON_PHU và KHÔNG dính `DA_BI_TU_CHOI_TRUOC`.
      const xt1 = await xemPhu("trước khi DON mở phiếu mới", luc("10:43:00"));
      expect(xt1, "chờ kế toán vì phiếu thẻ cạnh tranh, không vì vết bác").toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["CO_PHIEU_THE_CANH_TRANH"] });
      // (2) DON mở phiếu mới P2 (cùng mã, CHO_QUET còn hạn đúng số tiền): cũng là đối thủ (R-5f) — kết luận không đổi, X VẪN là ứng viên và KHÔNG dính vết bác.
      const p2 = await moPhieu(DON, DOT_A, luc("10:42:30"));
      expect(p2.intentId).not.toBe(p1.intentId);
      const xt2 = await xemPhu("sau khi DON mở phiếu mới", luc("10:43:10"));
      expect(xt2, "…vẫn vì phiếu thẻ cạnh tranh, KHÔNG vì vết bác").toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["CO_PHIEU_THE_CANH_TRANH"] });
      // ĐỐI CHỨNG của chính DON: phiếu P2 của DON KHÔNG thấy X.
      await chuaThay(p2.intentId, luc("10:43:20"));
      const timDon = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: luc("10:43:30") });
      expect(timDon.ok && timDon.ungVien, "DON: X đã bị bác ⇒ không còn").toEqual([]);
      expect(await soPayment(DON)).toBe(0);
      expect(await soPayment(DON_PHU)).toBe(0);
    });

    it("[HN6-A2-07] DẤU VẾT: huỷ SAU từ chối ghi `sauTuChoiSaiMa: true` (cổng riêng đã bỏ nên vết là thứ còn lại để điều tra khoản về muộn); huỷ không có yêu cầu nào ghi `false`", async () => {
      const bac = await canhGiuaDoi({ bac: true });
      expect((await huy(bac.p1.intentId, { now: luc("10:42:20") })).ok).toBe(true);
      const vetBac = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect(vetBac.newValues).toMatchObject({ sauTuChoiSaiMa: true, xacNhanKhachChuaQuet: true, nguon: "HUY_TAY", ma: bac.g.ma, status: "HUY" });

      await dungFixture();
      const sach = await canhGiuaDoi({ bac: false });
      expect((await huy(sach.p1.intentId, { now: luc("10:42:20") })).ok).toBe(true);
      const vetSach = await db.auditLog.findFirstOrThrow({ where: { entityType: "Order", entityId: DON, action: "POS_PHIEU_HUY" } });
      expect(vetSach.newValues, "đối chứng: không yêu cầu nào").toMatchObject({ sauTuChoiSaiMa: false, nguon: "HUY_TAY" });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // [HN4-DB-18] RÀ ĐỐI KHÁNG BẢN GHÉP (10/10/2026): huỷ TAY phiếu thẻ của đơn B không được gỡ tín hiệu "phiếu thẻ CẠNH TRANH" của đơn A.
  //
  // Mỗi bên có test cho bên kia KHÔNG tồn tại: Việc 3 coi phiếu HUY là "đối thủ đã biến mất" (vì trước Việc 4 phiếu HUY chỉ sinh ra khi
  // phiếu gộp của nó đã đổi), còn Việc 4 cho sale huỷ tay một phiếu mà phiếu gộp VẪN MỞ, mã vẫn sống. Cổng huỷ chỉ tìm tiền theo MÃ trong
  // ghi chú nên giao dịch ghi chú TRỐNG của khách B vô hình với nó; tick "chắc khách chưa quẹt" là lời sale, không phải bằng chứng.
  // Hai đơn cùng cơ sở, cùng máy, cùng số tiền, cả hai đã "Chưa thấy"; MỘT giao dịch ghi chú rỗng nằm UNMATCHED — của khách nào?
  // Mã TRƯỚC bản vá: `canhTranh` chỉ lấy `TRANG_THAI_MO` ⇒ sau huỷ B đối thủ = 0 ⇒ nhãn nút của A đổi CHO_KE_TOAN → TU_GHI_NHAN và
  // `guiSaiMa` ghi 3.168.000đ vào ĐƠN A, phát `phieu-gop.da-chia` (biên nhận / chuyển đổi lead) — khách B không được ghi gì.
  // ───────────────────────────────────────────────────────────────────────────
  describe("[HN4-DB-18] huỷ tay phiếu thẻ của đơn KHÁC ⇒ tín hiệu cạnh tranh của đơn này vẫn còn", () => {
    /** A (DON·DOT_A) và B (DON_PHU·DOT_D): cùng cơ sở, cùng máy, cùng số tiền, cả hai "Chưa thấy"; một giao dịch GHI CHÚ RỖNG. */
    async function haiDonMotGiaoDich() {
      const a = await phatPhieu(DON, [DOT_A]);
      const pa = await moPhieu(DON, DOT_A);
      await chuaThay(pa.intentId);
      const b = await phatPhieu(DON_PHU, [DOT_D]);
      const pb = await moPhieu(DON_PHU, DOT_D);
      await chuaThay(pb.intentId);
      expect(a.tongTien, "fixture: hai đơn cùng số tiền").toBe(b.tongTien);
      const m = maGd();
      await nhapFile([dong({ maGiaoDich: m, dienGiai: "", soTien: a.tongTien })]);
      return { a, pa, b, pb, bt: await btId(m) };
    }
    const xemTruocA = async (intentId: string) => {
      const t = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId, now: GUI });
      if (!t.ok) throw new Error(t.error);
      expect(t.ungVien, "fixture: đúng MỘT ứng viên").toHaveLength(1);
      return t.ungVien[0]!.xemTruoc;
    };
    const suKienA = () => db.domainEvent.count({ where: { payloadJson: { path: ["orderId"], string_starts_with: DON } } });

    it("[HN4-DB-18a] ĐỐI CHỨNG: đơn B còn phiếu thẻ mở ⇒ A: CHO_KE_TOAN (CO_PHIEU_THE_CANH_TRANH); gửi ⇒ chờ kế toán, 0 Payment", async () => {
      const c = await haiDonMotGiaoDich();
      const xt = await xemTruocA(c.pa.intentId);
      expect(xt.quyet).toBe("CHO_KE_TOAN");
      expect(xt.lyDo).toContain("CO_PHIEU_THE_CANH_TRANH");
      expect(await guiCho(DON, c.pa.intentId, c.bt)).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
      expect(await soPayment(DON)).toBe(0);
      expect(await soPayment(DON_PHU)).toBe(0);
    });

    it("[HN4-DB-18b] B bấm 'Huỷ phiếu thẻ' (đường THẬT, có tick) — phiếu gộp B VẪN MỞ ⇒ A vẫn CHO_KE_TOAN; gửi ⇒ chờ kế toán; 0 Payment, 0 sự kiện chia tiền", async () => {
      const c = await haiDonMotGiaoDich();
      const kq = await huy(c.pb.intentId, { orderId: DON_PHU });
      expect(kq.ok, `fixture: B huỷ được — ${kq.ok ? "" : kq.error}`).toBe(true);
      expect((await phieuPos(c.pb.intentId)).status).toBe("HUY");
      expect((await phieuGopDb(c.b.billId)).status, "huỷ tay KHÔNG đụng phiếu gộp: mã của B vẫn sống").toBe("OPEN");

      const xt = await xemTruocA(c.pa.intentId);
      expect(xt.quyet, "nhãn nút của A phải nói đúng điều SẮP xảy ra").toBe("CHO_KE_TOAN");
      expect(xt.lyDo).toContain("CO_PHIEU_THE_CANH_TRANH");
      const truocSuKien = await suKienA();
      expect(await guiCho(DON, c.pa.intentId, c.bt)).toMatchObject({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET" });
      expect(await soPayment(DON), "tiền KHÔNG vào đơn A").toBe(0);
      expect(await soPayment(DON_PHU)).toBe(0);
      expect(await suKienA(), "không phát phieu-gop.da-chia (biên nhận / chuyển đổi lead)").toBe(truocSuKien);
      expect((await phieuGopDb(c.a.billId)).status).toBe("OPEN");
    });

    it("[HN4-DB-18c] ĐỐI CHỨNG DƯƠNG: phiếu gộp của B ĐÃ ĐỔI (không còn OPEN) rồi phiếu thẻ HUY ⇒ không còn đối thủ ⇒ A TỰ GHI NHẬN như Việc 3", async () => {
      const c = await haiDonMotGiaoDich();
      expect((await huy(c.pb.intentId, { orderId: DON_PHU })).ok).toBe(true);
      await db.paymentBill.update({ where: { id: c.b.billId }, data: { status: "VOID" } });
      const xt = await xemTruocA(c.pa.intentId);
      expect(xt).toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
      expect(await guiCho(DON, c.pa.intentId, c.bt)).toMatchObject({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN" });
      expect(await soPayment(DON)).toBe(1);
    });

    it("[HN4-DB-18d] phiếu HUY của CHÍNH phiếu gộp A (mở lại 'Thẻ POS' cho A) KHÔNG tự tính là đối thủ của A", async () => {
      const a = await phatPhieu(DON, [DOT_A]);
      const p1 = await moPhieu(DON, DOT_A);
      await chuaThay(p1.intentId);
      expect((await huy(p1.intentId)).ok).toBe(true);
      const p2 = await moPhieu(DON, DOT_A, sau(NOW, 66 * PHUT));
      expect(p2.intentId, "fixture: phiếu thẻ MỚI trên cùng phiếu gộp").not.toBe(p1.intentId);
      await chuaThay(p2.intentId, sau(NOW, 67 * PHUT));
      const m = maGd();
      // Giờ quẹt SAU lúc mở phiếu MỚI (11:06Z) ⇒ nằm trong cửa sổ của p2; p1 (mở 10:00Z, HUY) sẽ là "đối thủ" nếu bị tính nhầm.
      await nhapFile([dong({ maGiaoDich: m, dienGiai: "", soTien: a.tongTien, thoiGian: "2026-10-06T18:07:00+07:00" })]);
      const t = await timUngVienSaiMa({ sdb: SDB_TAT_CA, orderId: DON, intentId: p2.intentId, now: sau(NOW, 68 * PHUT) });
      if (!t.ok) throw new Error(t.error);
      expect(t.ungVien[0]!.xemTruoc, "phiếu HUY cũ cùng phiếu gộp không phải đối thủ").toEqual({ quyet: "TU_GHI_NHAN", lyDo: [] });
    });
  });
});
