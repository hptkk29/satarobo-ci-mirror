/**
 * content-isolated — cầu nối service worker ⇄ world MAIN qua `window.postMessage`, KIỂM
 * origin + source + nonce (đặc tả GĐ5). Mỗi lệnh một nonce 128-bit mới, dùng MỘT lần.
 *
 * Giới hạn đã biết (ghi ở docs/pos-gd5-thiet-ke.md): script của chính trang portal nhìn thấy
 * mọi tin postMessage trên cửa sổ — portal là gốc tin cậy (nó đã giữ token). Nonce chống tin
 * GIẢ của bên không thấy luồng tin (khung khác origin, cửa sổ khác) và chống nhận nhầm lượt.
 */
import { describe, expect, it } from "vitest";
import { KENH } from "../src/lib/hang-so";
import { ChromeIsolatedGia } from "./ho-tro/chrome-gia";
import { MERCHANT, PORTAL, URL_PHIEN } from "./ho-tro/du-lieu";
import { PortalHttpGia, taoXhrGia } from "./ho-tro/portal-gia";
import { CuaSoChung, chayScript, choTroi, taoTheGioi } from "./ho-tro/the-gioi";

const LENH_PHIEN = { loai: "GOI", phuongThuc: "GET", url: URL_PHIEN, merchantCode: MERCHANT };

function dung(coMain = true, duongDan = "/soft-pos-transaction?tab=1#x") {
  const chung = new CuaSoChung();
  const chromeIso = new ChromeIsolatedGia();
  const portal = new PortalHttpGia();
  const hen: Array<() => void> = [];
  const iso = taoTheGioi(chung, {
    ten: "ISOLATED",
    duongDan,
    them: {
      chrome: chromeIso.chrome,
      // hẹn giờ gom lại để test timeout không phải chờ đồng hồ thật
      setTimeout: (fn: () => void) => {
        hen.push(fn);
        return hen.length;
      },
      clearTimeout: () => undefined,
    },
  });
  chayScript(iso, "content-isolated");
  if (coMain) {
    const main = taoTheGioi(chung, { ten: "MAIN", duongDan, them: { fetch: portal.fetch, XMLHttpRequest: taoXhrGia(portal) } });
    chayScript(main, "content-main");
  }
  return { chung, chromeIso, portal, hen };
}

describe("content-isolated: cầu nối có kiểm origin + nonce", () => {
  it("[EXT-ISO-01] chuyển lệnh của service worker sang MAIN với nonce 32 hex MỚI, trả đúng kết quả", async () => {
    const d = dung();
    const kq = await d.chromeIso.guiTuBackground({ kenh: KENH, lenh: LENH_PHIEN });
    expect(kq).toMatchObject({ loai: "PHIEN", coUser: true });
    const lenh = d.chung.daDang.filter((x) => (x.data as { huong?: string }).huong === "lenh");
    expect(lenh).toHaveLength(1);
    const id = (lenh[0].data as { id: string }).id;
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(lenh[0].targetOrigin).toBe(PORTAL);
  });

  it("[EXT-ISO-02] kết quả GIẢ (sai nonce / khác origin / cửa sổ khác) bị bỏ qua — chỉ kết quả thật được nhận", async () => {
    const d = dung(false);
    const p = d.chromeIso.guiTuBackground({ kenh: KENH, lenh: LENH_PHIEN });
    await choTroi();
    const lenh = d.chung.daDang.find((x) => (x.data as { huong?: string }).huong === "lenh");
    const id = (lenh?.data as { id: string }).id;
    const gia = { loai: "PHIEN", httpStatus: 200, coUser: false, hetHanLuc: null, nguonHetHan: null };
    d.chung.dang({ kenh: KENH, huong: "ket-qua", id: "0".repeat(32), ketQua: gia }, PORTAL, "TRANG"); // sai nonce
    d.chung.dangTuNgoai({ kenh: KENH, huong: "ket-qua", id, ketQua: gia }, "https://evil.example", undefined); // khác origin
    d.chung.dangTuNgoai({ kenh: KENH, huong: "ket-qua", id, ketQua: gia }, PORTAL, { khac: true }); // cửa sổ khác
    await choTroi();
    let daXong = false;
    void p.then(() => {
      daXong = true;
    });
    await choTroi();
    expect(daXong).toBe(false);
    const that = { loai: "PHIEN", httpStatus: 200, coUser: true, hetHanLuc: null, nguonHetHan: null };
    d.chung.dang({ kenh: KENH, huong: "ket-qua", id, ketQua: that }, PORTAL, "MAIN");
    expect(await p).toEqual(that);
  });

  it("[EXT-ISO-03] nonce dùng MỘT lần: phát lại kết quả cũ cho lệnh mới không được nhận", async () => {
    const d = dung(false);
    const p1 = d.chromeIso.guiTuBackground({ kenh: KENH, lenh: LENH_PHIEN });
    await choTroi();
    const id1 = (d.chung.daDang.find((x) => (x.data as { huong?: string }).huong === "lenh")?.data as { id: string }).id;
    d.chung.dang({ kenh: KENH, huong: "ket-qua", id: id1, ketQua: { loai: "PHIEN", n: 1 } }, PORTAL, "MAIN");
    expect(await p1).toEqual({ loai: "PHIEN", n: 1 });
    const p2 = d.chromeIso.guiTuBackground({ kenh: KENH, lenh: LENH_PHIEN });
    await choTroi();
    d.chung.dang({ kenh: KENH, huong: "ket-qua", id: id1, ketQua: { loai: "PHIEN", n: 1 } }, PORTAL, "MAIN"); // phát lại
    let xong = false;
    void p2.then(() => {
      xong = true;
    });
    await choTroi();
    expect(xong).toBe(false);
  });

  it("[EXT-ISO-04] chỉ nhận lệnh từ service worker của CHÍNH extension (sender không có tab, đúng id)", async () => {
    const d = dung();
    expect(await d.chromeIso.guiTuBackground({ kenh: KENH, lenh: LENH_PHIEN }, { id: "extension-khac" })).toBeUndefined();
    expect(
      await d.chromeIso.guiTuBackground({ kenh: KENH, lenh: LENH_PHIEN }, { id: d.chromeIso.id, tab: { id: 9 } }),
    ).toBeUndefined();
    expect(await d.chromeIso.guiTuBackground({ kenh: "khac", lenh: LENH_PHIEN })).toBeUndefined();
    expect(d.chung.daDang.filter((x) => (x.data as { huong?: string }).huong === "lenh")).toHaveLength(0);
  });

  it("[EXT-ISO-05] báo service worker trang đã sẵn sàng — CHỈ đường dẫn (không query, không hash)", () => {
    const d = dung();
    expect(d.chromeIso.tinDaGui).toEqual([{ kenh: KENH, suKien: "TRANG_SAN_SANG", duongDan: "/soft-pos-transaction" }]);
  });

  it("[EXT-ISO-06] MAIN không trả lời ⇒ hết giờ trả MAIN_TIMEOUT (không treo service worker)", async () => {
    const d = dung(false);
    const p = d.chromeIso.guiTuBackground({ kenh: KENH, lenh: LENH_PHIEN });
    await choTroi();
    expect(d.hen.length).toBeGreaterThan(0);
    for (const fn of d.hen.splice(0)) fn();
    expect(await p).toEqual({ loai: "LOI", ma: "MAIN_TIMEOUT" });
  });
});
