import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tầng dịch vụ không cần phiên; mock chỉ để import không kéo `next-auth` vào Node thuần.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { db } from "@/lib/db";
import { chuyenTienDoGiao, HTTP_LOI_VAN_HANH, thuLaiDongCanXuLy } from "@/lib/online-checkout/giao-hang-van-hanh";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb } from "../e2e/_helpers/seed";

/**
 * [VHT-DB] CHẶN CHUYỂN TRẠNG THÁI GIAO HÀNG SAI + NHẬT KÝ — Postgres thật, đo ở tầng dịch vụ (quyền đã có `[VHQ-*]`).
 *   [VHT-01] đơn huỷ / đã hoàn / nháp / đã xoá mềm ⇒ KHÔNG đóng gói, KHÔNG giao (PAID→PACKING, PACKING→SHIPPED, FAILED→SHIPPED)
 *   [VHT-02] đơn huỷ: vẫn ghi được SỰ THẬT của hàng đã đi (SHIPPED→DELIVERED / FAILED) và đóng dòng thiếu hàng (NEEDS_STAFF→CANCELLED)
 *   [VHT-03] bảng chuyển trạng thái: bước sai ⇒ từ chối, không ghi · [VHT-04] mọi lần TỪ CHỐI chuyển trạng thái trên dòng có thật đều có nhật ký
 *   [VHT-05] đối chứng: đường đi đúng ⇒ mỗi bước một nhật ký, không nhật ký từ chối
 *   [VHT-06] «thử lại» trên đơn không còn đủ điều kiện (huỷ / chưa thu đủ) ⇒ từ chối, dòng GIỮ NEEDS_STAFF + ghi chú (không kẹt ở AWAITING_PAYMENT)
 *   [VHT-07] «thử lại» thành công ⇒ nhật ký ghi cả KẾT QUẢ cuối (PAID), trừ tồn đúng một lần
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "vhttest-";
const NGUOI = { id: `${NS}kho`, ten: "Thủ kho thử" };
const GIA = 100_000;

async function don() {
  const oid = (await db.order.findMany({ where: { code: { startsWith: NS } }, select: { id: true } })).map((o) => o.id);
  const items = (await db.orderItem.findMany({ where: { orderId: { in: oid } }, select: { id: true } })).map((i) => i.id);
  const fids = (await db.orderItemFulfillment.findMany({ where: { orderItemId: { in: items } }, select: { id: true } })).map((f) => f.id);
  const sps = (await db.product.findMany({ where: { sku: { startsWith: NS } }, select: { id: true } })).map((p) => p.id);
  await db.auditLog.deleteMany({ where: { entityId: { in: [...fids, ...items] } } });
  await db.productReservation.deleteMany({ where: { OR: [{ orderItemId: { in: items } }, { productId: { in: sps } }] } });
  await db.productMovement.deleteMany({ where: { productId: { in: sps } } });
  await db.orderItemFulfillment.deleteMany({ where: { orderItemId: { in: items } } });
  await db.payment.deleteMany({ where: { orderId: { in: oid } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
  await db.order.deleteMany({ where: { id: { in: oid } } });
  await db.product.deleteMany({ where: { id: { in: sps } } });
}

describe.skipIf(!RUN)("[VHT-DB] chặn chuyển trạng thái giao hàng sai + nhật ký", () => {
  let spId = "";
  let dem = 0;

  beforeAll(async () => {
    assertTestDb();
    await don();
    spId = (await db.product.create({ data: { sku: `${NS}sp`, name: `${NS}Bộ học cụ`, category: "KIT_ROBOT", status: "ACTIVE", salePrice: GIA, stockOnHand: 50 } as never, select: { id: true } })).id;
  }, 120_000);
  afterAll(async () => {
    await don();
  });
  beforeEach(async () => {
    await db.product.update({ where: { id: spId }, data: { stockOnHand: 50 } });
  });

  type TrangThaiDon = "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "REFUNDED" | "DRAFT";
  /** Một đơn Online học cụ mới với một dòng giao hàng ở trạng thái `giao`. `daThu` = số tiền đã ghi nhận. */
  const dung = async (o: { don?: TrangThaiDon; daXoa?: boolean; giao: "PAID" | "PACKING" | "SHIPPED" | "FAILED" | "NEEDS_STAFF"; daThu?: number }) => {
    dem += 1;
    const d = await db.order.create({
      data: { code: `${NS}DH${Date.now()}-${dem}`, type: "ONLINE", status: o.don ?? "CONFIRMED", deletedAt: o.daXoa ? new Date() : null, customerName: `${NS}PH`, customerPhone: "0905888222", centerId: null, subtotal: GIA, totalAmount: GIA } as never,
      select: { id: true },
    });
    const dong = await db.orderItem.create({ data: { orderId: d.id, type: "PRODUCT", productId: spId, itemName: `${NS}Bộ học cụ`, quantity: 1, unitPrice: GIA, totalPrice: GIA }, select: { id: true } });
    if ((o.daThu ?? GIA) > 0) await db.payment.create({ data: { orderId: d.id, amount: o.daThu ?? GIA, method: "BANK_TRANSFER", paidDate: new Date() } });
    const luc = new Date();
    const f = await db.orderItemFulfillment.create({
      data: {
        orderItemId: dong.id,
        status: o.giao,
        paidAt: luc,
        ...(o.giao === "PACKING" || o.giao === "SHIPPED" || o.giao === "FAILED" ? { packedAt: luc } : {}),
        ...(o.giao === "SHIPPED" || o.giao === "FAILED" ? { shippedAt: luc } : {}),
        ...(o.giao === "FAILED" ? { failedAt: luc } : {}),
        ...(o.giao === "NEEDS_STAFF" ? { note: "Đã thu tiền nhưng hết hàng" } : {}),
      },
      select: { id: true },
    });
    if (o.giao === "NEEDS_STAFF") await db.productReservation.create({ data: { productId: spId, orderItemId: dong.id, quantity: 1, status: "EXPIRED", expiresAt: new Date(Date.now() - 60_000), releasedAt: new Date(), reason: "HET_HAN_GIU_KHO" } });
    return { fid: f.id, dongId: dong.id, orderId: d.id };
  };
  const chuyen = (fid: string, tu: string, den: string, them: Record<string, string> = {}) => chuyenTienDoGiao(db, NGUOI, fid, { tu, den, ...them }, new Date());
  const dongGiao = (fid: string) => db.orderItemFulfillment.findUniqueOrThrow({ where: { id: fid }, select: { status: true, note: true, packedAt: true, shippedAt: true } });
  const nhatKy = async (fid: string) => (await db.auditLog.findMany({ where: { module: "online-fulfillment", entityId: fid }, orderBy: { createdAt: "asc" }, select: { action: true, actorId: true, oldValues: true, newValues: true } })) as Array<{ action: string; actorId: string | null; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null }>;

  const KHONG_HIEU_LUC: Array<[string, { don?: TrangThaiDon; daXoa?: boolean }]> = [
    ["đơn đã huỷ", { don: "CANCELLED" }],
    ["đơn đã hoàn tiền", { don: "REFUNDED" }],
    ["đơn nháp", { don: "DRAFT" }],
    ["đơn đã xoá mềm", { daXoa: true }],
  ];
  const BUOC_GIAO: Array<["PAID" | "PACKING" | "FAILED", string]> = [
    ["PAID", "PACKING"],
    ["PACKING", "SHIPPED"],
    ["FAILED", "SHIPPED"],
  ];

  it.each(KHONG_HIEU_LUC)("[VHT-01] %s ⇒ không đóng gói / không giao được, dòng không đổi, có nhật ký từ chối", async (_ten, o) => {
    for (const [tu, den] of BUOC_GIAO) {
      const x = await dung({ ...o, giao: tu });
      const r = await chuyen(x.fid, tu, den);
      expect({ buoc: `${tu}→${den}`, ok: r.ok, ma: r.ok ? null : r.ma }).toEqual({ buoc: `${tu}→${den}`, ok: false, ma: "DON_KHONG_DU_DIEU_KIEN" });
      expect((await dongGiao(x.fid)).status).toBe(tu);
      expect((await nhatKy(x.fid)).map((a) => a.action)).toEqual(["FULFILLMENT_TU_CHOI"]);
    }
    expect(HTTP_LOI_VAN_HANH.DON_KHONG_DU_DIEU_KIEN).toBe(409);
  });

  it("[VHT-02] đơn đã huỷ: vẫn ghi được hàng đã đi tới đâu và đóng dòng thiếu hàng", async () => {
    const a = await dung({ don: "CANCELLED", giao: "SHIPPED" });
    expect(await chuyen(a.fid, "SHIPPED", "DELIVERED")).toMatchObject({ ok: true });
    const b = await dung({ don: "CANCELLED", giao: "SHIPPED" });
    expect(await chuyen(b.fid, "SHIPPED", "FAILED", { ghiChu: "Khách từ chối nhận" })).toMatchObject({ ok: true });
    const c = await dung({ don: "CANCELLED", giao: "NEEDS_STAFF" });
    expect(await chuyen(c.fid, "NEEDS_STAFF", "CANCELLED", { ghiChu: "Đơn đã huỷ" })).toMatchObject({ ok: true });
  });

  it("[VHT-03] bước sai bảng chuyển ⇒ từ chối, không ghi dấu thời gian", async () => {
    const x = await dung({ giao: "PAID" });
    for (const [tu, den] of [["PAID", "SHIPPED"], ["PAID", "DELIVERED"], ["PAID", "CANCELLED"], ["PACKING", "DELIVERED"], ["SHIPPED", "PACKING"], ["NEEDS_STAFF", "SHIPPED"]] as const) {
      const r = await chuyen(x.fid, tu, den, { ghiChu: "thử bước sai" });
      expect({ buoc: `${tu}→${den}`, ma: r.ok ? null : r.ma }).toEqual({ buoc: `${tu}→${den}`, ma: "CHUYEN_KHONG_HOP_LE" });
    }
    expect(await dongGiao(x.fid)).toMatchObject({ status: "PAID", packedAt: null, shippedAt: null });
  });

  it("[VHT-04] lần từ chối trên dòng có thật được ghi nhật ký (ai, từ đâu, muốn đi đâu, vì sao); id lạ không ghi gì", async () => {
    const x = await dung({ giao: "PAID" });
    await chuyen(x.fid, "PAID", "SHIPPED");
    await chuyen(x.fid, "PACKING", "SHIPPED"); // `tu` lệch trạng thái thật
    const nk = await nhatKy(x.fid);
    expect(nk.map((a) => [a.action, a.actorId, a.oldValues?.status, a.newValues?.tu, a.newValues?.den, a.newValues?.ma])).toEqual([
      ["FULFILLMENT_TU_CHOI", NGUOI.id, "PAID", "PAID", "SHIPPED", "CHUYEN_KHONG_HOP_LE"],
      ["FULFILLMENT_TU_CHOI", NGUOI.id, "PAID", "PACKING", "SHIPPED", "TRANG_THAI_DA_DOI"],
    ]);
    const truoc = await db.auditLog.count({ where: { module: "online-fulfillment" } });
    expect(await chuyen("khong-co-dong", "PAID", "SHIPPED")).toMatchObject({ ok: false });
    expect(await chuyen("khong-co-dong", "PAID", "PACKING")).toMatchObject({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await db.auditLog.count({ where: { module: "online-fulfillment" } })).toBe(truoc);
  });

  it("[VHT-05] đối chứng: PAID→PACKING→SHIPPED→DELIVERED mỗi bước một nhật ký, bấm lặp không thêm", async () => {
    const x = await dung({ giao: "PAID" });
    for (const [tu, den] of [["PAID", "PACKING"], ["PACKING", "SHIPPED"], ["SHIPPED", "DELIVERED"]] as const) expect(await chuyen(x.fid, tu, den)).toMatchObject({ ok: true, daCo: false });
    expect(await chuyen(x.fid, "SHIPPED", "DELIVERED")).toMatchObject({ ok: true, daCo: true });
    expect((await nhatKy(x.fid)).map((a) => a.action)).toEqual(["FULFILLMENT_PACKING", "FULFILLMENT_SHIPPED", "FULFILLMENT_DELIVERED"]);
  });

  it.each([
    ["đơn đã huỷ", { don: "CANCELLED" as const }],
    ["đơn chưa thu đủ", { don: "PENDING_PAYMENT" as const, daThu: 0 }],
    ["đơn đã xoá mềm", { daXoa: true }],
  ])("[VHT-06] «thử lại» khi %s ⇒ từ chối, dòng giữ NEEDS_STAFF và ghi chú", async (_ten, o) => {
    const x = await dung({ ...o, giao: "NEEDS_STAFF" });
    const r = await thuLaiDongCanXuLy(db, NGUOI, x.fid, new Date());
    expect(await dongGiao(x.fid)).toMatchObject({ status: "NEEDS_STAFF", note: "Đã thu tiền nhưng hết hàng" });
    expect({ ok: r.ok, ma: r.ok ? null : r.ma }).toEqual({ ok: false, ma: "DON_KHONG_DU_DIEU_KIEN" });
    expect((await nhatKy(x.fid)).map((a) => a.action)).toEqual(["FULFILLMENT_TU_CHOI"]);
    expect((await db.product.findUniqueOrThrow({ where: { id: spId } })).stockOnHand).toBe(50);
  });

  it("[VHT-07] «thử lại» thành công ⇒ PAID, trừ tồn một lần, nhật ký ghi cả kết quả cuối", async () => {
    const x = await dung({ giao: "NEEDS_STAFF" });
    expect(await thuLaiDongCanXuLy(db, NGUOI, x.fid, new Date())).toEqual({ ok: true, trangThai: "PAID" });
    expect((await db.product.findUniqueOrThrow({ where: { id: spId } })).stockOnHand).toBe(49);
    const nk = await nhatKy(x.fid);
    expect(nk.map((a) => [a.action, a.oldValues?.status, a.newValues?.status])).toEqual([
      ["FULFILLMENT_RETRY", "NEEDS_STAFF", "AWAITING_PAYMENT"],
      ["FULFILLMENT_RETRY_KET_QUA", "AWAITING_PAYMENT", "PAID"],
    ]);
    expect(nk.every((a) => a.actorId === NGUOI.id)).toBe(true);
  });
});
