/**
 * Nạp ĐÚNG mã content script sẽ được đóng gói (biên dịch bằng cùng hàm `bienDichTs` mà
 * script đóng gói dùng) vào một ngữ cảnh `node:vm`, mô phỏng hai "thế giới" của Chrome:
 *
 *   · MAIN     — thế giới của trang portal (có `fetch`/`XMLHttpRequest` của trang).
 *   · ISOLATED — thế giới của content script thường (có `chrome.runtime`).
 *
 * Hai thế giới dùng CHUNG một cửa sổ thật: `window.postMessage` ở thế giới này tới được bộ
 * nghe `message` ở thế giới kia (và cả chính nó) — `CuaSoChung` mô phỏng đúng điều đó, kể cả
 * nhân bản dữ liệu bằng structured clone như trình duyệt.
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { bienDichTs } from "../../scripts/bien-dich";
import { PORTAL } from "./du-lieu";

export type TenScript = "content-main" | "content-isolated";

const boNhoMa = new Map<TenScript, string>();

/** Mã JS (đã biên dịch) của content script — ĐÚNG thứ nằm trong gói. */
export function maScript(ten: TenScript): string {
  const co = boNhoMa.get(ten);
  if (co) return co;
  const duong = resolve(process.cwd(), "pos-agent-extension", "src", `${ten}.ts`);
  const ma = bienDichTs(readFileSync(duong, "utf8"), `${ten}.ts`, "script");
  boNhoMa.set(ten, ma);
  return ma;
}

export interface SuKienTin {
  data: unknown;
  origin: string;
  source: unknown;
}
type Nghe = (ev: SuKienTin) => void;

/** Một tin đã được `postMessage` (bản sao) — để test quét xem có gì lọt ra không. */
export interface TinDaDang {
  tuTheGioi: string;
  data: unknown;
  targetOrigin: string;
}

export class CuaSoChung {
  private nghe: Array<{ fn: Nghe; theGioi: object }> = [];
  readonly daDang: TinDaDang[] = [];
  constructor(readonly origin: string = PORTAL) {}

  dangKy(fn: Nghe, theGioi: object): void {
    this.nghe.push({ fn, theGioi });
  }

  huy(fn: Nghe): void {
    this.nghe = this.nghe.filter((n) => n.fn !== fn);
  }

  /** `window.postMessage(data, targetOrigin)` từ một thế giới của CHÍNH cửa sổ này. */
  dang(data: unknown, targetOrigin: string, tuTheGioi: string): void {
    const banSao = structuredClone(data);
    this.daDang.push({ tuTheGioi, data: banSao, targetOrigin });
    if (targetOrigin !== "*" && targetOrigin !== this.origin) return; // trình duyệt bỏ im lặng
    setImmediate(() => {
      for (const n of [...this.nghe]) {
        n.fn({ data: structuredClone(banSao), origin: this.origin, source: n.theGioi });
      }
    });
  }

  /** Tin từ NGUỒN LẠ: iframe khác origin, cửa sổ khác, hoặc script trang giả mạo. */
  dangTuNgoai(data: unknown, origin: string, source: unknown): void {
    setImmediate(() => {
      for (const n of [...this.nghe]) n.fn({ data: structuredClone(data), origin, source });
    });
  }
}

export interface TuyChonTheGioi {
  ten: "MAIN" | "ISOLATED";
  duongDan?: string;
  them?: Record<string, unknown>;
}

/** Dựng global của một thế giới + nạp script vào đó. */
export function taoTheGioi(chung: CuaSoChung, tc: TuyChonTheGioi): Record<string, unknown> {
  const duongDan = tc.duongDan ?? "/soft-pos-transaction";
  const g: Record<string, unknown> = {};
  g.window = g;
  g.self = g;
  g.top = g;
  const u = new URL(duongDan, chung.origin);
  g.location = {
    origin: u.origin,
    href: u.href,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    protocol: u.protocol,
    host: u.host,
  };
  g.postMessage = (data: unknown, targetOrigin: string) => chung.dang(data, targetOrigin, tc.ten);
  g.setTimeout = setTimeout;
  g.clearTimeout = clearTimeout;
  g.console = console;
  g.URL = URL;
  g.Headers = Headers;
  g.TextEncoder = TextEncoder;
  g.TextDecoder = TextDecoder;
  g.atob = atob;
  g.btoa = btoa;
  g.crypto = webcrypto;
  g.structuredClone = structuredClone;
  Object.assign(g, tc.them ?? {});
  vm.createContext(g);
  // Bên TRONG ngữ cảnh, `window`/`globalThis` là proxy toàn cục của vm — KHÁC đối tượng `g` ở
  // ngoài. `event.source` phải là đúng đối tượng mà script so (`ev.source !== window`), như
  // trình duyệt trả WindowProxy của chính cửa sổ.
  const trong = vm.runInContext("globalThis", g) as object;
  g.addEventListener = (type: string, fn: Nghe) => {
    if (type === "message") chung.dangKy(fn, trong);
  };
  g.removeEventListener = (type: string, fn: Nghe) => {
    if (type === "message") chung.huy(fn);
  };
  return g;
}

export function chayScript(g: Record<string, unknown>, ten: TenScript): void {
  vm.runInContext(maScript(ten), g as vm.Context, { filename: `${ten}.js` });
}

/** Chờ hàng đợi tác vụ trôi (postMessage giả lập dùng setImmediate). */
export async function choTroi(lan = 12): Promise<void> {
  for (let i = 0; i < lan; i++) await new Promise((r) => setImmediate(r));
}
