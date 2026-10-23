// Ca [CHT-*] — bước "ĐÃ CHI" của yêu cầu hoàn tiền đi VÀO SỔ `Payment` (`chiHoanTien`,
// lib/finance/chi-hoan-tien.ts), trên Postgres THẬT. Chủ dự án bảo làm 29/09/2026.
//
// Canh: chuyển APPROVED → PAID + dòng âm đúng tổng / đúng khoản nguồn / đúng đầu mối; rót LIFO; mọi
// cổng từ chối KHÔNG ghi gì (đếm dòng); chi hai lần; khoản nguồn chỉ là khoản ĐÃ XÁC NHẬN; trần ròng
// của phạm vi (tiền đã chuyển sang bé khác); công nợ + hoá đơn điện tử thấy khoản hoàn; và
// `chiHoanTienAction` (quyền, phạm vi cơ sở, phương thức — có đối chứng dương).
//
// Mốc thời gian TUYỆT ĐỐI (luật 19). Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { KHOAN_DA_XAC_NHAN, KHOAN_DA_DONG, computeEnrollmentDebt } from "@/lib/finance/debt";
import { chiHoanTien, rotLifo } from "@/lib/finance/chi-hoan-tien";
import { RefundError } from "@/lib/finance/refund";
import { approveRefundAction, chiHoanTienAction, rejectRefundAction } from "@/app/(admin)/admin/hoan-tien/_actions";
import { chotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA, taoHoaDonChoLanThu } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";

if (!RUN_DB_TESTS) console.warn(`[CHT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-cht-";
const CS = `${T}center`;
const CS2 = `${T}center2`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const DON = `${T}don`;
const DON2 = `${T}don2`;
const OI = `${T}oi`;
const OI2 = `${T}oi2`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture CHT" };
const SALE = `${T}sale`;
const PT_CHUNG = "FXCHT_TIEN_MAT";
const PT_CS2 = "FXCHT_BANK_CS2";
const XN_QUA_KHU = new Date("2026-09-01T02:00:00Z");
const TRUOC = new Date("2000-01-15T02:00:00Z");
const NGAY_CHI = new Date("2026-09-20T05:00:00Z");
const PHAP_NHAN = { ma: "SATA_ROBO", ten: "Công ty CP Sata Robo", maSoThue: "0402301783", diaChi: "Đà Nẵng", bat: true };
/** Trạng thái từ HẰNG (lưới truc-a cấm gõ literal). */
const DA_GHI = SALE_STATUS_DA_GHI_NHAN[0]!;
const DA_XN = KHOAN_DA_XAC_NHAN.accountantStatus;
const DONS = [DON, DON2];

async function don() {
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: { in: DONS } }, select: { id: true } });
  const gui = await db.hoaDonGuiEmail.findMany({ where: { hoaDonId: { in: hd.map((x) => x.id) } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: gui.map((g) => `hoa-don.gui:${g.id}`) } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: DONS } } });
  const pays = await db.payment.findMany({ where: { orderId: { in: DONS } }, select: { id: true } });
  const rrs = await db.refundRequest.findMany({ where: { reason: { startsWith: T } }, select: { id: true } });
  await db.receipt.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
  await db.auditLog.deleteMany({
    where: { entityId: { in: [...pays.map((p) => p.id), ...rrs.map((r) => r.id), ...hd.map((x) => x.id)] } },
  });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { in: DONS } } });
  await db.refundRequest.deleteMany({ where: { reason: { startsWith: T } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: DONS } } });
  await db.order.deleteMany({ where: { id: { in: DONS } } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.paymentMethod.deleteMany({ where: { code: { in: [PT_CHUNG, PT_CS2] } } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS2] } } });
}

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở CHT", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở CHT 2", slug: `${T}co-so-2`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 4 fixture", slug: `${T}sata-4` } });
  await db.class.create({ data: { id: LOP, name: "Lớp CHT", courseId: KHOA, centerId: CS } });
  await db.student.create({ data: { id: HS, name: "Bé Hoàn CHT" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  for (const [id, code] of [
    [DON, "ORD-269929-000501"],
    [DON2, "ORD-269929-000502"],
  ] as const) {
    await db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: "PH CHT",
        customerPhone: "0999000777",
        customerEmail: "phuhuynh.cht@example.com",
        totalAmount: 9_000_000,
        centerId: CS,
      },
    });
  }
  await db.orderItem.create({
    data: { id: OI, orderId: DON, enrollmentId: GD, type: "COURSE_ENROLLMENT", itemName: "Sata 4 — Bé Hoàn", quantity: 1, unitPrice: 9_000_000, totalPrice: 9_000_000 },
  });
  await db.orderItem.create({
    data: { id: OI2, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 4 — Bé Em", quantity: 1, unitPrice: 9_000_000, totalPrice: 9_000_000 },
  });
  await db.paymentMethod.create({ data: { code: PT_CHUNG, name: "Tiền mặt (CHT)", type: "CASH" } });
  await db.paymentMethod.create({ data: { code: PT_CS2, name: "CK CS2 (CHT)", type: "BANK_TRANSFER", centerId: CS2 } });
}

type Khoan = {
  id: string;
  soTien: number;
  ngay: string;
  orderItemId?: string | null;
  enrollmentId?: string | null;
  orderId?: string;
  accountantStatus?: "PENDING" | "REJECTED" | "REFUNDED" | typeof DA_XN;
  adjustmentOfId?: string | null;
  paymentType?: "PAYMENT" | "ADJUSTMENT";
};
const khoan = (k: Khoan) =>
  db.payment.create({
    data: {
      id: k.id,
      orderId: k.orderId ?? DON,
      orderItemId: k.orderItemId === undefined ? OI : k.orderItemId,
      enrollmentId: k.enrollmentId === undefined ? GD : k.enrollmentId,
      amount: k.soTien,
      method: "CASH",
      paidDate: new Date(k.ngay),
      note: "[auto:sepay:TXN-CHT] khoản gốc",
      saleStatus: DA_GHI,
      accountantStatus: k.accountantStatus ?? DA_XN,
      adjustmentOfId: k.adjustmentOfId ?? null,
      paymentType: k.paymentType ?? "PAYMENT",
      recordedById: SALE,
      centerId: CS,
    },
  });

type Nguon = { orderItemId?: string | null; enrollmentId?: string | null };
const hoan = (nguon: Nguon, soTien: number, status: "PENDING" | "APPROVED" | "PAID" | "REJECTED" = "APPROVED") =>
  db.refundRequest.create({
    data: {
      orderItemId: nguon.orderItemId ?? null,
      enrollmentId: nguon.enrollmentId ?? null,
      centerId: CS,
      trigger: "WITHDRAW",
      reason: `${T}nghỉ học`,
      paidConfirmed: 5_000_000,
      sessionsTotal: 48,
      sessionsLearned: 12,
      unitPrice: 62_500,
      proposedAmount: soTien,
      approvedAmount: status === "PENDING" ? null : soTien,
      status,
      approvedAt: status === "PENDING" ? null : TRUOC,
    },
  });

const chi = (refundRequestId: string) =>
  chiHoanTien({ refundRequestId, actorId: KT.id, actorName: KT.name, method: PT_CHUNG, paidDate: NGAY_CHI, note: "chi tay" });

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof RefundError ? `${e.code}:${e.message}` : String(e);
  }
}

/** Ảnh chụp mọi thứ một lượt chi có thể chạm — so trước/sau để chứng minh "không ghi gì". */
async function anhSo(rrId: string) {
  const [pay, rr, audit] = await Promise.all([
    db.payment.count({ where: { orderId: { in: DONS } } }),
    db.refundRequest.findUniqueOrThrow({ where: { id: rrId }, select: { status: true, paidAt: true, paidById: true, paidMethod: true } }),
    db.auditLog.count({ where: { entityId: rrId } }),
  ]);
  return { pay, rr, audit };
}

const dongHoan = (rrId: string) =>
  db.payment.findMany({
    where: { refundRequestId: rrId },
    orderBy: { amount: "asc" },
    select: {
      amount: true,
      adjustmentOfId: true,
      orderItemId: true,
      enrollmentId: true,
      orderId: true,
      accountantStatus: true,
      method: true,
      paidDate: true,
      centerId: true,
      confirmedById: true,
      note: true,
    },
  });

describe("[CHT-00] rotLifo — thuần", () => {
  it("rót theo thứ tự đã sắp, bỏ khoản ≤ 0, thiếu ⇒ null", () => {
    expect(rotLifo([{ id: "b", conHoan: 2 }, { id: "a", conHoan: 3 }], 4)).toEqual([
      { paymentId: "b", soTien: 2 },
      { paymentId: "a", soTien: 2 },
    ]);
    expect(rotLifo([{ id: "b", conHoan: 0 }, { id: "a", conHoan: 3 }], 3)).toEqual([{ paymentId: "a", soTien: 3 }]);
    expect(rotLifo([{ id: "a", conHoan: 3 }], 4)).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[CHT-01..08] chiHoanTien — sổ Payment trên Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[CHT-01] chi đúng ⇒ PAID + paidAt/paidById/paidMethod, MỘT dòng âm đúng số, đúng khoản nguồn và đầu mối", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 2_000_000);
    const kq = await chi(rr.id);
    expect(kq.soTien).toBe(2_000_000);
    expect(kq.orderId).toBe(DON);

    const sau = await db.refundRequest.findUniqueOrThrow({ where: { id: rr.id } });
    expect(sau).toMatchObject({ status: "PAID", paidById: KT.id, paidMethod: PT_CHUNG });
    expect(sau.paidAt?.toISOString()).toBe(NGAY_CHI.toISOString());

    const dong = await dongHoan(rr.id);
    expect(dong).toEqual([
      {
        amount: -2_000_000,
        adjustmentOfId: `${T}p1`,
        orderItemId: OI,
        enrollmentId: GD,
        orderId: DON,
        accountantStatus: "REFUNDED",
        method: PT_CHUNG,
        paidDate: NGAY_CHI,
        centerId: CS,
        confirmedById: KT.id,
        note: expect.not.stringContaining("[auto:"),
      },
    ]);
    // Audit: một dòng cho RefundRequest + một cho Payment âm, TRONG cùng lượt.
    expect(await db.auditLog.count({ where: { entityId: rr.id, action: "STATUS_CHANGE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: kq.paymentIds[0]!, action: "CREATE" } })).toBe(1);
  });

  it("[CHT-02] rót LIFO qua 2 khoản — khoản MỚI NHẤT cạn trước", async () => {
    await khoan({ id: `${T}p-cu`, soTien: 3_000_000, ngay: "2026-07-01T03:00:00Z" });
    await khoan({ id: `${T}p-moi`, soTien: 2_000_000, ngay: "2026-08-15T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 4_000_000);
    await chi(rr.id);
    const dong = await dongHoan(rr.id);
    expect(dong.map((d) => [d.adjustmentOfId, d.amount]).sort()).toEqual(
      [
        [`${T}p-cu`, -2_000_000],
        [`${T}p-moi`, -2_000_000],
      ].sort(),
    );
    // Đổi thứ tự ngày ⇒ khoản kia cạn trước (đối chứng: thứ tự là theo NGÀY, không theo id).
    await don();
    await dungFixture();
    await khoan({ id: `${T}p-cu`, soTien: 3_000_000, ngay: "2026-08-15T03:00:00Z" });
    await khoan({ id: `${T}p-moi`, soTien: 2_000_000, ngay: "2026-07-01T03:00:00Z" });
    const rr2 = await hoan({ orderItemId: OI, enrollmentId: GD }, 4_000_000);
    await chi(rr2.id);
    expect((await dongHoan(rr2.id)).map((d) => [d.adjustmentOfId, d.amount]).sort()).toEqual(
      [
        [`${T}p-cu`, -3_000_000],
        [`${T}p-moi`, -1_000_000],
      ].sort(),
    );
  });

  it("[CHT-03] vượt số còn hoàn ⇒ ném, câu nói số, và KHÔNG ghi gì", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 5_000_001);
    const truoc = await anhSo(rr.id);
    expect(await maLoi(chi(rr.id))).toBe("INSUFFICIENT:Chỉ còn 5.000.000 đ đã thu (kế toán đã xác nhận) có thể hoàn — yêu cầu duyệt 5.000.001 đ");
    expect(await anhSo(rr.id)).toEqual(truoc);
    expect(truoc.rr.status).toBe("APPROVED");
  });

  it("[CHT-04] chi lần 2 ⇒ từ chối, không thêm dòng nào", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    await chi(rr.id);
    const truoc = await anhSo(rr.id);
    expect(await maLoi(chi(rr.id))).toMatch(/^INVALID_STATE:.*ĐÃ CHI/);
    expect(await anhSo(rr.id)).toEqual(truoc);
    expect(await db.payment.count({ where: { refundRequestId: rr.id } })).toBe(1);
  });

  it("[CHT-04b] hai lượt chi SONG SONG ⇒ đúng một lượt ghi", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    const kq = await Promise.allSettled([chi(rr.id), chi(rr.id)]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    expect(await db.payment.count({ where: { refundRequestId: rr.id } })).toBe(1);
  });

  it("[CHT-05] PENDING / REJECTED ⇒ từ chối, không ghi gì", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    for (const st of ["PENDING", "REJECTED"] as const) {
      const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000, st);
      const truoc = await anhSo(rr.id);
      expect(await maLoi(chi(rr.id))).toMatch(new RegExp(`^INVALID_STATE:Yêu cầu đang ${st}`));
      expect(await anhSo(rr.id)).toEqual(truoc);
    }
  });

  it("[CHT-06] khoản đã có hoàn trước ⇒ phần đó bị trừ khỏi số còn hoàn", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    await khoan({ id: `${T}p1-hoan`, soTien: -4_000_000, ngay: "2026-08-02T03:00:00Z", accountantStatus: "REFUNDED", adjustmentOfId: `${T}p1` });
    const quaSo = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_001);
    expect(await maLoi(chi(quaSo.id))).toMatch(/^INSUFFICIENT:Chỉ còn 1\.000\.000 đ/);
    const vua = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    await chi(vua.id);
    expect((await dongHoan(vua.id)).map((d) => d.amount)).toEqual([-1_000_000]);
  });

  it("[CHT-06b] khoản MỚI NHẤT đã hoàn hết trước đó ⇒ lượt chi mới rót sang khoản cũ hơn (không trỏ vào khoản đã cạn)", async () => {
    await khoan({ id: `${T}p-cu`, soTien: 3_000_000, ngay: "2026-07-01T03:00:00Z" });
    await khoan({ id: `${T}p-moi`, soTien: 2_000_000, ngay: "2026-08-15T03:00:00Z" });
    await khoan({ id: `${T}p-moi-hoan`, soTien: -2_000_000, ngay: "2026-08-16T03:00:00Z", accountantStatus: "REFUNDED", adjustmentOfId: `${T}p-moi` });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    await chi(rr.id);
    expect((await dongHoan(rr.id)).map((d) => [d.adjustmentOfId, d.amount])).toEqual([[`${T}p-cu`, -1_000_000]]);
  });

  it("[CHT-07] khoản kế toán TỪ CHỐI / còn CHỜ không làm nguồn; khoản của BÉ KHÁC cùng đơn cũng không", async () => {
    await khoan({ id: `${T}p-tu-choi`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z", accountantStatus: "REJECTED" });
    await khoan({ id: `${T}p-cho`, soTien: 5_000_000, ngay: "2026-08-02T03:00:00Z", accountantStatus: "PENDING" });
    await khoan({ id: `${T}p-be-em`, soTien: 5_000_000, ngay: "2026-08-03T03:00:00Z", orderItemId: OI2, enrollmentId: null });
    await khoan({ id: `${T}p-that`, soTien: 1_000_000, ngay: "2026-07-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 2_000_000);
    expect(await maLoi(chi(rr.id))).toMatch(/^INSUFFICIENT:Chỉ còn 1\.000\.000 đ/);
    // Đối chứng dương: đúng 1tr thì chi được, và rót vào ĐÚNG khoản đã xác nhận.
    const rr2 = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    await chi(rr2.id);
    expect((await dongHoan(rr2.id)).map((d) => d.adjustmentOfId)).toEqual([`${T}p-that`]);
  });

  it("[CHT-08] trần RÒNG của phạm vi — tiền đã CHUYỂN sang bé khác (dòng âm không trỏ khoản) không hoàn được", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    await khoan({ id: `${T}chuyen-ra`, soTien: -3_000_000, ngay: "2026-08-05T03:00:00Z", paymentType: "ADJUSTMENT" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 2_000_001);
    expect(await maLoi(chi(rr.id))).toMatch(/^INSUFFICIENT:Chỉ còn 2\.000\.000 đ/);
    const rr2 = await hoan({ orderItemId: OI, enrollmentId: GD }, 2_000_000);
    await chi(rr2.id);
    expect((await dongHoan(rr2.id)).map((d) => d.amount)).toEqual([-2_000_000]);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[CHT-09..10] nhánh ghi danh (không dòng đơn) + đơn mơ hồ", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[CHT-09] yêu cầu chỉ có enrollmentId ⇒ nguồn = khoản của ghi danh, dòng âm mang orderItemId của NGUỒN", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z", orderItemId: null });
    const rr = await hoan({ enrollmentId: GD }, 1_500_000);
    await chi(rr.id);
    expect(await dongHoan(rr.id)).toMatchObject([
      { amount: -1_500_000, adjustmentOfId: `${T}p1`, orderItemId: null, enrollmentId: GD, orderId: DON },
    ]);
  });

  it("[CHT-10] ghi danh được trả qua HAI đơn ⇒ từ chối (không đoán đơn), không ghi gì", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z", orderItemId: null });
    await khoan({ id: `${T}p2`, soTien: 1_000_000, ngay: "2026-08-02T03:00:00Z", orderItemId: null, orderId: DON2 });
    await db.orderItem.update({ where: { id: OI }, data: { enrollmentId: null } });
    const rr = await hoan({ enrollmentId: GD }, 1_000_000);
    const truoc = await anhSo(rr.id);
    expect(await maLoi(chi(rr.id))).toMatch(/^MANY_ORDERS:/);
    expect(await anhSo(rr.id)).toEqual(truoc);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[CHT-11..12] công nợ + hoá đơn điện tử thấy khoản đã chi", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[CHT-11] đã đóng (ròng) của ghi danh giảm đúng số chi; công nợ ghi danh còn học tăng tương ứng", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const daDong = async () =>
      (await db.payment.aggregate({ where: { enrollmentId: GD, ...KHOAN_DA_DONG }, _sum: { amount: true } }))._sum.amount ?? 0;
    const butToan = () =>
      db.payment.findMany({ where: { enrollmentId: GD, ...KHOAN_DA_DONG }, select: { amount: true, accountantStatus: true } });
    expect(await daDong()).toBe(5_000_000);
    expect(computeEnrollmentDebt(9_000_000, await butToan(), "ACTIVE")).toBe(4_000_000);
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 2_000_000);
    await chi(rr.id);
    expect(await daDong()).toBe(3_000_000);
    expect(computeEnrollmentDebt(9_000_000, await butToan(), "ACTIVE")).toBe(6_000_000);
  });

  it("[CHT-12] hoá đơn ĐÃ XUẤT của khoản ⇒ sau khi chi thành 'Cần điều chỉnh' (trước khi chi: 'da-xuat')", async () => {
    await khoan({ id: `${T}p1`, soTien: 3_000_000, ngay: "2699-09-20T03:00:00Z", accountantStatus: "PENDING" });
    const nhap = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: `khoan:${T}p1`,
      khoan: [{ id: `${T}p1`, soTien: 3_000_000 }],
      loai: {
        trangThai: "NHAP",
        phapNhan: PHAP_NHAN,
        so: { kyHieu: "1C99TSR", soHoaDon: "901", ngayPhatHanh: new Date("2699-09-21T00:00:00Z") },
        guiEmailKhach: false,
        pdf: { khoa: `hoa-don/CHT/${DON}/1.pdf`, ten: "hd-cht.pdf", co: 1000, sha256: "sha-cht-1" },
        xml: null,
        theoSoDaThu: null,
        tienTha: 0,
      },
    });
    const hdTruoc = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: nhap.id }, select: { updatedAt: true } });
    const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
    const KT_CS = {
      userId: KT.id,
      isSuperAdmin: false,
      grantsAllow: new Set<string>(),
      permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }],
    } as unknown as Actor;
    await chotHoaDon({
      nguoiChot: KT,
      actor: KT_CS,
      orderId: DON,
      hoaDonId: nhap.id,
      now: XN_QUA_KHU,
      phienBan: hdTruoc.updatedAt,
      emailDuKien: nguoiMuaChoDon(donHt).email,
    });
    expect((await db.payment.findUniqueOrThrow({ where: { id: `${T}p1` } })).accountantStatus).toBe(DA_XN);

    const SIEU: Actor = {
      userId: KT.id,
      isSuperAdmin: true,
      isHoLevel: true,
      orgRoles: [],
      permissions: [],
      visibleCenterIds: [CS],
      visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(),
      assignedClassIds: new Set<string>(),
    };
    const dongHd = async () =>
      (await napHangChoHoaDon(SIEU, { canViewPii: true, orderId: DON })).dong.find((d) => d.hoaDon?.id === nhap.id)!;

    // Yêu cầu hoàn DUYỆT TRƯỚC mốc xuất (năm 2000) ⇒ vế Q1 không bật: trước khi chi, hoá đơn "da-xuat".
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    expect((await dongHd()).ngan).toBe("da-xuat");

    await chi(rr.id);
    const sau = await dongHd();
    expect(sau.ngan).toBe("can-dieu-chinh");
    expect(sau.canDieuChinh).toEqual(
      expect.arrayContaining([
        "Có hoàn tiền / điều chỉnh trên khoản sau khi đã xuất hoá đơn",
        expect.stringMatching(/^Số tiền hiện tại \(2\.000\.000đ\) khác tổng trên hoá đơn \(3\.000\.000đ\)/),
      ]),
    );
  });
});

// ─── Action ─────────────────────────────────────────────────────────────────────────────
function actorCoSo(centerId: string): Actor {
  return {
    userId: KT.id,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      { action: "orders:view", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] },
      { action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] },
    ],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[CHT-A1..A5] chiHoanTienAction — quyền, phạm vi, phương thức", () => {
  beforeEach(async () => {
    await dungFixture();
    h.auth.mockResolvedValue({ user: { id: KT.id, name: KT.name } });
    h.checkPermission.mockResolvedValue(true);
    h.resolveActor.mockResolvedValue(actorCoSo(CS));
  });
  afterAll(don);

  const goi = (rrId: string, method = PT_CHUNG, paidDate = "2026-09-20") =>
    chiHoanTienAction({ refundRequestId: rrId, method, paidDate, note: "chi qua action" });

  it("[CHT-A1] thiếu payments:confirm ⇒ từ chối, không ghi gì; hỏi ĐÚNG quyền payments:confirm", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    h.checkPermission.mockResolvedValue(false);
    const truoc = await anhSo(rr.id);
    expect(await goi(rr.id)).toEqual({ ok: false, error: "Không có quyền đánh dấu đã chi hoàn tiền" });
    expect(h.checkPermission).toHaveBeenCalledWith("payments:confirm");
    expect(await anhSo(rr.id)).toEqual(truoc);
  });

  it("[CHT-A2] kế toán CƠ SỞ KHÁC ⇒ từ chối, không ghi gì; đối chứng dương: cơ sở của đơn ⇒ PAID", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    h.resolveActor.mockResolvedValue(actorCoSo(CS2));
    const truoc = await anhSo(rr.id);
    expect(await goi(rr.id)).toEqual({ ok: false, error: "Không tìm thấy yêu cầu hoàn tiền" });
    expect(await anhSo(rr.id)).toEqual(truoc);

    h.resolveActor.mockResolvedValue(actorCoSo(CS));
    expect(await goi(rr.id)).toEqual({ ok: true });
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe("PAID");
    expect(await db.payment.count({ where: { refundRequestId: rr.id } })).toBe(1);
  });

  it("[CHT-A3] phương thức của CƠ SỞ KHÁC / ngoài danh mục ⇒ từ chối, không ghi gì", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    const truoc = await anhSo(rr.id);
    const kq1 = await goi(rr.id, PT_CS2);
    expect(kq1.ok).toBe(false);
    expect(await goi(rr.id, "KHONG_CO_MA_NAY")).toEqual({ ok: false, error: "Phương thức chi không có trong danh mục" });
    expect(await anhSo(rr.id)).toEqual(truoc);
  });

  it("[CHT-A4] ngày chi sau hôm nay / sai dạng ⇒ từ chối", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000);
    expect((await goi(rr.id, PT_CHUNG, "2699-01-01")).ok).toBe(false);
    expect((await goi(rr.id, PT_CHUNG, "20/09/2026")).ok).toBe(false);
    expect(await db.payment.count({ where: { refundRequestId: rr.id } })).toBe(0);
  });

  it("[CHT-A5] lỗi nghiệp vụ (vượt số) đi ra thành câu đọc được, không nổ", async () => {
    await khoan({ id: `${T}p1`, soTien: 5_000_000, ngay: "2026-08-01T03:00:00Z" });
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 9_000_000);
    const kq = await goi(rr.id);
    expect(kq).toEqual({ ok: false, error: expect.stringMatching(/^Chỉ còn 5\.000\.000 đ/) });
  });
});

// Lỗ CÓ SẴN (phát hiện 29/09 khi nối bước chi): Duyệt / Từ chối chỉ hỏi `payments:confirm` rồi
// gọi thẳng `approveRefund` / `rejectRefund` bằng id — KHÔNG kiểm cơ sở. Kế toán CS2 biết id là
// duyệt được (và sửa `approvedAmount`) yêu cầu hoàn của CS1. Luật tầm nhìn phải TRÙNG với
// `listRefundRequests`: ghi danh → lớp trong phạm vi, HOẶC dòng đơn → đơn trong phạm vi.
describe.skipIf(!RUN_DB_TESTS)("[CHT-A6..A7] Duyệt / Từ chối hoàn — phạm vi cơ sở", () => {
  beforeEach(async () => {
    await dungFixture();
    h.auth.mockResolvedValue({ user: { id: KT.id, name: KT.name } });
    h.checkPermission.mockResolvedValue(true);
  });
  afterAll(don);

  const trangThai = async (id: string) =>
    db.refundRequest.findUniqueOrThrow({ where: { id }, select: { status: true, approvedAmount: true, note: true } });

  for (const [ten, nguon] of [
    ["qua dòng đơn", { orderItemId: OI }],
    ["qua ghi danh (không dòng đơn)", { enrollmentId: GD }],
  ] as const) {
    it(`[CHT-A6] ${ten}: kế toán CƠ SỞ KHÁC ⇒ Duyệt / Từ chối bị từ chối, không đổi gì; đối chứng dương cơ sở của đơn`, async () => {
      const rr = await hoan(nguon, 1_000_000, "PENDING");
      const truoc = await trangThai(rr.id);

      h.resolveActor.mockResolvedValue(actorCoSo(CS2));
      expect(await approveRefundAction(rr.id, 500_000)).toEqual({ ok: false, error: "Không tìm thấy yêu cầu hoàn tiền" });
      expect(await rejectRefundAction(rr.id, "từ chối từ cơ sở khác")).toEqual({
        ok: false,
        error: "Không tìm thấy yêu cầu hoàn tiền",
      });
      expect(await trangThai(rr.id)).toEqual(truoc);

      h.resolveActor.mockResolvedValue(actorCoSo(CS));
      expect(await approveRefundAction(rr.id, 800_000)).toEqual({ ok: true });
      expect(await trangThai(rr.id)).toMatchObject({ status: "APPROVED", approvedAmount: 800_000 });
    });
  }

  it("[CHT-A7] Từ chối — đối chứng dương: kế toán cơ sở của đơn từ chối được", async () => {
    const rr = await hoan({ orderItemId: OI, enrollmentId: GD }, 1_000_000, "PENDING");
    h.resolveActor.mockResolvedValue(actorCoSo(CS));
    expect(await rejectRefundAction(rr.id, "không đủ điều kiện hoàn")).toEqual({ ok: true });
    expect((await trangThai(rr.id)).status).toBe("REJECTED");
  });
});
