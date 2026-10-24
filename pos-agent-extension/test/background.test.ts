/**
 * Dây nối service worker ⇄ `chrome.*` (`src/lib/nen-chrome.ts`): alarm đúng nhịp, sự kiện tab,
 * và — quan trọng nhất — ĐỊNH TUYẾN TIN NHẮN: lệnh đọc/ghi cấu hình CHỈ nhận từ trang Options
 * của chính extension; content script (chạy trong trang web) chỉ được báo "trang sẵn sàng".
 */
import { describe, expect, it } from "vitest";
import type { BoDieuPhoi } from "../src/lib/bo-dieu-phoi";
import { ALARM } from "../src/lib/hang-so";
import { damBaoAlarms, ganSuKien, taoPhuThuocChrome } from "../src/lib/nen-chrome";
import { taoChromeNenGia } from "./ho-tro/chrome-gia";
import { BI_MAT } from "./ho-tro/du-lieu";

type GoiStub = Array<[string, unknown[]]>;

function bdpStub(goi: GoiStub): BoDieuPhoi {
  const ghi =
    (ten: string, tra: unknown = undefined) =>
    async (...a: unknown[]) => {
      goi.push([ten, a]);
      return tra as never;
    };
  return {
    khoiDong: ghi("khoiDong"),
    nhipPhut: ghi("nhipPhut"),
    nhipKeepalive: ghi("nhipKeepalive"),
    hoiNhanh: ghi("hoiNhanh"),
    dongBoNgay: ghi("dongBoNgay"),
    tabCapNhat: ghi("tabCapNhat"),
    tabDong: ghi("tabDong"),
    trangSanSang: ghi("trangSanSang"),
    layCauHinh: ghi("layCauHinh", { cauHinh: null, coBiMat: true, gocChoPhep: [] }),
    luuCauHinh: ghi("luuCauHinh", { ok: true }),
    layTrangThai: ghi("layTrangThai", { phienBan: "0.1.0" }),
    guiHeartbeatNgay: ghi("guiHeartbeatNgay"),
    choXong: async () => undefined,
  };
}

function guiTin(c: ReturnType<typeof taoChromeNenGia>["chrome"], msg: unknown, sender: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    let giu = false;
    for (const fn of c.runtime.onMessage.nghe) if (fn(msg, sender, resolve) === true) giu = true;
    if (!giu) resolve("(không trả lời)");
  });
}

const OPTIONS = { id: "idextensionsatarobopos", url: "chrome-extension://idextensionsatarobopos/options.html" };
const CONTENT = { id: "idextensionsatarobopos", url: "https://merchant.techcombank.com/soft-pos-transaction", tab: { id: 42 }, frameId: 0 };

describe("Dây nối service worker", () => {
  it("[EXT-BG-01] alarm: 1 phút (job + đồng bộ) và 10 phút (keepalive + heartbeat); không tạo lại khi đã có", async () => {
    const g = taoChromeNenGia();
    await damBaoAlarms(g.chrome);
    expect(g.alarms.get(ALARM.phut)).toEqual({ periodInMinutes: 1, delayInMinutes: 1 });
    expect(g.alarms.get(ALARM.keepalive)).toEqual({ periodInMinutes: 10, delayInMinutes: 10 });
    g.alarms.set(ALARM.phut, { periodInMinutes: 1, delayInMinutes: 0.5 });
    await damBaoAlarms(g.chrome);
    expect(g.alarms.get(ALARM.phut)).toEqual({ periodInMinutes: 1, delayInMinutes: 0.5 });
  });

  it("[EXT-BG-02] sự kiện chrome ⇒ đúng hàm bộ điều phối (alarm, cài đặt, khởi động, tab)", async () => {
    const g = taoChromeNenGia();
    const goi: GoiStub = [];
    ganSuKien(g.chrome, bdpStub(goi));
    for (const fn of g.chrome.alarms.onAlarm.nghe) fn({ name: ALARM.phut });
    for (const fn of g.chrome.alarms.onAlarm.nghe) fn({ name: ALARM.keepalive });
    for (const fn of g.chrome.alarms.onAlarm.nghe) fn({ name: "la" });
    for (const fn of g.chrome.runtime.onInstalled.nghe) fn({ reason: "install" });
    for (const fn of g.chrome.runtime.onStartup.nghe) fn();
    for (const fn of g.chrome.tabs.onUpdated.nghe) fn(7, { url: "https://merchant.techcombank.com/login" }, {});
    for (const fn of g.chrome.tabs.onRemoved.nghe) fn(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(goi.map((x) => x[0])).toEqual(["nhipPhut", "nhipKeepalive", "khoiDong", "khoiDong", "tabCapNhat", "tabDong"]);
    expect(goi[2][1]).toEqual(["INSTALL"]);
    expect(goi[3][1]).toEqual(["STARTUP"]);
    expect(goi[4][1]).toEqual([7, "https://merchant.techcombank.com/login", null]);
  });

  it("[EXT-BG-03] trang Options đọc/ghi được cấu hình; content script (trang web) thì KHÔNG", async () => {
    const g = taoChromeNenGia();
    const goi: GoiStub = [];
    ganSuKien(g.chrome, bdpStub(goi));
    expect(await guiTin(g.chrome, { kenh: "satarobo-pos-agent", lenh: "LAY_CAU_HINH" }, OPTIONS)).toEqual({
      cauHinh: null,
      coBiMat: true,
      gocChoPhep: [],
    });
    for (const lenh of ["LAY_CAU_HINH", "LUU_CAU_HINH", "LAY_TRANG_THAI", "GUI_HEARTBEAT_NGAY"]) {
      expect(await guiTin(g.chrome, { kenh: "satarobo-pos-agent", lenh, cauHinh: {}, biMatMoi: BI_MAT }, CONTENT)).toBe(
        "(không trả lời)",
      );
    }
    // extension khác / trang web giả url options
    expect(await guiTin(g.chrome, { kenh: "satarobo-pos-agent", lenh: "LAY_CAU_HINH" }, { ...OPTIONS, id: "khac" })).toBe(
      "(không trả lời)",
    );
    expect(
      await guiTin(g.chrome, { kenh: "satarobo-pos-agent", lenh: "LAY_CAU_HINH" }, { ...OPTIONS, tab: { id: 1 }, url: "https://evil.example/options.html" }),
    ).toBe("(không trả lời)");
    expect(goi.filter((x) => x[0] === "layCauHinh")).toHaveLength(1);
    expect(goi.filter((x) => x[0] === "luuCauHinh")).toHaveLength(0);
  });

  it("[EXT-BG-04] 'trang sẵn sàng' chỉ nhận từ content script khung CHÍNH của trang portal", async () => {
    const g = taoChromeNenGia();
    const goi: GoiStub = [];
    ganSuKien(g.chrome, bdpStub(goi));
    const tin = { kenh: "satarobo-pos-agent", suKien: "TRANG_SAN_SANG", duongDan: "/soft-pos-transaction" };
    await guiTin(g.chrome, tin, CONTENT);
    await guiTin(g.chrome, tin, { ...CONTENT, frameId: 3 }); // khung con
    await guiTin(g.chrome, tin, { ...CONTENT, url: "https://evil.example/x" }); // trang khác
    await guiTin(g.chrome, tin, OPTIONS); // không phải content script
    await guiTin(g.chrome, { ...tin, duongDan: 5 }, CONTENT); // sai kiểu
    await new Promise((r) => setTimeout(r, 0));
    expect(goi.filter((x) => x[0] === "trangSanSang")).toEqual([["trangSanSang", [42, "/soft-pos-transaction"]]]);
  });

  it("[EXT-BG-05] kho: cố hạ chrome.storage.local về TRUSTED_CONTEXTS (content script không đọc được bí mật) — có thì dùng", async () => {
    const g = taoChromeNenGia();
    const pt = taoPhuThuocChrome(g.chrome);
    await pt.kho.ghi({ biMat: BI_MAT });
    expect(await pt.kho.doc("biMat")).toBe(BI_MAT);
    expect(g.mucTruyCap).toContain("TRUSTED_CONTEXTS");
    expect(pt.hostPermissions).toEqual(["https://merchant.techcombank.com/*", "https://admin.satarobo.vn/*"]);
  });

  it("[EXT-BG-06] huy hiệu: hiển thị trạng thái lên icon (chữ + màu + tiêu đề), không chứa bí mật", async () => {
    const g = taoChromeNenGia();
    const pt = taoPhuThuocChrome(g.chrome);
    await pt.hienThi({ nhan: "HẾT", mau: "DO", tieuDe: "Phiên portal đã hết — đăng nhập lại" });
    expect(g.badge).toContainEqual({ text: "HẾT" });
    expect(JSON.stringify(g.badge)).not.toContain(BI_MAT);
  });
});
