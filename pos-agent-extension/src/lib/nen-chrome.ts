/**
 * Nối bộ điều phối với `chrome.*` thật của service worker: kho, tab, huy hiệu, alarm, định tuyến
 * tin nhắn. Phần này mỏng — mọi quyết định nằm ở `bo-dieu-phoi.ts`.
 *
 * ĐỊNH TUYẾN TIN NHẮN (an toàn):
 *   · Đọc/ghi cấu hình CHỈ từ trang Options của CHÍNH extension (sender.url = options.html).
 *   · Content script (chạy trong trang web) chỉ được báo "trang sẵn sàng" — từ khung chính trang
 *     portal. Không có `externally_connectable` ⇒ trang web khác không gửi tới được.
 */
import type { BoDieuPhoi, HienThi, PhuThuoc } from "./bo-dieu-phoi.js";
import type { ChromeToiThieu, NguoiGuiChrome, TabChrome, VungKhoChrome } from "./chrome-kieu.js";
import { ALARM, KENH, PORTAL_ORIGIN } from "./hang-so.js";
import type { KhoLuuTru } from "./kho.js";
import type { TabApi, TabInfo } from "./tab-portal.js";

export function layChrome(): ChromeToiThieu {
  return (globalThis as unknown as { chrome: ChromeToiThieu }).chrome;
}

function taoKho(v: VungKhoChrome, sanSang: Promise<void>): KhoLuuTru {
  return {
    async doc<T>(khoa: string): Promise<T | undefined> {
      await sanSang;
      const r = await v.get(khoa);
      return r[khoa] as T | undefined;
    },
    async ghi(gia: Record<string, unknown>): Promise<void> {
      await sanSang;
      const xoa = Object.keys(gia).filter((k) => gia[k] === undefined);
      const dat = Object.fromEntries(Object.entries(gia).filter(([, x]) => x !== undefined));
      if (Object.keys(dat).length > 0) await v.set(dat);
      if (xoa.length > 0) await v.remove(xoa);
    },
    async xoa(khoa: readonly string[]): Promise<void> {
      await sanSang;
      if (khoa.length > 0) await v.remove([...khoa]);
    },
  };
}

function tabInfo(t: TabChrome | undefined): TabInfo | null {
  if (!t || typeof t.id !== "number") return null;
  return {
    id: t.id,
    url: typeof t.url === "string" ? t.url : null,
    pinned: t.pinned === true,
    discarded: t.discarded === true,
    status: t.status === "loading" || t.status === "complete" ? t.status : null,
  };
}

function taoTabApi(c: ChromeToiThieu): TabApi {
  return {
    async get(tabId) {
      try {
        return tabInfo(await c.tabs.get(tabId));
      } catch {
        return null; // tab đã đóng
      }
    },
    async query(urlPattern) {
      return (await c.tabs.query({ url: urlPattern })).map(tabInfo).filter((t): t is TabInfo => t !== null);
    },
    async create(p) {
      const t = tabInfo(await c.tabs.create(p));
      if (!t) throw new Error("Không mở được tab portal");
      return t;
    },
    async update(tabId, p) {
      try {
        return tabInfo(await c.tabs.update(tabId, p));
      } catch {
        return null;
      }
    },
    async reload(tabId) {
      await c.tabs.reload(tabId);
    },
    async sendMessage(tabId, msg) {
      return c.tabs.sendMessage(tabId, msg, { frameId: 0 });
    },
  };
}

const MAU: Record<HienThi["mau"], string> = { XANH: "#15803d", DO: "#b91c1c", CAM: "#c2410c", XAM: "#6b7280" };

export function taoPhuThuocChrome(c: ChromeToiThieu): PhuThuoc {
  // Cố hạ `storage.local` về ngữ cảnh tin cậy (service worker + trang extension): content script
  // khi đó không đọc được bí mật dù có lỗi gì. Chrome cũ không hỗ trợ cho `local` ⇒ bỏ qua.
  const sanSang = (async () => {
    try {
      await c.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    } catch {
      // không hỗ trợ — content script của extension vốn không đọc kho
    }
  })();
  return {
    dongHo: () => Date.now(),
    kho: taoKho(c.storage.local, sanSang),
    khoPhien: taoKho(c.storage.session, Promise.resolve()),
    tab: taoTabApi(c),
    fetch: (url, init) => fetch(url, init),
    datHenGio: (fn, ms) => {
      setTimeout(fn, ms);
    },
    async hienThi(h) {
      if (!c.action) return;
      await c.action.setBadgeText({ text: h.nhan === "OK" ? "" : h.nhan });
      await c.action.setBadgeBackgroundColor({ color: MAU[h.mau] });
      await c.action.setTitle({ title: `SataRobo POS Agent — ${h.tieuDe}` });
    },
    async giuSong<T>(p: Promise<T>): Promise<T> {
      // Service worker MV3 bị tắt sau ~30 giây không có sự kiện / lời gọi API extension: lời gọi
      // /transactions có thể lâu hơn ⇒ chạm một API rẻ mỗi 20 giây trong lúc chờ.
      const nhip = setInterval(() => {
        void c.runtime.getPlatformInfo().catch(() => undefined);
      }, 20_000);
      try {
        return await p;
      } finally {
        clearInterval(nhip);
      }
    },
    hostPermissions: c.runtime.getManifest().host_permissions ?? [],
  };
}

export async function damBaoAlarms(c: ChromeToiThieu): Promise<void> {
  if (!(await c.alarms.get(ALARM.phut))) c.alarms.create(ALARM.phut, { periodInMinutes: 1, delayInMinutes: 1 });
  if (!(await c.alarms.get(ALARM.keepalive))) {
    c.alarms.create(ALARM.keepalive, { periodInMinutes: 10, delayInMinutes: 10 });
  }
}

function ghiLoi(e: unknown): void {
  // Chỉ in TÊN/thông điệp lỗi của mã extension — không bao giờ in thân request / cấu hình.
  console.error("[SataRobo POS Agent]", e instanceof Error ? e.message : "lỗi không rõ");
}

function chay(fn: () => Promise<unknown>): void {
  try {
    fn().catch(ghiLoi);
  } catch (e) {
    ghiLoi(e);
  }
}

function laTrangOptions(c: ChromeToiThieu, s: NguoiGuiChrome): boolean {
  if (s.id !== c.runtime.id || typeof s.url !== "string") return false;
  const goc = c.runtime.getURL("options.html");
  return s.url === goc || s.url.startsWith(`${goc}?`) || s.url.startsWith(`${goc}#`);
}

function laContentScriptPortal(c: ChromeToiThieu, s: NguoiGuiChrome): s is NguoiGuiChrome & { tab: { id: number } } {
  return (
    s.id === c.runtime.id &&
    s.frameId === 0 &&
    typeof s.tab?.id === "number" &&
    typeof s.url === "string" &&
    s.url.startsWith(`${PORTAL_ORIGIN}/`)
  );
}

/** Trả Promise khi có trả lời; `null` = không nhận tin này (không trả lời). */
export function xuLyTinNhan(c: ChromeToiThieu, bdp: BoDieuPhoi, msg: unknown, sender: NguoiGuiChrome): Promise<unknown> | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (m.kenh !== KENH) return null;
  if (laTrangOptions(c, sender)) {
    switch (m.lenh) {
      case "LAY_CAU_HINH":
        return bdp.layCauHinh();
      case "LUU_CAU_HINH":
        return bdp.luuCauHinh({ cauHinh: m.cauHinh, biMatMoi: m.biMatMoi });
      case "LAY_TRANG_THAI":
        return bdp.layTrangThai();
      case "GUI_HEARTBEAT_NGAY":
        return bdp.guiHeartbeatNgay().then(() => bdp.layTrangThai());
      default:
        return null;
    }
  }
  if (laContentScriptPortal(c, sender) && m.suKien === "TRANG_SAN_SANG" && typeof m.duongDan === "string") {
    const tabId = sender.tab.id;
    const duongDan = m.duongDan;
    chay(() => bdp.trangSanSang(tabId, duongDan));
  }
  return null;
}

export function ganSuKien(c: ChromeToiThieu, bdp: BoDieuPhoi): void {
  c.runtime.onInstalled.addListener(() => {
    chay(() => damBaoAlarms(c));
    chay(() => bdp.khoiDong("INSTALL"));
  });
  c.runtime.onStartup.addListener(() => {
    chay(() => damBaoAlarms(c));
    chay(() => bdp.khoiDong("STARTUP"));
  });
  c.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM.phut) chay(() => bdp.nhipPhut());
    else if (a.name === ALARM.keepalive) chay(() => bdp.nhipKeepalive());
  });
  c.tabs.onUpdated.addListener((tabId, info) => {
    if (typeof info.url === "string") {
      const url = info.url;
      chay(() => bdp.tabCapNhat(tabId, url, info.status ?? null));
    }
  });
  c.tabs.onRemoved.addListener((tabId) => chay(() => bdp.tabDong(tabId)));
  c.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const p = xuLyTinNhan(c, bdp, msg, sender);
    if (!p) return false;
    p.then(sendResponse, (e: unknown) => {
      ghiLoi(e);
      sendResponse({ ok: false, loi: { chung: "Lỗi nội bộ của extension" } });
    });
    return true;
  });
  c.action?.onClicked.addListener(() => chay(() => c.runtime.openOptionsPage()));
}
