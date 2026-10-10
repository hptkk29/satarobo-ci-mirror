/**
 * Dựng MỘT trang portal chỉ có thế giới MAIN (content-main THẬT) + kênh để test gửi lệnh
 * như content-isolated sẽ gửi. Dùng cho test allowlist / bắt header / lọc trường.
 */
import { KENH } from "../../src/lib/hang-so";
import { PORTAL, URL_TIM_KIEM } from "./du-lieu";
import { PortalHttpGia, taoXhrGia } from "./portal-gia";
import { CuaSoChung, chayScript, choTroi, taoTheGioi } from "./the-gioi";
import { THAN_APP } from "./may-agent";

export interface TrangMain {
  chung: CuaSoChung;
  main: Record<string, unknown>;
  portal: PortalHttpGia;
  /** Gửi lệnh như content-isolated (cùng cửa sổ, đúng origin) và chờ kết quả theo id. */
  gui(lenh: unknown, id?: string): Promise<unknown>;
  /** App portal tự gọi search (qua `window.fetch` đã bị bọc) — nguồn bắt header. */
  appTimKiem(than?: string, header?: Record<string, string>): Promise<unknown>;
}

let dem = 0;

export function taoTrangMain(portal = new PortalHttpGia(), duongDan = "/soft-pos-transaction"): TrangMain {
  const chung = new CuaSoChung();
  const main = taoTheGioi(chung, {
    ten: "MAIN",
    duongDan,
    them: { fetch: portal.fetch, XMLHttpRequest: taoXhrGia(portal) },
  });
  chayScript(main, "content-main");
  const gui = (lenh: unknown, idDat?: string): Promise<unknown> => {
    const id = idDat ?? `${(++dem).toString(16).padStart(8, "0")}${"0".repeat(24)}`;
    return new Promise((resolve) => {
      let xong = false;
      const nghe = (ev: { data: unknown }) => {
        const d = ev.data as { kenh?: string; huong?: string; id?: string; ketQua?: unknown };
        if (!xong && d && d.kenh === KENH && d.huong === "ket-qua" && d.id === id) {
          xong = true;
          chung.huy(nghe);
          resolve(d.ketQua);
        }
      };
      chung.dangKy(nghe, {});
      chung.dang({ kenh: KENH, huong: "lenh", id, lenh }, PORTAL, "ISOLATED");
      // Không có trả lời trong vài vòng ⇒ coi như MAIN im lặng (bỏ qua lệnh).
      void (async () => {
        await choTroi(40);
        if (!xong) {
          xong = true;
          chung.huy(nghe);
          resolve("(im lặng)");
        }
      })();
    });
  };
  const appTimKiem = async (than = THAN_APP, header?: Record<string, string>): Promise<unknown> => {
    const f = main.fetch as (u: string, i: Record<string, unknown>) => Promise<{ status: number }>;
    const res = await f(URL_TIM_KIEM, {
      method: "POST",
      headers: header ?? {
        "Content-Type": "application/json",
        "X-API-Auth": portal.header["x-api-auth"],
        "x-api-payment": portal.header["x-api-payment"],
        "X-Device-ID": portal.header["x-device-id"],
      },
      body: than,
    });
    await choTroi();
    return res;
  };
  return { chung, main, portal, gui, appTimKiem };
}
