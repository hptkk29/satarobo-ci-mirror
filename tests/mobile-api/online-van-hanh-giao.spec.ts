import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string } }, quyen: new Set<string>(), hoi: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => SESS.current), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: vi.fn(async (a: string) => {
    SESS.hoi.push(a);
    return SESS.quyen.has(a);
  }),
}));
// Cổng route còn đòi CẤP HỘI SỞ (đọc `resolveActor`). Bộ này đo NGHIỆP VỤ vận hành giao hàng nên giả lập đúng một người vận hành cấp Hội sở; phép phân quyền thật (RoleDef/UserOrgRole,
// v1 + v2) nằm ở `online-van-hanh-giao-quyen.spec.ts` [VHQ-*].
vi.mock("@/lib/auth/actor", async (goc) => {
  const that = await goc<typeof import("@/lib/auth/actor")>();
  return { ...that, resolveActor: vi.fn(async (id: string) => (id === "nv-kho-1" ? ({ userId: id, isSuperAdmin: true, isHoLevel: true, grantsAllow: new Set<string>(), permissions: [] } as unknown as Awaited<ReturnType<typeof that.resolveActor>>) : that.resolveActor(id))) };
});
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { GET as listGet } from "@/app/api/admin/online-fulfillment/route";
import { POST as retryPost } from "@/app/api/admin/online-fulfillment/[id]/retry/route";
import { POST as transPost } from "@/app/api/admin/online-fulfillment/[id]/transition/route";
import { GET as cronGiuKho } from "@/app/api/cron/online-giu-kho/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as datHangPost } from "@/app/api/mobile/v1/parent/cart/checkout/route";
import { POST as themPost } from "@/app/api/mobile/v1/parent/cart/items/route";
import { GET as gioGet, PATCH as gioPatch } from "@/app/api/mobile/v1/parent/cart/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { POST as huyPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { PUT as diaChiPut } from "@/app/api/mobile/v1/parent/shipping/profile/route";
import { db } from "@/lib/db";
import { quetHetHan } from "@/lib/inventory/giu-kho";
import { quetThongBaoCoHang } from "@/lib/online-checkout/danh-muc-hoc-cu";
import { tongQuanGiao } from "@/lib/online-checkout/giao-hang-van-hanh";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [VH] V8.44 — VẬN HÀNH GIAO HÀNG TỪNG DÒNG + «CÓ HÀNG LẠI» qua route + Postgres thật.
 *   [VH-01] quyền: không phiên ⇒ 401; thiếu `online_fulfillment:view-pii`/`online_fulfillment:update` ⇒ 403 (xem được ≠ ghi được; khoá kho cũ `inventory:*` không mở gì); route hỏi ĐÚNG quyền
 *   [VH-02] đường đi PAID→PACKING→SHIPPED→DELIVERED: dấu thời gian, carrier/mã vận đơn, audit từng bước, thông báo phụ huynh, app thấy `tienDo`
 *   [VH-03] chuyển sai: bỏ bước ⇒ 422; `tu` lệch ⇒ 409 + hienTai; không tồn tại ⇒ 404; trường lạ ⇒ 400; FAILED thiếu ghi chú ⇒ 422
 *   [VH-04] bấm lặp đúng đích ⇒ 200 daCo, KHÔNG audit/thông báo thứ hai
 *   [VH-05] đồng thời: 6 người cùng PACKING→SHIPPED ⇒ một audit; DELIVERED ∥ FAILED ⇒ đúng một thắng
 *   [VH-06] giao thất bại → giao lại: FAILED→SHIPPED
 *   [VH-07] giao TỪNG PHẦN: hai dòng khác tiến độ; tổng quan đơn tính ra
 *   [VH-08] NEEDS_STAFF: thử lại khi vẫn thiếu hàng ⇒ vẫn NEEDS_STAFF; bổ sung hàng ⇒ PAID, trừ tồn đúng một lần; đồng thời ⇒ một lượt
 *   [VH-09] danh sách: lọc trạng thái, phân trang theo con trỏ, trạng thái lạ ⇒ 400
 *   [CHL-01] «có hàng lại»: hết hàng ⇒ không báo; có hàng ⇒ báo MỘT lần; quét lại ⇒ 0; sản phẩm không bán Online ⇒ không báo
 *   [CHL-02] lỗi giữa chừng ⇒ KHÔNG mất lượt báo (đánh dấu cùng giao dịch với thông báo); lượt sau gửi được; có audit
 *   [CHL-03] phụ huynh chưa có con ⇒ chưa đánh dấu; có con rồi ⇒ nhận
 *   [CHL-04] nhả giữ kho (huỷ đơn) làm có hàng lại ⇒ quét báo
 *   [CHL-05] cron online-giu-kho chạy cả bước «có hàng lại»; không bí mật ⇒ 401, không báo
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "vh844-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; chiTiet?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ctxId = (id: string) => ({ params: Promise.resolve({ id }) as never });
let n = 0;

describe.skipIf(!RUN)("[VH] vận hành giao hàng + có hàng lại — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const tok: Record<string, string> = {};
  const DIA_CHI = { hoTen: "Nguyễn Văn A", soDienThoai: "0905123456", tinhThanh: "Đà Nẵng", phuongXa: "Hải Châu 1", soNhaDuong: "1 Đường Test" };
  const KHO = { id: "nv-kho-1", name: "Thủ kho Test" };
  /** Người vận hành kho cấp Hội sở: `quyen` là đúng các khoá người đó được cửa quyền cho phép. */
  const dangNhapAdmin = (quyen: string[]) => {
    SESS.current = { user: { id: KHO.id, name: KHO.name } };
    SESS.quyen = new Set(quyen);
  };
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9d00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  const sp = async (k: string, d: { ton: number; gia?: number; sellOnline?: boolean }) =>
    (ids[k] = (await db.product.create({ data: { sku: `${NS}${k}-${++n}`, name: `${NS}${k}`, category: "KIT_ROBOT", status: "ACTIVE", salePrice: d.gia ?? 100_000, stockOnHand: d.ton, sellOnline: d.sellOnline ?? true } as never, select: { id: true } })).id);
  const them = (t: string, body: unknown) => themPost(req("POST", "/x", body, bearer(t)));
  const datHang = async (t: string) => {
    const g = (await json(await gioGet(req("GET", "/x", undefined, bearer(t))))).data;
    return datHangPost(req("POST", "/x", { revision: g.revision }, bearer(t)));
  };
  const sanSang = async (k: string) => {
    expect((await diaChiPut(req("PUT", "/x", DIA_CHI, bearer(tok[k]!)))).status).toBe(200);
    expect((await gioPatch(req("PATCH", "/x", { phuongThucGiao: "T844_STD" }, bearer(tok[k]!)))).status).toBe(200);
  };
  const traTien = async (orderId: string, soTien: number) => {
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    return ingestPayosWebhook({ reference: `VH-${Date.now()}-${++n}`, description: `${phieu.matchKey} HOC PHI ONLINE`, amount: soTien, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" }, "SEPAY");
  };
  /** Một đơn học cụ ĐÃ THANH TOÁN ⇒ fulfillment PAID. Trả `{ orderId, fid, oi, productId }`. */
  const donDaTra = async (k: string, soLuong = 1, ton = 10) => {
    await sanSang(k);
    const p = await sp(`p-${k}-${n}`, { ton, gia: 100_000 });
    await them(tok[k]!, { productId: p, soLuong });
    const r = await json(await datHang(tok[k]!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect((await traTien(r.data.orderId, r.data.tongTien)).status).toBe("MATCHED");
    const oi = await db.orderItem.findFirstOrThrow({ where: { orderId: r.data.orderId, productId: p }, select: { id: true } });
    const f = await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oi.id } });
    expect(f.status).toBe("PAID");
    return { orderId: r.data.orderId as string, fid: f.id, oi: oi.id, productId: p };
  };
  const chuyen = async (fid: string, body: unknown) => transPost(req("POST", "/x", body, undefined), ctxId(fid));
  const hienTai = async (fid: string) => (await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: fid } })).status;
  const kiemToan = (fid: string, action?: string) => db.auditLog.count({ where: { module: "online-fulfillment", entityId: fid, ...(action ? { action } : {}) } });

  const xoa = async () => {
    const sps = (await db.product.findMany({ where: { sku: { startsWith: NS } }, select: { id: true } })).map((p) => p.id);
    const us = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
    const gios = (await db.cart.findMany({ where: { parentUserId: { in: us } }, select: { id: true } })).map((c) => c.id);
    await db.cartRemovedNotice.deleteMany({ where: { cartId: { in: gios } } });
    await db.cartItem.deleteMany({ where: { cartId: { in: gios } } });
    await db.cart.deleteMany({ where: { id: { in: gios } } });
    const oids = (await db.order.findMany({ where: { createdById: { in: us } }, select: { id: true } })).map((o) => o.id);
    const items = (await db.orderItem.findMany({ where: { orderId: { in: oids } }, select: { id: true } })).map((i) => i.id);
    const fids = (await db.orderItemFulfillment.findMany({ where: { orderItemId: { in: items } }, select: { id: true } })).map((f) => f.id);
    await db.auditLog.deleteMany({ where: { OR: [{ module: "online-fulfillment", entityId: { in: fids } }, { entityType: "OrderItem", entityId: { in: items } }, { module: "online-restock" }] } });
    await db.notification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: "giao:" } }, { dedupeKey: { startsWith: "restock:" } }], studentId: { startsWith: NS } } });
    await db.productReservation.deleteMany({ where: { OR: [{ productId: { in: sps } }, { orderItemId: { in: items } }] } });
    await db.orderItemFulfillment.deleteMany({ where: { orderItemId: { in: items } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oids } } } });
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: oids } } } });
    await db.payment.deleteMany({ where: { orderId: { in: oids }, adjustmentOfId: { not: null } } });
    await db.payment.deleteMany({ where: { orderId: { in: oids } } });
    await db.bankTransaction.deleteMany({ where: { providerTxnId: { contains: "VH-" } } });
    await db.productMovement.deleteMany({ where: { productId: { in: sps } } });
    await db.productRestockSubscription.deleteMany({ where: { productId: { in: sps } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: oids } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oids } } });
    await db.order.deleteMany({ where: { id: { in: oids } } });
    await db.product.deleteMany({ where: { id: { in: sps } } });
    await db.parentShippingAddress.deleteMany({ where: { parentUserId: { in: us } } });
    await db.mobileSession.deleteMany({ where: { userId: { in: us } } });
    await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: us } } });
    await db.student.deleteMany({ where: { id: { startsWith: NS } } });
    await db.authAttemptCounter.deleteMany({});
    await db.user.deleteMany({ where: { id: { in: us } } });
    await db.shippingRate.deleteMany({ where: { method: { code: { startsWith: "T844" } } } });
    await db.shippingMethod.deleteMany({ where: { code: { startsWith: "T844" } } });
    await db.shippingZone.deleteMany({ where: { code: { startsWith: "T844" } } });
  };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await xoa();
    const hash = await bcrypt.hash(MK, 4);
    let i = 0;
    for (const k of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
      ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: `8496688${String(++i).padStart(4, "0")}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
      await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[k] } as never });
      tok[k] = await dn(`096688${String(i).padStart(4, "0")}`, i);
    }
    const z = await db.shippingZone.create({ data: { code: "T844_DN", name: "Đà Nẵng", provinces: ["Đà Nẵng"] }, select: { id: true } });
    const m = await db.shippingMethod.create({ data: { code: "T844_STD", name: "Giao tiêu chuẩn", sortOrder: 1 }, select: { id: true } });
    await db.shippingRate.create({ data: { methodId: m.id, zoneId: z.id, fee: 30_000, freeAboveAmount: 5_000_000 } });
  }, 300_000);
  afterAll(async () => {
    await xoa();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 240_000);
  beforeEach(() => {
    SESS.current = null;
    SESS.quyen = new Set();
    SESS.hoi = [];
  });

  it("[VH-01] quyền: 401 không phiên; thiếu quyền ⇒ 403; xem ≠ ghi; hỏi ĐÚNG quyền kho", async () => {
    const d = await donDaTra("A");
    const body = { tu: "PAID", den: "PACKING" };
    expect((await listGet(req("GET", "/api/admin/online-fulfillment"))).status).toBe(401);
    expect((await chuyen(d.fid, body)).status).toBe(401);
    expect((await retryPost(req("POST", "/x"), ctxId(d.fid))).status).toBe(401);
    dangNhapAdmin([]); // có phiên nhưng không quyền kho (vd. giáo viên / kế toán)
    expect((await listGet(req("GET", "/api/admin/online-fulfillment"))).status).toBe(403);
    expect((await chuyen(d.fid, body)).status).toBe(403);
    expect((await retryPost(req("POST", "/x"), ctxId(d.fid))).status).toBe(403);
    dangNhapAdmin(["inventory:view", "inventory:movement", "inventory:audit"]); // đủ CẢ BA khoá kho cũ nhưng không có quyền chuyên biệt
    expect((await listGet(req("GET", "/api/admin/online-fulfillment"))).status).toBe(403);
    expect((await chuyen(d.fid, body)).status).toBe(403);
    expect((await retryPost(req("POST", "/x"), ctxId(d.fid))).status).toBe(403);
    dangNhapAdmin(["online_fulfillment:view-pii"]); // chỉ XEM
    expect((await listGet(req("GET", "/api/admin/online-fulfillment"))).status).toBe(200);
    expect((await chuyen(d.fid, body)).status).toBe(403);
    expect(await hienTai(d.fid)).toBe("PAID"); // không đổi gì
    expect(await kiemToan(d.fid)).toBe(0);
    dangNhapAdmin(["online_fulfillment:update"]); // chỉ GHI (không xem) vẫn chuyển được; danh sách thì không
    expect((await listGet(req("GET", "/api/admin/online-fulfillment"))).status).toBe(403);
    expect((await chuyen(d.fid, body)).status).toBe(200);
    expect(new Set(SESS.hoi)).toEqual(new Set(["online_fulfillment:view-pii", "online_fulfillment:update"]));
  });

  it("[VH-02] PAID→PACKING→SHIPPED→DELIVERED: dấu thời gian, vận đơn, audit, thông báo, app thấy tiến độ", async () => {
    const d = await donDaTra("B");
    dangNhapAdmin(["online_fulfillment:update"]);
    const tienDoApp = async () => (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tok.B!)), { params: Promise.resolve({ orderId: d.orderId }) as never }))).data.dongHocCu[0].tienDo;
    expect(await tienDoApp()).toBe("DA_THANH_TOAN");
    expect((await chuyen(d.fid, { tu: "PAID", den: "PACKING" })).status).toBe(200);
    expect(await tienDoApp()).toBe("DANG_CHUAN_BI");
    const ship = await json(await chuyen(d.fid, { tu: "PACKING", den: "SHIPPED", carrier: "GHN", trackingCode: "VH844-TRK-1", expectedDeliveryOn: "2026-12-01" }));
    expect(ship).toMatchObject({ ok: true, data: { trangThai: "SHIPPED", daCo: false } });
    expect(await tienDoApp()).toBe("DANG_GIAO");
    expect((await chuyen(d.fid, { tu: "SHIPPED", den: "DELIVERED" })).status).toBe(200);
    expect(await tienDoApp()).toBe("DA_GIAO");
    const f = await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: d.fid } });
    expect(f).toMatchObject({ status: "DELIVERED", carrier: "GHN", trackingCode: "VH844-TRK-1" });
    expect(f.paidAt && f.packedAt && f.shippedAt && f.deliveredAt).toBeTruthy();
    expect(f.expectedDeliveryOn?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(f.packedAt!.getTime()).toBeLessThanOrEqual(f.shippedAt!.getTime());
    expect(f.shippedAt!.getTime()).toBeLessThanOrEqual(f.deliveredAt!.getTime());
    const au = await db.auditLog.findMany({ where: { module: "online-fulfillment", entityId: d.fid }, orderBy: { createdAt: "asc" } });
    expect(au.map((x) => x.action)).toEqual(["FULFILLMENT_PACKING", "FULFILLMENT_SHIPPED", "FULFILLMENT_DELIVERED"]);
    expect(au[1]!.oldValues).toMatchObject({ status: "PACKING" });
    expect(au[1]!.newValues).toMatchObject({ status: "SHIPPED", carrier: "GHN", trackingCode: "VH844-TRK-1" });
    expect(au.map((x) => x.actorId)).toEqual([KHO.id, KHO.id, KHO.id]);
    expect(au[0]!.actorName).toBe(KHO.name);
    const tb = await db.notification.findMany({ where: { dedupeKey: { startsWith: `giao:${d.fid}:` } }, select: { dedupeKey: true, studentId: true, title: true, body: true } });
    expect(tb.map((x) => x.dedupeKey).sort()).toEqual([`giao:${d.fid}:DELIVERED`, `giao:${d.fid}:PACKING`, `giao:${d.fid}:SHIPPED`]);
    expect(new Set(tb.map((x) => x.studentId))).toEqual(new Set([`${NS}sB`]));
    expect(JSON.stringify(tb)).not.toMatch(/VH844-TRK|GHN/); // thông báo trung tính, không lộ mã vận đơn
  });

  it("[VH-03] chuyển sai: bỏ bước 422; tu lệch 409; không tồn tại 404; trường lạ 400; FAILED thiếu ghi chú 422", async () => {
    const d = await donDaTra("C");
    dangNhapAdmin(["online_fulfillment:update"]);
    const r1 = await json(await chuyen(d.fid, { tu: "PAID", den: "DELIVERED" }));
    expect([r1.ok, r1.error?.code]).toEqual([false, "CHUYEN_KHONG_HOP_LE"]);
    expect((await chuyen(d.fid, { tu: "PAID", den: "DELIVERED" })).status).toBe(422);
    expect((await chuyen(d.fid, { tu: "PAID", den: "PACKING" })).status).toBe(200);
    const cu = await chuyen(d.fid, { tu: "PAID", den: "PACKING", ghiChu: "x" }); // người khác vẫn thấy PAID — đã ở đích PACKING ⇒ idempotent
    expect(cu.status).toBe(200);
    const lech = await chuyen(d.fid, { tu: "PAID", den: "SHIPPED" }); // PAID→SHIPPED không hợp lệ
    expect(lech.status).toBe(422);
    const lech2 = await json(await chuyen(d.fid, { tu: "SHIPPED", den: "DELIVERED" })); // họ tưởng đã SHIPPED, thực tế PACKING
    expect([lech2.ok, lech2.error?.code, lech2.error?.chiTiet]).toEqual([false, "TRANG_THAI_DA_DOI", { hienTai: "PACKING" }]);
    expect(await hienTai(d.fid)).toBe("PACKING");
    expect((await chuyen("khong-co", { tu: "PAID", den: "PACKING" })).status).toBe(404);
    expect((await chuyen(d.fid, { tu: "PACKING", den: "SHIPPED", gia: 1 })).status).toBe(400);
    expect((await chuyen(d.fid, { tu: "PACKING", den: "SHIPPED", expectedDeliveryOn: "mai" })).status).toBe(400);
    expect((await transPost(new Request("http://localhost/x", { method: "POST", body: "không phải json" }), ctxId(d.fid))).status).toBe(400);
    expect((await chuyen(d.fid, { tu: "PACKING", den: "SHIPPED" })).status).toBe(200);
    expect((await chuyen(d.fid, { tu: "SHIPPED", den: "FAILED" })).status).toBe(422); // thiếu ghi chú
    expect(await hienTai(d.fid)).toBe("SHIPPED");
    expect((await chuyen(d.fid, { tu: "SHIPPED", den: "FAILED", ghiChu: "Khách không nhận máy" })).status).toBe(200);
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: d.fid } })).note).toBe("Khách không nhận máy");
    // dòng ĐÃ giao không thể quay lui
    const e = await donDaTra("D");
    for (const [tu, den] of [["PAID", "PACKING"], ["PACKING", "SHIPPED"], ["SHIPPED", "DELIVERED"]] as const) expect((await chuyen(e.fid, { tu, den })).status).toBe(200);
    expect((await chuyen(e.fid, { tu: "SHIPPED", den: "FAILED", ghiChu: "nhầm" })).status).toBe(409); // đã DELIVERED
    expect(await hienTai(e.fid)).toBe("DELIVERED");
  });

  it("[VH-04] bấm lặp đúng đích ⇒ 200 daCo, không audit/thông báo thứ hai", async () => {
    const d = await donDaTra("E");
    dangNhapAdmin(["online_fulfillment:update"]);
    const a = await json(await chuyen(d.fid, { tu: "PAID", den: "PACKING" }));
    expect(a.data).toMatchObject({ trangThai: "PACKING", daCo: false });
    const b = await json(await chuyen(d.fid, { tu: "PAID", den: "PACKING" }));
    expect(b.data).toMatchObject({ trangThai: "PACKING", daCo: true });
    expect(await kiemToan(d.fid, "FULFILLMENT_PACKING")).toBe(1);
    expect(await db.notification.count({ where: { dedupeKey: `giao:${d.fid}:PACKING` } })).toBe(1);
  });

  it("[VH-05] đồng thời: 6 người cùng PACKING→SHIPPED ⇒ MỘT audit/mã; DELIVERED ∥ FAILED ⇒ đúng một thắng", async () => {
    const d = await donDaTra("F");
    dangNhapAdmin(["online_fulfillment:update"]);
    expect((await chuyen(d.fid, { tu: "PAID", den: "PACKING" })).status).toBe(200);
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => chuyen(d.fid, { tu: "PACKING", den: "SHIPPED", carrier: "GHN", trackingCode: `VH844-RACE-${i}` })));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await kiemToan(d.fid, "FULFILLMENT_SHIPPED")).toBe(1);
    expect(await db.notification.count({ where: { dedupeKey: `giao:${d.fid}:SHIPPED` } })).toBe(1);
    const f = await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: d.fid } });
    expect(f.trackingCode).toMatch(/^VH844-RACE-[1-6]$/);
    const au = await db.auditLog.findFirstOrThrow({ where: { module: "online-fulfillment", entityId: d.fid, action: "FULFILLMENT_SHIPPED" } });
    expect((au.newValues as { trackingCode: string }).trackingCode).toBe(f.trackingCode); // audit và dòng khớp nhau
    const [x, y] = await Promise.all([chuyen(d.fid, { tu: "SHIPPED", den: "DELIVERED" }), chuyen(d.fid, { tu: "SHIPPED", den: "FAILED", ghiChu: "Không liên lạc được" })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const cuoi = await hienTai(d.fid);
    expect(["DELIVERED", "FAILED"]).toContain(cuoi);
    expect((await kiemToan(d.fid, "FULFILLMENT_DELIVERED")) + (await kiemToan(d.fid, "FULFILLMENT_FAILED"))).toBe(1);
  });

  it("[VH-06] giao thất bại → giao lại: FAILED→SHIPPED", async () => {
    const d = await donDaTra("G");
    dangNhapAdmin(["online_fulfillment:update"]);
    for (const b of [{ tu: "PAID", den: "PACKING" }, { tu: "PACKING", den: "SHIPPED", trackingCode: "VH844-L1" }, { tu: "SHIPPED", den: "FAILED", ghiChu: "Vắng nhà" }]) expect((await chuyen(d.fid, b)).status).toBe(200);
    expect(await hienTai(d.fid)).toBe("FAILED");
    const f1 = await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: d.fid } });
    expect(f1.failedAt).toBeTruthy();
    expect((await chuyen(d.fid, { tu: "FAILED", den: "SHIPPED", trackingCode: "VH844-L2" })).status).toBe(200);
    const f2 = await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: d.fid } });
    expect(f2).toMatchObject({ status: "SHIPPED", trackingCode: "VH844-L2" });
    expect(f2.shippedAt!.getTime()).toBeGreaterThanOrEqual(f1.shippedAt!.getTime());
    expect((await chuyen(d.fid, { tu: "SHIPPED", den: "DELIVERED" })).status).toBe(200);
  });

  it("[VH-07] giao TỪNG PHẦN: hai dòng khác tiến độ; tổng quan đơn tính ra", async () => {
    await sanSang("H");
    const p1 = await sp("ph1", { ton: 5 });
    const p2 = await sp("ph2", { ton: 5 });
    await them(tok.H!, { productId: p1 });
    await them(tok.H!, { productId: p2 });
    const r = await json(await datHang(tok.H!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect((await traTien(r.data.orderId, r.data.tongTien)).status).toBe("MATCHED");
    const fs = await db.orderItemFulfillment.findMany({ where: { orderItem: { orderId: r.data.orderId } }, include: { orderItem: { select: { productId: true } } } });
    expect(fs).toHaveLength(2);
    const f1 = fs.find((f) => f.orderItem.productId === p1)!;
    const f2 = fs.find((f) => f.orderItem.productId === p2)!;
    dangNhapAdmin(["online_fulfillment:update", "online_fulfillment:view-pii"]);
    for (const b of [{ tu: "PAID", den: "PACKING" }, { tu: "PACKING", den: "SHIPPED" }, { tu: "SHIPPED", den: "DELIVERED" }]) expect((await chuyen(f1.id, b)).status).toBe(200);
    expect((await chuyen(f2.id, { tu: "PAID", den: "PACKING" })).status).toBe(200);
    const ct = (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tok.H!)), { params: Promise.resolve({ orderId: r.data.orderId }) as never }))).data;
    const tien = Object.fromEntries(ct.dongHocCu.map((x: { productId: string; tienDo: string }) => [x.productId, x.tienDo]));
    expect(tien).toEqual({ [p1]: "DA_GIAO", [p2]: "DANG_CHUAN_BI" });
    expect(tongQuanGiao(fs.map(() => "DELIVERED" as const))).toBe("DA_GIAO_HET");
    expect(tongQuanGiao(["DELIVERED", "PACKING"])).toBe("GIAO_MOT_PHAN");
    expect(tongQuanGiao(["PAID", "PACKING"])).toBe("CHUA_GIAO");
    expect(tongQuanGiao(["SHIPPED", "PAID"])).toBe("GIAO_MOT_PHAN");
    expect(tongQuanGiao(["DELIVERED", "FAILED"])).toBe("CAN_XU_LY");
    expect(tongQuanGiao(["DELIVERED", "NEEDS_STAFF"])).toBe("CAN_XU_LY");
    expect(tongQuanGiao(["DELIVERED", "CANCELLED"])).toBe("DA_GIAO_HET"); // dòng đã huỷ không cản "giao hết"
    expect(tongQuanGiao(["CANCELLED"])).toBe("KHONG_CO_HANG");
    expect(tongQuanGiao([])).toBe("KHONG_CO_HANG");
  });

  it("[VH-08] NEEDS_STAFF: thử lại thiếu hàng ⇒ vẫn NEEDS_STAFF; bổ sung ⇒ PAID, trừ tồn đúng một lần; đồng thời ⇒ một lượt", async () => {
    await sanSang("I");
    const p = await sp("late", { ton: 5, gia: 100_000 });
    await them(tok.I!, { productId: p, soLuong: 2 });
    const r = await json(await datHang(tok.I!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    // giữ kho hết hạn, hàng bị bán nơi khác ⇒ tồn 0 lúc thanh toán MUỘN
    await db.productReservation.updateMany({ where: { orderItem: { orderId: r.data.orderId } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await quetHetHan(db as never, { now: new Date() });
    await db.product.update({ where: { id: p }, data: { stockOnHand: 0 } });
    expect((await traTien(r.data.orderId, r.data.tongTien)).status).toBe("MATCHED");
    const oi = await db.orderItem.findFirstOrThrow({ where: { orderId: r.data.orderId, productId: p }, select: { id: true } });
    const f = await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oi.id } });
    expect(f.status).toBe("NEEDS_STAFF");
    dangNhapAdmin(["online_fulfillment:update"]);
    // thử lại khi kho CHƯA bổ sung ⇒ vẫn cần nhân viên, tồn không âm
    const t1 = await json(await retryPost(req("POST", "/x"), ctxId(f.id)));
    expect(t1).toMatchObject({ ok: true, data: { trangThai: "NEEDS_STAFF" } });
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(0);
    // kho bổ sung 5 cái ⇒ HAI người thử lại cùng lúc ⇒ MỘT lượt thắng, trừ tồn đúng 2
    await db.product.update({ where: { id: p }, data: { stockOnHand: 5 } });
    const [a, b] = await Promise.all([retryPost(req("POST", "/x"), ctxId(f.id)), retryPost(req("POST", "/x"), ctxId(f.id))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]); // đúng MỘT người thắng, người kia nhận TRANG_THAI_DA_DOI
    expect(await hienTai(f.id)).toBe("PAID");
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(3);
    expect(await db.productMovement.count({ where: { productId: p, type: "SALE" } })).toBe(1);
    // đã PAID ⇒ thử lại nữa bị từ chối, không trừ lần hai
    const t3 = await json(await retryPost(req("POST", "/x"), ctxId(f.id)));
    expect([t3.ok, t3.error?.code, t3.error?.chiTiet]).toEqual([false, "TRANG_THAI_DA_DOI", { hienTai: "PAID" }]);
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(3);
    expect(await kiemToan(f.id, "FULFILLMENT_RETRY")).toBe(2); // lần 1 thiếu hàng + ĐÚNG MỘT lượt thắng
    expect((await retryPost(req("POST", "/x"), ctxId("khong-co"))).status).toBe(404);
  });

  it("[VH-09] danh sách: lọc trạng thái, phân trang bằng con trỏ, trạng thái lạ ⇒ 400", async () => {
    const d1 = await donDaTra("J");
    const d2 = await donDaTra("J");
    dangNhapAdmin(["online_fulfillment:view-pii", "online_fulfillment:update"]);
    expect((await chuyen(d2.fid, { tu: "PAID", den: "PACKING" })).status).toBe(200);
    const ds = async (qs: string) => (await json(await listGet(req("GET", `/api/admin/online-fulfillment${qs}`)))).data;
    const goc = await ds("?status=PAID");
    expect(goc.dong.map((x: { fulfillmentId: string }) => x.fulfillmentId)).toContain(d1.fid);
    expect(goc.dong.map((x: { fulfillmentId: string }) => x.fulfillmentId)).not.toContain(d2.fid); // d2 đã PACKING
    const mot = goc.dong.find((x: { fulfillmentId: string }) => x.fulfillmentId === d1.fid);
    expect(mot).toMatchObject({ orderId: d1.orderId, trangThai: "PAID", soLuong: 1, nguoiNhan: { hoTen: "Nguyễn Văn A", soDienThoai: "0905123456", diaChi: "1 Đường Test, Hải Châu 1, Đà Nẵng" } });
    const hai = await ds("?status=PAID,PACKING&take=1");
    expect(hai.dong).toHaveLength(1);
    expect(hai.tiep).toBe(hai.dong[0].fulfillmentId);
    const tiep = await ds(`?status=PAID,PACKING&take=1&after=${hai.tiep}`);
    expect(tiep.dong.length).toBeGreaterThanOrEqual(1);
    expect(tiep.dong[0].fulfillmentId > hai.dong[0].fulfillmentId).toBe(true);
    expect((await listGet(req("GET", "/api/admin/online-fulfillment?status=BAY"))).status).toBe(400);
    const macDinh = await ds("");
    expect(macDinh.dong.every((x: { trangThai: string }) => ["PAID", "PACKING", "SHIPPED", "FAILED", "NEEDS_STAFF"].includes(x.trangThai))).toBe(true);
  });

  // ───────────── «CÓ HÀNG LẠI» ─────────────
  const dangKy = async (k: string, p: string) => {
    await db.productRestockSubscription.upsert({ where: { productId_parentUserId: { productId: p, parentUserId: ids[k]! } }, create: { productId: p, parentUserId: ids[k]!, createdAt: new Date() }, update: { notifiedAt: null } });
  };
  const soBao = (p: string) => db.notification.count({ where: { dedupeKey: { startsWith: `restock:${p}:` } } });

  it("[CHL-01] hết hàng ⇒ không báo; có hàng ⇒ báo MỘT lần; quét lại ⇒ 0; sản phẩm không bán Online ⇒ không báo", async () => {
    const p = await sp("rs1", { ton: 0 });
    const kinh = await sp("rs-tat", { ton: 0, sellOnline: false });
    await dangKy("A", p);
    await dangKy("B", p);
    await dangKy("A", kinh);
    const now = new Date();
    expect(await quetThongBaoCoHang(db as never, { now })).toMatchObject({ daGui: 0, loi: 0 });
    expect(await soBao(p)).toBe(0);
    await db.product.update({ where: { id: p }, data: { stockOnHand: 3 } });
    await db.product.update({ where: { id: kinh }, data: { stockOnHand: 3 } }); // có hàng nhưng KHÔNG bán Online
    const kq = await quetThongBaoCoHang(db as never, { now });
    expect(kq.daGui).toBe(2);
    expect(await soBao(p)).toBe(2);
    expect(await soBao(kinh)).toBe(0);
    expect(await db.productRestockSubscription.count({ where: { productId: kinh, notifiedAt: null } })).toBe(1); // vẫn chờ
    expect((await quetThongBaoCoHang(db as never, { now })).daGui).toBe(0);
    const song = await Promise.all([quetThongBaoCoHang(db as never, { now }), quetThongBaoCoHang(db as never, { now })]);
    expect(song[0].daGui + song[1].daGui).toBe(0);
    // hết hàng rồi đăng ký lại, có hàng ⇒ báo lại đúng một lần
    await db.product.update({ where: { id: p }, data: { stockOnHand: 0 } });
    await dangKy("A", p);
    expect((await quetThongBaoCoHang(db as never, { now })).daGui).toBe(0);
    await db.product.update({ where: { id: p }, data: { stockOnHand: 1 } });
    const dua = await Promise.all([quetThongBaoCoHang(db as never, { now }), quetThongBaoCoHang(db as never, { now })]); // hai lượt quét cùng lúc trên MỘT đăng ký còn chờ
    expect(dua[0].daGui + dua[1].daGui).toBe(1);
    expect(await db.auditLog.count({ where: { module: "online-restock", entityId: (await db.productRestockSubscription.findFirstOrThrow({ where: { productId: p, parentUserId: ids.A } })).id } })).toBeGreaterThanOrEqual(1);
  });

  it("[CHL-02] lỗi giữa chừng KHÔNG mất lượt báo: đánh dấu + thông báo cùng giao dịch; lượt sau gửi được; có audit", async () => {
    const p = await sp("rs2", { ton: 5 });
    await dangKy("C", p);
    const hong = new Proxy(db, {
      get(t, k) {
        if (k === "$transaction") {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            (t as never as { $transaction: (f: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction((tx) =>
              fn(new Proxy(tx as object, { get: (tt, kk) => (kk === "notification" ? { createMany: () => Promise.reject(new Error("hạ tầng lỗi")) } : (tt as Record<string | symbol, unknown>)[kk]) })),
            );
        }
        return (t as never as Record<string | symbol, unknown>)[k];
      },
    });
    const kq = await quetThongBaoCoHang(hong as never, { now: new Date() });
    expect(kq.loi).toBeGreaterThanOrEqual(1);
    expect(await db.productRestockSubscription.count({ where: { productId: p, notifiedAt: null } })).toBe(1); // KHÔNG bị đánh dấu đã báo
    expect(await soBao(p)).toBe(0);
    expect((await quetThongBaoCoHang(db as never, { now: new Date() })).daGui).toBeGreaterThanOrEqual(1);
    expect(await soBao(p)).toBe(1);
    const sub = await db.productRestockSubscription.findFirstOrThrow({ where: { productId: p } });
    expect(sub.notifiedAt).toBeTruthy();
    expect(await db.auditLog.count({ where: { module: "online-restock", action: "RESTOCK_NOTIFIED", entityId: sub.id } })).toBe(1);
  });

  it("[CHL-03] phụ huynh chưa có con ⇒ chưa đánh dấu đã báo; có con rồi ⇒ nhận", async () => {
    const p = await sp("rs3", { ton: 5 });
    await db.student.deleteMany({ where: { id: `${NS}sD` } });
    await dangKy("D", p);
    expect((await quetThongBaoCoHang(db as never, { now: new Date() })).daGui).toBe(0);
    expect(await db.productRestockSubscription.count({ where: { productId: p, notifiedAt: null } })).toBe(1);
    await db.student.create({ data: { id: `${NS}sD`, name: "Bé D", parentUserId: ids.D } as never });
    expect((await quetThongBaoCoHang(db as never, { now: new Date() })).daGui).toBe(1);
    expect(await soBao(p)).toBe(1);
  });

  it("[CHL-04] nhả giữ kho (huỷ đơn) làm có hàng lại ⇒ quét báo; còn bị giữ ⇒ không báo", async () => {
    await sanSang("E");
    const p = await sp("rs4", { ton: 1, gia: 100_000 });
    await them(tok.E!, { productId: p });
    const r = await json(await datHang(tok.E!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true); // đơn giữ 1/1 ⇒ khả dụng 0
    await dangKy("F", p);
    expect((await quetThongBaoCoHang(db as never, { now: new Date() })).daGui).toBe(0); // đang bị giữ ⇒ chưa có hàng thật
    expect(await soBao(p)).toBe(0);
    expect((await huyPost(req("POST", "/x", {}, bearer(tok.E!)), { params: Promise.resolve({ orderId: r.data.orderId }) as never })).status).toBe(200);
    expect((await quetThongBaoCoHang(db as never, { now: new Date() })).daGui).toBe(1);
    expect(await soBao(p)).toBe(1);
  });

  it("[CHL-05] cron online-giu-kho chạy cả «có hàng lại»; thiếu bí mật ⇒ 401 và KHÔNG báo", async () => {
    process.env.CRON_SECRET = "cron-secret-test-vh844-32-ky-tu-tro-len-xxxxxxxx";
    try {
      const p = await sp("rs5", { ton: 0 });
      await dangKy("G", p);
      await db.product.update({ where: { id: p }, data: { stockOnHand: 2 } });
      const goi = (kem: boolean) => cronGiuKho(new Request("http://localhost/api/cron/online-giu-kho", { headers: kem ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {} }) as never);
      expect((await goi(false)).status).toBe(401);
      expect(await soBao(p)).toBe(0);
      const r = await json(await goi(true));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.data.coHangLai.daGui).toBeGreaterThanOrEqual(1);
      expect(await soBao(p)).toBe(1);
      expect((await json(await goi(true))).data.coHangLai.daGui).toBe(0); // chạy lại không báo thêm
      expect(await soBao(p)).toBe(1);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
