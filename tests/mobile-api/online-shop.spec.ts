import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as danhMucGet } from "@/app/api/mobile/v1/online/shop/products/route";
import { GET as motGet } from "@/app/api/mobile/v1/online/shop/products/[id]/route";
import { DELETE as huyDel, POST as baoPost } from "@/app/api/mobile/v1/parent/shop/products/[id]/restock-notify/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { giuKho } from "@/lib/inventory/giu-kho";
import { guiThongBaoCoHangLai } from "@/lib/online-checkout/danh-muc-hoc-cu";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [SHOP] V8.42 — DANH MỤC HỌC CỤ BÁN ONLINE + «BÁO KHI CÓ HÀNG» qua route phụ huynh + Postgres thật.
 *   [SHOP-01] xác thực + chỉ sản phẩm bán Online/đang bán; KHÔNG lộ giá vốn/tồn thật khi dồi dào
 *   [SHOP-02] tồn khả dụng trừ phần ĐANG GIỮ (giữ kho còn hạn) — hết hạn thì trả lại
 *   [SHOP-03] biến thể cùng nhóm; mua kèm chỉ gồm sản phẩm cũng bán Online
 *   [SHOP-04] một sản phẩm: không bán Online/không tồn tại/id dài ⇒ cùng 404; tham số lạ ⇒ 400
 *   [SHOP-05] báo khi có hàng: idempotent, cá nhân hoá, huỷ, thân lạ ⇒ 400, sản phẩm không bán Online ⇒ 404
 *   [SHOP-06] gửi thông báo hàng về: chỉ khi CÒN HÀNG, một lần/đăng ký, trung tính, đăng ký lại ⇒ báo lại
 *   [SHOP-07] cờ Online tắt ⇒ 404
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "shop842-";
const MK = "Mat-khau-test-2026";
const NOW = new Date("2026-11-24T10:00:00.000Z");
let dem = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const ctx = (id: string) => ({ params: Promise.resolve({ id }) as never });

describe.skipIf(!RUN)("[SHOP] danh mục học cụ Online — Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9c00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  const sp = async (k: string, d: { ton: number; sellOnline?: boolean; status?: "ACTIVE" | "DRAFT"; nhom?: string; nhan?: string; toiDa?: number }) =>
    (ids[k] = (await db.product.create({ data: { sku: `${NS}${k}`, name: `${NS}${k}`, category: "KIT_ROBOT", status: d.status ?? "ACTIVE", salePrice: 100_000 + k.length, costPrice: 77_777, stockOnHand: d.ton, sellOnline: d.sellOnline ?? true, onlineGroupKey: d.nhom ?? null, onlineVariantLabel: d.nhan ?? null, onlineMaxQty: d.toiDa ?? null } as never, select: { id: true } })).id);
  const xoa = async () => {
    const sps = (await db.product.findMany({ where: { sku: { startsWith: NS } }, select: { id: true } })).map((p) => p.id);
    const us = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
    const oids = (await db.order.findMany({ where: { code: { startsWith: NS } }, select: { id: true } })).map((o) => o.id);
    await db.notification.deleteMany({ where: { dedupeKey: { startsWith: "restock:" } } });
    await db.productReservation.deleteMany({ where: { productId: { in: sps } } });
    await db.productRestockSubscription.deleteMany({ where: { productId: { in: sps } } });
    await db.productOnlineAddon.deleteMany({ where: { productId: { in: sps } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oids } } });
    await db.order.deleteMany({ where: { id: { in: oids } } });
    await db.product.deleteMany({ where: { id: { in: sps } } });
    await db.mobileSession.deleteMany({ where: { userId: { in: us } } });
    await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: us } } });
    await db.student.deleteMany({ where: { id: { startsWith: NS } } });
    await db.authAttemptCounter.deleteMany({});
    await db.user.deleteMany({ where: { id: { in: us } } });
  };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await xoa();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `ND ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966980001");
    await mk("B", "84966980002");
    await db.student.create({ data: { id: `${NS}sa`, name: "Bé A", parentUserId: ids.A } as never });
    await db.student.create({ data: { id: `${NS}sb`, name: "Bé B", parentUserId: ids.B } as never });
    tA = await dn("0966980001", 1);
    tB = await dn("0966980002", 2);
  }, 240_000);
  afterAll(async () => {
    await xoa();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 240_000);

  it("[SHOP-01] xác thực; chỉ sản phẩm bán Online + đang bán; không lộ giá vốn / tồn thật khi dồi dào", async () => {
    await sp("a-doi-dao", { ton: 12 });
    await sp("b-chi-con", { ton: 3 });
    await sp("c-het", { ton: 0 });
    await sp("d-tat", { ton: 9, sellOnline: false });
    await sp("e-nhap", { ton: 9, status: "DRAFT" });
    expect((await danhMucGet(req("GET", "/x"))).status).toBe(401);
    const r = await json(await danhMucGet(req("GET", `/x?q=${NS}`, undefined, bearer(tA))));
    const muc = r.data.muc as Array<{ sku: string; tonKho: { trangThai: string; conLai: number | null }; donGia: number; soLuongToiDa: number }>;
    expect(muc.map((m) => m.sku).sort()).toEqual([`${NS}a-doi-dao`, `${NS}b-chi-con`, `${NS}c-het`]);
    const theo = (k: string) => muc.find((m) => m.sku === `${NS}${k}`)!;
    expect(theo("a-doi-dao").tonKho).toEqual({ trangThai: "CON_HANG", conLai: null });
    expect(theo("b-chi-con").tonKho).toEqual({ trangThai: "CHI_CON", conLai: 3 });
    expect(theo("c-het").tonKho).toEqual({ trangThai: "HET_HANG", conLai: null });
    expect(theo("a-doi-dao").soLuongToiDa).toBe(5);
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/costPrice|77777|stockOnHand|minThreshold/); // không giá vốn / tồn thật (12 chỉ lộ ở dạng trạng thái)
    expect(JSON.stringify(theo("a-doi-dao"))).not.toMatch(/"conLai":12/);
  });

  it("[SHOP-02] tồn khả dụng trừ phần ĐANG GIỮ (còn hạn); hết hạn thì trả lại", async () => {
    const p = await sp("f-giu", { ton: 8 });
    const o = await db.order.create({ data: { code: `${NS}ORD-1`, type: "ONLINE", status: "PENDING_PAYMENT", customerName: "x", customerPhone: "0", subtotal: 0, totalAmount: 0 } as never, select: { id: true } });
    const it = await db.orderItem.create({ data: { orderId: o.id, type: "PRODUCT", productId: p, itemName: "x", quantity: 4, unitPrice: 1, totalPrice: 4 } as never, select: { id: true } });
    const gi = await db.$transaction((tx) => giuKho(tx, { dong: [{ orderItemId: it.id, productId: p, soLuong: 4 }], now: new Date(), ttlPhut: 15 }));
    expect(gi.ok).toBe(true);
    const doc = async () => ((await json(await motGet(req("GET", "/x", undefined, bearer(tA)), ctx(p)))).data.sanPham.tonKho) as { trangThai: string; conLai: number | null };
    expect(await doc()).toEqual({ trangThai: "CHI_CON", conLai: 4 }); // 8 − 4 giữ = 4
    await db.productReservation.updateMany({ where: { orderItemId: it.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect(await doc()).toEqual({ trangThai: "CON_HANG", conLai: null }); // hết hạn ⇒ trả lại toàn bộ: 8 − 0 = 8 > ngưỡng 5 ⇒ CON_HANG (không lộ số)
  });

  it("[SHOP-03] biến thể cùng nhóm; mua kèm chỉ gồm sản phẩm cũng bán Online", async () => {
    const std = await sp("g-std", { ton: 10, nhom: `${NS}nhom`, nhan: "Standard", toiDa: 2 });
    const pro = await sp("g-pro", { ton: 10, nhom: `${NS}nhom`, nhan: "Pro" });
    const tatBienThe = await sp("g-tat", { ton: 10, nhom: `${NS}nhom`, nhan: "Cũ", sellOnline: false });
    const kem1 = await sp("h-kem1", { ton: 10 });
    const kem2 = await sp("h-kem2", { ton: 10, sellOnline: false });
    await db.productOnlineAddon.createMany({ data: [{ productId: std, addonProductId: kem1, sortOrder: 2 }, { productId: std, addonProductId: kem2, sortOrder: 1 }] });
    const r = await json(await motGet(req("GET", "/x", undefined, bearer(tA)), ctx(std)));
    expect(r.data.sanPham).toMatchObject({ id: std, nhom: { khoa: `${NS}nhom`, nhanBienThe: "Standard" }, soLuongToiDa: 2, muaKem: [kem1] });
    const bt = (r.data.bienThe as Array<{ id: string }>).map((x) => x.id);
    expect(bt.sort()).toEqual([std, pro].sort());
    expect(bt).not.toContain(tatBienThe);
  });

  it("[SHOP-04] một sản phẩm: không bán Online / không tồn tại / id dài ⇒ cùng 404; tham số lạ ⇒ 400", async () => {
    expect(await ma(await motGet(req("GET", "/x", undefined, bearer(tA)), ctx(ids["d-tat"]!)))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await motGet(req("GET", "/x", undefined, bearer(tA)), ctx(ids["e-nhap"]!)))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await motGet(req("GET", "/x", undefined, bearer(tA)), ctx("khong-co-that")))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await motGet(req("GET", "/x", undefined, bearer(tA)), ctx("x".repeat(65))))).toEqual([404, "NOT_FOUND"]);
    for (const q of ["danhMuc=KHONG_CO", "trang=0", "soLuong=51", "x=1"]) expect((await danhMucGet(req("GET", `/x?${q}`, undefined, bearer(tA)))).status, q).toBe(400);
  });

  it("[SHOP-05] báo khi có hàng: idempotent, cá nhân hoá, huỷ, thân lạ ⇒ 400, sản phẩm không bán Online ⇒ 404", async () => {
    const p = ids["c-het"]!;
    expect((await baoPost(req("POST", "/x", {}, bearer(tA)), ctx(p))).status).toBe(200);
    expect((await baoPost(req("POST", "/x", {}, bearer(tA)), ctx(p))).status).toBe(200); // lặp
    expect(await db.productRestockSubscription.count({ where: { productId: p, parentUserId: ids.A } })).toBe(1);
    const dsA = (await json(await danhMucGet(req("GET", `/x?q=${NS}c-het`, undefined, bearer(tA))))).data.muc[0];
    const dsB = (await json(await danhMucGet(req("GET", `/x?q=${NS}c-het`, undefined, bearer(tB))))).data.muc[0];
    expect([dsA.daDangKyBaoCoHang, dsB.daDangKyBaoCoHang]).toEqual([true, false]); // cá nhân hoá, không lộ người khác
    expect((await baoPost(req("POST", "/x", { x: 1 }, bearer(tA)), ctx(p))).status).toBe(400);
    expect(await ma(await baoPost(req("POST", "/x", {}, bearer(tA)), ctx(ids["d-tat"]!)))).toEqual([404, "NOT_FOUND"]);
    expect((await baoPost(req("POST", "/x", {}), ctx(p))).status).toBe(401);
    expect((await huyDel(req("DELETE", "/x", {}, bearer(tA)), ctx(p))).status).toBe(200);
    expect((await huyDel(req("DELETE", "/x", {}, bearer(tA)), ctx(p))).status).toBe(200); // huỷ lặp
    expect(await db.productRestockSubscription.count({ where: { productId: p, parentUserId: ids.A } })).toBe(0);
  });

  it("[SHOP-06] thông báo hàng về: chỉ khi CÒN HÀNG; một lần/đăng ký; trung tính; đăng ký lại ⇒ báo lại", async () => {
    const p = ids["c-het"]!;
    await baoPost(req("POST", "/x", {}, bearer(tA)), ctx(p));
    await baoPost(req("POST", "/x", {}, bearer(tB)), ctx(p));
    expect(await guiThongBaoCoHangLai(db as never, { productId: p, now: NOW })).toBe(0); // vẫn hết hàng
    await db.product.update({ where: { id: p }, data: { stockOnHand: 4 } });
    const gui = await Promise.all([guiThongBaoCoHangLai(db as never, { productId: p, now: NOW }), guiThongBaoCoHangLai(db as never, { productId: p, now: NOW })]);
    expect(gui[0] + gui[1]).toBe(2); // hai người đăng ký, mỗi người đúng MỘT thông báo dù gọi song song
    expect(await guiThongBaoCoHangLai(db as never, { productId: p, now: NOW })).toBe(0);
    const tb = await db.notification.findMany({ where: { dedupeKey: { startsWith: `restock:${p}:` } }, select: { title: true, body: true, studentId: true } });
    expect(tb).toHaveLength(2);
    expect(tb.map((x) => x.studentId).sort()).toEqual([`${NS}sa`, `${NS}sb`]);
    expect(JSON.stringify(tb)).not.toMatch(/\d{4,}|đồng|giá|còn \d/i); // không giá, không số lượng
    // A đăng ký LẠI sau khi đã được báo, hàng hết rồi về lại ⇒ báo lại (dedupeKey mới)
    await db.product.update({ where: { id: p }, data: { stockOnHand: 0 } });
    await baoPost(req("POST", "/x", {}, bearer(tA)), ctx(p));
    await db.product.update({ where: { id: p }, data: { stockOnHand: 6 } });
    expect(await guiThongBaoCoHangLai(db as never, { productId: p, now: NOW })).toBe(1);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `restock:${p}:` } } })).toBe(3);
  });

  it("[SHOP-07] cờ Online tắt ⇒ 404 ở mọi route", async () => {
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    try {
      expect((await danhMucGet(req("GET", "/x", undefined, bearer(tA)))).status).toBe(404);
      expect((await motGet(req("GET", "/x", undefined, bearer(tA)), ctx(ids["a-doi-dao"]!))).status).toBe(404);
      expect((await baoPost(req("POST", "/x", {}, bearer(tA)), ctx(ids["a-doi-dao"]!))).status).toBe(404);
    } finally {
      process.env.ELEARNING_ONLINE_ENABLED = "true";
    }
  });
});
