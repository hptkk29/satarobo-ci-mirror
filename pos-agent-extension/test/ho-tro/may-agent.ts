/**
 * "Máy agent" GIẢ cho test tích hợp: trình duyệt (tab + trang chạy content script THẬT trong
 * `node:vm`), portal Techcombank giả (HTTP), máy chủ satarobo giả (kiểm HMAC độc lập) và bộ
 * điều phối THẬT của service worker. Không có đồng hồ thật: `dongHo.now` do test đặt.
 */
import { TRANG_GIAO_DICH } from "../../src/lib/hang-so";
import { taoBoDieuPhoi, type BoDieuPhoi, type HienThi } from "../../src/lib/bo-dieu-phoi";
import type { TabApi, TabInfo } from "../../src/lib/tab-portal";
import { ChromeIsolatedGia, HenGioGia, KhoGia } from "./chrome-gia";
import { AGENT_ID, BI_MAT, GOC_PROD, MERCHANT, PORTAL, T0, URL_TIM_KIEM } from "./du-lieu";
import { PortalHttpGia, taoXhrGia } from "./portal-gia";
import { SataroboGia } from "./satarobo-gia";
import { CuaSoChung, chayScript, choTroi, taoTheGioi } from "./the-gioi";

interface TrangGia {
  chung: CuaSoChung;
  main: Record<string, unknown>;
  chromeIso: ChromeIsolatedGia;
  duongDan: string;
}

interface TabGia {
  info: TabInfo;
  trang: TrangGia | null;
  autoDiscardable: boolean;
}

/** Thân search mà app portal TỰ gửi khi mở trang giao dịch. */
export const THAN_APP = JSON.stringify({
  page_index: 0,
  page_size: 10,
  transaction_time_from: "2026-10-07 00:00:00",
  transaction_time_to: "2026-10-07 23:59:59",
});

export class TrinhDuyetGia implements TabApi {
  private tabs = new Map<number, TabGia>();
  private idKe = 100;
  baoTrangMoi: ((tabId: number, duongDan: string) => void) | null = null;
  baoCapNhat: ((tabId: number, url: string) => void) | null = null;
  readonly dieuHuong: Array<{ tabId: number; url: string; kieu: "create" | "update" | "reload" }> = [];
  /** App tự gọi search khi mở /soft-pos-transaction (nguồn bắt header). */
  appGoiTimKiem = true;
  /** Thân search app gửi (đổi để mô phỏng thân bị mã hoá). */
  thanApp: string = THAN_APP;

  constructor(private readonly portal: PortalHttpGia) {}

  /** Tab có sẵn TRƯỚC khi cài extension: không có content script (Chrome không tiêm vào trang cũ). */
  themTabCu(url: string, pinned: boolean): number {
    const id = this.idKe++;
    this.tabs.set(id, {
      info: { id, url, pinned, discarded: false, status: "complete" },
      trang: null,
      autoDiscardable: true,
    });
    return id;
  }

  tab(id: number): TabGia | undefined {
    return this.tabs.get(id);
  }

  soTab(): number {
    return this.tabs.size;
  }

  dong(id: number): void {
    this.tabs.delete(id);
  }

  async get(tabId: number): Promise<TabInfo | null> {
    const t = this.tabs.get(tabId);
    return t ? { ...t.info } : null;
  }

  async query(urlPattern: string): Promise<TabInfo[]> {
    const goc = urlPattern.replace(/\*$/, "");
    return [...this.tabs.values()].filter((t) => (t.info.url ?? "").startsWith(goc)).map((t) => ({ ...t.info }));
  }

  async create(p: { url: string; pinned: boolean; active: boolean }): Promise<TabInfo> {
    const id = this.idKe++;
    this.tabs.set(id, {
      info: { id, url: p.url, pinned: p.pinned, discarded: false, status: "loading" },
      trang: null,
      autoDiscardable: true,
    });
    this.dieuHuong.push({ tabId: id, url: p.url, kieu: "create" });
    await this.moTrang(id, p.url);
    return { ...this.tabs.get(id)!.info };
  }

  async update(
    tabId: number,
    p: { url?: string; pinned?: boolean; autoDiscardable?: boolean },
  ): Promise<TabInfo | null> {
    const t = this.tabs.get(tabId);
    if (!t) return null;
    if (p.pinned !== undefined) t.info.pinned = p.pinned;
    if (p.autoDiscardable !== undefined) t.autoDiscardable = p.autoDiscardable;
    if (p.url !== undefined) {
      this.dieuHuong.push({ tabId, url: p.url, kieu: "update" });
      await this.moTrang(tabId, p.url);
    }
    return { ...t.info };
  }

  async reload(tabId: number): Promise<void> {
    const t = this.tabs.get(tabId);
    if (!t) throw new Error(`No tab with id: ${tabId}.`);
    this.dieuHuong.push({ tabId, url: t.info.url ?? "", kieu: "reload" });
    await this.moTrang(tabId, t.info.url ?? `${PORTAL}${TRANG_GIAO_DICH}`);
  }

  async sendMessage(tabId: number, msg: unknown): Promise<unknown> {
    const t = this.tabs.get(tabId);
    if (!t) throw new Error(`No tab with id: ${tabId}.`);
    if (!t.trang) throw new Error("Could not establish connection. Receiving end does not exist.");
    return t.trang.chromeIso.guiTuBackground(msg);
  }

  /** Mở một trang portal trong tab: dựng 2 thế giới + chạy content script THẬT. */
  async moTrang(tabId: number, url: string): Promise<void> {
    const t = this.tabs.get(tabId);
    if (!t) return;
    let duongDan = new URL(url).pathname;
    // App portal tự đá về /login khi chưa đăng nhập.
    if (!this.portal.dangNhap && duongDan !== "/login") duongDan = "/login";
    const chung = new CuaSoChung();
    const chromeIso = new ChromeIsolatedGia();
    chromeIso.khiGui = (m) => {
      const tin = m as { suKien?: string; duongDan?: string };
      if (tin.suKien === "TRANG_SAN_SANG" && typeof tin.duongDan === "string") this.baoTrangMoi?.(tabId, tin.duongDan);
    };
    const iso = taoTheGioi(chung, { ten: "ISOLATED", duongDan, them: { chrome: chromeIso.chrome } });
    const main = taoTheGioi(chung, {
      ten: "MAIN",
      duongDan,
      them: { fetch: this.portal.fetch, XMLHttpRequest: taoXhrGia(this.portal) },
    });
    t.info.url = `${PORTAL}${duongDan}`;
    t.info.status = "complete";
    t.trang = { chung, main, chromeIso, duongDan };
    chayScript(iso, "content-isolated");
    chayScript(main, "content-main");
    this.baoCapNhat?.(tabId, t.info.url);
    if (duongDan === TRANG_GIAO_DICH && this.portal.dangNhap && this.appGoiTimKiem) {
      const f = main.fetch as (u: string, i: Record<string, unknown>) => Promise<unknown>;
      await f(URL_TIM_KIEM, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Auth": this.portal.header["x-api-auth"],
          "x-api-payment": this.portal.header["x-api-payment"],
          "X-Device-ID": this.portal.header["x-device-id"],
        },
        body: this.thanApp,
      });
    }
    await choTroi();
  }
}

export interface MayAgent {
  bdp: BoDieuPhoi;
  portal: PortalHttpGia;
  trinhDuyet: TrinhDuyetGia;
  satarobo: SataroboGia;
  kho: KhoGia;
  khoPhien: KhoGia;
  henGio: HenGioGia;
  hienThi: HienThi[];
  dongHo: { now: number };
  /** Chờ mọi việc đang xếp hàng của bộ điều phối + tin postMessage trôi hết. */
  xong(): Promise<void>;
}

export async function taoMayAgent(
  tc: { cauHinh?: boolean; lastSyncedAt?: number | null; goc?: string } = {},
): Promise<MayAgent> {
  const dongHo = { now: T0 };
  const portal = new PortalHttpGia();
  const trinhDuyet = new TrinhDuyetGia(portal);
  const goc = tc.goc ?? GOC_PROD;
  const satarobo = new SataroboGia({
    agentId: AGENT_ID,
    biMat: BI_MAT,
    goc,
    merchantCode: MERCHANT,
    dongHo: () => dongHo.now,
  });
  const kho = new KhoGia();
  const khoPhien = new KhoGia();
  const henGio = new HenGioGia();
  const hienThi: HienThi[] = [];
  const bdp = taoBoDieuPhoi({
    dongHo: () => dongHo.now,
    kho,
    khoPhien,
    tab: trinhDuyet,
    fetch: satarobo.fetch,
    datHenGio: henGio.datHenGio,
    hienThi: async (h) => {
      hienThi.push(h);
    },
    giuSong: (p) => p,
    hostPermissions: [`${PORTAL}/*`, `${goc}/*`],
  });
  trinhDuyet.baoTrangMoi = (id, d) => {
    void bdp.trangSanSang(id, d);
  };
  trinhDuyet.baoCapNhat = (id, url) => {
    void bdp.tabCapNhat(id, url, "complete");
  };
  if (tc.cauHinh !== false) {
    await kho.ghi({
      cauHinh: { agentId: AGENT_ID, centerCode: "CS1", merchantCode: MERCHANT, satAroboBaseUrl: goc },
      biMat: BI_MAT,
    });
  }
  if (tc.lastSyncedAt !== undefined && tc.lastSyncedAt !== null) await kho.ghi({ lastSyncedAt: tc.lastSyncedAt });
  return {
    bdp,
    portal,
    trinhDuyet,
    satarobo,
    kho,
    khoPhien,
    henGio,
    hienThi,
    dongHo,
    async xong() {
      for (let i = 0; i < 4; i++) {
        await choTroi();
        await bdp.choXong();
      }
    },
  };
}
