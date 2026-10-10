/**
 * content-main (world MAIN) — phương án dự phòng roadmap cho phép khi header portal CHƯA ĐO:
 * bọc `window.fetch` (+ XHR) để NHỚ header app vừa dùng cho đúng endpoint search, rồi dùng
 * lại. Header/token CHỈ sống trong closure của trang — không bao giờ qua postMessage.
 */
import { describe, expect, it } from "vitest";
import { CHUOI_CAM, HET_HAN_ACCESS_ISO, MERCHANT, URL_PHIEN, URL_TIM_KIEM, dongPortal, timChuoiCam } from "./ho-tro/du-lieu";
import { taoTrangMain } from "./ho-tro/main-don";
import { choTroi } from "./ho-tro/the-gioi";

const PHIEN = { loai: "GOI", phuongThuc: "GET", url: URL_PHIEN, merchantCode: MERCHANT };
const TIM = {
  loai: "GOI",
  phuongThuc: "POST",
  url: URL_TIM_KIEM,
  merchantCode: MERCHANT,
  than: { page_index: 0, page_size: 50, transaction_time_from: "2026-10-07 00:00:00", transaction_time_to: "2026-10-07 23:59:59" },
};

describe("content-main: bắt header của app và dùng lại", () => {
  it("[EXT-MAIN-01] chưa có lời gọi search nào của app ⇒ HEADER_NOT_CAPTURED, không tự gọi", async () => {
    const t = taoTrangMain();
    const kq = await t.gui(TIM);
    expect(kq).toMatchObject({ loai: "LOI", ma: "HEADER_NOT_CAPTURED" });
    expect(t.portal.goi).toHaveLength(0);
  });

  it("[EXT-MAIN-02] app gọi search (fetch) thành công ⇒ extension gọi lại với ĐÚNG header app đã dùng + thân của extension", async () => {
    const t = taoTrangMain();
    t.portal.giaoDich = [dongPortal()];
    await t.appTimKiem();
    const kq = await t.gui(TIM);
    expect(kq).toMatchObject({ loai: "TRANG", httpStatus: 200, totalItems: 1 });
    const cuoi = t.portal.goi.at(-1);
    expect(cuoi?.headers["x-api-auth"]).toBe(t.portal.header["x-api-auth"]);
    expect(cuoi?.headers["x-api-payment"]).toBe(t.portal.header["x-api-payment"]);
    expect(cuoi?.headers["x-device-id"]).toBe(t.portal.header["x-device-id"]);
    expect(JSON.parse(cuoi?.body ?? "{}")).toEqual(TIM.than);
  });

  it("[EXT-MAIN-03] app dùng XMLHttpRequest (axios) ⇒ cũng bắt được header", async () => {
    const t = taoTrangMain();
    const Xhr = t.main.XMLHttpRequest as new () => {
      open(m: string, u: string): void;
      setRequestHeader(k: string, v: string): void;
      send(b?: string): void;
    };
    const x = new Xhr();
    x.open("POST", URL_TIM_KIEM);
    x.setRequestHeader("Content-Type", "application/json");
    x.setRequestHeader("X-API-Auth", t.portal.header["x-api-auth"]);
    x.setRequestHeader("x-api-payment", t.portal.header["x-api-payment"]);
    x.setRequestHeader("X-Device-ID", t.portal.header["x-device-id"]);
    x.send(JSON.stringify(TIM.than));
    await choTroi();
    expect(await t.gui(TIM)).toMatchObject({ loai: "TRANG" });
  });

  it("[EXT-MAIN-04] lời gọi của app bị 401 ⇒ KHÔNG nhớ header đó", async () => {
    const t = taoTrangMain();
    await t.appTimKiem(undefined, { "Content-Type": "application/json", "X-API-Auth": "sai" });
    expect(await t.gui(TIM)).toMatchObject({ loai: "LOI", ma: "HEADER_NOT_CAPTURED" });
  });

  it("[EXT-MAIN-05] thân app KHÔNG phải JSON thuần như đã đo (bị mã hoá) ⇒ BODY_ENCRYPTED, không đoán, không gọi", async () => {
    const t = taoTrangMain();
    await t.appTimKiem("U2FsdGVkX1+mã-hoá-AES==");
    const truoc = t.portal.goi.length;
    expect(await t.gui(TIM)).toMatchObject({ loai: "LOI", ma: "BODY_ENCRYPTED" });
    expect(t.portal.goi.length).toBe(truoc);
  });

  it("[EXT-MAIN-06] search của extension bị 401 ⇒ HET_PHIEN + bỏ header đã nhớ (lần sau HEADER_NOT_CAPTURED)", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    t.portal.epTimKiem = "401";
    expect(await t.gui(TIM)).toMatchObject({ loai: "HET_PHIEN", httpStatus: 401 });
    t.portal.epTimKiem = null;
    expect(await t.gui(TIM)).toMatchObject({ loai: "LOI", ma: "HEADER_NOT_CAPTURED" });
  });

  it("[EXT-MAIN-07] bị chuyển hướng (redirect) ⇒ CHUYEN_HUONG, KHÔNG đi theo tới URL khác (redirect: manual)", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    t.portal.epTimKiem = "CHUYEN_HUONG";
    expect(await t.gui(TIM)).toMatchObject({ loai: "CHUYEN_HUONG" });
    const cuoi = t.portal.goi.at(-1);
    expect(cuoi?.url).toBe(URL_TIM_KIEM);
  });

  it("[EXT-MAIN-08] portal 500 / hình dạng lạ ⇒ PORTAL_HTTP_ERROR / PORTAL_BAD_SHAPE", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    t.portal.epTimKiem = "500";
    expect(await t.gui(TIM)).toMatchObject({ loai: "LOI", ma: "PORTAL_HTTP_ERROR", httpStatus: 500 });
    t.portal.epTimKiem = "SAI_HINH";
    expect(await t.gui(TIM)).toMatchObject({ loai: "LOI", ma: "PORTAL_BAD_SHAPE" });
  });
});

describe("content-main: chuyển hướng ở API search (RV5)", () => {
  it("[EXT-MAIN-16] search của extension bị CHUYỂN HƯỚNG ⇒ CHUYEN_HUONG + bỏ header đã nhớ (như 401) — lần sau HEADER_NOT_CAPTURED, không gọi lại bằng header đã bị đá", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    t.portal.epTimKiem = "CHUYEN_HUONG";
    expect(await t.gui(TIM)).toMatchObject({ loai: "CHUYEN_HUONG", dauHeader: { coHeader: false } });
    t.portal.epTimKiem = null;
    const truoc = t.portal.goi.length;
    expect(await t.gui(TIM)).toMatchObject({ loai: "LOI", ma: "HEADER_NOT_CAPTURED" });
    expect(t.portal.goi.length).toBe(truoc);
  });
});

describe("content-main: phiên portal", () => {
  it("[EXT-MAIN-09] có user ⇒ chỉ trả coUser + MỐC exp của access token (JWT) — không trả token", async () => {
    const t = taoTrangMain();
    const kq = await t.gui(PHIEN);
    expect(kq).toMatchObject({ loai: "PHIEN", httpStatus: 200, coUser: true, hetHanLuc: HET_HAN_ACCESS_ISO, nguonHetHan: "ACCESS_TOKEN" });
    expect(timChuoiCam(kq)).toBeNull();
  });

  it("[EXT-MAIN-10] RV5 — access token không phải JWT ⇒ KHÔNG biết hạn (null), KHÔNG lùi về `expires` (NextAuth JWT: mốc TRƯỢT +30 ngày mỗi lần gọi)", async () => {
    // Lý lẽ của bản cũ ("có mốc còn hơn không") sai với `expires` trượt: nó phá chống nháy TQ-11 (mốc "đổi"
    // ở mỗi keepalive ⇒ coi là phiên mới) và báo máy chủ hạn +30 ngày ⇒ chuông 07:30 không bao giờ rung.
    const t = taoTrangMain();
    t.portal.accessToken = "khong-phai-jwt";
    expect(await t.gui(PHIEN)).toMatchObject({ coUser: true, hetHanLuc: null, nguonHetHan: null });
  });

  it("[EXT-MAIN-11] chưa đăng nhập (session {}) ⇒ coUser false", async () => {
    const t = taoTrangMain();
    t.portal.dangNhap = false;
    expect(await t.gui(PHIEN)).toMatchObject({ loai: "PHIEN", coUser: false, hetHanLuc: null });
  });

  it("[EXT-MAIN-12] kết quả mang 'dấu' header (mã trang + số lần bắt) — không mang header", async () => {
    const t = taoTrangMain();
    const a = (await t.gui(PHIEN)) as { dauHeader: { maTrang: string; soBat: number; coHeader: boolean } };
    expect(a.dauHeader).toMatchObject({ soBat: 0, coHeader: false });
    expect(a.dauHeader.maTrang).toMatch(/^[0-9a-f]{16,}$/);
    await t.appTimKiem();
    const b = (await t.gui(PHIEN)) as { dauHeader: { maTrang: string; soBat: number; coHeader: boolean } };
    expect(b.dauHeader).toEqual({ maTrang: a.dauHeader.maTrang, soBat: 1, coHeader: true, thanMaHoa: false });
  });
});

describe("content-main: không phá app, không lộ gì", () => {
  it("[EXT-MAIN-13] fetch của app đi qua nguyên vẹn (cùng đối số, cùng response) — kể cả URL ngoài allowlist", async () => {
    const t = taoTrangMain();
    const f = t.main.fetch as (u: string, i?: Record<string, unknown>) => Promise<{ status: number }>;
    const r = await f(`${URL_PHIEN.replace("/session", "/csrf")}`);
    expect(r.status).toBe(404);
    expect(t.portal.goi.at(-1)?.url).toBe("https://merchant.techcombank.com/api/auth/csrf");
  });

  it("[EXT-MAIN-14] suốt một vòng đủ (app gọi → phiên → search → 401) không tin nào trên cửa sổ chứa token/header/cookie/tên chủ thẻ", async () => {
    const t = taoTrangMain();
    t.portal.giaoDich = [dongPortal()];
    await t.appTimKiem();
    await t.gui(PHIEN);
    await t.gui(TIM);
    t.portal.epTimKiem = "401";
    await t.gui(TIM);
    expect(t.chung.daDang.length).toBeGreaterThanOrEqual(6);
    for (const tin of t.chung.daDang) expect(timChuoiCam(tin.data, CHUOI_CAM)).toBeNull();
  });

  it("[EXT-MAIN-15] kết quả chỉ gửi tới đúng origin portal (targetOrigin không bao giờ là '*')", async () => {
    const t = taoTrangMain();
    await t.gui(PHIEN);
    const ketQua = t.chung.daDang.filter((d) => (d.data as { huong?: string }).huong === "ket-qua");
    expect(ketQua.length).toBeGreaterThan(0);
    for (const d of ketQua) expect(d.targetOrigin).toBe("https://merchant.techcombank.com");
  });
});
