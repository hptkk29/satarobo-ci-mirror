import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as datHangPost } from "@/app/api/mobile/v1/parent/cart/checkout/route";
import { POST as themPost } from "@/app/api/mobile/v1/parent/cart/items/route";
import { GET as gioGet, PATCH as gioPatch } from "@/app/api/mobile/v1/parent/cart/route";
import { POST as huyPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { GET as cronGiuKho } from "@/app/api/cron/online-giu-kho/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { PUT as diaChiPut } from "@/app/api/mobile/v1/parent/shipping/profile/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { hoanTatHangSauThanhToan } from "@/lib/online-checkout/hang-sau-thanh-toan";
import { chotHocCu, ghiHocCu, LoiGiaDoi } from "@/lib/online-checkout/tao-don-hoc-cu";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { quetHetHan } from "@/lib/inventory/giu-kho";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [DHH] V8.43 — ĐẶT HÀNG HỖN HỢP (khoá Online + học cụ) qua route phụ huynh + Postgres thật.
 *   [DHH-01] chỉ học cụ: đơn PRODUCT + phí giao + ảnh chụp địa chỉ; giữ kho ACTIVE cùng giao dịch; fulfillment AWAITING_PAYMENT; một phiếu thu = tổng gồm phí; dòng giỏ đã đặt rời giỏ
 *   [DHH-02] hỗn hợp khoá + học cụ: một đơn, một phiếu thu; tổng = khoá − giảm + hàng + phí
 *   [DHH-03] thiếu địa chỉ / chưa chọn phương thức giao ⇒ 422, KHÔNG đơn, KHÔNG giữ kho
 *   [DHH-04] bấm đúp cùng revision ⇒ đơn cũ (daCo), không giữ kho lần hai; đổi bộ học cụ ⇒ KHÔNG nhận nhầm đơn cũ
 *   [DHH-05] giá TĂNG sau khi vào giỏ ⇒ GIA_DA_TANG 409 (không đơn); xác nhận ⇒ đơn theo giá mới
 *   [DHH-06] tranh hàng: nhiều phụ huynh cùng đặt phần tồn ít ⇒ đúng bằng tồn thành công, còn lại HET_HANG kèm thieu[], không oversell, không đơn nửa vời
 *   [DHH-07] huỷ đơn nhả giữ kho + fulfillment CANCELLED; huỷ lặp idempotent
 *   [DHH-08] học cụ không bán Online giữa chừng ⇒ không đơn (khoá Offline không có đường vào)
 *   [DHH-10] phòng thủ lõi: giá lệch giữa lúc chốt và lúc ghi ⇒ LoiGiaDoi (rollback); chốt học cụ chặn sản phẩm không bán Online; giữ kho đã nhả/hết hạn hiện đúng ở chi tiết
 *   [DHH-11] cùng cặp khoá đang chờ + thêm học cụ ⇒ DA_CO_DON_DANG_CHO, KHÔNG trả lại đơn cũ thiếu hàng
 *   [DHH-12] THANH TOÁN ĐỦ (webhook thật) ⇒ trừ tồn một lần, giữ kho CONSUMED, fulfillment PAID, ProductMovement SALE; webhook lặp / gọi lại cầu nối ⇒ KHÔNG trừ hai lần; khoá học cùng đơn được cấp quyền
 *   [DHH-13] chưa thu đủ ⇒ KHÔNG tiêu thụ (tồn nguyên, fulfillment AWAITING_PAYMENT)
 *   [DHH-14] thanh toán MUỘN: giữ kho hết hạn + hết hàng ⇒ NEEDS_STAFF, tiền giữ, tồn không âm; hết hạn nhưng còn hàng ⇒ vẫn bán
 *   [DHH-15] cron online-giu-kho: không có/sai bí mật ⇒ 401; quét giữ kho hết hạn (ACTIVE→EXPIRED); thử lại hàng ĐÃ THU mà hích bị mất ⇒ PAID, trừ tồn đúng một lần; chạy lại không đổi gì
 *   [DHH-16] ALL-OR-NOTHING MẶC ĐỊNH (V8.44 Owner): checkout KHÔNG gửi itemIds mà giỏ có dòng không đặt được ⇒ 409 KHONG_CO_DONG_DE_DAT + cartItemIds, KHÔNG đơn, KHÔNG giữ kho, giỏ nguyên; gửi itemIds của dòng tốt ⇒ đơn đúng tổng đã thấy
 *   [DHH-17] ALL-OR-NOTHING cho dòng KHOÁ: khoá tạm ngừng bán sau khi vào giỏ ⇒ 409 + cartItemIds (dòng khoá), KHÔNG đơn kể cả dòng học cụ tốt; gỡ dòng khoá/itemIds ⇒ đơn học cụ
 *   [DHH-09] chi tiết đơn hỗn hợp: `dong` CHỈ là khoá, học cụ ở `dongHocCu` (tiến độ giao, giữ kho còn hạn, địa chỉ chụp); người khác ⇒ 404; sau huỷ không còn giuKho
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "dhh843-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; chiTiet?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
let n = 0;

// Làm ấm đủ 5 kết nối của pool TRƯỚC mỗi đợt bắn: pool nguội ⇒ lượt đầu commit xong trước khi các lượt sau mở được kết nối ⇒ «song song» thực ra là nối tiếp và ca không bắt được tranh chấp.
const amPool = () => Promise.all(Array.from({ length: 5 }, () => db.$queryRaw`SELECT pg_sleep(0.05)::text AS x`));

describe.skipIf(!RUN)("[DHH] đặt hàng hỗn hợp — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const tok: Record<string, string> = {};
  const DIA_CHI = { hoTen: "Nguyễn Văn A", soDienThoai: "0905123456", tinhThanh: "Đà Nẵng", phuongXa: "Hải Châu 1", soNhaDuong: "1 Đường Test" };
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9e00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  const sp = async (k: string, d: { ton: number; gia?: number; toiDa?: number }) =>
    (ids[k] = (await db.product.create({ data: { sku: `${NS}${k}`, name: `${NS}${k}`, category: "KIT_ROBOT", status: "ACTIVE", salePrice: d.gia ?? 100_000, stockOnHand: d.ton, sellOnline: true, ...(d.toiDa ? { onlineMaxQty: d.toiDa } : {}) } as never, select: { id: true } })).id);
  async function dungKhoa(gia: number) {
    const t = await taoKhoa(db as never, { code: `DHH843-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: false, renewalPrice: null } as never, null);
    if (!t.ok) throw new Error(t.thongBao);
    const ch = await themChuong(db as never, { versionId: t.draftVersionId, title: "C1" });
    if (!ch.ok) throw new Error("chuong");
    const b = await themBai(db as never, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung" } });
    if (!b.ok) throw new Error("bai");
    const l = await luuCaiDat(db as never, { versionId: t.draftVersionId, caiDat: caiDatKhoiDauChoBanNhap() });
    if (!l.ok) throw new Error(l.thongBao);
    const xt = await xemTruocPhatHanh(db as never, t.courseId, null);
    if (!xt.ok) throw new Error(xt.thongBao);
    const ph = await phatHanh(db as never, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, new Date());
    if (!ph.ok) throw new Error(ph.thongBao);
    await doiTrangThaiBan(db as never, { courseId: t.courseId, saleStatus: "ON_SALE" });
    return t.courseId;
  }
  const them = (t: string, body: unknown) => themPost(req("POST", "/x", body, bearer(t)));
  const gio = async (t: string) => (await json(await gioGet(req("GET", "/x", undefined, bearer(t))))).data;
  // V8.44: checkout là ALL-OR-NOTHING theo snapshot ⇒ app gửi `itemIds` của các dòng người mua đang thấy SẴN SÀNG; helper làm y như app (giỏ dùng chung giữa ca còn dòng cũ không đặt được).
  const datHang = async (t: string, body?: Record<string, unknown>) => {
    const g = await gio(t);
    const sanSang = (g.dong as Array<{ itemId: string; trangThai: string }>).filter((x) => x.trangThai === "SAN_SANG").map((x) => x.itemId);
    return datHangPost(req("POST", "/x", { revision: g.revision, itemIds: sanSang, ...body }, bearer(t)));
  };
  const chonGiao = (t: string, ma0: string | null) => gioPatch(req("PATCH", "/x", { phuongThucGiao: ma0 }, bearer(t)));
  const choPhuHuynhSanSang = async (k: string) => {
    expect((await diaChiPut(req("PUT", "/x", DIA_CHI, bearer(tok[k]!)))).status).toBe(200);
    expect((await chonGiao(tok[k]!, "T843H_STD")).status).toBe(200);
  };

  const xoa = async () => {
    const sps = (await db.product.findMany({ where: { sku: { startsWith: NS } }, select: { id: true } })).map((p) => p.id);
    const us = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
    const gios = (await db.cart.findMany({ where: { parentUserId: { in: us } }, select: { id: true } })).map((c) => c.id);
    await db.cartRemovedNotice.deleteMany({ where: { cartId: { in: gios } } });
    await db.cartItem.deleteMany({ where: { cartId: { in: gios } } });
    await db.cart.deleteMany({ where: { id: { in: gios } } });
    const oids = (await db.order.findMany({ where: { createdById: { in: us } }, select: { id: true } })).map((o) => o.id);
    const items = (await db.orderItem.findMany({ where: { orderId: { in: oids } }, select: { id: true } })).map((i) => i.id);
    await db.productReservation.deleteMany({ where: { OR: [{ productId: { in: sps } }, { orderItemId: { in: items } }] } });
    await db.orderItemFulfillment.deleteMany({ where: { orderItemId: { in: items } } });
    await db.orderOnlineGrant.deleteMany({ where: { orderId: { in: oids } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oids } } } });
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: oids } } } });
    await db.payment.deleteMany({ where: { orderId: { in: oids }, adjustmentOfId: { not: null } } });
    await db.payment.deleteMany({ where: { orderId: { in: oids } } });
    await db.bankTransaction.deleteMany({ where: { providerTxnId: { contains: "DHH-" } } });
    await db.productMovement.deleteMany({ where: { productId: { in: sps } } });
    await db.productRestockSubscription.deleteMany({ where: { productId: { in: sps } } });
    await donBangOnl(db);
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
    await db.shippingRate.deleteMany({ where: { method: { code: { startsWith: "T843H" } } } });
    await db.shippingMethod.deleteMany({ where: { code: { startsWith: "T843H" } } });
    await db.shippingZone.deleteMany({ where: { code: { startsWith: "T843H" } } });
  };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await xoa();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    const phs = ["A", "B", "C", "D", "E", "F", "G"];
    let i = 0;
    for (const k of phs) {
      await mk(k, `8496699${String(++i).padStart(4, "0")}`);
      await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[k] } as never });
      tok[k] = await dn(`096699${String(i).padStart(4, "0")}`, i);
    }
    // Cấu hình giao hàng TEST (không phải chính sách): Đà Nẵng, tiêu chuẩn 30.000đ, miễn phí từ 5.000.000đ.
    const z = await db.shippingZone.create({ data: { code: "T843H_DN", name: "Đà Nẵng", provinces: ["Đà Nẵng"] }, select: { id: true } });
    const m = await db.shippingMethod.create({ data: { code: "T843H_STD", name: "Giao tiêu chuẩn", sortOrder: 1 }, select: { id: true } });
    await db.shippingRate.create({ data: { methodId: m.id, zoneId: z.id, fee: 30_000, freeAboveAmount: 5_000_000 } });
  }, 300_000);
  afterAll(async () => {
    await xoa();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 240_000);

  it("[DHH-01] chỉ học cụ: đơn PRODUCT + phí giao + ảnh chụp địa chỉ; giữ kho cùng giao dịch; một phiếu thu = tổng", async () => {
    await choPhuHuynhSanSang("A");
    const p = await sp("robot", { ton: 10, gia: 400_000 });
    await them(tok.A!, { productId: p, soLuong: 2 });
    const r = await json(await datHang(tok.A!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const d = r.data;
    expect(d).toMatchObject({ tongTien: 830_000, phiVanChuyen: 30_000, giuKho: { trangThai: "DANG_GIU" } });
    expect(typeof d.gioMayChu).toBe("string");
    expect(new Date(d.giuKho.hanGiuLuc).getTime()).toBeGreaterThan(new Date(d.gioMayChu).getTime());
    expect(d.dongHocCu).toHaveLength(1);
    expect(d.dongHocCu[0]).toMatchObject({ productId: p, soLuong: 2, donGia: 400_000, thanhTien: 800_000 });

    const don = await db.order.findUniqueOrThrow({ where: { id: d.orderId }, include: { items: true } });
    expect(don).toMatchObject({ type: "ONLINE", status: "PENDING_PAYMENT", totalAmount: 830_000, shippingFee: 30_000, shippingMethodCode: "T843H_STD" });
    expect(don.shippingAddress).toMatchObject({ hoTen: "Nguyễn Văn A", tinhThanh: "Đà Nẵng", phi: 30_000 });
    expect(don.items).toHaveLength(1);
    expect(don.items[0]).toMatchObject({ type: "PRODUCT", productId: p, quantity: 2, unitPrice: 400_000, totalPrice: 800_000 });
    const gk = await db.productReservation.findMany({ where: { orderItemId: don.items[0]!.id } });
    expect(gk).toHaveLength(1);
    expect(gk[0]).toMatchObject({ status: "ACTIVE", quantity: 2, productId: p });
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: don.items[0]!.id } })).status).toBe("AWAITING_PAYMENT");
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(10); // CHƯA trừ tồn: chỉ giữ chỗ, trừ khi thanh toán xác nhận
    const phieu = await db.paymentRequest.findMany({ where: { orderId: d.orderId } });
    expect(phieu).toHaveLength(1);
    expect(phieu[0]!.amountDue).toBe(830_000);
    expect((await gio(tok.A!)).dong.filter((x: { loai: string }) => x.loai === "HOC_CU")).toHaveLength(0); // dòng đã đặt rời giỏ
  });

  it("[DHH-02] hỗn hợp khoá + học cụ: một đơn, một phiếu thu, tổng = khoá + hàng + phí", async () => {
    await choPhuHuynhSanSang("B");
    const khoa = await dungKhoa(500_000);
    const p = await sp("kit", { ton: 5, gia: 150_000 });
    expect((await them(tok.B!, { khoaId: khoa, studentId: `${NS}sB` })).status).toBe(200);
    expect((await them(tok.B!, { productId: p, soLuong: 1 })).status).toBe(200);
    const r = await json(await datHang(tok.B!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data).toMatchObject({ tongTien: 500_000 + 150_000 + 30_000, phiVanChuyen: 30_000 });
    expect(r.data.dong).toHaveLength(1);
    expect(r.data.dongHocCu).toHaveLength(1);
    const don = await db.order.findUniqueOrThrow({ where: { id: r.data.orderId }, include: { items: true } });
    expect(don.items.map((i) => i.type).sort()).toEqual(["ONLINE_COURSE", "PRODUCT"]);
    expect(don.totalAmount).toBe(680_000);
    const phieu = await db.paymentRequest.findMany({ where: { orderId: don.id } });
    expect(phieu).toHaveLength(1);
    expect(phieu[0]!.amountDue).toBe(680_000);
    expect(await db.orderOnlineGrant.count({ where: { orderId: don.id, status: "PENDING" } })).toBe(1);
    expect(await db.productReservation.count({ where: { orderItem: { orderId: don.id }, status: "ACTIVE" } })).toBe(1); // chỉ dòng học cụ có giữ kho
  });

  it("[DHH-03] thiếu địa chỉ / chưa chọn phương thức ⇒ 422, KHÔNG đơn, KHÔNG giữ kho", async () => {
    const p = await sp("thieu-dc", { ton: 5, gia: 100_000 });
    await them(tok.C!, { productId: p });
    expect(await ma(await datHang(tok.C!))).toEqual([422, "THIEU_DIA_CHI"]);
    expect((await diaChiPut(req("PUT", "/x", DIA_CHI, bearer(tok.C!)))).status).toBe(200);
    expect(await ma(await datHang(tok.C!))).toEqual([422, "CHUA_CHON_PHUONG_THUC_GIAO"]);
    expect(await db.order.count({ where: { createdById: ids.C } })).toBe(0);
    expect(await db.productReservation.count({ where: { productId: p } })).toBe(0);
    expect((await gio(tok.C!)).dong.filter((x: { loai: string }) => x.loai === "HOC_CU")).toHaveLength(1); // giỏ nguyên vẹn
  });

  it("[DHH-04] bấm đúp cùng revision ⇒ đơn cũ; đổi bộ học cụ ⇒ KHÔNG nhận nhầm đơn cũ", async () => {
    await choPhuHuynhSanSang("D");
    const p = await sp("dup", { ton: 8, gia: 100_000 });
    await them(tok.D!, { productId: p, soLuong: 2 });
    const g = await gio(tok.D!);
    const a = await json(await datHangPost(req("POST", "/x", { revision: g.revision }, bearer(tok.D!))));
    expect(a.ok, JSON.stringify(a.error)).toBe(true);
    const b = await json(await datHangPost(req("POST", "/x", { revision: g.revision }, bearer(tok.D!))));
    expect(b.data.orderId).toBe(a.data.orderId); // replay
    expect(b.data.giuKho).toMatchObject({ trangThai: "DANG_GIU" });
    expect(await db.order.count({ where: { createdById: ids.D, type: "ONLINE" } })).toBe(1);
    expect(await db.productReservation.count({ where: { productId: p, status: "ACTIVE" } })).toBe(1);
    // Giỏ mới (sau khi đơn cũ còn chờ): cùng sản phẩm khác số lượng ⇒ đơn MỚI, không phải đơn cũ.
    const p2 = await sp("dup2", { ton: 8, gia: 100_000 });
    await them(tok.D!, { productId: p2, soLuong: 1 });
    const c = await json(await datHang(tok.D!));
    expect(c.ok, JSON.stringify(c.error)).toBe(true);
    expect(c.data.orderId).not.toBe(a.data.orderId);
  });

  it("[DHH-05] giá TĂNG sau khi vào giỏ ⇒ GIA_DA_TANG (không đơn); xác nhận ⇒ đơn theo giá mới", async () => {
    await choPhuHuynhSanSang("E");
    const p = await sp("tang", { ton: 5, gia: 100_000 });
    await them(tok.E!, { productId: p });
    await db.product.update({ where: { id: p }, data: { salePrice: 130_000 } });
    const r = await datHang(tok.E!);
    expect(await ma(r.clone())).toEqual([409, "GIA_DA_TANG"]);
    expect((await json(r)).error?.chiTiet?.cartItemIds).toHaveLength(1);
    expect(await db.order.count({ where: { createdById: ids.E } })).toBe(0);
    const ok = await json(await datHang(tok.E!, { xacNhanGiaMoi: true }));
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(ok.data.dongHocCu[0]).toMatchObject({ donGia: 130_000 });
    expect(ok.data.tongTien).toBe(130_000 + 30_000);
    // Giá GIẢM không cần xác nhận.
    const p2 = await sp("giam", { ton: 5, gia: 100_000 });
    await them(tok.E!, { productId: p2 });
    await db.product.update({ where: { id: p2 }, data: { salePrice: 80_000 } });
    expect((await datHang(tok.E!)).status).toBe(200);
  });

  it("[DHH-06] tranh hàng: nhiều phụ huynh cùng đặt phần tồn ít ⇒ đúng bằng tồn thành công, còn lại HET_HANG, không oversell", async () => {
    const khachs = ["A", "B", "C", "D", "E", "F", "G"];
    for (const k of khachs) await choPhuHuynhSanSang(k); // mỗi ca phải xanh khi chạy MỘT MÌNH — tự chuẩn bị địa chỉ + phương thức
    const p = await sp("tranh", { ton: 3, gia: 100_000 });
    for (const k of khachs) await them(tok[k]!, { productId: p, soLuong: 1 });
    const g = await Promise.all(khachs.map((k) => gio(tok[k]!)));
    const kq = await Promise.all(khachs.map((k, i) => datHangPost(req("POST", "/x", { revision: g[i].revision, itemIds: g[i].dong.filter((d: { productId?: string }) => d.productId === p).map((d: { itemId: string }) => d.itemId) }, bearer(tok[k]!)))));
    const bodies = await Promise.all(kq.map(async (r) => [r.status, await json(r)] as const));
    const hs = bodies.map(([st, j]) => [st, j.error?.code] as const);
    const thanhCong = hs.filter(([s]) => s === 200).length;
    const hetHang = hs.filter(([s, c]) => s === 409 && c === "HET_HANG").length;
    expect(thanhCong, JSON.stringify(hs)).toBe(3);
    expect(hetHang).toBe(4);
    const giu = await db.productReservation.aggregate({ where: { productId: p, status: "ACTIVE" }, _sum: { quantity: true } });
    expect(giu._sum.quantity).toBe(3); // không oversell
    expect(await db.orderItem.count({ where: { productId: p } })).toBe(3); // không đơn nửa vời của người thua
    // Người thua nhận HET_HANG KÈM danh sách dòng thiếu (để app tô đúng dòng) — không phải lỗi chung chung.
    const loi409 = bodies.filter(([st]) => st === 409).map(([, jj]) => jj.error);
    for (const e of loi409) expect(e?.chiTiet?.thieu?.[0], JSON.stringify(e)).toMatchObject({ productId: p, yeuCau: 1 });
    // Sau cuộc đua, dòng của người thua trong giỏ hiển thị HET_HANG (cần xử lý) và đặt lại KHÔNG tạo đơn.
    const kThua = khachs.find((_, idx) => hs[idx]![0] === 409)!;
    const gThua = await gio(tok[kThua]!);
    expect(gThua.dong.find((d: { productId?: string }) => d.productId === p)).toMatchObject({ trangThai: "HET_HANG" });
    // Chọn TƯỜNG MINH dòng đã thua (giỏ có thể còn dòng hợp lệ khác từ ca trước — mặc định sẽ đặt chúng, không liên quan tới cuộc đua).
    const dongThua = gThua.dong.find((d: { productId?: string }) => d.productId === p) as { itemId: string };
    const lai = await datHangPost(req("POST", "/x", { revision: gThua.revision, itemIds: [dongThua.itemId] }, bearer(tok[kThua]!)));
    const laiJ = await json(lai);
    expect([lai.status, laiJ.error?.code], JSON.stringify({ kThua, gThua: gThua.dong, laiJ: laiJ.data ? { orderId: laiJ.data.orderId, daCo: laiJ.data.daCo, hc: laiJ.data.dongHocCu } : laiJ.error })).toEqual([409, "KHONG_CO_DONG_DE_DAT"]);
    expect(await db.orderItem.count({ where: { productId: p } })).toBe(3);
  });

  it("[DHH-07] huỷ đơn nhả giữ kho + fulfillment CANCELLED; huỷ lặp idempotent", async () => {
    await choPhuHuynhSanSang("A");
    const p = await sp("huy", { ton: 4, gia: 100_000 });
    await them(tok.A!, { productId: p, soLuong: 2 });
    const r = await json(await datHang(tok.A!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const oi = (await db.orderItem.findFirstOrThrow({ where: { orderId: r.data.orderId, productId: p } })).id;
    const huy = () => huyPost(req("POST", "/x", {}, bearer(tok.A!)), { params: Promise.resolve({ orderId: r.data.orderId }) as never });
    expect((await huy()).status).toBe(200);
    expect((await db.productReservation.findFirstOrThrow({ where: { orderItemId: oi } })).status).toBe("RELEASED");
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oi } })).status).toBe("CANCELLED");
    expect((await huy()).status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(4);
  });

  it("[DHH-08] học cụ không bán Online giữa chừng ⇒ không đơn", async () => {
    await choPhuHuynhSanSang("B");
    const p = await sp("tat", { ton: 5, gia: 100_000 });
    await them(tok.B!, { productId: p });
    await db.product.update({ where: { id: p }, data: { sellOnline: false } });
    const r = await datHang(tok.B!, { itemIds: (await gio(tok.B!)).dong.filter((d: { productId?: string }) => d.productId === p).map((d: { itemId: string }) => d.itemId) });
    expect(r.status).toBe(409);
    expect(await db.orderItem.count({ where: { productId: p } })).toBe(0);
    expect(await db.productReservation.count({ where: { productId: p } })).toBe(0);
  });
  it("[DHH-09] chi tiết đơn hỗn hợp: `dong` chỉ là khoá; học cụ + tiến độ giao + giữ kho + địa chỉ chụp; người khác ⇒ 404", async () => {
    await choPhuHuynhSanSang("F");
    const khoa = await dungKhoa(300_000);
    const p = await sp("ct", { ton: 6, gia: 90_000 });
    await them(tok.F!, { khoaId: khoa, studentId: `${NS}sF` });
    await them(tok.F!, { productId: p, soLuong: 3 });
    const r = await json(await datHang(tok.F!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const ctx = { params: Promise.resolve({ orderId: r.data.orderId }) as never };
    const d = (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tok.F!)), ctx))).data;
    expect(d.dong).toHaveLength(1);
    expect(d.dong[0].courseId).toBe(khoa); // dòng khoá thật, KHÔNG lẫn dòng hàng với courseId rỗng
    expect(d.dongHocCu).toHaveLength(1);
    expect(d.dongHocCu[0]).toMatchObject({ productId: p, soLuong: 3, donGia: 90_000, thanhTien: 270_000, tienDo: "CHO_THANH_TOAN", maVanDon: null });
    expect(d).toMatchObject({ tongTien: 300_000 + 270_000 + 30_000, phiVanChuyen: 30_000, giuKho: { trangThai: "DANG_GIU" } });
    expect(d.giaoHang).toMatchObject({ phuongThuc: "T843H_STD", phi: 30_000, nguoiNhan: "Nguyễn Văn A" });
    expect(d.giaoHang.diaChi).toContain("Đà Nẵng");
    expect(typeof d.gioMayChu).toBe("string");
    // Người khác không đọc được.
    expect((await chiTietGet(req("GET", "/x", undefined, bearer(tok.G!)), ctx)).status).toBe(404);
    // Sau huỷ: giữ kho biến mất, tiến độ DA_HUY.
    await huyPost(req("POST", "/x", {}, bearer(tok.F!)), ctx);
    const sau = (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tok.F!)), ctx))).data;
    expect(sau.giuKho).toBeNull();
    expect(sau.dongHocCu[0].tienDo).toBe("DA_HUY");
  });
  it("[DHH-10] phòng thủ lõi: giá lệch chốt↔ghi ⇒ LoiGiaDoi; chốt chặn không-bán-Online; giữ kho đã nhả / hết hạn hiện đúng ở chi tiết", async () => {
    const p = await sp("loi", { ton: 5, gia: 100_000 });
    // (a) giá lệch giữa lúc chốt và lúc ghi (sau khi bước đọc đã chốt 100.000, giá thật vừa đổi) ⇒ ném, không ghi gì.
    await expect(db.$transaction((tx) => ghiHocCu(tx, { orderId: "khong-co", dong: [{ cartItemId: "c", productId: p, sku: `${NS}loi`, ten: "x", soLuong: 1, donGia: 99_999 }], now: new Date(), ttlPhut: 15 }))).rejects.toBeInstanceOf(LoiGiaDoi);
    // (b) chốt từ chối sản phẩm không bán Online (phòng thủ sau cổng của giỏ).
    await db.product.update({ where: { id: p }, data: { sellOnline: false } });
    expect(await chotHocCu(db as never, { parentUserId: ids.A!, dong: [{ cartItemId: "c", productId: p, soLuong: 1 }], phuongThuc: "T843H_STD", tamTinhKhoa: 0 })).toMatchObject({ ok: false, ma: "KHONG_BAN_ONLINE" });
    await db.product.update({ where: { id: p }, data: { sellOnline: true } });
    // (c) giữ kho trên đơn ĐANG CHỜ: nhả ⇒ không còn «giữ kho»; hết hạn + reaper quét ⇒ HET_HAN (không im lặng biến mất).
    await choPhuHuynhSanSang("G");
    await them(tok.G!, { productId: p, soLuong: 1 });
    const r = await json(await datHang(tok.G!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const ctx = { params: Promise.resolve({ orderId: r.data.orderId }) as never };
    const ct = async () => (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tok.G!)), ctx))).data;
    expect((await ct()).giuKho).toMatchObject({ trangThai: "DANG_GIU" });
    await db.productReservation.updateMany({ where: { orderItem: { orderId: r.data.orderId } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect((await ct()).giuKho).toMatchObject({ trangThai: "HET_HAN" }); // quá hạn nhưng reaper chưa quét
    await quetHetHan(db as never, { now: new Date() });
    expect((await ct()).giuKho).toMatchObject({ trangThai: "HET_HAN" }); // reaper đã quét ⇒ vẫn nói HET_HAN
    await db.productReservation.updateMany({ where: { orderItem: { orderId: r.data.orderId } }, data: { status: "RELEASED" } });
    expect((await ct()).giuKho).toBeNull(); // đã nhả (không còn gì để đếm ngược)
  });

  it("[DHH-11] cùng cặp khoá đang chờ + thêm học cụ ⇒ DA_CO_DON_DANG_CHO (không trả lại đơn cũ thiếu hàng)", async () => {
    await choPhuHuynhSanSang("E");
    const khoa = await dungKhoa(200_000);
    await them(tok.E!, { khoaId: khoa, studentId: `${NS}sE` });
    const don1 = await json(await datHang(tok.E!));
    expect(don1.ok, JSON.stringify(don1.error)).toBe(true);
    const p = await sp("ghep", { ton: 5, gia: 50_000 });
    await them(tok.E!, { khoaId: khoa, studentId: `${NS}sE` });
    await them(tok.E!, { productId: p });
    expect(await ma(await datHang(tok.E!))).toEqual([409, "DA_CO_DON_DANG_CHO"]);
    expect(await db.orderItem.count({ where: { productId: p } })).toBe(0);
    expect(await db.productReservation.count({ where: { productId: p } })).toBe(0);
  });
  const traTien = async (orderId: string, soTien: number, ref: string) => {
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    return ingestPayosWebhook({ reference: ref, description: `${phieu.matchKey} HOC PHI ONLINE`, amount: soTien, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" }, "SEPAY");
  };

  it("[DHH-12] thanh toán đủ (webhook thật): trừ tồn MỘT lần, CONSUMED, PAID, SALE; lặp không trừ hai lần; khoá cùng đơn được cấp quyền", async () => {
    await choPhuHuynhSanSang("A");
    const khoa = await dungKhoa(400_000);
    const p = await sp("tt", { ton: 10, gia: 250_000 });
    await them(tok.A!, { khoaId: khoa, studentId: `${NS}sA` });
    await them(tok.A!, { productId: p, soLuong: 2 });
    const r = await json(await datHang(tok.A!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data.tongTien).toBe(400_000 + 500_000 + 30_000);
    const oi = (await db.orderItem.findFirstOrThrow({ where: { orderId: r.data.orderId, productId: p } })).id;
    const ref = `DHH-${Date.now()}-${++n}`;
    expect((await traTien(r.data.orderId, r.data.tongTien, ref)).status).toBe("MATCHED");
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(8);
    expect((await db.productReservation.findFirstOrThrow({ where: { orderItemId: oi } })).status).toBe("CONSUMED");
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oi } })).status).toBe("PAID");
    const mv = await db.productMovement.findMany({ where: { productId: p, type: "SALE" } });
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ quantity: -2, orderId: r.data.orderId });
    expect(await db.orderOnlineGrant.count({ where: { orderId: r.data.orderId, status: "GRANTED" } })).toBe(1);
    // Lặp: webhook cùng tham chiếu + gọi lại cầu nối ⇒ không đổi gì.
    await traTien(r.data.orderId, r.data.tongTien, ref);
    const lai = await hoanTatHangSauThanhToan(db as never, r.data.orderId, new Date());
    expect(lai.coHang).toBe(false);
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(8);
    expect(await db.productMovement.count({ where: { productId: p, type: "SALE" } })).toBe(1);
    const ct = (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tok.A!)), { params: Promise.resolve({ orderId: r.data.orderId }) as never }))).data;
    expect(ct.dongHocCu[0].tienDo).toBe("DA_THANH_TOAN");
    expect(ct.giuKho).toBeNull(); // đã tiêu thụ ⇒ hết «giữ kho»
  });

  it("[DHH-13] chưa thu đủ ⇒ KHÔNG tiêu thụ", async () => {
    await choPhuHuynhSanSang("B");
    const p = await sp("chua-du", { ton: 6, gia: 100_000 });
    await them(tok.B!, { productId: p, soLuong: 1 });
    const r = await json(await datHang(tok.B!));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const kq = await hoanTatHangSauThanhToan(db as never, r.data.orderId, new Date());
    expect(kq).toMatchObject({ coHang: true, daThuDu: false });
    expect((await db.product.findUniqueOrThrow({ where: { id: p } })).stockOnHand).toBe(6);
    const oi = (await db.orderItem.findFirstOrThrow({ where: { orderId: r.data.orderId, productId: p } })).id;
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oi } })).status).toBe("AWAITING_PAYMENT");
    expect((await db.productReservation.findFirstOrThrow({ where: { orderItemId: oi } })).status).toBe("ACTIVE");
  });

  it("[DHH-14] thanh toán MUỘN: hết hạn giữ + hết hàng ⇒ NEEDS_STAFF (tiền giữ, tồn không âm); hết hạn nhưng còn hàng ⇒ vẫn bán", async () => {
    await choPhuHuynhSanSang("C");
    await choPhuHuynhSanSang("D").catch(() => undefined);
    const hetHang = await sp("muon-het", { ton: 2, gia: 100_000 });
    const conHang = await sp("muon-con", { ton: 5, gia: 100_000 });
    await them(tok.C!, { productId: hetHang, soLuong: 2 });
    const a = await json(await datHang(tok.C!));
    expect(a.ok, JSON.stringify(a.error)).toBe(true);
    await them(tok.C!, { productId: conHang, soLuong: 1 });
    const b = await json(await datHang(tok.C!));
    expect(b.ok, JSON.stringify(b.error)).toBe(true);
    // giữ kho hết hạn + reaper quét; hàng `hetHang` bị bán nơi khác (tồn về 0).
    await db.productReservation.updateMany({ where: { orderItem: { orderId: { in: [a.data.orderId, b.data.orderId] } } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await quetHetHan(db as never, { now: new Date() });
    await db.product.update({ where: { id: hetHang }, data: { stockOnHand: 0 } });

    expect((await traTien(a.data.orderId, a.data.tongTien, `DHH-${Date.now()}-${++n}`)).status).toBe("MATCHED");
    const oiA = (await db.orderItem.findFirstOrThrow({ where: { orderId: a.data.orderId, productId: hetHang } })).id;
    const fA = await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oiA } });
    expect(fA.status).toBe("NEEDS_STAFF");
    expect(fA.note).toContain("Đã thu tiền");
    expect((await db.product.findUniqueOrThrow({ where: { id: hetHang } })).stockOnHand).toBe(0); // KHÔNG âm
    expect(await db.payment.count({ where: { orderId: a.data.orderId, amount: { gt: 0 } } })).toBe(1); // tiền ĐÃ ghi, không bị lỗi kho làm hỏng
    expect(await db.auditLog.count({ where: { entityType: "OrderItem", entityId: oiA, action: "FULFILLMENT_NEEDS_STAFF" } })).toBe(1);

    expect((await traTien(b.data.orderId, b.data.tongTien, `DHH-${Date.now()}-${++n}`)).status).toBe("MATCHED");
    const oiB = (await db.orderItem.findFirstOrThrow({ where: { orderId: b.data.orderId, productId: conHang } })).id;
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oiB } })).status).toBe("PAID");
    expect((await db.product.findUniqueOrThrow({ where: { id: conHang } })).stockOnHand).toBe(4);
  });
  it("[DHH-15] cron online-giu-kho: 401 khi thiếu bí mật; quét hết hạn; thử lại hàng đã thu mà hích bị mất; chạy lại không đổi gì", async () => {
    process.env.CRON_SECRET = "cron-secret-test-dhh-32-ky-tu-tro-len-xxxxxxxx";
    const goi = (kem: boolean) => cronGiuKho(new Request("http://localhost/api/cron/online-giu-kho", { headers: kem ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {} }) as never);
    expect((await goi(false)).status).toBe(401);
    expect((await cronGiuKho(new Request("http://localhost/x", { headers: { authorization: "Bearer sai" } }) as never)).status).toBe(401);

    await choPhuHuynhSanSang("D");
    const hetHan = await sp("cron-het", { ton: 5, gia: 100_000 });
    const mat = await sp("cron-mat", { ton: 5, gia: 100_000 });
    // (a) giữ kho hết hạn ⇒ EXPIRED
    await them(tok.D!, { productId: hetHan, soLuong: 1 });
    const a = await json(await datHang(tok.D!));
    expect(a.ok, JSON.stringify(a.error)).toBe(true);
    await db.productReservation.updateMany({ where: { orderItem: { orderId: a.data.orderId } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    // (b) đã thu tiền nhưng hích bị mất: dựng lại trạng thái «trước hích»
    await them(tok.D!, { productId: mat, soLuong: 2 });
    const b = await json(await datHang(tok.D!));
    expect(b.ok, JSON.stringify(b.error)).toBe(true);
    expect((await traTien(b.data.orderId, b.data.tongTien, `DHH-${Date.now()}-${++n}`)).status).toBe("MATCHED");
    const oiB = (await db.orderItem.findFirstOrThrow({ where: { orderId: b.data.orderId, productId: mat } })).id;
    await db.productReservation.updateMany({ where: { orderItemId: oiB }, data: { status: "ACTIVE", consumedAt: null } });
    await db.orderItemFulfillment.update({ where: { orderItemId: oiB }, data: { status: "AWAITING_PAYMENT", paidAt: null } });
    await db.product.update({ where: { id: mat }, data: { stockOnHand: 5 } });
    await db.productMovement.deleteMany({ where: { productId: mat } });

    const r1 = await json(await goi(true));
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    expect((await db.productReservation.findFirstOrThrow({ where: { orderItem: { orderId: a.data.orderId } } })).status).toBe("EXPIRED");
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oiB } })).status).toBe("PAID");
    expect((await db.product.findUniqueOrThrow({ where: { id: mat } })).stockOnHand).toBe(3);
    // đơn A chưa thu ⇒ không bị đụng
    const oiA = (await db.orderItem.findFirstOrThrow({ where: { orderId: a.data.orderId, productId: hetHan } })).id;
    expect((await db.orderItemFulfillment.findUniqueOrThrow({ where: { orderItemId: oiA } })).status).toBe("AWAITING_PAYMENT");
    // chạy lại: không đổi
    await goi(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: mat } })).stockOnHand).toBe(3);
    expect(await db.productMovement.count({ where: { productId: mat, type: "SALE" } })).toBe(1);
    delete process.env.CRON_SECRET;
  });

  it("[DHH-16] all-or-nothing mặc định: dòng không đặt được ⇒ 409 + cartItemIds, KHÔNG đơn/giữ kho; itemIds dòng tốt ⇒ đơn đúng", async () => {
    await choPhuHuynhSanSang("F");
    const tot = await sp("aon-tot", { ton: 5, gia: 100_000 });
    const xau = await sp("aon-xau", { ton: 5, gia: 100_000 });
    const soDongTruoc = (await gio(tok.F!)).dong.length; // giỏ dùng chung giữa các ca: đo theo CHÊNH LỆCH
    await them(tok.F!, { productId: tot });
    await them(tok.F!, { productId: xau });
    await db.product.update({ where: { id: xau }, data: { stockOnHand: 0 } }); // hết hàng SAU khi vào giỏ ⇒ dòng HET_HANG nhưng giỏ không đổi revision
    const g = await gio(tok.F!);
    const dongXau = g.dong.find((x: { productId: string }) => x.productId === xau);
    expect(dongXau.trangThai).toBe("HET_HANG");
    const truocDon = await db.order.count({ where: { createdById: ids.F } });
    // KHÔNG itemIds (mặc định) ⇒ không âm thầm bỏ dòng xấu để tạo đơn khác tổng
    const r = await datHangPost(req("POST", "/x", { revision: g.revision }, bearer(tok.F!)));
    expect(r.status).toBe(409);
    const j = await json(r);
    expect(j.error?.code).toBe("KHONG_CO_DONG_DE_DAT");
    expect(j.error?.chiTiet?.cartItemIds).toContain(dongXau.itemId);
    expect(j.error?.chiTiet?.cartItemIds).not.toContain(g.dong.find((x: { productId: string }) => x.productId === tot).itemId);
    expect(await db.order.count({ where: { createdById: ids.F } })).toBe(truocDon);
    expect(await db.productReservation.count({ where: { productId: { in: [tot, xau] } } })).toBe(0);
    expect((await gio(tok.F!)).dong).toHaveLength(soDongTruoc + 2); // giỏ nguyên vẹn
    // itemIds CHỈ dòng tốt (người mua tự bỏ dòng hết hàng) ⇒ đơn đúng dòng + phí
    const dongTot = g.dong.find((x: { productId: string }) => x.productId === tot);
    const ok = await json(await datHangPost(req("POST", "/x", { revision: g.revision, itemIds: [dongTot.itemId] }, bearer(tok.F!))));
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(ok.data).toMatchObject({ tongTien: 100_000 + 30_000, phiVanChuyen: 30_000 });
    expect(ok.data.dongHocCu).toHaveLength(1);
    const conLai = (await gio(tok.F!)).dong.map((x: { itemId: string }) => x.itemId);
    expect(conLai).toContain(dongXau.itemId); // dòng xấu ở lại giỏ, KHÔNG vào đơn
    expect(conLai).not.toContain(dongTot.itemId); // dòng tốt đã vào đơn
  });

  it("[DHH-17] all-or-nothing cho dòng KHOÁ: khoá tạm ngừng bán ⇒ 409 + cartItemIds, KHÔNG đơn dù học cụ tốt", async () => {
    await choPhuHuynhSanSang("G");
    const khoa = await dungKhoa(300_000);
    const tot = await sp("aon-khoa-tot", { ton: 5, gia: 100_000 });
    expect((await them(tok.G!, { khoaId: khoa, studentId: `${NS}sG` })).status).toBe(200);
    await them(tok.G!, { productId: tot });
    await doiTrangThaiBan(db as never, { courseId: khoa, saleStatus: "PAUSED" }); // khoá ngừng bán SAU khi vào giỏ
    const g = await gio(tok.G!);
    const dongKhoa = g.dong.find((x: { loai: string }) => x.loai !== "HOC_CU");
    expect(dongKhoa).toBeTruthy();
    expect(dongKhoa.trangThai).not.toBe("SAN_SANG");
    const truoc = await db.order.count({ where: { createdById: ids.G } });
    const r = await datHangPost(req("POST", "/x", { revision: g.revision }, bearer(tok.G!)));
    expect(r.status).toBe(409);
    const j = await json(r);
    expect(j.error?.code).toBe("KHONG_CO_DONG_DE_DAT");
    expect(j.error?.chiTiet?.cartItemIds).toContain(dongKhoa.itemId);
    expect(await db.order.count({ where: { createdById: ids.G } })).toBe(truoc); // KHÔNG tạo đơn học cụ lẻ
    expect(await db.productReservation.count({ where: { productId: tot } })).toBe(0);
  });

  const CGT_N = 6;
  const tomCgt = async (nhan: string, ds: Promise<Response>[]) => {
    const kq = await Promise.all((await Promise.all(ds)).map(async (r) => { const j = await json(r); return { s: r.status, ma: j.error?.code, data: j.data as any }; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.info(`${nhan} phản hồi: ${kq.map((x) => `${x.s}${x.ma ? `:${x.ma}` : ""}${x.data?.daCo === true || x.data?.daHuyTruocDo === true || x.data?.trungLap === true ? ":lặp" : ""}`).sort().join(" ")}`);
    return kq;
  };

  it("[CGT-01] checkout giỏ CHỈ HỌC CỤ: 6 request y hệt song song ⇒ đúng MỘT đơn, MỘT lượt giữ kho; gửi lại tuần tự ⇒ đơn cũ", async () => {
    await choPhuHuynhSanSang("C");
    const p = await sp("cgt1", { ton: 20, gia: 100_000 });
    const them1 = await json(await them(tok.C!, { productId: p, soLuong: 2 }));
    const than = { revision: (await gio(tok.C!)).revision, itemIds: [them1.data.itemId] };
    const gui = () => datHangPost(req("POST", "/x", than, bearer(tok.C!)));
    await amPool();
    const kq = await tomCgt("[CGT-01]", Array.from({ length: CGT_N }, gui));
    const duoc = kq.filter((x) => x.s === 200);
    expect(duoc.length).toBeGreaterThanOrEqual(1);
    expect(new Set(duoc.map((x) => x.data.orderId)).size).toBe(1);
    expect(duoc.filter((x) => x.data.daCo === false)).toHaveLength(1);
    for (const x of kq.filter((y) => y.s !== 200)) expect([x.s, ["GIO_DA_THAY_DOI", "KHONG_CO_DONG_DE_DAT"].includes(x.ma ?? "")], x.ma).toEqual([409, true]);
    const dem = async () => [await db.orderItem.count({ where: { productId: p } }), await db.productReservation.count({ where: { productId: p } }), (await db.product.findUniqueOrThrow({ where: { id: p }, select: { stockOnHand: true } })).stockOnHand];
    expect(await dem()).toEqual([1, 1, 20]);
    const lai = (await json(await gui())).data;
    expect(lai).toMatchObject({ daCo: true, orderId: duoc[0]!.data.orderId });
    expect(await dem()).toEqual([1, 1, 20]);
  }, 60_000);

  it("[CGT-02] huỷ đơn hỗn hợp {khoiPhucVaoGio:true} × 6 song song ⇒ nhả giữ kho MỘT lần, giỏ khôi phục MỘT lần (không nhân đôi dòng)", async () => {
    await choPhuHuynhSanSang("D");
    const khoa = await dungKhoa(310_000);
    const p = await sp("cgt2", { ton: 7, gia: 100_000 });
    const a = await json(await them(tok.D!, { khoaId: khoa, studentId: `${NS}sD` }));
    const b = await json(await them(tok.D!, { productId: p, soLuong: 2 }));
    const don = await json(await datHang(tok.D!, { itemIds: [a.data.itemId, b.data.itemId] }));
    expect(don.ok, JSON.stringify(don.error)).toBe(true);
    const orderId = don.data.orderId as string;
    const oi = (await db.orderItem.findFirstOrThrow({ where: { orderId, productId: p } })).id;
    await amPool();
    const kq = await tomCgt("[CGT-02]", Array.from({ length: CGT_N }, () => huyPost(req("POST", "/x", { khoiPhucVaoGio: true }, bearer(tok.D!)), { params: Promise.resolve({ orderId }) as never })));
    expect(kq.map((x) => x.s)).toEqual(Array(CGT_N).fill(200));
    expect(kq.filter((x) => x.data.daHuyTruocDo === false)).toHaveLength(1);
    expect((await db.productReservation.findMany({ where: { orderItemId: oi }, select: { status: true } })).map((r) => r.status)).toEqual(["RELEASED"]);
    expect((await db.product.findUniqueOrThrow({ where: { id: p }, select: { stockOnHand: true } })).stockOnHand).toBe(7);
    expect(await db.orderStatusHistory.count({ where: { orderId, toStatus: "CANCELLED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: orderId, action: "CANCEL" } })).toBe(1);
    const gioD = { cart: { parentUserId: ids.D! } };
    expect((await db.cartItem.findMany({ where: { ...gioD, productId: p }, select: { quantity: true } })).map((x) => x.quantity)).toEqual([2]);
    expect(await db.cartItem.count({ where: { ...gioD, onlineCourseId: khoa } })).toBe(1);
  }, 60_000);
});
