import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as datHangPost } from "@/app/api/mobile/v1/parent/cart/checkout/route";
import { POST as xacNhanPost } from "@/app/api/mobile/v1/parent/cart/dong-bi-go/xac-nhan/route";
import { DELETE as xoaDongDel, PATCH as suaDongPatch } from "@/app/api/mobile/v1/parent/cart/items/[itemId]/route";
import { POST as themPost } from "@/app/api/mobile/v1/parent/cart/items/route";
import { GET as gioGet, PATCH as gioPatch } from "@/app/api/mobile/v1/parent/cart/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { giuKho } from "@/lib/inventory/giu-kho";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [GH] V8.42 — GIỎ HÀNG CÓ HỌC CỤ (Commerce v2 · P0-A) qua route phụ huynh + Postgres thật.
 *   [GH-01] thêm học cụ: XOR strict với khoá; không đường nào gửi giá/tổng/phí; trần 1–100; DTO + tamTinh/tongTien/giaoHang do máy chủ; thêm lại ⇒ daCo, không đổi số lượng
 *   [GH-02] từ chối: hết hàng · không bán Online · không tồn tại · vượt trần · khoá Offline thật đưa vào như sản phẩm ⇒ 404
 *   [GH-03] PATCH số lượng + kẹp theo kho (DA_GIAM_SO_LUONG, ghi lại một lần, revision +1) · hết hàng ⇒ HET_HANG cần xử lý, không vào tạm tính
 *   [GH-04] giá đổi ⇒ giaDaDoi nhưng dòng VẪN hợp lệ; tạm tính theo giá mới
 *   [GH-05] sản phẩm ngừng kinh doanh ⇒ dòng bị GỠ + thông báo lưu theo giỏ, xác nhận một lần, idempotent, không lộ giỏ người khác
 *   [GH-06] PATCH học viên của dòng khoá: sở hữu (404), trùng cặp (409), đổi được; PATCH sai loại ⇒ 400
 *   [GH-07] giỏ hỗn hợp: tamTinh = khoá + học cụ; mã chỉ áp cho khoá; khuyenMai nói rõ phạm vi; mã lạ ⇒ hopLe=false
 *   [GH-08] đặt hàng khi giỏ có học cụ nhưng CHƯA có địa chỉ giao ⇒ 422 THIEU_DIA_CHI, không đơn, không giữ kho
 *   [GH-09] IDOR: sửa/xoá dòng của phụ huynh khác ⇒ 404; giữ kho đang có KHÔNG làm giỏ biến mất; thân lạ/giá giả ⇒ 400
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "gh842-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const item = (id: string) => ({ params: Promise.resolve({ itemId: id }) as never });
let n = 0;

describe.skipIf(!RUN)("[GH] giỏ hàng có học cụ — Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9d00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  const sp = async (k: string, d: { ton: number; gia?: number; toiDa?: number; sellOnline?: boolean }) =>
    (ids[k] = (await db.product.create({ data: { sku: `${NS}${k}`, name: `${NS}${k}`, category: "KIT_ROBOT", status: "ACTIVE", salePrice: d.gia ?? 100_000, stockOnHand: d.ton, sellOnline: d.sellOnline ?? true, onlineMaxQty: d.toiDa ?? null } as never, select: { id: true } })).id);
  async function dungKhoa(gia: number) {
    const t = await taoKhoa(db as never, { code: `GH842-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: false, renewalPrice: null } as never, null);
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
  const dongCuaSp = (g: { dong: Array<{ productId?: string }> }, productId: string) => g.dong.find((d) => d.productId === productId) as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any

  const xoa = async () => {
    const sps = (await db.product.findMany({ where: { sku: { startsWith: NS } }, select: { id: true } })).map((p) => p.id);
    const us = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
    const gios = (await db.cart.findMany({ where: { parentUserId: { in: us } }, select: { id: true } })).map((c) => c.id);
    await db.cartRemovedNotice.deleteMany({ where: { cartId: { in: gios } } });
    await db.cartItem.deleteMany({ where: { cartId: { in: gios } } });
    await db.cart.deleteMany({ where: { id: { in: gios } } });
    const oids = (await db.order.findMany({ where: { code: { startsWith: NS } }, select: { id: true } })).map((o) => o.id);
    await db.productReservation.deleteMany({ where: { OR: [{ productId: { in: sps } }, { orderItem: { orderId: { in: oids } } }] } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oids } } });
    await db.order.deleteMany({ where: { id: { in: oids } } });
    await db.productRestockSubscription.deleteMany({ where: { productId: { in: sps } } });
    await db.product.deleteMany({ where: { id: { in: sps } } });
    await donBangOnl(db);
    await db.mobileSession.deleteMany({ where: { userId: { in: us } } });
    await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: us } } });
    await db.student.deleteMany({ where: { id: { startsWith: NS } } });
    await db.course.deleteMany({ where: { slug: { startsWith: NS } } });
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
    await mk("A", "84966990001");
    await mk("B", "84966990002");
    for (const k of ["a1", "a2"]) await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids.A } as never });
    await db.student.create({ data: { id: `${NS}sb1`, name: "Bé B", parentUserId: ids.B } as never });
    tA = await dn("0966990001", 1);
    tB = await dn("0966990002", 2);
  }, 240_000);
  afterAll(async () => {
    await xoa();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 240_000);

  it("[GH-01] thêm học cụ: XOR strict, không có đường gửi giá; DTO + tổng do máy chủ; thêm lại ⇒ daCo", async () => {
    const p = await sp("robot", { ton: 12, gia: 1_290_000 });
    for (const thua of [{ productId: p, khoaId: "x", studentId: "y" }, { productId: p, studentId: ids.A }, { productId: p, donGia: 1 }, { productId: p, thanhTien: 1 }, { productId: p, phiVanChuyen: 0 }, { productId: p, soLuong: 0 }, { productId: p, soLuong: 101 }, { soLuong: 2 }, {}]) {
      expect((await them(tA, thua)).status, JSON.stringify(thua)).toBe(400);
    }
    const r = await json(await them(tA, { productId: p, soLuong: 2 }));
    expect(r.data).toMatchObject({ daCo: false });
    const g = r.data.gio;
    const d = dongCuaSp(g, p)!;
    expect(d).toMatchObject({ loai: "HOC_CU", productId: p, sku: `${NS}robot`, donGia: 1_290_000, soLuong: 2, thanhTien: 2_580_000, trangThai: "SAN_SANG", giaDaDoi: false, soLuongToiDa: 5, tonKho: { trangThai: "CON_HANG", conLai: null } });
    expect(g).toMatchObject({ tamTinh: 2_580_000, giamTong: 0, phiVanChuyen: 0, tongTien: 2_580_000, soDongSanSang: 1, soDongCanXuLy: 0, khuyenMai: null, dongBiGo: [], giaoHang: { yeuCau: true, phuongThuc: null, daCoDiaChi: false } });
    expect(typeof g.gioMayChu).toBe("string");
    const lai = await json(await them(tA, { productId: p, soLuong: 4 }));
    expect(lai.data).toMatchObject({ daCo: true, itemId: r.data.itemId });
    expect(dongCuaSp(lai.data.gio, p)!.soLuong).toBe(2); // thêm lại KHÔNG đổi số lượng (đổi bằng PATCH)
    expect(lai.data.revision).toBe(r.data.revision);
    expect((await them(tA, { productId: p }).then(ma))[0]).toBe(200);
  });

  it("[GH-02] từ chối: hết hàng · không bán Online · không tồn tại · vượt trần · khoá Offline thật như sản phẩm", async () => {
    const het = await sp("het", { ton: 0 });
    const tat = await sp("tat", { ton: 5, sellOnline: false });
    const gioiHan = await sp("gioi-han", { ton: 50, toiDa: 2 });
    expect(await ma(await them(tA, { productId: het }))).toEqual([409, "HET_HANG"]);
    expect(await ma(await them(tA, { productId: tat }))).toEqual([409, "KHONG_BAN_ONLINE"]);
    expect(await ma(await them(tA, { productId: "khong-co-that" }))).toEqual([404, "SAN_PHAM_KHONG_TON_TAI"]);
    expect(await ma(await them(tA, { productId: gioiHan, soLuong: 3 }))).toEqual([409, "SO_LUONG_VUOT_TOI_DA"]);
    const off = await db.course.create({ data: { name: `${NS}Offline`, slug: `${NS}off-${Date.now()}`, type: "OFFLINE", price: 1_000_000 } as never, select: { id: true } });
    expect(await ma(await them(tA, { productId: off.id }))).toEqual([404, "SAN_PHAM_KHONG_TON_TAI"]); // khoá Offline KHÔNG vào giỏ qua đường học cụ
    expect(await ma(await them(tA, { khoaId: off.id, studentId: `${NS}sa1` }))).toEqual([409, "LOAI_SAN_PHAM_CHUA_HO_TRO"]);
    expect(await db.cartItem.count({ where: { OR: [{ productId: { in: [het, tat] } }, { onlineCourseId: off.id }] } })).toBe(0);
  });

  it("[GH-03] PATCH số lượng + kẹp theo kho; hết hàng ⇒ cần xử lý và không vào tạm tính", async () => {
    const p = await sp("kep", { ton: 6, gia: 200_000, toiDa: 5 });
    const a = await json(await them(tB, { productId: p, soLuong: 3 }));
    const id = a.data.itemId as string;
    expect((await suaDongPatch(req("PATCH", "/x", { soLuong: 6 }, bearer(tB)), item(id))).status).toBe(409); // vượt trần 5
    const s1 = await json(await suaDongPatch(req("PATCH", "/x", { soLuong: 5 }, bearer(tB)), item(id)));
    expect(dongCuaSp(s1.data.gio, p)).toMatchObject({ soLuong: 5, thanhTien: 1_000_000, trangThai: "SAN_SANG" });
    await db.product.update({ where: { id: p }, data: { stockOnHand: 2 } }); // kho tụt còn 2
    const g = await gio(tB);
    expect(dongCuaSp(g, p)).toMatchObject({ soLuong: 2, thanhTien: 400_000, trangThai: "DA_GIAM_SO_LUONG", tonKho: { trangThai: "CHI_CON", conLai: 2 } });
    expect(g).toMatchObject({ tamTinh: 400_000, soDongSanSang: 1, soDongCanXuLy: 0 }); // DA_GIAM_SO_LUONG VẪN là dòng hợp lệ
    const luu = await db.cartItem.findUniqueOrThrow({ where: { id }, select: { quantity: true } });
    expect(luu.quantity).toBe(5); // kẹp theo kho KHÔNG ghi đè ý định ban đầu
    const rev = g.revision as number;
    expect((await gio(tB)).revision).toBe(rev); // GET thuần đọc: không đổi revision
    expect(dongCuaSp(await gio(tB), p)).toMatchObject({ soLuong: 2, trangThai: "DA_GIAM_SO_LUONG" }); // và trạng thái VẪN còn khi gọi lại
    await db.product.update({ where: { id: p }, data: { stockOnHand: 9 } }); // kho hồi
    expect(dongCuaSp(await gio(tB), p)).toMatchObject({ soLuong: 5, trangThai: "SAN_SANG" }); // quay về ý định ban đầu
    await db.product.update({ where: { id: p }, data: { stockOnHand: 2 } });
    await db.product.update({ where: { id: p }, data: { stockOnHand: 0 } });
    const h = await gio(tB);
    expect(dongCuaSp(h, p)).toMatchObject({ trangThai: "HET_HANG", lyDo: "HET_HANG", thanhTien: 0, tonKho: { trangThai: "HET_HANG" } });
    expect(h).toMatchObject({ tamTinh: 0, tongTien: 0, soDongSanSang: 0, soDongCanXuLy: 1 });
    expect(await ma(await suaDongPatch(req("PATCH", "/x", { soLuong: 1, studentId: "x" }, bearer(tB)), item(id)))).toEqual([400, "SAI_LOAI_DONG"]); // học cụ không có học viên
  });

  it("[GH-04] giá đổi ⇒ giaDaDoi nhưng dòng VẪN hợp lệ; tạm tính theo giá mới", async () => {
    const p = await sp("gia", { ton: 9, gia: 1_690_000 });
    await them(tB, { productId: p });
    await db.product.update({ where: { id: p }, data: { salePrice: 1_590_000 } });
    const g = await gio(tB);
    expect(dongCuaSp(g, p)).toMatchObject({ donGia: 1_590_000, donGiaLucThem: 1_690_000, giaDaDoi: true, trangThai: "SAN_SANG" });
    expect(g.soDongCanXuLy).toBe(1); // dòng «kep»/«het» ở ca trước vẫn còn; dòng này không thêm việc
  });

  it("[GH-05] sản phẩm ngừng kinh doanh ⇒ dòng bị GỠ + thông báo lưu theo giỏ; xác nhận một lần; không lộ giỏ người khác", async () => {
    const p = await sp("ngung", { ton: 9 });
    const x = await json(await them(tA, { productId: p }));
    await db.product.update({ where: { id: p }, data: { status: "DISCONTINUED" } });
    const g = await gio(tA);
    expect(dongCuaSp(g, p)).toBeUndefined();
    expect(g.dongBiGo).toHaveLength(1);
    expect(g.dongBiGo[0]).toMatchObject({ ten: `${NS}ngung`, lyDo: "SAN_PHAM_NGUNG_BAN" });
    expect(g.revision).toBe(x.data.revision + 1); // đúng MỘT lần tăng
    expect((await gio(tA)).dongBiGo).toHaveLength(1); // trả lại ở MỌI GET cho tới khi xác nhận (xoay máy/thiết bị khác không làm mất)
    expect((await gio(tB)).dongBiGo).toEqual([]); // không lộ giỏ người khác
    const nhamB = await json(await xacNhanPost(req("POST", "/x", { ids: [g.dongBiGo[0].id] }, bearer(tB))));
    expect(nhamB.data.soDaXacNhan).toBe(0); // B không xác nhận được thông báo của A
    const ok = await json(await xacNhanPost(req("POST", "/x", {}, bearer(tA))));
    expect(ok.data).toMatchObject({ soDaXacNhan: 1 });
    expect(ok.data.gio.dongBiGo).toEqual([]);
    expect(ok.data.gio.revision).toBe(g.revision); // xác nhận KHÔNG đổi revision
    expect((await json(await xacNhanPost(req("POST", "/x", {}, bearer(tA))))).data.soDaXacNhan).toBe(0); // idempotent
    expect((await xacNhanPost(req("POST", "/x", { x: 1 }, bearer(tA)))).status).toBe(400);
  });

  it("[GH-06] PATCH học viên của dòng khoá: sở hữu, trùng cặp, đổi được; sai loại ⇒ 400", async () => {
    const k = await dungKhoa(500_000);
    const a = await json(await them(tA, { khoaId: k, studentId: `${NS}sa1` }));
    const id = a.data.itemId as string;
    expect(await ma(await suaDongPatch(req("PATCH", "/x", { studentId: `${NS}sb1` }, bearer(tA)), item(id)))).toEqual([404, "NOT_FOUND"]); // con nhà khác
    const ok = await json(await suaDongPatch(req("PATCH", "/x", { studentId: `${NS}sa2` }, bearer(tA)), item(id)));
    expect(ok.data.gio.dong.find((d: Record<string, unknown>) => d.itemId === id)).toMatchObject({ studentId: `${NS}sa2`, trangThai: "SAN_SANG" });
    await them(tA, { khoaId: k, studentId: `${NS}sa1` });
    expect(await ma(await suaDongPatch(req("PATCH", "/x", { studentId: `${NS}sa1` }, bearer(tA)), item(id)))).toEqual([409, "DONG_DA_CO_TRONG_GIO"]);
    expect((await suaDongPatch(req("PATCH", "/x", { soLuong: 2 }, bearer(tA)), item(id))).status).toBe(400); // khoá không có số lượng
    expect((await suaDongPatch(req("PATCH", "/x", {}, bearer(tA)), item(id))).status).toBe(400);
    const p = ids["robot"]!;
    const hc = (await gio(tA)).dong.find((d: { productId?: string }) => d.productId === p).itemId as string;
    expect((await suaDongPatch(req("PATCH", "/x", { studentId: `${NS}sa1` }, bearer(tA)), item(hc))).status).toBe(400); // học cụ không có học viên
  });

  it("[GH-07] giỏ hỗn hợp: tamTinh = khoá + học cụ; mã chỉ áp cho khoá; khuyenMai nói rõ phạm vi; mã lạ ⇒ hopLe=false", async () => {
    const before = await gio(tA);
    expect(before.khuyenMai).toBeNull();
    const dungCho = (before.dong as Array<Record<string, any>>).filter((d) => d.trangThai === "SAN_SANG" || d.trangThai === "DA_GIAM_SO_LUONG"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const tong = dungCho.reduce((s, d) => s + (d.loai === "HOC_CU" ? d.thanhTien : d.donGia ?? 0), 0);
    expect(before.tamTinh).toBe(tong);
    const m = await json(await gioPatch(req("PATCH", "/x", { maGiamGia: "UATB-KHONG-CO" }, bearer(tA))));
    expect(m.data.gio.khuyenMai).toMatchObject({ ma: "UATB-KHONG-CO", hopLe: false, apDungCho: ["ONLINE_COURSE"], khongApDungCho: ["HOC_CU"] });
    expect(typeof m.data.gio.khuyenMai.moTa).toBe("string");
    const hocCuRows = await db.cartItem.findMany({ where: { cart: { parentUserId: ids.A }, itemType: "PHYSICAL_GOOD" }, select: { maGiamGia: true } });
    expect(hocCuRows.length).toBeGreaterThan(0);
    expect(hocCuRows.every((r) => r.maGiamGia === null)).toBe(true); // mã KHÔNG ghi vào dòng học cụ
    await gioPatch(req("PATCH", "/x", { maGiamGia: null }, bearer(tA)));
  });

  it("[GH-08] đặt hàng khi giỏ có học cụ mà CHƯA có địa chỉ ⇒ 422 THIEU_DIA_CHI, KHÔNG tạo đơn nửa vời (đường đặt hoàn chỉnh: online-don-hon-hop.spec)", async () => {
    const g = await gio(tA);
    expect(await ma(await datHangPost(req("POST", "/x", { revision: g.revision }, bearer(tA))))).toEqual([422, "THIEU_DIA_CHI"]);
    const hocCu = g.dong.find((d: { loai: string }) => d.loai === "HOC_CU");
    expect(await ma(await datHangPost(req("POST", "/x", { revision: g.revision, itemIds: [hocCu.itemId] }, bearer(tA))))).toEqual([422, "THIEU_DIA_CHI"]); // chọn tường minh dòng học cụ cũng cần địa chỉ
    expect(await db.order.count({ where: { createdById: ids.A, type: "ONLINE" } })).toBe(0); // không đơn nào được tạo
    expect(await db.productReservation.count({ where: { orderItem: { order: { createdById: ids.A } } } })).toBe(0); // không giữ kho
    expect((await gio(tA)).revision).toBeGreaterThanOrEqual(g.revision);
  });

  it("[GH-10] sản phẩm bị TẮT bán Online / tạm ngưng sau khi đã vào giỏ ⇒ KHONG_BAN_ONLINE, cần xử lý, không vào tạm tính; bật lại ⇒ hợp lệ lại", async () => {
    const p = await sp("tat-sau", { ton: 9, gia: 300_000 });
    await them(tB, { productId: p });
    const truoc = await gio(tB);
    expect(dongCuaSp(truoc, p)).toMatchObject({ trangThai: "SAN_SANG" });
    await db.product.update({ where: { id: p }, data: { sellOnline: false } });
    const g1 = await gio(tB);
    expect(dongCuaSp(g1, p)).toMatchObject({ trangThai: "KHONG_BAN_ONLINE", lyDo: "SAN_PHAM_NGUNG_BAN", thanhTien: 0 });
    expect(g1.soDongCanXuLy).toBe(truoc.soDongCanXuLy + 1);
    expect(g1.tamTinh).toBe(truoc.tamTinh - 300_000); // không còn tính vào tạm tính
    expect(g1.dongBiGo).toEqual([]); // chưa phải ngừng kinh doanh vĩnh viễn ⇒ KHÔNG gỡ
    await db.product.update({ where: { id: p }, data: { sellOnline: true, status: "PAUSED" } });
    expect(dongCuaSp(await gio(tB), p)).toMatchObject({ trangThai: "KHONG_BAN_ONLINE" }); // tạm ngưng cũng vậy
    await db.product.update({ where: { id: p }, data: { status: "ACTIVE" } });
    expect(dongCuaSp(await gio(tB), p)).toMatchObject({ trangThai: "SAN_SANG", thanhTien: 300_000 });
  });

  it("[GH-09] IDOR: sửa/xoá dòng người khác ⇒ 404; giữ kho đang có không làm giỏ biến mất; thân lạ ⇒ 400", async () => {
    const p = await sp("idor", { ton: 20 });
    const a = await json(await them(tA, { productId: p, soLuong: 2 }));
    const id = a.data.itemId as string;
    expect(await ma(await suaDongPatch(req("PATCH", "/x", { soLuong: 4 }, bearer(tB)), item(id)))).toEqual([404, "DONG_KHONG_THUOC_GIO"]);
    expect(await ma(await xoaDongDel(req("DELETE", "/x", undefined, bearer(tB)), item(id)))).toEqual([404, "DONG_KHONG_THUOC_GIO"]);
    expect((await db.cartItem.findUniqueOrThrow({ where: { id }, select: { quantity: true } })).quantity).toBe(2);
    for (const thua of [{ soLuong: 3, donGia: 1 }, { soLuong: 3, tongTien: 0 }, { soLuong: -1 }, { soLuong: 1.5 }]) expect((await suaDongPatch(req("PATCH", "/x", thua, bearer(tA)), item(id))).status, JSON.stringify(thua)).toBe(400);
    // một đơn khác đang GIỮ kho cho sản phẩm này: giỏ của A KHÔNG bị đụng; tồn khả dụng giảm đúng
    const o = await db.order.create({ data: { code: `${NS}ORD-1`, type: "ONLINE", status: "PENDING_PAYMENT", customerName: "x", customerPhone: "0", subtotal: 0, totalAmount: 0 } as never, select: { id: true } });
    const oi = await db.orderItem.create({ data: { orderId: o.id, type: "PRODUCT", productId: p, itemName: "x", quantity: 19, unitPrice: 1, totalPrice: 19 } as never, select: { id: true } });
    expect((await db.$transaction((tx) => giuKho(tx, { dong: [{ orderItemId: oi.id, productId: p, soLuong: 19 }], now: new Date(), ttlPhut: 15 }))).ok).toBe(true);
    const g = await gio(tA);
    expect(dongCuaSp(g, p)).toMatchObject({ soLuong: 1, trangThai: "DA_GIAM_SO_LUONG", tonKho: { trangThai: "CHI_CON", conLai: 1 } }); // còn 20 − 19 giữ = 1
    expect((await db.cartItem.findUnique({ where: { id } }))).not.toBeNull(); // dòng vẫn còn (giữ kho của người khác không xoá giỏ)
    expect((await xoaDongDel(req("DELETE", "/x", undefined, bearer(tA)), item(id))).status).toBe(200);
    expect(await db.cartItem.count({ where: { id } })).toBe(0);
    await db.productReservation.deleteMany({ where: { orderItemId: oi.id } });
    await db.orderItem.deleteMany({ where: { id: oi.id } });
    await db.order.deleteMany({ where: { id: o.id } });
  });
});
