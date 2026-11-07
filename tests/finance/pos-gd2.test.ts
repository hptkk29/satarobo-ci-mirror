// tests/finance/pos-gd2.test.ts — GĐ2 THU THẺ POS: nhật ký kiểm · chống bấm dồn · poller · hết hạn ·
// thời hạn hiển thị · quét sạch cuối ngày · khai máy. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-gd1.test.ts`).
//
// Thiết kế: docs/pos-gd2-thiet-ke.md §9. Đi qua ĐÚNG cửa đời thật: phiếu mở bằng `moPhieuPos`, lượt
// kiểm bằng `kiemTraPhieuPos` (hàm DUY NHẤT gọi provider), file bằng `nhapLoPos`. Đồng hồ ĐÓNG BĂNG
// (luật 19): mọi hàm có `now` / `dongHo` đều được truyền mốc tuyệt đối — không ca nào đọc `Date.now()`.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { PosIntentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docPhieuGopDangMo, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
import { sinhMa } from "@/lib/payments/ma-phieu";
import { nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import type { DongPos } from "@/lib/payments/pos/kieu";
import type { PosCheckResult, PosProvider } from "@/lib/payments/pos/provider/kieu";
import { FakePosProvider } from "@/lib/payments/pos/provider/fake";
import { TcbFileImportProvider } from "@/lib/payments/pos/provider/tcb-file";
import { kiemTraPhieuPos, xuLyKetQuaPos, type TriggeredBy } from "@/lib/payments/pos/xu-ly-ket-qua";
import { docPhieuPosTho, moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { dungPhieuPosChoDon } from "@/lib/payments/pos/phieu-pos-luat";
import { chayPollerPos, hetHanPhieuPos } from "@/lib/payments/pos/poller";
import { quetSachPhieuPos } from "@/lib/payments/pos/quet-sach";
import { khaiMayPos, type MayKhai } from "@/lib/payments/pos/khai-may-pos";
import { docLocNhatKy } from "@/lib/payments/pos/nhat-ky-loc";
import { docNhatKy } from "@/lib/payments/pos/nhat-ky-doc";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { dongBoPhieuPosSauNhap } from "@/lib/payments/pos/dong-bo-sau-nhap";
import { CAU_DANG_KIEM } from "@/lib/payments/pos/thong-diep-pos";
import { gioVN } from "@/lib/format/thoi-gian-vn";

// Tiêm lỗi "pha phiếu NÉM" (`[POS2-LOG-04]`): bọc `quyetPhieuPos` thật, chỉ ném khi ca bật công tắc.
// `vi.mock` áp cho MỌI nơi import tệp này trong đồ thị của bộ test (gồm xu-ly-ket-qua.ts).
// `nemQuyetMa`: chỉ ném cho phiếu mang ĐÚNG mã đó (`[POS2-PL-06]` — một phiếu hỏng giữa lô).
const tiem = vi.hoisted(() => ({ nemQuyet: false, nemQuyetMa: null as string | null }));
vi.mock("@/lib/payments/pos/phieu-pos-luat", async (importOriginal) => {
  const that = await importOriginal<typeof import("@/lib/payments/pos/phieu-pos-luat")>();
  return {
    ...that,
    quyetPhieuPos: (...a: Parameters<typeof that.quyetPhieuPos>) => {
      if (tiem.nemQuyet || (tiem.nemQuyetMa !== null && a[0].code5 === tiem.nemQuyetMa)) {
        throw new Error("fx: tiêm lỗi pha phiếu");
      }
      return that.quyetPhieuPos(...a);
    },
  };
});

if (!RUN_DB_TESTS) console.warn(`[POS2-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos2gd-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS2GD";

const KT = `${T}kt`; // Kế toán HO — người nhập file + vai HO_ACCOUNTANT
const SALE = `${T}sale`;
const ADMIN = `${T}admin`; // Quản trị tối cao (vai SUPER_ADMIN)
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const LEAD = `${T}lead`;
const MAY1 = `${PFX}MAY01`;
const MAY2 = `${PFX}MAY02`;
const SDT_PH = "0399822345";
const ACTOR = { id: SALE, name: "Sale fixture POS2" };

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000

/** Lúc tạo phiếu POS (17:00 giờ VN). */
const NOW = new Date("2026-10-06T10:00:00Z");
/** Giờ quẹt thẻ (giờ VN) — SAU lúc tạo phiếu, TRƯỚC lúc kiểm. */
const GIO_QUET = "2026-10-06T17:31:35+07:00";
/** Lúc kiểm. */
const KIEM = new Date("2026-10-06T10:40:00Z");
const GIAY = 1_000;
const PHUT = 60_000;
const GIO = 60 * PHUT;
const sau = (moc: Date, ms: number) => new Date(moc.getTime() + ms);

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { OR: [{ providerTxnId: { startsWith: PFX } }, { providerTxnId: { startsWith: T } }] };
/** Khoá chuông không mang id fixture — mốc ngày/giờ VN của các ca dưới (NOW = 17:00 VN 06/10). */
const KHOA_CHUONG_CO_DINH = [
  "pos.loi-ket-noi:he-thong:2026-10-06T17",
  "pos.loi-ket-noi:he-thong:2026-10-07T17",
  "pos.quet-sach:2026-10-06",
  "pos.quet-sach:2026-10-07",
];
const CUA_DON = { orderId: { startsWith: T } };

async function don() {
  // Mọi đơn của bộ này mang tiền tố T (đơn chính, đơn phụ, đơn hàng loạt).
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: T } } });
  // Nhật ký TRƯỚC phiếu POS (khoá ngoại RESTRICT).
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: CUA_DON } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: CUA_DON } });
  await db.staffNotification.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  // Chuông theo phiếu (entityId = đơn) và chuông TOÀN HỆ THỐNG (khoá ngày/giờ cố định của bộ này) —
  // người nhận là MỌI Kế toán HO / Quản trị đang có trong DB, không chỉ người của fixture.
  await db.staffNotification.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.staffNotification.deleteMany({ where: { dedupeKey: { in: KHOA_CHUONG_CO_DINH } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.auditLog.deleteMany({
    where: { OR: [{ entityId: { startsWith: T } }, { actorId: { in: [KT, SALE, ADMIN] } }] },
  });
  await db.orderStatusHistory.deleteMany({ where: CUA_DON });
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
  // Vết của script khai máy trỏ máy theo id (cuid, không mang tiền tố) ⇒ tra id trước khi xoá máy.
  const mayFx = await db.posTerminal.findMany({ where: { maThietBi: { startsWith: PFX } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { entityType: "PosTerminal", entityId: { in: mayFx.map((m) => m.id) } } });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: CUA_DON });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: [KT, SALE, ADMIN] } }, { phone: { in: [SDT_PH, "84399822345"] } }] } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function vai(code: string): Promise<string> {
  const r = await db.roleDef.upsert({ where: { code }, create: { code, name: code }, update: {}, select: { id: true } });
  return r.id;
}

async function dungFixture() {
  tiem.nemQuyet = false;
  tiem.nemQuyetMa = null;
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", "Kế toán HO fixture POS2"],
    [SALE, "SALES_CSM", "Sale fixture POS2"],
    [ADMIN, "SUPER_ADMIN", "Quản trị fixture POS2"],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  // Người nhận báo (T17) đọc từ VAI. `effectiveFrom` TUYỆT ĐỐI (luật 19).
  const HIEU_LUC = new Date("2026-01-01T00:00:00Z");
  await db.userOrgRole.create({
    data: { userId: ADMIN, orgUnitId: `${T}ou-goc`, roleId: await vai("SUPER_ADMIN"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
  });
  await db.userOrgRole.create({
    data: { userId: KT, orgUnitId: `${T}ou-ho`, roleId: await vai("HO_ACCOUNTANT"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
  });

  for (const [id, ten, code] of [
    [CS1, "CS1 fixture POS2GD", "FXP2-CS1"],
    [CS2, "CS2 fixture POS2GD", "FXP2-CS2"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, code, address: "114 Hoàng Diệu" } });
  }
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị fixture POS2", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY1, maQuay: "QTT45XWQT", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: "QTTFBKATK", centerId: CS2 } });
  await db.lead.create({
    data: { id: LEAD, parentName: "PH fixture POS2", phone: "0399822346", assignedToId: SALE, status: "CHO_QUYET_DINH" },
  });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269982-000123",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture POS2",
      customerPhone: SDT_PH,
      totalAmount: TONG,
      centerId: CS1,
      leadId: LEAD,
      createdById: SALE,
    },
  });
  for (const [id, ten, gia] of [
    [A, "Bé A POS2", DOT_TIEN_A],
    [B, "Bé B POS2", DOT_TIEN_B],
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
const nhatKy = (intentId: string) => db.posCheckLog.findMany({ where: { intentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

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

function kiem(
  intentId: string,
  provider: PosProvider,
  o: { nguon?: TriggeredBy; now?: Date; nguoiKiemId?: string | null } = {},
) {
  return kiemTraPhieuPos({
    intentId,
    provider,
    triggeredBy: o.nguon ?? "SALE",
    now: o.now ?? KIEM,
    nguoiKiemId: o.nguoiKiemId === undefined ? SALE : o.nguoiKiemId,
  });
}

function paid(p: Partial<PosCheckResult> & { providerTxnId: string; dienGiai: string }): PosCheckResult {
  return { kind: "PAID", amount: TONG, paidAt: GIO_QUET, approvalCode: "123456", cardMasked: "411111******1111", terminalCode: MAY1, ...p };
}

/** Số lượt Fake được hỏi CHO MỘT phiếu. */
const soLuotHoi = (f: FakePosProvider, intentId: string) => f.daHoi.filter((x) => x.intentId === intentId).length;

// ─────────────────────────────────────────────────────────────────────────────
// NHẬT KÝ
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS2-LOG] mỗi lượt gọi provider ĐÚNG MỘT dòng nhật ký", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS2-LOG-01] SALE ra NOT_FOUND ⇒ 1 dòng: kind/nguồn/người bấm/thời lượng/trạng thái sau/cơ sở/createdAt = now", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    const kq = await kiem(p.intentId, f);
    expect(kq.tuCache).toBe(false);
    const ds = await nhatKy(p.intentId);
    expect(ds).toHaveLength(1);
    const d = ds[0]!;
    expect(d).toMatchObject({
      kind: "NOT_FOUND",
      triggeredBy: "SALE",
      createdById: SALE,
      providerTxnId: null,
      errorCode: null,
      statusSau: "CHO_QUET",
      centerId: CS1,
    });
    expect(Number.isInteger(d.durationMs) && d.durationMs >= 0).toBe(true);
    expect(d.createdAt.toISOString(), "createdAt do APP đặt = now truyền vào").toBe(KIEM.toISOString());
  });

  it("[POS2-LOG-02] PAID đúng số ⇒ 1 dòng kind PAID, mã GD TCB, trạng thái sau DA_THU", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const f = new FakePosProvider();
    f.datKetQua(p.intentId, paid({ providerTxnId: m, dienGiai: g.ma }));
    expect((await kiem(p.intentId, f)).status).toBe("DA_THU");
    const ds = await nhatKy(p.intentId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ kind: "PAID", providerTxnId: m, statusSau: "DA_THU", errorCode: null });
  });

  it("[POS2-LOG-03] provider NÉM ⇒ PROVIDER_NEM; trả kết quả hỏng ⇒ KET_QUA_HONG; báo lỗi DB file ⇒ TCB_FILE_DB", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const nem: PosProvider = {
      ten: "FAKE",
      nguonDuLieu: "FAKE",
      checkStatus: async () => {
        throw new Error("fx: provider sập");
      },
    };
    const hong: PosProvider = {
      ten: "FAKE",
      nguonDuLieu: "FAKE",
      checkStatus: async () => ({ kind: "KHONG_CO_KIND_NAY" }) as unknown as PosCheckResult,
    };
    const f = new FakePosProvider();
    f.datKetQua(p.intentId, { kind: "PROVIDER_ERROR", reasonCode: "TCB_FILE_DB" });
    await kiem(p.intentId, nem, { now: KIEM });
    await kiem(p.intentId, hong, { now: sau(KIEM, 10 * GIAY) });
    await kiem(p.intentId, f, { now: sau(KIEM, 20 * GIAY) });
    const ds = await nhatKy(p.intentId);
    expect(ds.map((d) => [d.kind, d.errorCode])).toEqual([
      ["PROVIDER_ERROR", "PROVIDER_NEM"],
      ["PROVIDER_ERROR", "KET_QUA_HONG"],
      ["PROVIDER_ERROR", "TCB_FILE_DB"],
    ]);
  });

  it("[POS2-LOG-04] xuLyKetQuaPos NÉM ⇒ lỗi VẪN ném ra ngoài VÀ có đúng 1 dòng errorCode XU_LY_NEM, statusSau null", async () => {
    await phatPhieu();
    const p = await moPhieu();
    tiem.nemQuyet = true;
    await expect(kiem(p.intentId, new FakePosProvider())).rejects.toThrow("fx: tiêm lỗi pha phiếu");
    tiem.nemQuyet = false;
    const ds = await nhatKy(p.intentId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ kind: "NOT_FOUND", errorCode: "XU_LY_NEM", statusSau: null, triggeredBy: "SALE" });
    // Pha phiếu cuộn ngược — trạng thái không đổi, kết quả không ghi.
    expect((await phieuPos(p.intentId)).lastResultKind).toBeNull();
  });

  it("[POS2-LOG-05] ghi nhật ký LỖI (người bấm không tồn tại ⇒ khoá ngoại) ⇒ kiemTraPhieuPos vẫn trả kết quả, trạng thái phiếu đã commit", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    f.datKetQua(p.intentId, { kind: "FAILED", reasonCode: "USER_CANCELLED" });
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const kq = await kiem(p.intentId, f, { nguoiKiemId: `${T}khong-ton-tai` });
    const daBaoLoi = loi.mock.calls.some((c) => String(c[0]).includes("ghi nhật ký kiểm lỗi"));
    loi.mockRestore();
    expect(kq.status).toBe("THAT_BAI");
    expect((await phieuPos(p.intentId)).status, "trạng thái đã commit dù nhật ký hỏng").toBe("THAT_BAI");
    expect(await nhatKy(p.intentId)).toHaveLength(0);
    expect(daBaoLoi, "lỗi ghi nhật ký phải để lại vết console.error, không im lặng").toBe(true);
  });

  it("[POS2-LOG-07] IMPORT qua dongBoPhieuPosSauNhap ⇒ dòng triggeredBy IMPORT, createdById = người nhập", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma })]);
    await dongBoPhieuPosSauNhap({ now: KIEM, nguoiKiemId: KT });
    const ds = await nhatKy(p.intentId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ triggeredBy: "IMPORT", createdById: KT, kind: "PAID", statusSau: "DA_THU" });
  });

  it("[POS2-LOG-08] gọi THẲNG xuLyKetQuaPos (không qua provider) ⇒ 0 dòng — nhật ký là của lượt GỌI PROVIDER", async () => {
    await phatPhieu();
    const p = await moPhieu();
    await xuLyKetQuaPos({ intentId: p.intentId, ketQua: { kind: "NOT_FOUND" }, triggeredBy: "SALE", now: KIEM, nguonDuLieu: "FAKE" });
    expect(await nhatKy(p.intentId)).toHaveLength(0);
  });

  it("[POS2-SC-03] dòng nhật ký mang orgUnitId CHÉP từ phiếu POS; phiếu chưa có ⇒ ghi kép điền theo cơ sở", async () => {
    await phatPhieu();
    const p = await moPhieu();
    expect((await phieuPos(p.intentId)).orgUnitId, "fixture: phiếu đã được ghi kép").toBe(OU1);
    // (1) CHÉP: phiếu mang một orgUnitId khác ánh xạ của cơ sở ⇒ nhật ký theo PHIẾU, không suy lại.
    await db.posPaymentIntent.updateMany({ where: { id: p.intentId }, data: { orgUnitId: `${T}ou-khac` } });
    await kiem(p.intentId, new FakePosProvider(), { now: KIEM });
    // (2) TRỐNG: phiếu không có ⇒ dòng nhật ký để ghi kép tự điền = đơn vị của cơ sở.
    await db.posPaymentIntent.updateMany({ where: { id: p.intentId }, data: { orgUnitId: null } });
    await kiem(p.intentId, new FakePosProvider(), { now: sau(KIEM, 10 * GIAY) });
    const ds = await nhatKy(p.intentId);
    expect(ds.map((d) => d.orgUnitId)).toEqual([`${T}ou-khac`, OU1]);
    expect(ds.every((d) => d.centerId === CS1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHỐNG BẤM DỒN
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS2-CD] tối đa MỘT lượt gọi provider / phiếu / 5 giây", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS2-CD-01] SALE lúc t, SALE lúc t+3s ⇒ provider hỏi 1 lần; nhật ký [kind thật, CACHE]; lượt 2 trả câu lưu", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    const r1 = await kiem(p.intentId, f, { now: KIEM });
    const r2 = await kiem(p.intentId, f, { now: sau(KIEM, 3 * GIAY) });
    expect(soLuotHoi(f, p.intentId)).toBe(1);
    expect(r2).toMatchObject({ tuCache: true, doiTrangThai: false, status: "CHO_QUET", thongDiep: r1.thongDiep, ketLuan: null });
    const ds = await nhatKy(p.intentId);
    expect(ds.map((d) => d.kind)).toEqual(["NOT_FOUND", "CACHE"]);
    expect(ds[1]).toMatchObject({ durationMs: 0, providerTxnId: null, statusSau: "CHO_QUET", createdById: SALE, triggeredBy: "SALE" });
    expect(ds[1]!.createdAt.toISOString()).toBe(sau(KIEM, 3 * GIAY).toISOString());
  });

  it("[POS2-CD-02] biên: t+4,999s ⇒ CACHE; t+5,000s ⇒ hỏi provider (2 lượt)", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    await kiem(p.intentId, f, { now: KIEM });
    expect((await kiem(p.intentId, f, { now: sau(KIEM, 4_999) })).tuCache).toBe(true);
    expect(soLuotHoi(f, p.intentId)).toBe(1);
    // Lượt CACHE KHÔNG dời mốc — 5 giây tính từ lượt GỌI provider gần nhất.
    expect((await kiem(p.intentId, f, { now: sau(KIEM, 5_000) })).tuCache).toBe(false);
    expect(soLuotHoi(f, p.intentId)).toBe(2);
    expect((await nhatKy(p.intentId)).map((d) => d.kind)).toEqual(["NOT_FOUND", "CACHE", "NOT_FOUND"]);
  });

  it("[POS2-CD-03] 3 × SALE song song CÙNG now ⇒ provider hỏi ĐÚNG 1 lần; nhật ký 1 dòng thật + 2 CACHE", async () => {
    await phatPhieu();
    const p = await moPhieu();
    for (let vong = 0; vong < 4; vong += 1) {
      const f = new FakePosProvider();
      const moc = sau(KIEM, vong * 10 * GIAY);
      const kq = await Promise.all([kiem(p.intentId, f, { now: moc }), kiem(p.intentId, f, { now: moc }), kiem(p.intentId, f, { now: moc })]);
      expect(soLuotHoi(f, p.intentId), `vòng ${vong}`).toBe(1);
      expect(kq.filter((k) => k.tuCache), `vòng ${vong}`).toHaveLength(2);
    }
    const ds = await nhatKy(p.intentId);
    expect(ds.filter((d) => d.kind === "CACHE")).toHaveLength(8);
    expect(ds.filter((d) => d.kind === "NOT_FOUND")).toHaveLength(4);
  });

  it("[POS2-CD-04] SALE rồi POLLER sau 2s ⇒ POLLER CACHE; AGENT sau 2s ⇒ CACHE", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    await kiem(p.intentId, f, { now: KIEM });
    expect((await kiem(p.intentId, f, { nguon: "POLLER", now: sau(KIEM, 2 * GIAY), nguoiKiemId: null })).tuCache).toBe(true);
    expect((await kiem(p.intentId, f, { nguon: "AGENT", now: sau(KIEM, 2 * GIAY), nguoiKiemId: null })).tuCache).toBe(true);
    expect(soLuotHoi(f, p.intentId)).toBe(1);
    const ds = await nhatKy(p.intentId);
    expect(ds.map((d) => [d.triggeredBy, d.kind, d.createdById])).toEqual([
      ["SALE", "NOT_FOUND", SALE],
      ["POLLER", "CACHE", null],
      ["AGENT", "CACHE", null],
    ]);
  });

  it("[POS2-CD-05] SALE rồi IMPORT sau 2s ⇒ IMPORT hỏi provider; QUET_SACH sau 2s ⇒ hỏi provider (U3)", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    await kiem(p.intentId, f, { now: KIEM });
    expect((await kiem(p.intentId, f, { nguon: "IMPORT", now: sau(KIEM, 2 * GIAY), nguoiKiemId: KT })).tuCache).toBe(false);
    expect((await kiem(p.intentId, f, { nguon: "QUET_SACH", now: sau(KIEM, 3 * GIAY), nguoiKiemId: null })).tuCache).toBe(false);
    expect(soLuotHoi(f, p.intentId)).toBe(3);
    expect((await nhatKy(p.intentId)).map((d) => [d.triggeredBy, d.kind])).toEqual([
      ["SALE", "NOT_FOUND"],
      ["IMPORT", "NOT_FOUND"],
      ["QUET_SACH", "NOT_FOUND"],
    ]);
    // Và chúng VẪN giữ lượt: SALE ngay sau QUET_SACH ⇒ CACHE.
    expect((await kiem(p.intentId, f, { now: sau(KIEM, 4 * GIAY) })).tuCache).toBe(true);
  });

  it("[POS2-CD-08] lượt đầu ĐANG BAY (provider chậm) ⇒ lượt hai trong 5s trả CAU_DANG_KIEM — phiếu chưa có câu nào", async () => {
    await phatPhieu();
    const p = await moPhieu();
    let moCua!: () => void;
    const cua = new Promise<void>((r) => {
      moCua = r;
    });
    let daVao!: () => void;
    const vao = new Promise<void>((r) => {
      daVao = r;
    });
    const cham: PosProvider = {
      ten: "FAKE",
      nguonDuLieu: "FAKE",
      checkStatus: async () => {
        daVao();
        await cua;
        return { kind: "NOT_FOUND" };
      },
    };
    const f = new FakePosProvider();
    const luot1 = kiem(p.intentId, cham, { now: KIEM });
    await vao; // lượt 1 đã GIỮ LƯỢT (commit) và đang chờ provider
    const r2 = await kiem(p.intentId, f, { now: sau(KIEM, GIAY) });
    expect(r2.tuCache).toBe(true);
    expect(r2.thongDiep).toBe(CAU_DANG_KIEM);
    expect(soLuotHoi(f, p.intentId)).toBe(0);
    moCua();
    const r1 = await luot1;
    expect(r1.tuCache).toBe(false);
    expect((await nhatKy(p.intentId)).map((d) => d.kind).sort()).toEqual(["CACHE", "NOT_FOUND"]);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// POLLER
// ─────────────────────────────────────────────────────────────────────────────

let soHangLoat = 0;

/**
 * Phiếu POS dựng THẲNG (một đơn + một phiếu gộp + một phiếu POS) cho các ca chọn tập của poller — đi
 * qua `moPhieuPos` cho hàng chục phiếu là đo `taoPhieuGop`, không đo poller. Phiếu gộp không mang mã
 * (`matchKey` null — tránh đụng mã thật trong DB); provider của các ca này là Fake (không đọc mã).
 */
async function taoPhieuLe(o: {
  taoLuc: Date;
  trangThai?: PosIntentStatus;
  kiemLuc?: Date | null;
  hetLuc?: Date;
  centerId?: string;
  ma?: string;
}): Promise<string> {
  const n = ++soHangLoat;
  const orderId = `${T}hl-don-${n}`;
  const cs = o.centerId ?? CS1;
  await db.order.create({
    data: {
      id: orderId,
      code: `ORD-269983-${String(n).padStart(6, "0")}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "PH hàng loạt POS2",
      customerPhone: "0399822399",
      totalAmount: 1_250_000,
      centerId: cs,
    },
  });
  const bill = await db.paymentBill.create({ data: { orderId, centerId: cs, amountDue: 1_250_000 } });
  const p = await db.posPaymentIntent.create({
    data: {
      paymentBillId: bill.id,
      code5: o.ma ?? sinhMa(400_000 - n),
      amount: 1_250_000,
      centerId: cs,
      status: o.trangThai ?? "CHO_QUET",
      createdById: SALE,
      createdAt: o.taoLuc,
      expiresAt: o.hetLuc ?? new Date(o.taoLuc.getTime() + 24 * GIO),
      lastCheckAt: o.kiemLuc ?? null,
    },
    select: { id: true },
  });
  return p.id;
}

/** Poller/quét sạch đọc MỌI phiếu mở trong DB — phiếu ngoài fixture làm sai mọi phép đếm. Nói rõ. */
async function chiCoPhieuFixture() {
  const ngoai = await db.posPaymentIntent.count({
    where: { status: { in: ["CHO_QUET", "THAT_BAI"] }, NOT: { paymentBill: { orderId: { startsWith: T } } } },
  });
  expect(ngoai, "DB test còn phiếu POS MỞ ngoài fixture — dọn trước khi đo poller").toBe(0);
}

const hoiCua = (f: FakePosProvider, ids: readonly string[]) => {
  const tap = new Set(ids);
  return [...new Set(f.daHoi.map((x) => x.intentId).filter((id) => tap.has(id)))].sort();
};

/** Provider luôn báo lỗi kết nối (đúng hợp đồng: KHÔNG ném). */
const loiKetNoi: PosProvider = {
  ten: "FAKE",
  nguonDuLieu: "FAKE",
  checkStatus: async () => ({ kind: "PROVIDER_ERROR", reasonCode: "TCB_FILE_DB" }),
};

describe.skipIf(!RUN_DB_TESTS)("[POS2-PL] poller — chọn đúng tập, đúng nhịp, ghi HET_HAN đúng mốc", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS2-PL-01] chọn ĐÚNG tập còn hạn — so TẬP id được hỏi", async () => {
    await chiCoPhieuFixture();
    const P = PHUT;
    const chon = [
      await taoPhieuLe({ taoLuc: sau(NOW, -2 * P) }), // CHO_QUET trẻ, chưa kiểm
      await taoPhieuLe({ taoLuc: sau(NOW, -3 * P), trangThai: "THAT_BAI", kiemLuc: sau(NOW, -2 * P) }), // THAT_BAI trẻ
      await taoPhieuLe({ taoLuc: sau(NOW, -31 * P), kiemLuc: sau(NOW, -11 * P) }), // 31′, kiểm 11′ trước
      await taoPhieuLe({ taoLuc: sau(NOW, -5 * P), kiemLuc: sau(NOW, -51 * GIAY) }), // trẻ, kiểm 51s trước
    ];
    const khong: string[] = [];
    for (const s of ["DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "HUY"] as const) {
      khong.push(await taoPhieuLe({ taoLuc: sau(NOW, -2 * P), trangThai: s }));
    }
    khong.push(await taoPhieuLe({ taoLuc: sau(NOW, -5 * P), kiemLuc: sau(NOW, -30 * GIAY) })); // trẻ, kiểm 30s trước
    khong.push(await taoPhieuLe({ taoLuc: sau(NOW, -31 * P), kiemLuc: sau(NOW, -5 * P) })); // 31′, kiểm 5′ trước
    khong.push(await taoPhieuLe({ taoLuc: sau(NOW, P) })); // createdAt > now
    const f = new FakePosProvider();
    const kq = await chayPollerPos({ dongHo: () => NOW, provider: f });
    expect(hoiCua(f, [...chon, ...khong])).toEqual([...chon].sort());
    expect(kq).toMatchObject({ daKiem: 4, cache: 0, loi: 0, hetHan: 0, boQuaHetGio: 0 });
    const nk = await db.posCheckLog.findMany({ where: { intentId: { in: chon } } });
    expect(nk).toHaveLength(4);
    expect(nk.every((d) => d.triggeredBy === "POLLER" && d.createdById === null)).toBe(true);
  });

  it("[POS2-PL-02] mốc HET_HAN: expiresAt − 1ms còn mở; = now ⇒ kiểm lần cuối (POLLER) rồi HET_HAN, đúng 1 AuditLog, câu của lượt cuối giữ nguyên", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const HAN = sau(NOW, 24 * GIO);
    expect(await hetHanPhieuPos({ intentId: p.intentId, now: sau(HAN, -1) })).toEqual({ doi: false });
    expect((await phieuPos(p.intentId)).status).toBe("CHO_QUET");

    const f = new FakePosProvider();
    const kq = await chayPollerPos({ dongHo: () => HAN, provider: f });
    expect(kq).toMatchObject({ hetHan: 1, loi: 0 });
    expect(soLuotHoi(f, p.intentId), "lượt kiểm cuối có hỏi provider").toBe(1);
    const x = await phieuPos(p.intentId);
    expect(x.status).toBe("HET_HAN");
    expect(x.lastTriggeredBy).toBe("POLLER");
    expect(x.lastCheckAt?.toISOString()).toBe(HAN.toISOString());
    expect(x.lastResultMessage ?? "", "phép ghi HET_HAN không đụng câu của lượt kiểm cuối").toContain(
      `Chưa thấy giao dịch mang mã ${g.ma}`,
    );
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_PHIEU_HET_HAN" } })).toBe(1);
    expect((await nhatKy(p.intentId)).map((d) => [d.triggeredBy, d.kind])).toEqual([["POLLER", "NOT_FOUND"]]);
    // Lượt sau: phiếu đã đóng ⇒ không kiểm, không ghi lại.
    await chayPollerPos({ dongHo: () => sau(HAN, PHUT), provider: f });
    expect(soLuotHoi(f, p.intentId)).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_PHIEU_HET_HAN" } })).toBe(1);
  });

  it("[POS2-PL-03] phiếu QUÁ HẠN mà tiền ĐÃ có (file đã nhập, máy khai SAU) ⇒ lượt kiểm cuối ⇒ DA_THU, KHÔNG HET_HAN", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const mayMoi = `${PFX}MAYMOI`;
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: mayMoi })]);
    expect(
      (await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: m } })).status,
      "máy chưa khai ⇒ hàng chờ",
    ).toBe("UNMATCHED");
    await db.posTerminal.create({ data: { maThietBi: mayMoi, centerId: CS1 } });
    const kq = await chayPollerPos({ dongHo: () => sau(NOW, 24 * GIO), provider: new TcbFileImportProvider() });
    expect(kq.hetHan).toBe(0);
    const x = await phieuPos(p.intentId);
    expect(x.status, "sự thật về tiền thắng").toBe("DA_THU");
    expect((await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: m } })).status).toBe("MATCHED");
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_PHIEU_HET_HAN" } })).toBe(0);
  });

  it("[POS2-PL-04] trần 30/lượt, NULL/cũ nhất trước, nhịp 50 giây: 35 phiếu ⇒ 30 · 5 · 30", async () => {
    await chiCoPhieuFixture();
    const ids: string[] = [];
    for (let i = 0; i < 35; i += 1) ids.push(await taoPhieuLe({ taoLuc: sau(NOW, -10 * PHUT + i * GIAY) }));
    const f1 = new FakePosProvider();
    expect((await chayPollerPos({ dongHo: () => NOW, provider: f1 })).daKiem).toBe(30);
    const luot1 = hoiCua(f1, ids);
    expect(luot1, "30 phiếu tạo SỚM nhất (cùng lastCheckAt NULL)").toEqual([...ids.slice(0, 30)].sort());

    const f2 = new FakePosProvider();
    expect((await chayPollerPos({ dongHo: () => sau(NOW, 20 * GIAY), provider: f2 })).daKiem).toBe(5);
    expect(hoiCua(f2, ids), "30 phiếu vừa kiểm chưa tới nhịp 50 giây").toEqual([...ids.slice(30)].sort());

    const f3 = new FakePosProvider();
    expect((await chayPollerPos({ dongHo: () => sau(NOW, 60 * GIAY), provider: f3 })).daKiem).toBe(30);
    expect(hoiCua(f3, ids), "lượt 1 tới nhịp (60s ≥ 50s), lượt 2 thì chưa (40s)").toEqual(luot1);
  }, 60_000);

  it("[POS2-PL-05] ngân sách 40 giây: đồng hồ bước 15 giây/lần đọc ⇒ dừng, đếm phần bỏ lại, không lỗi", async () => {
    await chiCoPhieuFixture();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await taoPhieuLe({ taoLuc: sau(NOW, -10 * PHUT + i * GIAY) }));
    let buoc = 0;
    const dongHo = () => sau(NOW, 15 * GIAY * buoc++);
    const f = new FakePosProvider();
    const kq = await chayPollerPos({ dongHo, provider: f });
    // Lần đọc 1 = mốc đầu; phiếu 1 (+15s) · phiếu 2 (+30s) kiểm; phiếu 3 (+45s) vượt ngân sách ⇒ dừng.
    expect(kq).toMatchObject({ daKiem: 2, loi: 0, boQuaHetGio: 3 });
    expect(hoiCua(f, ids)).toHaveLength(2);
  });

  it("[POS2-PL-06] một phiếu NÉM giữa lô ⇒ loi = 1, các phiếu khác VẪN được kiểm", async () => {
    await chiCoPhieuFixture();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push(await taoPhieuLe({ taoLuc: sau(NOW, -10 * PHUT + i * GIAY), ma: sinhMa(399_000 - i) }));
    }
    tiem.nemQuyetMa = sinhMa(399_000 - 1);
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const kq = await chayPollerPos({ dongHo: () => NOW, provider: new FakePosProvider() });
    loi.mockRestore();
    expect(kq).toMatchObject({ daKiem: 3, loi: 1 });
    const nk = await db.posCheckLog.findMany({ where: { intentId: { in: ids } }, select: { intentId: true, errorCode: true } });
    expect(nk).toHaveLength(4);
    expect(nk.filter((d) => d.errorCode === "XU_LY_NEM").map((d) => d.intentId)).toEqual([ids[1]]);
  });

  it("[POS2-PL-08] đua hetHanPhieuPos ‖ moPhieuPos trên phiếu QUÁ HẠN ⇒ đúng 1 cũ HET_HAN, 1 mới CHO_QUET, 0 P2002, AuditLog HET_HAN ≤ 1", async () => {
    for (let vong = 0; vong < 6; vong += 1) {
      if (vong > 0) await dungFixture();
      await phatPhieu();
      const cu = await moPhieu();
      const luc = sau(NOW, 25 * GIO);
      const [h, m] = await Promise.all([
        hetHanPhieuPos({ intentId: cu.intentId, now: luc }),
        moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: luc }),
      ]);
      expect(m.ok, `vòng ${vong}: ${!m.ok ? m.error : ""}`).toBe(true);
      const ds = await db.posPaymentIntent.findMany({ where: { paymentBill: { orderId: DON } }, orderBy: { createdAt: "asc" } });
      expect(ds.map((x) => x.status), `vòng ${vong}`).toEqual(["HET_HAN", "CHO_QUET"]);
      expect(m.ok && m.phieu.intentId).toBe(ds[1]!.id);
      const soAudit = await db.auditLog.count({ where: { entityId: DON, action: "POS_PHIEU_HET_HAN" } });
      expect(soAudit, `vòng ${vong}`).toBeLessThanOrEqual(1);
      expect(soAudit === 1, `vòng ${vong}: poller ghi ⇔ có vết`).toBe(h.doi);
    }
  }, 120_000);

  it("[POS2-PL-09] 20 phiếu + provider lỗi kết nối ⇒ một lượt poller ⇒ mỗi admin ĐÚNG 1 chuông TOÀN HỆ THỐNG; SALE bấm ⇒ chuông theo phiếu như GĐ1", async () => {
    await chiCoPhieuFixture();
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      ids.push(await taoPhieuLe({ taoLuc: sau(NOW, -10 * PHUT + i * GIAY), centerId: i % 2 ? CS2 : CS1 }));
    }
    const kq = await chayPollerPos({ dongHo: () => NOW, provider: loiKetNoi });
    expect(kq.daKiem).toBe(20);
    const khoa = "pos.loi-ket-noi:he-thong:2026-10-06T17";
    for (const u of [KT, ADMIN]) {
      const ds = await db.staffNotification.findMany({ where: { userId: u, dedupeKey: { startsWith: "pos.loi-ket-noi:" } } });
      expect(ds.map((d) => d.dedupeKey), u).toEqual([khoa]);
      // [POS2-VA-06] (sửa CÓ CHỦ ĐÍCH — bản cũ ghim href KHÔNG ngày, tức ghim đúng lỗi): chuông mang
      // NGÀY VN phát chuông, không để màn tự lấy "hôm nay" của người bấm.
      expect(ds[0]!.href).toBe("/bien-dong-so-du/nhat-ky-pos?ketQua=PROVIDER_ERROR&tu=2026-10-06&den=2026-10-06");
      expect(ds[0]!.body).toContain("ngày 06/10");
    }
    expect(await db.staffNotification.count({ where: { userId: SALE, dedupeKey: { startsWith: "pos.loi-ket-noi:" } } })).toBe(0);
    // Đối chứng: SALE bấm Kiểm tra (ngoài cửa sổ 5s) ⇒ khoá THEO PHIẾU (GĐ1).
    await kiem(ids[0]!, loiKetNoi, { now: sau(NOW, PHUT) });
    const theoPhieu = await db.staffNotification.findMany({
      where: { userId: KT, dedupeKey: { startsWith: `pos.loi-ket-noi:${ids[0]}:` } },
    });
    expect(theoPhieu).toHaveLength(1);
  });

  it("[POS2-PL-10] poller KHÔNG hỏi cờ: cơ sở đang TẮT billing.flexV1Enabled ⇒ phiếu vẫn được kiểm", async () => {
    await phatPhieu();
    const p = await moPhieu();
    expect(await laThuTienLinhHoatBat(OU1), "fixture: cờ của cơ sở đang TẮT").toBe(false);
    const f = new FakePosProvider();
    await chayPollerPos({ dongHo: () => sau(NOW, 2 * PHUT), provider: f });
    expect(soLuotHoi(f, p.intentId)).toBe(1);
    expect((await nhatKy(p.intentId)).map((d) => d.triggeredBy)).toEqual(["POLLER"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THỜI HẠN HIỂN THỊ — ẩn khỏi màn sale nhưng VẪN đối soát
// ─────────────────────────────────────────────────────────────────────────────

async function viewDon(now: Date) {
  const mo = await docPhieuGopDangMo(DON);
  return dungPhieuPosChoDon({ ds: await docPhieuPosTho(DON), phieuMo: mo, now });
}

describe.skipIf(!RUN_DB_TESTS)("[POS2-HT-03] phiếu 31 phút rời màn sale nhưng poller vẫn đối soát; tiền về ⇒ hiện lại", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("ẩn ⇒ bấm 'Thẻ POS' trả CHÍNH phiếu đó (0 phép ghi) ⇒ nhập file ⇒ poller ⇒ DA_THU ⇒ hiện lại", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await kiem(p.intentId, new FakePosProvider(), { now: sau(NOW, PHUT) });
    expect((await viewDon(sau(NOW, 29 * PHUT)))?.intentId, "29′ vẫn trên màn").toBe(p.intentId);
    expect(await viewDon(sau(NOW, 31 * PHUT)), "31′ rời màn").toBeNull();

    const truoc = await phieuPos(p.intentId);
    const lai = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: sau(NOW, 31 * PHUT) });
    expect(lai.ok && lai.taoMoi).toBe(false);
    expect(lai.ok && lai.phieu.intentId).toBe(p.intentId);
    expect((await phieuPos(p.intentId)).updatedAt.getTime(), "không ghi gì").toBe(truoc.updatedAt.getTime());
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(1);

    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, thoiGian: "2026-10-06T17:35:00+07:00" })]);
    // Ẩn trên màn nhưng VẪN trong tập poller (tuổi 42′ ≥ 30′, kiểm lần cuối 41′ trước ≥ 10′).
    await chayPollerPos({ dongHo: () => sau(NOW, 42 * PHUT), provider: new TcbFileImportProvider() });
    expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
    const v = await viewDon(sau(NOW, 43 * PHUT));
    expect(v?.intentId, "DA_THU không bao giờ ẩn").toBe(p.intentId);
    expect(v?.hienThi).toBe("DA_THU");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUÉT SẠCH 23:30 GIỜ VN
// ─────────────────────────────────────────────────────────────────────────────

/** 23:30 giờ VN ngày 06/10 = 16:30Z. */
const QUET = new Date("2026-10-06T16:30:00Z");

/**
 * Đơn PHỤ đầy đủ (một con, một đợt) + phiếu gộp phát mã + phiếu POS mở lúc NOW — cho các ca cần NHIỀU
 * phiếu được ghi nhận thật (tiền qua `thuTheoPhieuGop`, không dựng tay).
 */
async function taoDonPhu(k: number): Promise<{ orderId: string; ma: string; intentId: string; tien: number }> {
  const orderId = `${T}don-phu-${k}`;
  const item = `${T}item-phu-${k}`;
  const dot = `${T}dot-phu-${k}`;
  const tien = 2_376_000 + k * 1_000;
  await db.order.create({
    data: {
      id: orderId,
      code: `ORD-269984-${String(k).padStart(6, "0")}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "PH phụ POS2",
      customerPhone: "0399822377",
      totalAmount: tien,
      centerId: CS1,
      createdById: SALE,
    },
  });
  await db.orderItem.create({
    data: { id: item, orderId, type: "COURSE_ENROLLMENT", itemName: `Bé phụ ${k}`, quantity: 1, unitPrice: tien, totalPrice: tien },
  });
  await db.paymentRequest.create({
    data: { id: dot, orderId, orderItemId: item, centerId: CS1, installmentNo: 1, amountDue: tien, status: "PENDING", sortOrder: 1 },
  });
  const g = await taoPhieuGop({ orderId, paymentRequestIds: [dot], actor: ACTOR });
  if (!g.ok) throw new Error(`fixture: không phát được phiếu gộp phụ — ${g.error}`);
  const r = await moPhieuPos({ orderId, paymentRequestId: dot, actor: ACTOR, now: NOW });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS phụ — ${r.error}`);
  return { orderId, ma: g.ma, intentId: r.phieu.intentId, tien };
}

const chuongQuetSach = (userId: string) =>
  db.staffNotification.findMany({ where: { userId, dedupeKey: { startsWith: "pos.quet-sach:" } }, orderBy: { dedupeKey: "asc" } });

describe.skipIf(!RUN_DB_TESTS)("[POS2-QS] quét sạch cuối ngày — ghi nhận phiếu bị bỏ sót, một chuông/ngày cho Kế toán HO", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS2-QS-01] file đã nhập nhưng giao dịch UNMATCHED (máy khai SAU) ⇒ quét sạch ⇒ DA_THU, tiền đủ, nhật ký QUET_SACH, Kế toán HO nhận 1 chuông, Sale KHÔNG", async () => {
    await chiCoPhieuFixture();
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const mayMoi = `${PFX}MAYMOI`;
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: mayMoi })]);
    expect((await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: m } })).status).toBe("UNMATCHED");
    await db.posTerminal.create({ data: { maThietBi: mayMoi, centerId: CS1 } });

    const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const kq = await quetSachPhieuPos({ dongHo: () => QUET, provider: new TcbFileImportProvider() });
    const daCanh = canh.mock.calls.some((c) => String(c[0]).startsWith("[pos:quet-sach]"));
    canh.mockRestore();
    expect(kq.ghiNhan).toEqual([{ intentId: p.intentId, code5: g.ma, status: "DA_THU" }]);
    expect(daCanh, "để lại vết cảnh báo cho người vận hành").toBe(true);
    expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
    const bt = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: m }, include: { allocations: true } });
    expect(bt.status).toBe("MATCHED");
    expect(bt.allocations).toHaveLength(2);
    const khoan = await db.payment.findMany({ where: { orderId: DON } });
    expect(khoan.reduce((s, k) => s + k.amount, 0)).toBe(TONG);
    expect(khoan.every((k) => k.accountantStatus === "PENDING")).toBe(true);
    expect((await nhatKy(p.intentId)).map((d) => [d.triggeredBy, d.kind, d.statusSau])).toEqual([["QUET_SACH", "PAID", "DA_THU"]]);

    for (const u of [KT, ADMIN]) {
      const c = await chuongQuetSach(u);
      expect(c.map((x) => x.dedupeKey), u).toEqual(["pos.quet-sach:2026-10-06"]);
      expect(c[0]!.href).toBe("/bien-dong-so-du/nhat-ky-pos?nguon=QUET_SACH&tu=2026-10-06&den=2026-10-06");
      expect(c[0]!.body).toContain(g.ma);
      expect(c[0]!.body, "không in số tiền (khuôn PRD T5)").not.toMatch(/6\.732\.000|6732000/);
    }
    expect(await chuongQuetSach(SALE)).toHaveLength(0);
  });

  it("[POS2-QS-02] chạy 2 lần CÙNG ngày ⇒ vẫn 1 dòng chuông/người (nội dung cập nhật); NGÀY SAU ⇒ dòng mới", async () => {
    await chiCoPhieuFixture();
    const a = await taoDonPhu(1);
    const b = await taoDonPhu(2);
    const c = await taoDonPhu(3);
    const f = new FakePosProvider();
    const tra = (x: { intentId: string; ma: string; tien: number }) =>
      f.datKetQua(x.intentId, paid({ providerTxnId: maGd(), dienGiai: x.ma, amount: x.tien }));
    const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    tra(a);
    expect((await quetSachPhieuPos({ dongHo: () => QUET, provider: f })).ghiNhan.map((x) => x.intentId)).toEqual([a.intentId]);
    tra(b);
    expect((await quetSachPhieuPos({ dongHo: () => sau(QUET, 10 * PHUT), provider: f })).ghiNhan.map((x) => x.intentId)).toEqual([b.intentId]);
    let ds = await chuongQuetSach(KT);
    expect(ds.map((x) => x.dedupeKey)).toEqual(["pos.quet-sach:2026-10-06"]);
    expect(ds[0]!.body, "lượt sau ĐÈ nội dung cùng ngày").toContain(b.ma);

    tra(c);
    expect((await quetSachPhieuPos({ dongHo: () => sau(QUET, 24 * GIO), provider: f })).ghiNhan.map((x) => x.intentId)).toEqual([c.intentId]);
    canh.mockRestore();
    ds = await chuongQuetSach(KT);
    expect(ds.map((x) => x.dedupeKey)).toEqual(["pos.quet-sach:2026-10-06", "pos.quet-sach:2026-10-07"]);
  });

  it("[POS2-QS-03] quét sạch ‖ poller ‖ SALE cùng một giao dịch (6 vòng) ⇒ đúng một bộ tiền, một sự kiện", async () => {
    for (let vong = 0; vong < 6; vong += 1) {
      if (vong > 0) await dungFixture();
      await chiCoPhieuFixture();
      const g = await phatPhieu();
      const p = await moPhieu();
      const m = maGd();
      const mayMoi = `${PFX}MAYMOI`;
      await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: mayMoi })]);
      await db.posTerminal.create({ data: { maThietBi: mayMoi, centerId: CS1 } });
      const tcb = new TcbFileImportProvider();
      const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await Promise.all([
        quetSachPhieuPos({ dongHo: () => QUET, provider: tcb }),
        chayPollerPos({ dongHo: () => QUET, provider: tcb }),
        kiem(p.intentId, tcb, { now: QUET }),
      ]);
      canh.mockRestore();
      const bts = await db.bankTransaction.findMany({ where: { providerTxnId: m } });
      expect(bts, `vòng ${vong}: 1 BankTransaction`).toHaveLength(1);
      expect(bts[0]!.status).toBe("MATCHED");
      expect(await db.paymentAllocation.count({ where: { bankTransactionId: bts[0]!.id } }), `vòng ${vong}: 1 bộ phân bổ`).toBe(2);
      const khoan = await db.payment.findMany({ where: { orderId: DON, note: { contains: `[auto:card_pos:${m}]` } } });
      expect(khoan.reduce((s, k) => s + k.amount, 0), `vòng ${vong}: Σ Payment`).toBe(TONG);
      expect(khoan, `vòng ${vong}: 1 bộ Payment`).toHaveLength(2);
      const ev = await db.domainEvent.findMany({ where: { type: "phieu-gop.da-chia", payloadJson: { path: ["orderId"], equals: DON } } });
      expect(ev, `vòng ${vong}: 1 sự kiện`).toHaveLength(1);
      const x = await phieuPos(p.intentId);
      expect(x.status).toBe("DA_THU");
      expect(x.bankTransactionId).toBe(bts[0]!.id);
    }
  }, 120_000);

  it("[POS2-QS-04] không phiếu nào được ghi nhận ⇒ 0 chuông (đối chứng âm); conMoHomNay đếm phiếu MỞ tạo HÔM NAY giờ VN", async () => {
    await chiCoPhieuFixture();
    await taoPhieuLe({ taoLuc: NOW }); // mở, hôm nay (17:00 VN 06/10)
    await taoPhieuLe({ taoLuc: sau(NOW, -24 * GIO) }); // mở, hôm qua (17:00 VN 05/10) — đã quá 24h
    await taoPhieuLe({ taoLuc: NOW, trangThai: "DA_THU" }); // đóng, hôm nay
    await taoPhieuLe({ taoLuc: new Date("2026-10-05T17:00:00Z") }); // mở, ĐÚNG 00:00 VN 06/10 ⇒ tính
    const kq = await quetSachPhieuPos({ dongHo: () => QUET, provider: new FakePosProvider() });
    expect(kq).toMatchObject({ daKiem: 3, ghiNhan: [], conMoHomNay: 2, loi: 0, daBao: 0 });
    expect(await chuongQuetSach(KT)).toHaveLength(0);
    expect(await chuongQuetSach(ADMIN)).toHaveLength(0);
  });

  it("[POS2-QS-06] quét sạch KHÔNG ghi HET_HAN — phiếu quá 24h vẫn MỞ sau lượt quét (việc của poller); và quét không lọc tuổi", async () => {
    await chiCoPhieuFixture();
    const cu = await taoPhieuLe({ taoLuc: sau(NOW, -30 * GIO) });
    const f = new FakePosProvider();
    await quetSachPhieuPos({ dongHo: () => QUET, provider: f });
    expect(soLuotHoi(f, cu), "phiếu quá hạn VẪN được quét (không lọc tuổi — U14)").toBe(1);
    expect((await phieuPos(cu)).status).toBe("CHO_QUET");
    expect(await db.auditLog.count({ where: { action: "POS_PHIEU_HET_HAN", entityId: { startsWith: T } } })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG GĐ2 (06/10/2026) — lỗi đã xác nhận (docs/pos-gd2-thiet-ke.md Phụ lục C)
// ─────────────────────────────────────────────────────────────────────────────

/** Hạn của phiếu mở lúc NOW (+24 giờ) = 17:00 VN ngày 07/10. */
const HAN = sau(NOW, 24 * GIO);
const CAU_LECH = "Máy đã thu 6.632.000đ, phiếu cần 6.732.000đ — đã chuyển kế toán xử lý. Đừng quẹt bù phần chênh.";

describe.skipIf(!RUN_DB_TESTS)("[POS2-VA-01] phiếu poller ghi HET_HAN lúc 24h VẪN được đồng bộ khi file nhập muộn (chưa bị thay)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS2-VA-01a] đúng số: HET_HAN lúc +24h ⇒ nhập file lúc +30h ⇒ đồng bộ ⇒ DA_THU, phiếu NHẬN giao dịch", async () => {
    await chiCoPhieuFixture();
    const g = await phatPhieu();
    const p = await moPhieu();
    expect((await chayPollerPos({ dongHo: () => HAN, provider: new FakePosProvider() })).hetHan).toBe(1);
    expect((await phieuPos(p.intentId)).status).toBe("HET_HAN");
    const m = maGd();
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma })]);
    const bt = await db.bankTransaction.findFirstOrThrow({ where: { providerTxnId: m } });
    expect(bt.status, "tiền đã khớp lúc import (không phụ thuộc phiếu POS)").toBe("MATCHED");
    const kq = await dongBoPhieuPosSauNhap({ now: sau(NOW, 30 * GIO), nguoiKiemId: KT });
    expect(kq).toEqual({ daKiem: 1, loi: 0 });
    const x = await phieuPos(p.intentId);
    expect(x.status, "GĐ1 (không poller) ra DA_THU — GĐ2 phải giữ đúng điều đó").toBe("DA_THU");
    expect(x.bankTransactionId).toBe(bt.id);
    expect(x.lastTriggeredBy).toBe("IMPORT");
  });

  it("[POS2-VA-01b] lệch số: HET_HAN ⇒ nhập file lệch ⇒ đồng bộ ⇒ giữ HET_HAN nhưng câu là câu LỆCH TIỀN (cấm quẹt bù), màn in câu đó", async () => {
    await chiCoPhieuFixture();
    const g = await phatPhieu();
    const p = await moPhieu();
    await chayPollerPos({ dongHo: () => HAN, provider: new FakePosProvider() });
    expect((await phieuPos(p.intentId)).status).toBe("HET_HAN");
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma, soTien: TONG - 100_000 })]);
    const luc = sau(NOW, 30 * GIO);
    await dongBoPhieuPosSauNhap({ now: luc, nguoiKiemId: KT });
    const x = await phieuPos(p.intentId);
    expect(x.status, "phiếu đã bị máy đóng — LECH_TIEN không lật phiếu đóng").toBe("HET_HAN");
    expect(x.lastResultMessage).toBe(CAU_LECH);
    const v = await viewDon(luc);
    expect(v?.intentId, "giao dịch chờ tay ⇒ phiếu vẫn trên màn").toBe(p.intentId);
    expect(v?.thongDiep).toBe(CAU_LECH);
    expect(v?.choKeToan).toBe(true);
  });

  it("[POS2-VA-01c] đối chứng: phiếu HET_HAN ĐÃ BỊ THAY (có phiếu mới hơn cùng phiếu gộp) ⇒ KHÔNG đồng bộ (GĐ1 D.4 #5)", async () => {
    await chiCoPhieuFixture();
    const g = await phatPhieu();
    const cu = await moPhieu();
    await chayPollerPos({ dongHo: () => HAN, provider: new FakePosProvider() });
    const moi = await moPhieu({ now: sau(HAN, GIO) });
    expect(moi.intentId).not.toBe(cu.intentId);
    await nhapFile([dong({ maGiaoDich: maGd(), dienGiai: g.ma })]);
    const kq = await dongBoPhieuPosSauNhap({ now: sau(NOW, 30 * GIO), nguoiKiemId: KT });
    expect(kq.daKiem, "chỉ phiếu MỚI").toBe(1);
    expect((await nhatKy(cu.intentId)).map((d) => d.triggeredBy), "phiếu cũ không có lượt IMPORT").toEqual(["POLLER"]);
    expect((await phieuPos(cu.intentId)).status).toBe("HET_HAN");
  });

  it("[POS2-VA-01d] quét sạch cũng thấy phiếu HET_HAN chưa bị thay (lưới đỡ khi đồng bộ sau import hụt)", async () => {
    await chiCoPhieuFixture();
    const g = await phatPhieu();
    const p = await moPhieu();
    await chayPollerPos({ dongHo: () => HAN, provider: new FakePosProvider() });
    const m = maGd();
    const mayMoi = `${PFX}MAYMOI`;
    await nhapFile([dong({ maGiaoDich: m, dienGiai: g.ma, maThietBi: mayMoi })]);
    await db.posTerminal.create({ data: { maThietBi: mayMoi, centerId: CS1 } });
    const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const kq = await quetSachPhieuPos({ dongHo: () => new Date("2026-10-07T16:30:00Z"), provider: new TcbFileImportProvider() });
    canh.mockRestore();
    expect(kq.ghiNhan).toEqual([{ intentId: p.intentId, code5: g.ma, status: "DA_THU" }]);
    expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
  });
});

/** Kết quả PAID làm pha tiền NÉM bằng DỮ LIỆU (số tiền vượt cột Int — khuôn `[POS1-DB-06]`). */
const paidNem = (ma: string) => paid({ providerTxnId: maGd(), dienGiai: ma, amount: 3_000_000_000 });

describe.skipIf(!RUN_DB_TESTS)("[POS2-VA-02] poller CHỈ ghi HET_HAN khi lượt kiểm cuối KẾT LUẬN được", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS2-VA-02a] lượt cuối ra CACHE (sale vừa bấm, lượt đang bay) ⇒ KHÔNG HET_HAN; phút sau ⇒ HET_HAN", async () => {
    await chiCoPhieuFixture();
    await phatPhieu();
    const p = await moPhieu();
    // Sale đã GIỮ LƯỢT 1 giây trước hạn (lượt đó đang chờ provider).
    await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { lastCheckAt: sau(HAN, -GIAY) } });
    const k1 = await chayPollerPos({ dongHo: () => HAN, provider: new FakePosProvider() });
    expect(k1).toMatchObject({ cache: 1, daKiem: 0, hetHan: 0 });
    expect((await phieuPos(p.intentId)).status).toBe("CHO_QUET");
    const k2 = await chayPollerPos({ dongHo: () => sau(HAN, PHUT), provider: new FakePosProvider() });
    expect(k2).toMatchObject({ daKiem: 1, hetHan: 1 });
    expect((await phieuPos(p.intentId)).status).toBe("HET_HAN");
  });

  it("[POS2-VA-02b] lượt cuối LỖI KẾT NỐI ⇒ KHÔNG HET_HAN; thử lại theo nhịp 10′ (không mỗi phút); kết luận được ⇒ HET_HAN", async () => {
    await chiCoPhieuFixture();
    await phatPhieu();
    const p = await moPhieu();
    const k1 = await chayPollerPos({ dongHo: () => HAN, provider: loiKetNoi });
    expect(k1).toMatchObject({ daKiem: 1, hetHan: 0 });
    expect((await phieuPos(p.intentId)).status).toBe("CHO_QUET");
    const f = new FakePosProvider();
    await chayPollerPos({ dongHo: () => sau(HAN, PHUT), provider: f });
    expect(soLuotHoi(f, p.intentId), "chưa tới nhịp 10′").toBe(0);
    const k3 = await chayPollerPos({ dongHo: () => sau(HAN, 10 * PHUT), provider: f });
    expect(soLuotHoi(f, p.intentId)).toBe(1);
    expect(k3.hetHan).toBe(1);
    expect((await phieuPos(p.intentId)).status).toBe("HET_HAN");
  });

  it("[POS2-VA-02c] lượt cuối CHƯA XÁC ĐỊNH (pha tiền ném) ⇒ KHÔNG HET_HAN, hetHanPhieuPos tự từ chối; quá trần 6 ngày ⇒ thôi hỏi", async () => {
    await chiCoPhieuFixture();
    const g = await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    f.datKetQua(p.intentId, paidNem(g.ma), paidNem(g.ma));
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const k1 = await chayPollerPos({ dongHo: () => HAN, provider: f });
    expect(k1).toMatchObject({ daKiem: 1, hetHan: 0 });
    let x = await phieuPos(p.intentId);
    expect(x.status).toBe("CHO_QUET");
    expect(x.lastResultKind).toBe("PAID");
    expect(await hetHanPhieuPos({ intentId: p.intentId, now: sau(HAN, PHUT) }), "cổng dưới khoá").toEqual({ doi: false });
    await chayPollerPos({ dongHo: () => sau(HAN, 10 * PHUT), provider: f });
    expect(soLuotHoi(f, p.intentId), "thử lại theo nhịp 10′").toBe(2);
    expect((await phieuPos(p.intentId)).status).toBe("CHO_QUET");
    await chayPollerPos({ dongHo: () => sau(HAN, 6 * 24 * GIO + PHUT), provider: f });
    loi.mockRestore();
    expect(soLuotHoi(f, p.intentId), "quá trần ⇒ poller thôi hỏi").toBe(2);
    x = await phieuPos(p.intentId);
    expect(x.status, "không tự kết luận — vẫn chờ kế toán").toBe("CHO_QUET");
    expect(await db.auditLog.count({ where: { entityId: DON, action: "POS_PHIEU_HET_HAN" } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS2-VA-03] lượt bấm dồn (CACHE) tô màu như MÀN tô câu đã lưu + giờ của lượt kiểm THẬT", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("CHUA_XAC_DINH: lượt thật 'loi' ⇒ bấm lại sau 2s (CACHE) vẫn 'loi', không 'thong_tin'; kiemLuc = giờ lượt thật", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    f.datKetQua(p.intentId, paidNem(g.ma));
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r1 = await kiem(p.intentId, f, { now: KIEM });
    loi.mockRestore();
    expect(r1).toMatchObject({ tuCache: false, mucDo: "loi", kiemLuc: gioVN(KIEM) });
    const r2 = await kiem(p.intentId, f, { now: sau(KIEM, 2 * GIAY) });
    expect(r2).toMatchObject({ tuCache: true, thongDiep: r1.thongDiep, mucDo: "loi", kiemLuc: gioVN(KIEM) });
    const v = await viewDon(sau(KIEM, 2 * GIAY));
    expect(r2.mucDo, "CACHE = cùng phép tô của màn").toBe(v?.mucDo);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS2-VA-04] quét sạch chạy lại CÙNG ngày: chuông là HỢP mọi lượt, rung lại người đã đọc, daBao đếm chuông thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("lượt 1 ghi nhận A, Kế toán đọc ⇒ lượt 2 ghi nhận B ⇒ thân có CẢ A và B, chưa đọc lại; daBao = số người được rung", async () => {
    await chiCoPhieuFixture();
    const a = await taoDonPhu(11);
    const b = await taoDonPhu(12);
    const f = new FakePosProvider();
    const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f.datKetQua(a.intentId, paid({ providerTxnId: maGd(), dienGiai: a.ma, amount: a.tien }));
    await quetSachPhieuPos({ dongHo: () => QUET, provider: f });
    await db.staffNotification.updateMany({
      where: { dedupeKey: "pos.quet-sach:2026-10-06" },
      data: { readAt: sau(QUET, PHUT) },
    });
    f.datKetQua(b.intentId, paid({ providerTxnId: maGd(), dienGiai: b.ma, amount: b.tien }));
    const k2 = await quetSachPhieuPos({ dongHo: () => sau(QUET, 10 * PHUT), provider: f });
    canh.mockRestore();
    expect(k2.ghiNhan.map((x) => x.intentId)).toEqual([b.intentId]);
    for (const u of [KT, ADMIN]) {
      const c = await chuongQuetSach(u);
      expect(c, u).toHaveLength(1);
      expect(c[0]!.body, `${u}: thân là HỢP mọi lượt trong ngày`).toContain(a.ma);
      expect(c[0]!.body).toContain(b.ma);
      expect(c[0]!.title).toContain("2 phiếu");
      expect(c[0]!.readAt, `${u}: có phiếu MỚI ⇒ mở lại`).toBeNull();
    }
    const nhan = await db.staffNotification.count({ where: { dedupeKey: "pos.quet-sach:2026-10-06" } });
    expect(k2.daBao, "daBao = số người VỪA được rung (mọi người đã đọc ⇒ mọi người)").toBe(nhan);
    // Đối chứng: lượt 3 không ghi nhận gì ⇒ không chuông, daBao 0.
    const k3 = await quetSachPhieuPos({ dongHo: () => sau(QUET, 20 * PHUT), provider: f });
    expect(k3).toMatchObject({ ghiNhan: [], daBao: 0 });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS2-VA-05] 'chưa xác định' khi poller tự kiểm nhiều giờ ⇒ MỘT chuông / phiếu / ngày / người", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("ba lượt poller lúc 17:01 · 19:00 · 22:00 VN cùng ngày ⇒ 1 chuông mỗi Kế toán HO / Quản trị; SALE bấm giữ khoá GĐ1", async () => {
    await chiCoPhieuFixture();
    const g = await phatPhieu();
    const p = await moPhieu();
    const f = new FakePosProvider();
    f.datKetQua(p.intentId, paidNem(g.ma), paidNem(g.ma), paidNem(g.ma), paidNem(g.ma));
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const t of [sau(NOW, PHUT), sau(NOW, 2 * GIO), sau(NOW, 5 * GIO)]) {
      await chayPollerPos({ dongHo: () => t, provider: f });
    }
    expect(soLuotHoi(f, p.intentId), "fixture: ba lượt thật").toBe(3);
    for (const u of [KT, ADMIN]) {
      const ds = await db.staffNotification.findMany({ where: { userId: u, dedupeKey: { startsWith: "pos.chua-xac-dinh:" } } });
      expect(ds.map((d) => d.dedupeKey), u).toEqual([`pos.chua-xac-dinh:${p.intentId}:2026-10-06`]);
    }
    // Đối chứng: SALE bấm ⇒ khoá theo GIỜ như GĐ1 (một chuông mới, khác khoá).
    await kiem(p.intentId, f, { now: sau(NOW, 6 * GIO) });
    loi.mockRestore();
    const ds = await db.staffNotification.findMany({ where: { userId: KT, dedupeKey: { startsWith: "pos.chua-xac-dinh:" } } });
    expect(ds.map((d) => d.dedupeKey).sort()).toEqual(
      [`pos.chua-xac-dinh:${p.intentId}:2026-10-06`, `pos.chua-xac-dinh:${p.intentId}:2026-10-06T23`].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MÁY POS — chọn máy khi cơ sở có nhiều máy · script khai máy
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS2-MAY-05] cơ sở có 2 máy đang bật ⇒ sale PHẢI chọn máy (GĐ1 đã làm — lấp lỗ phủ)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("không truyền máy ⇒ từ chối, 0 phiếu; máy hợp lệ ⇒ tạo trên ĐÚNG máy đó; máy cơ sở khác ⇒ từ chối", async () => {
    const may3 = await db.posTerminal.create({ data: { maThietBi: `${PFX}MAY03`, maQuay: "QTTPHU03", centerId: CS1 } });
    const may2 = await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: MAY2 } });
    await phatPhieu();
    const thieu = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, actor: ACTOR, now: NOW });
    expect(thieu).toEqual({ ok: false, error: "Cơ sở có nhiều máy POS — chọn máy sẽ quẹt" });
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(0);

    const khac = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, posTerminalId: may2.id, actor: ACTOR, now: NOW });
    expect(khac).toEqual({ ok: false, error: "Máy POS không thuộc cơ sở của đơn hoặc đã tắt — tải lại trang" });
    expect(await db.posPaymentIntent.count({ where: { paymentBill: { orderId: DON } } })).toBe(0);

    const dung = await moPhieuPos({ orderId: DON, paymentRequestId: DOT_A, posTerminalId: may3.id, actor: ACTOR, now: NOW });
    expect(dung.ok).toBe(true);
    const x = await db.posPaymentIntent.findFirstOrThrow({ where: { paymentBill: { orderId: DON } } });
    expect(x.posTerminalId).toBe(may3.id);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS2-SEED] khaiMayPos — dry-run không ghi; --apply tạo đúng cơ sở + ghi kép; chạy lại idempotent; không đè, không chuyển cơ sở", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const SEED1 = `${PFX}SEED01`;
  const SEED2 = `${PFX}SEED02`;
  const DS: MayKhai[] = [
    { coSo: "FXP2-CS1", maThietBi: SEED1, maQuay: "QTTSEED01", maCuaHang: "CHSEED001", maNhaCungCap: "NCCSEED01", maTcbQuay: null },
    { coSo: "FXP2-CS2", maThietBi: SEED2, maQuay: "QTTSEED02", maCuaHang: "CHSEED002", maNhaCungCap: "NCCSEED02", maTcbQuay: null },
  ];
  const mayCuaSeed = () =>
    db.posTerminal.findMany({ where: { maThietBi: { in: [SEED1, SEED2] } }, orderBy: { maThietBi: "asc" } });
  const vetSeed = async () => {
    const ids = (await mayCuaSeed()).map((m) => m.id);
    return db.auditLog.count({ where: { entityType: "PosTerminal", entityId: { in: ids } } });
  };

  it("[POS2-SEED-02] apply: false ⇒ 0 máy mới, 0 vết; trả kế hoạch 2 × TAO", async () => {
    const truocAudit = await db.auditLog.count();
    const kq = await khaiMayPos({ ds: DS, apply: false });
    expect(kq.viec.map((v) => v.loai)).toEqual(["TAO", "TAO"]);
    expect(kq.daGhi).toBe(0);
    expect(await mayCuaSeed()).toHaveLength(0);
    expect(await db.auditLog.count()).toBe(truocAudit);
  });

  it("[POS2-SEED-03] apply: true ⇒ 2 máy đúng centerId theo Center.code, orgUnitId ghi kép, 2 vết CREATE", async () => {
    const kq = await khaiMayPos({ ds: DS, apply: true });
    expect(kq).toMatchObject({ daGhi: 2, coXungDot: false });
    const m = await mayCuaSeed();
    expect(m.map((x) => [x.maThietBi, x.centerId, x.active, x.maQuay, x.maCuaHang, x.maNhaCungCap, x.maTcbQuay])).toEqual([
      [SEED1, CS1, true, "QTTSEED01", "CHSEED001", "NCCSEED01", null],
      [SEED2, CS2, true, "QTTSEED02", "CHSEED002", "NCCSEED02", null],
    ]);
    expect(m.map((x) => x.orgUnitId), "CS1 có đơn vị ⇒ ghi kép; CS2 không ⇒ trống").toEqual([OU1, null]);
    expect(m.every((x) => x.createdById === null)).toBe(true);
    const vet = await db.auditLog.findMany({ where: { entityType: "PosTerminal", entityId: { in: m.map((x) => x.id) } } });
    expect(vet.map((v) => v.action)).toEqual(["CREATE", "CREATE"]);
    expect(vet.every((v) => v.actorId === null && v.actorName === "Script pos-khai-may")).toBe(true);
  });

  it("[POS2-SEED-04] chạy apply LẦN HAI ⇒ 2 × GIU_NGUYEN, daGhi 0, updatedAt không đổi, không vết mới", async () => {
    await khaiMayPos({ ds: DS, apply: true });
    const truoc = await mayCuaSeed();
    const vetTruoc = await vetSeed();
    const kq = await khaiMayPos({ ds: DS, apply: true });
    expect(kq.viec.map((v) => v.loai)).toEqual(["GIU_NGUYEN", "GIU_NGUYEN"]);
    expect(kq).toMatchObject({ daGhi: 0, coXungDot: false });
    expect((await mayCuaSeed()).map((x) => x.updatedAt.getTime())).toEqual(truoc.map((x) => x.updatedAt.getTime()));
    expect(await vetSeed()).toBe(vetTruoc);
  });

  it("[POS2-SEED-05] máy đã khai ở CS2 mà script nói CS1 ⇒ XUNG_DOT_CO_SO, centerId GIỮ; ô có giá trị khác ⇒ GIỮ, báo lệch; ô trống ⇒ điền", async () => {
    await db.posTerminal.create({ data: { maThietBi: SEED1, centerId: CS2, maCuaHang: "CHTAY0001" } });
    await db.posTerminal.create({ data: { maThietBi: SEED2, centerId: CS2, maCuaHang: "CHTAY0002", active: false } });
    const kq = await khaiMayPos({ ds: DS, apply: true });
    expect(kq.coXungDot).toBe(true);
    expect(kq.viec[0]).toEqual({ loai: "XUNG_DOT_CO_SO", maThietBi: SEED1, coSoHienTai: "FXP2-CS2", coSoScript: "FXP2-CS1" });
    expect(kq.viec[1]).toMatchObject({
      loai: "DIEN",
      maThietBi: SEED2,
      dien: { maQuay: "QTTSEED02", maNhaCungCap: "NCCSEED02" },
      lech: [{ truong: "maCuaHang", hienTai: "CHTAY0002", script: "CHSEED002" }],
      dangTat: true,
    });
    const m = await mayCuaSeed();
    expect(m[0]).toMatchObject({ centerId: CS2, maCuaHang: "CHTAY0001", maQuay: null });
    expect(m[1]).toMatchObject({ centerId: CS2, maCuaHang: "CHTAY0002", maQuay: "QTTSEED02", maNhaCungCap: "NCCSEED02", active: false });
    const vet = await db.auditLog.findMany({ where: { entityType: "PosTerminal", entityId: m[1]!.id } });
    expect(vet.map((v) => v.action)).toEqual(["UPDATE"]);
    expect(vet[0]!.newValues).toEqual({ maQuay: "QTTSEED02", maNhaCungCap: "NCCSEED02" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MÀN TRA CỨU NHẬT KÝ — dữ liệu theo phạm vi người xem
// ─────────────────────────────────────────────────────────────────────────────

function nguoiXem(o: { ho: boolean; coSo?: string }): Actor {
  return {
    userId: KT,
    isSuperAdmin: false,
    isHoLevel: o.ho,
    orgRoles: [],
    permissions: [
      {
        action: "payments:import-pos",
        scopeType: "GLOBAL",
        orgUnitId: o.ho ? `${T}ou-ho` : OU1,
        roleCode: o.ho ? "HO_ACCOUNTANT" : "CENTER_ACCOUNTANT",
        centerScope: o.ho ? "ALL" : [o.coSo ?? CS1],
      },
    ],
    visibleCenterIds: o.ho ? [CS1, CS2] : [o.coSo ?? CS1],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[POS2-NK-03] dữ liệu màn Nhật ký kiểm thẻ POS đi qua scopedDb", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("Kế toán HO thấy CS1 + CS2; vai neo CS1 có quyền chỉ thấy CS1 (đối chứng âm + dương); tổng đếm khớp", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const cs2 = await taoPhieuLe({ taoLuc: sau(NOW, -2 * PHUT), centerId: CS2 });
    const f = new FakePosProvider();
    await kiem(p.intentId, f, { now: KIEM });
    await kiem(p.intentId, f, { now: sau(KIEM, 2 * GIAY) }); // CACHE
    await kiem(cs2, loiKetNoi, { nguon: "POLLER", now: KIEM, nguoiKiemId: null });
    const loc = docLocNhatKy({}, KIEM, [CS1, CS2]);

    const ho = await docNhatKy(scopedDb(nguoiXem({ ho: true })), loc);
    const cuaFx = ho.dong.filter((d) => d.intentId === p.intentId || d.intentId === cs2);
    expect(cuaFx).toHaveLength(3);
    expect(new Set(cuaFx.map((d) => d.centerId))).toEqual(new Set([CS1, CS2]));
    const dongSale = cuaFx.find((d) => d.ketQua === "NOT_FOUND")!;
    expect(dongSale).toMatchObject({ code5: g.ma, orderId: DON, orderCode: "ORD-269982-000123", nguon: "SALE", nguoiBam: "Sale fixture POS2", statusSau: "CHO_QUET" });
    expect(dongSale.luc).toBe("2026-10-06T17:40:00+07:00");

    const cs1 = await docNhatKy(scopedDb(nguoiXem({ ho: false, coSo: CS1 })), loc);
    const thay = cs1.dong.filter((d) => d.intentId === p.intentId || d.intentId === cs2);
    expect(thay.map((d) => d.centerId).sort(), "neo CS1 KHÔNG thấy dòng CS2").toEqual([CS1, CS1]);
    expect(thay.map((d) => d.ketQua).sort()).toEqual(["CACHE", "NOT_FOUND"]);
    // Đếm theo kết quả cũng đi qua phạm vi (groupBy được scope).
    expect(cs1.theoKetQua.PROVIDER_ERROR ?? 0).toBe(0);
    expect(ho.theoKetQua.PROVIDER_ERROR ?? 0).toBeGreaterThanOrEqual(1);

    // Lọc theo mã phiếu + nguồn.
    const theoMa = await docNhatKy(scopedDb(nguoiXem({ ho: true })), docLocNhatKy({ ma: g.ma, ketQua: "CACHE" }, KIEM, [CS1, CS2]));
    expect(theoMa.dong.map((d) => [d.code5, d.ketQua])).toEqual([[g.ma, "CACHE"]]);
    expect(theoMa.tong).toBe(1);
  });

  it("[POS2-VA-07] dải tổng KHÔNG bị lọc kết quả đang áp: số cạnh mỗi lọc nhanh = số dòng nhận được khi bấm", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const cs2 = await taoPhieuLe({ taoLuc: sau(NOW, -2 * PHUT), centerId: CS2 });
    const f = new FakePosProvider();
    await kiem(p.intentId, f, { now: KIEM });
    await kiem(p.intentId, f, { now: sau(KIEM, 2 * GIAY) }); // CACHE
    await kiem(cs2, loiKetNoi, { nguon: "POLLER", now: KIEM, nguoiKiemId: null });
    const sdb = scopedDb(nguoiXem({ ho: true }));
    const khongLoc = await docNhatKy(sdb, docLocNhatKy({}, KIEM, [CS1, CS2]));
    for (const ketQua of ["PROVIDER_ERROR", "CACHE", "PAID"] as const) {
      const dl = await docNhatKy(sdb, docLocNhatKy({ ketQua }, KIEM, [CS1, CS2]));
      expect(dl.tong, `${ketQua}: "N lượt" + bảng theo bộ lọc đầy đủ`).toBe(khongLoc.theoKetQua[ketQua] ?? 0);
      expect(dl.daiTong.tong, `${ketQua}: dải tổng không lọc kết quả`).toBe(khongLoc.tong);
      for (const k of ["CACHE", "PROVIDER_ERROR", "PAID", "NOT_FOUND"] as const) {
        expect(dl.daiTong.theoKetQua[k] ?? 0, `${ketQua} → số cạnh ${k}`).toBe(khongLoc.theoKetQua[k] ?? 0);
      }
    }
    expect(khongLoc.daiTong).toEqual({ tong: khongLoc.tong, theoKetQua: khongLoc.theoKetQua });
  });
});
