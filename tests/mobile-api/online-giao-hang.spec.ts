import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as themPost } from "@/app/api/mobile/v1/parent/cart/items/route";
import { GET as gioGet, PATCH as gioPatch } from "@/app/api/mobile/v1/parent/cart/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as phuongThucGet } from "@/app/api/mobile/v1/parent/shipping/methods/route";
import { GET as diaChiGet, PUT as diaChiPut } from "@/app/api/mobile/v1/parent/shipping/profile/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [GHG-DB] V8.43 — GIAO HÀNG (Commerce v2 · P0) qua route phụ huynh + Postgres thật. Mọi mức phí/khu vực/phương thức trong test là DỮ LIỆU TEST do chính test tạo — mã không chứa số tiền nào.
 *   [GHG-01] địa chỉ: GET luôn 200 (chưa có ⇒ daCo:false + goiY); PUT strict, đủ 5 trường, SĐT hợp lệ ⇒ lỗi 422 kèm trường; cá nhân hoá, không lộ người khác
 *   [GHG-02] phương thức theo địa chỉ: chưa địa chỉ ⇒ CHUA_CO_DIA_CHI; giao nhanh CHỈ ở khu vực có rate; ngoài vùng ⇒ NGOAI_VUNG; tên tỉnh chấp nhận biến thể; method/rate tắt ⇒ ẩn/ngoài vùng
 *   [GHG-03] giỏ: học cụ + địa chỉ + phương thức ⇒ phiVanChuyen/tongTien do máy chủ; thiếu địa chỉ/chưa chọn/không áp dụng ⇒ vanDe (phí 0); miễn phí theo ngưỡng; giỏ CHỈ khoá không đòi giao hàng
 *   [GHG-04] giả mạo: gửi phí/tổng ⇒ 400; phương thức lạ ⇒ 422; revision cũ ⇒ 409; đổi cấu hình rate ⇒ giỏ tính lại (không có số cũ nào được lưu)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "ghg843-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.99.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; truong?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const DC = { hoTen: "Nguyễn Thu Hà", soDienThoai: "0905412118", tinhThanh: "TP Đà Nẵng", phuongXa: "P. Ngũ Hành Sơn", soNhaDuong: "12 Lê Văn Hiến" };

describe.skipIf(!RUN)("[GHG-DB] giao hàng — Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9e00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  const diaChi = (t: string, body: unknown) => diaChiPut(req("PUT", "/x", body, bearer(t)));
  const gio = async (t: string) => (await json(await gioGet(req("GET", "/x", undefined, bearer(t))))).data;
  const pt = async (t: string) => (await json(await phuongThucGet(req("GET", "/x", undefined, bearer(t))))).data;
  const datPt = (t: string, body: unknown) => gioPatch(req("PATCH", "/x", body, bearer(t)));

  const xoa = async () => {
    const us = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
    const sps = (await db.product.findMany({ where: { sku: { startsWith: NS } }, select: { id: true } })).map((p) => p.id);
    const gios = (await db.cart.findMany({ where: { parentUserId: { in: us } }, select: { id: true } })).map((c) => c.id);
    await db.cartItem.deleteMany({ where: { cartId: { in: gios } } });
    await db.cart.deleteMany({ where: { id: { in: gios } } });
    await db.product.deleteMany({ where: { id: { in: sps } } });
    await db.parentShippingAddress.deleteMany({ where: { parentUserId: { in: us } } });
    await db.shippingRate.deleteMany({ where: { method: { code: { startsWith: "T843" } } } });
    await db.shippingMethod.deleteMany({ where: { code: { startsWith: "T843" } } });
    await db.shippingZone.deleteMany({ where: { code: { startsWith: "T843" } } });
    await donBangOnl(db);
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
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `Phụ huynh ${k}`, phone: sdt, address: "Gợi ý: 1 Đường Test", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966910001");
    await mk("B", "84966910002");
    await db.student.create({ data: { id: `${NS}sa`, name: "Bé A", parentUserId: ids.A } as never });
    tA = await dn("0966910001", 1);
    tB = await dn("0966910002", 2);
    // Dữ liệu TEST (không phải chính sách): DN = Đà Nẵng, HN = Hà Nội; STANDARD ở cả hai, EXPRESS CHỈ ở DN; STANDARD miễn phí từ 5.000.000 ở DN.
    const dnZ = await db.shippingZone.create({ data: { code: "T843_DN", name: "Đà Nẵng", provinces: ["Đà Nẵng"] }, select: { id: true } });
    const hnZ = await db.shippingZone.create({ data: { code: "T843_HN", name: "Hà Nội", provinces: ["Hà Nội"] }, select: { id: true } });
    ids.std = (await db.shippingMethod.create({ data: { code: "T843_STD", name: "Giao tiêu chuẩn", etaText: "2–4 ngày làm việc", sortOrder: 1 }, select: { id: true } })).id;
    ids.exp = (await db.shippingMethod.create({ data: { code: "T843_EXP", name: "Giao nhanh", etaText: "1–2 ngày làm việc", sortOrder: 2 }, select: { id: true } })).id;
    ids.tat = (await db.shippingMethod.create({ data: { code: "T843_OFF", name: "Đã tắt", sortOrder: 3, isActive: false }, select: { id: true } })).id;
    ids.rStdDn = (await db.shippingRate.create({ data: { methodId: ids.std!, zoneId: dnZ.id, fee: 30_000, freeAboveAmount: 5_000_000 }, select: { id: true } })).id;
    await db.shippingRate.create({ data: { methodId: ids.std!, zoneId: hnZ.id, fee: 45_000 } });
    await db.shippingRate.create({ data: { methodId: ids.exp!, zoneId: dnZ.id, fee: 50_000 } });
    ids.sp1 = (await db.product.create({ data: { sku: `${NS}rb`, name: `${NS}Robot`, category: "KIT_ROBOT", status: "ACTIVE", salePrice: 1_000_000, stockOnHand: 50, sellOnline: true } as never, select: { id: true } })).id;
  }, 240_000);
  afterAll(async () => {
    await xoa();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 240_000);

  it("[GHG-01] địa chỉ: GET luôn 200 + goiY; PUT strict/đủ trường/SĐT hợp lệ; cá nhân hoá", async () => {
    expect((await diaChiGet(req("GET", "/x"))).status).toBe(401);
    const g0 = await json(await diaChiGet(req("GET", "/x", undefined, bearer(tA))));
    expect(g0.data).toMatchObject({ daCo: false, goiY: { hoTen: "Phụ huynh A", diaChi: "Gợi ý: 1 Đường Test" } });
    expect(await db.parentShippingAddress.count({ where: { parentUserId: ids.A } })).toBe(0); // gợi ý KHÔNG tự lưu
    for (const k of ["hoTen", "soDienThoai", "tinhThanh", "phuongXa", "soNhaDuong"] as const) {
      const r = await diaChi(tA, { ...DC, [k]: "  " });
      expect(r.status, k).toBe(422);
      const j = await json(r);
      expect(j.error).toMatchObject({ code: "DIA_CHI_KHONG_HOP_LE" });
    }
    expect((await diaChi(tA, { ...DC, soDienThoai: "12345" })).status).toBe(422);
    expect((await diaChi(tA, { ...DC, phi: 0 })).status).toBe(400); // khoá lạ
    expect((await diaChi(tA, { hoTen: "x" })).status).toBe(400);
    const ok = await json(await diaChi(tA, DC));
    expect(ok.data).toMatchObject({ daCo: true, hoTen: "Nguyễn Thu Hà", soDienThoai: "0905412118", tinhThanh: "TP Đà Nẵng", diaChiMotDong: "12 Lê Văn Hiến, P. Ngũ Hành Sơn, TP Đà Nẵng" });
    const sua = await json(await diaChi(tA, { ...DC, soNhaDuong: "99 Nguyễn Văn Linh" }));
    expect(sua.data.soNhaDuong).toBe("99 Nguyễn Văn Linh");
    expect(await db.parentShippingAddress.count({ where: { parentUserId: ids.A } })).toBe(1); // ghi đè, không nhân đôi
    const gB = await json(await diaChiGet(req("GET", "/x", undefined, bearer(tB))));
    expect(gB.data.daCo).toBe(false); // không lộ địa chỉ của A
  });

  it("[GHG-02] phương thức theo địa chỉ: giao nhanh chỉ ở khu vực có rate; ngoài vùng; biến thể tên tỉnh", async () => {
    const truoc = await pt(tB);
    expect(truoc.phuongThuc.map((m: { ma: string; khaDung: boolean; lyDo: string }) => [m.ma, m.khaDung, m.lyDo])).toEqual([["T843_STD", false, "CHUA_CO_DIA_CHI"], ["T843_EXP", false, "CHUA_CO_DIA_CHI"]]); // method tắt KHÔNG hiện
    const dnPt = (await pt(tA)).phuongThuc as Array<{ ma: string; ten: string; moTa: string | null; phi: number; khaDung: boolean; lyDo: string | null }>;
    expect(dnPt).toEqual([
      { ma: "T843_STD", ten: "Giao tiêu chuẩn", moTa: "2–4 ngày làm việc", phi: 30_000, khaDung: true, lyDo: null },
      { ma: "T843_EXP", ten: "Giao nhanh", moTa: "1–2 ngày làm việc", phi: 50_000, khaDung: true, lyDo: null },
    ]);
    await diaChi(tA, { ...DC, tinhThanh: "Hà Nội" });
    const hn = (await pt(tA)).phuongThuc as Array<{ ma: string; phi: number; khaDung: boolean; lyDo: string | null }>;
    expect(hn.find((m) => m.ma === "T843_STD")).toMatchObject({ phi: 45_000, khaDung: true });
    expect(hn.find((m) => m.ma === "T843_EXP")).toMatchObject({ phi: 0, khaDung: false, lyDo: "NGOAI_VUNG" }); // giao nhanh KHÔNG hiện ở vùng không hỗ trợ
    await diaChi(tA, { ...DC, tinhThanh: "Cần Thơ" });
    expect((await pt(tA)).phuongThuc.every((m: { khaDung: boolean; lyDo: string }) => !m.khaDung && m.lyDo === "NGOAI_VUNG")).toBe(true);
    for (const ten of ["Đà Nẵng", "TP. Đà Nẵng", "thành phố đà nẵng", "DA NANG", "Tỉnh Đà Nẵng"]) {
      await diaChi(tA, { ...DC, tinhThanh: ten });
      expect((await pt(tA)).phuongThuc.find((m: { ma: string }) => m.ma === "T843_EXP").khaDung, ten).toBe(true);
    }
    await db.shippingRate.updateMany({ where: { methodId: ids.exp }, data: { isActive: false } });
    expect((await pt(tA)).phuongThuc.find((m: { ma: string }) => m.ma === "T843_EXP")).toMatchObject({ khaDung: false, lyDo: "NGOAI_VUNG" });
    await db.shippingRate.updateMany({ where: { methodId: ids.exp }, data: { isActive: true } });
    await db.shippingZone.updateMany({ where: { code: "T843_DN" }, data: { isActive: false } });
    expect((await pt(tA)).phuongThuc.every((m: { khaDung: boolean }) => !m.khaDung)).toBe(true); // khu vực tắt ⇒ không giao
    await db.shippingZone.updateMany({ where: { code: "T843_DN" }, data: { isActive: true } });
    await diaChi(tA, { ...DC, tinhThanh: "TP Đà Nẵng" });
  });

  it("[GHG-03] giỏ: phí/tổng do máy chủ; thiếu địa chỉ/chưa chọn/không áp dụng ⇒ vanDe; miễn phí theo ngưỡng; giỏ chỉ khoá không đòi giao hàng", async () => {
    // B CHƯA có địa chỉ
    await themPost(req("POST", "/x", { productId: ids.sp1, soLuong: 2 }, bearer(tB)));
    const b0 = await gio(tB);
    expect(b0).toMatchObject({ tamTinh: 2_000_000, phiVanChuyen: 0, tongTien: 2_000_000, giaoHang: { yeuCau: true, phuongThuc: null, daCoDiaChi: false, vanDe: "THIEU_DIA_CHI" } });
    await diaChi(tB, DC);
    expect((await gio(tB)).giaoHang).toMatchObject({ daCoDiaChi: true, vanDe: "CHUA_CHON_PHUONG_THUC_GIAO" });
    const c1 = await json(await datPt(tB, { phuongThucGiao: "T843_STD" }));
    expect(c1.data.gio).toMatchObject({ tamTinh: 2_000_000, phiVanChuyen: 30_000, tongTien: 2_030_000, giaoHang: { phuongThuc: "T843_STD", vanDe: null } });
    // tạm tính ≥ ngưỡng miễn phí (5.000.000) ⇒ 0
    const hang = (await gio(tB)).dong.find((d: { loai: string }) => d.loai === "HOC_CU").itemId as string;
    const itemRoute = await import("@/app/api/mobile/v1/parent/cart/items/[itemId]/route");
    await db.product.update({ where: { id: ids.sp1! }, data: { onlineMaxQty: 10 } });
    expect((await itemRoute.PATCH(req("PATCH", "/x", { soLuong: 5 }, bearer(tB)), { params: Promise.resolve({ itemId: hang }) as never })).status).toBe(200);
    expect((await gio(tB))).toMatchObject({ tamTinh: 5_000_000, phiVanChuyen: 0, tongTien: 5_000_000 });
    await itemRoute.PATCH(req("PATCH", "/x", { soLuong: 2 }, bearer(tB)), { params: Promise.resolve({ itemId: hang }) as never });
    // chọn giao nhanh rồi chuyển sang vùng không hỗ trợ ⇒ không áp dụng, phí 0 + vanDe
    await datPt(tB, { phuongThucGiao: "T843_EXP" });
    expect((await gio(tB)).phiVanChuyen).toBe(50_000);
    await diaChi(tB, { ...DC, tinhThanh: "Hà Nội" });
    expect(await gio(tB)).toMatchObject({ phiVanChuyen: 0, tongTien: 2_000_000, giaoHang: { phuongThuc: "T843_EXP", vanDe: "PHUONG_THUC_GIAO_KHONG_HOP_LE" } });
    // bỏ chọn
    expect((await json(await datPt(tB, { phuongThucGiao: null }))).data.gio.giaoHang.phuongThuc).toBeNull();
    // giỏ KHÔNG còn học cụ ⇒ không yêu cầu giao hàng, phí 0 dù đã chọn phương thức
    await datPt(tB, { phuongThucGiao: "T843_STD" });
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: ids.B } } });
    expect((await gio(tB))).toMatchObject({ phiVanChuyen: 0, giaoHang: { yeuCau: false, vanDe: null } });
  });

  it("[GHG-04] giả mạo/validate: gửi phí/tổng ⇒ 400; phương thức lạ ⇒ 422; revision cũ ⇒ 409; đổi cấu hình ⇒ tính lại", async () => {
    await themPost(req("POST", "/x", { productId: ids.sp1, soLuong: 1 }, bearer(tA)));
    await diaChi(tA, DC);
    for (const thua of [{ phuongThucGiao: "T843_STD", phiVanChuyen: 0 }, { phuongThucGiao: "T843_STD", phi: 0 }, { phuongThucGiao: "T843_STD", tongTien: 1 }, { phiVanChuyen: 0 }, {}]) {
      expect((await datPt(tA, thua)).status, JSON.stringify(thua)).toBe(400);
    }
    const lạ = await datPt(tA, { phuongThucGiao: "KHONG_CO" });
    expect(lạ.status).toBe(422);
    expect((await json(lạ)).error?.code).toBe("PHUONG_THUC_GIAO_KHONG_HOP_LE");
    expect((await json(await datPt(tA, { phuongThucGiao: "T843_OFF" }))).error?.code).toBe("PHUONG_THUC_GIAO_KHONG_HOP_LE"); // phương thức đã tắt
    const g = await gio(tA);
    const ok = await datPt(tA, { phuongThucGiao: "T843_STD", revision: g.revision });
    expect(ok.status).toBe(200);
    expect((await datPt(tA, { phuongThucGiao: "T843_EXP", revision: g.revision })).status).toBe(409); // revision cũ
    expect((await gio(tA)).phiVanChuyen).toBe(30_000);
    await db.shippingRate.update({ where: { id: ids.rStdDn! }, data: { fee: 35_000 } }); // Admin đổi phí
    expect((await gio(tA))).toMatchObject({ phiVanChuyen: 35_000, tongTien: 1_035_000 }); // giỏ tính lại, không có số cũ nào được lưu
    await db.shippingRate.update({ where: { id: ids.rStdDn! }, data: { fee: 30_000 } });
  });
});
