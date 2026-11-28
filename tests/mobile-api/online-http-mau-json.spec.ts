/* eslint-disable @typescript-eslint/no-unused-vars -- spec SINH từ online-http-don-hon-hop.spec.ts (scratchpad sinh-mau-json.py): còn dư vài helper dùng chung */
import bcrypt from "bcryptjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";


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

const BASE = process.env.HTTP_BASE ?? "";
const via = (path: string) => async (r: Request, ctx?: { params: Promise<Record<string, string>> }): Promise<Response> => {
  const p = ctx ? Object.entries(await ctx.params).reduce((a, [k, v]) => a.replace(`[${k}]`, v), path) : path;
  const h: Record<string, string> = {}; r.headers.forEach((v, k) => { h[k] = v; });
  const corpus = r.method === "GET" || r.method === "HEAD" ? undefined : await r.text();
  return fetch(`${BASE}${p}`, { method: r.method, headers: h, body: corpus });
};
const dangNhapRoute = via("/api/mobile/v1/auth/login");
const datHangPost = via("/api/mobile/v1/parent/cart/checkout");
const themPost = via("/api/mobile/v1/parent/cart/items");
const huyPost = via("/api/mobile/v1/parent/online-orders/[orderId]/cancel");
const chiTietGet = via("/api/mobile/v1/parent/online-orders/[orderId]");
const cronGiuKho = via("/api/cron/online-giu-kho");
const quyDinhDongY = via("/api/mobile/v1/parent/policy/accept");
const diaChiPut = via("/api/mobile/v1/parent/shipping/profile");
const gioGet = via("/api/mobile/v1/parent/cart");
const gioPatch = via("/api/mobile/v1/parent/cart");

/** [HMAU] Mẫu JSON THẬT qua HTTP 3221 cho B/Web (V8.44): chạy một luồng học cụ + khoá + giao hàng + thanh toán + huỷ, lưu request/response (KHÔNG token) vào docs/mobile-integration/samples-v844. */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = !!process.env.HTTP_BASE && laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "hmau-";
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

describe.skipIf(!RUN)("[HMAU] đặt hàng hỗn hợp — Postgres thật", () => {
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
  const datHang = async (t: string, body?: Record<string, unknown>) => {
    const g = await gio(t);
    return datHangPost(req("POST", "/x", { revision: g.revision, ...body }, bearer(t)));
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


  const THU_MUC = process.env.MAU_DIR ?? "";
  let so = 0;
  const luu = async (ten: string, method: string, path: string, body: unknown, token: string | null): Promise<{ status: number; j: Tra }> => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(token ? { authorization: bearer(token) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json()) as Tra;
    if (THU_MUC) {
      mkdirSync(THU_MUC, { recursive: true });
      const cs = JSON.stringify({ request: { method, path, ...(body !== undefined ? { body } : {}), auth: token ? "Bearer <accessToken phụ huynh>" : null }, status: r.status, response: j }, null, 2);
      writeFileSync(`${THU_MUC}/${String(++so).padStart(2, "0")}-${ten}.json`, cs, "utf8");
    }
    return { status: r.status, j };
  };
  const traTien = async (orderId: string, soTien: number, ref: string) => {
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    return ingestPayosWebhook({ reference: ref, description: `${phieu.matchKey} HOC PHI ONLINE`, amount: soTien, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" }, "SEPAY");
  };

  it("[HMAU-01] luồng đầy đủ: giao hàng · giỏ · đặt hàng hỗn hợp · hết hàng · giá tăng · thanh toán · chi tiết · huỷ", async () => {
    const A = tok.A!;
    const B = tok.B!;
    const khoa = await dungKhoa(500_000);
    const kit = await sp("robot-kit", { ton: 3, gia: 400_000 });
    await db.product.update({ where: { id: kit }, data: { name: "Bộ ZMRobo Kit mẫu", onlineVariantLabel: "Bản tiêu chuẩn" } as never });
    // 1. Giao hàng: chưa có địa chỉ ⇒ khoá + lý do
    expect((await luu("giao-hang-chua-co-dia-chi", "GET", "/api/mobile/v1/parent/shipping/methods", undefined, A)).status).toBe(200);
    expect((await luu("dia-chi-luu", "PUT", "/api/mobile/v1/parent/shipping/profile", DIA_CHI, A)).status).toBe(200);
    const pt = await luu("giao-hang-sau-khi-co-dia-chi", "GET", "/api/mobile/v1/parent/shipping/methods", undefined, A);
    expect(pt.status).toBe(200);
    // 2. Danh mục học cụ
    expect((await luu("danh-muc-hoc-cu", "GET", "/api/mobile/v1/online/shop/products", undefined, A)).status).toBe(200);
    expect((await luu("chi-tiet-hoc-cu", "GET", `/api/mobile/v1/online/shop/products/${kit}`, undefined, A)).status).toBe(200);
    // 3. Giỏ: thêm khoá + học cụ, chọn phương thức giao
    expect((await luu("gio-them-khoa", "POST", "/api/mobile/v1/parent/cart/items", { khoaId: khoa, studentId: `${NS}sA` }, A)).status).toBe(200);
    expect((await luu("gio-them-hoc-cu", "POST", "/api/mobile/v1/parent/cart/items", { productId: kit, soLuong: 2 }, A)).status).toBe(200);
    expect((await luu("gio-chon-phuong-thuc-giao", "PATCH", "/api/mobile/v1/parent/cart", { phuongThucGiao: "T843H_STD" }, A)).status).toBe(200);
    const g = await luu("gio-xem", "GET", "/api/mobile/v1/parent/cart", undefined, A);
    expect(g.status).toBe(200);
    // 4. Phụ huynh B: đòi quá tồn ⇒ HET_HANG (tồn 3, A đang giữ 2 sau khi đặt) — đặt A trước
    const dh = await luu("dat-hang-hon-hop-200", "POST", "/api/mobile/v1/parent/cart/checkout", { revision: g.j.data.revision }, A);
    expect(dh.status).toBe(200);
    expect(dh.j.data.tongTien).toBe(500_000 + 800_000 + 30_000);
    const lap = await luu("dat-hang-bam-dup-cung-revision", "POST", "/api/mobile/v1/parent/cart/checkout", { revision: g.j.data.revision }, A);
    expect(lap.j.data.orderId).toBe(dh.j.data.orderId);
    // B: còn 1 cái, đòi 2 ⇒ 409 HET_HANG kèm chiTiet.thieu
    expect((await luu("dia-chi-b", "PUT", "/api/mobile/v1/parent/shipping/profile", DIA_CHI, B)).status).toBe(200);
    expect((await luu("giao-chon-b", "PATCH", "/api/mobile/v1/parent/cart", { phuongThucGiao: "T843H_STD" }, B)).status).toBe(200);
    expect((await luu("gio-them-hoc-cu-bi-giam-so-luong", "POST", "/api/mobile/v1/parent/cart/items", { productId: kit, soLuong: 2 }, B)).status).toBe(200);
    const gb = await luu("gio-b-xem", "GET", "/api/mobile/v1/parent/cart", undefined, B);
    expect(gb.j.data.dong[0].soLuong).toBe(1); // máy chủ hạ số lượng về tồn khả dụng (daGiamSoLuong)
    // D mua nốt cái cuối trước khi B đặt ⇒ B nhận HET_HANG
    expect((await luu("dia-chi-d", "PUT", "/api/mobile/v1/parent/shipping/profile", DIA_CHI, tok.D!)).status).toBe(200);
    await luu("giao-chon-d", "PATCH", "/api/mobile/v1/parent/cart", { phuongThucGiao: "T843H_STD" }, tok.D!);
    await luu("gio-d-them", "POST", "/api/mobile/v1/parent/cart/items", { productId: kit, soLuong: 1 }, tok.D!);
    const gd = await luu("gio-d-xem", "GET", "/api/mobile/v1/parent/cart", undefined, tok.D!);
    expect((await luu("dat-hang-d-lay-cai-cuoi-200", "POST", "/api/mobile/v1/parent/cart/checkout", { revision: gd.j.data.revision }, tok.D!)).status).toBe(200);
    const het = await luu("dat-hang-khong-con-dong-de-dat-409", "POST", "/api/mobile/v1/parent/cart/checkout", { revision: gb.j.data.revision }, B);
    expect(het.status).toBe(409);
    expect(het.j.error?.code).toBe("KHONG_CO_DONG_DE_DAT"); // dòng đã chuyển HET_HANG ở giỏ ⇒ không còn dòng nào đặt được (mã HET_HANG xuất hiện khi tranh hàng đúng lúc đặt — ca DHH-06)
    const gb2 = await luu("gio-b-sau-khi-het-hang", "GET", "/api/mobile/v1/parent/cart", undefined, B);
    expect(gb2.j.data.dong[0].trangThai).toBe("HET_HANG");
    // Giá tăng sau khi vào giỏ ⇒ 409 GIA_DA_TANG, rồi xác nhận
    const rau = await sp("gia-tang", { ton: 5, gia: 100_000 });
    expect((await luu("gio-c-dia-chi", "PUT", "/api/mobile/v1/parent/shipping/profile", DIA_CHI, tok.C!)).status).toBe(200);
    await luu("gio-c-giao", "PATCH", "/api/mobile/v1/parent/cart", { phuongThucGiao: "T843H_STD" }, tok.C!);
    await luu("gio-c-them", "POST", "/api/mobile/v1/parent/cart/items", { productId: rau }, tok.C!);
    await db.product.update({ where: { id: rau }, data: { salePrice: 130_000 } });
    const gc = await luu("gio-c-xem", "GET", "/api/mobile/v1/parent/cart", undefined, tok.C!);
    const tang = await luu("dat-hang-gia-da-tang-409", "POST", "/api/mobile/v1/parent/cart/checkout", { revision: gc.j.data.revision }, tok.C!);
    expect(tang.status).toBe(409);
    expect(tang.j.error?.code).toBe("GIA_DA_TANG");
    expect((await luu("dat-hang-xac-nhan-gia-moi-200", "POST", "/api/mobile/v1/parent/cart/checkout", { revision: gc.j.data.revision, xacNhanGiaMoi: true }, tok.C!)).status).toBe(200);
    // 5. Chi tiết đơn trước/sau thanh toán
    const id = dh.j.data.orderId as string;
    expect((await luu("chi-tiet-don-cho-thanh-toan", "GET", `/api/mobile/v1/parent/online-orders/${id}`, undefined, A)).status).toBe(200);
    expect((await traTien(id, dh.j.data.tongTien, `HMAU-${Date.now()}-${++n}`)).status).toBe("MATCHED");
    const sau = await luu("chi-tiet-don-sau-thanh-toan", "GET", `/api/mobile/v1/parent/online-orders/${id}`, undefined, A);
    expect(sau.status).toBe(200);
    expect(sau.j.data.dongHocCu[0].tienDo).toBe("DA_THANH_TOAN");
    // 6. Huỷ đơn chưa thanh toán (đơn của C) ⇒ nhả giữ kho
    const dc = await db.order.findFirstOrThrow({ where: { createdById: ids.C }, select: { id: true } });
    expect((await luu("huy-don-chua-thanh-toan", "POST", `/api/mobile/v1/parent/online-orders/${dc.id}/cancel`, {}, tok.C!)).status).toBe(200);
    expect((await luu("chi-tiet-don-sau-huy", "GET", `/api/mobile/v1/parent/online-orders/${dc.id}`, undefined, tok.C!)).status).toBe(200);
    // 7. Xoá dòng học cụ khỏi giỏ (E): xoá, xoá lặp, dòng của giỏ khác
    const kit2 = await sp("kit-xoa", { ton: 9, gia: 120_000 });
    expect((await luu("gio-e-them-de-xoa", "POST", "/api/mobile/v1/parent/cart/items", { productId: kit2, soLuong: 1 }, tok.E!)).status).toBe(200);
    const ge = await luu("gio-e-truoc-khi-xoa", "GET", "/api/mobile/v1/parent/cart", undefined, tok.E!);
    const dong = ge.j.data.dong.find((x: { loai: string }) => x.loai === "HOC_CU");
    expect(dong).toBeTruthy();
    const xoa1 = await luu("gio-xoa-dong-hoc-cu-200", "DELETE", `/api/mobile/v1/parent/cart/items/${dong.itemId}?revision=${ge.j.data.revision}`, undefined, tok.E!);
    expect(xoa1.status).toBe(200);
    expect((await luu("gio-xoa-lap-van-200", "DELETE", `/api/mobile/v1/parent/cart/items/${dong.itemId}`, undefined, tok.E!)).status).toBe(200);
    // dòng CÒN SỐNG của giỏ E, người khác (F) cố xoá ⇒ 404, dòng vẫn còn
    await luu("gio-e-them-lai", "POST", "/api/mobile/v1/parent/cart/items", { productId: kit2, soLuong: 1 }, tok.E!);
    const ge2 = await luu("gio-e-sau-khi-them-lai", "GET", "/api/mobile/v1/parent/cart", undefined, tok.E!);
    const dong2 = ge2.j.data.dong.find((x: { loai: string }) => x.loai === "HOC_CU");
    const khac = await luu("gio-xoa-dong-cua-gio-khac-404", "DELETE", `/api/mobile/v1/parent/cart/items/${dong2.itemId}`, undefined, tok.F!);
    expect(khac.status).toBe(404);
    expect((await luu("gio-e-xoa-lan-cuoi", "DELETE", `/api/mobile/v1/parent/cart/items/${dong2.itemId}`, undefined, tok.E!)).status).toBe(200);
    const sauXoa = await luu("gio-e-sau-khi-xoa", "GET", "/api/mobile/v1/parent/cart", undefined, tok.E!);
    expect(sauXoa.j.data.dong.filter((x: { loai: string }) => x.loai === "HOC_CU")).toHaveLength(0);
    // 8. Địa chỉ: gợi ý · sai dữ liệu · ngoài vùng
    const G = tok.G!;
    expect((await luu("dia-chi-g-chua-co-goi-y", "GET", "/api/mobile/v1/parent/shipping/profile", undefined, G)).status).toBe(200);
    const sai = await luu("dia-chi-sai-du-lieu-422", "PUT", "/api/mobile/v1/parent/shipping/profile", { ...DIA_CHI, soDienThoai: "abc" }, G);
    expect([422, 400]).toContain(sai.status);
    const la = await luu("dia-chi-truong-la-400", "PUT", "/api/mobile/v1/parent/shipping/profile", { ...DIA_CHI, quocGia: "VN" }, G);
    expect(la.status).toBe(400);
    expect((await luu("dia-chi-ngoai-vung-luu", "PUT", "/api/mobile/v1/parent/shipping/profile", { ...DIA_CHI, tinhThanh: "Thừa Thiên Huế" }, G)).status).toBe(200);
    const nv = await luu("giao-hang-ngoai-vung", "GET", "/api/mobile/v1/parent/shipping/methods", undefined, G);
    expect(nv.j.data.phuongThuc.every((x: { khaDung: boolean; lyDo: string }) => x.khaDung === false && x.lyDo === "NGOAI_VUNG")).toBe(true);
    expect((await luu("dia-chi-g-sau-khi-luu", "GET", "/api/mobile/v1/parent/shipping/profile", undefined, G)).status).toBe(200);
    // 9. «Báo khi có hàng»
    const het2 = await sp("het-hang-mau", { ton: 0, gia: 150_000 });
    const noiBo = await sp("noi-bo-mau", { ton: 3 });
    await db.product.update({ where: { id: noiBo }, data: { sellOnline: false } });
    const rs = `/api/mobile/v1/parent/shop/products/${het2}/restock-notify`;
    expect((await luu("bao-co-hang-dang-ky-200", "POST", rs, {}, G)).status).toBe(200);
    expect((await luu("bao-co-hang-dang-ky-lap-200", "POST", rs, {}, G)).status).toBe(200);
    const ctP = await luu("chi-tiet-hoc-cu-da-dang-ky", "GET", `/api/mobile/v1/online/shop/products/${het2}`, undefined, G);
    expect(ctP.j.data.sanPham.daDangKyBaoCoHang).toBe(true);
    expect((await luu("bao-co-hang-san-pham-khong-ban-online-404", "POST", `/api/mobile/v1/parent/shop/products/${noiBo}/restock-notify`, {}, G)).status).toBe(404);
    expect((await luu("bao-co-hang-than-la-400", "POST", rs, { x: 1 }, G)).status).toBe(400);
    expect((await luu("bao-co-hang-huy-200", "DELETE", rs, {}, G)).status).toBe(200);
    expect((await luu("bao-co-hang-huy-lap-200", "DELETE", rs, {}, G)).status).toBe(200);
  });
});
