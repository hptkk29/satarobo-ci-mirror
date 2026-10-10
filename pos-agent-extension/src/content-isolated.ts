/*
 * SataRobo POS Agent — content script world ISOLATED (cầu nối).
 *
 * Service worker ⇄ (chrome.runtime) ⇄ tệp này ⇄ (window.postMessage) ⇄ world MAIN.
 *   · Chỉ nhận lệnh từ service worker của CHÍNH extension (sender không có `tab`, đúng id).
 *   · Mỗi lệnh một nonce 128-bit MỚI; chỉ nhận kết quả mang đúng nonce đang chờ, từ CHÍNH cửa
 *     sổ này, đúng origin portal; nonce dùng MỘT lần. Quá 30 giây ⇒ MAIN_TIMEOUT.
 *   · Không đọc cấu hình, không đọc bí mật, không thấy header/token (chúng ở lại world MAIN).
 *   · Báo service worker "trang sẵn sàng" kèm ĐƯỜNG DẪN (không query, không hash).
 *
 * SCRIPT CỔ ĐIỂN: không import / export / biến toàn cục.
 */
(() => {
  "use strict";

  const KENH = "satarobo-pos-agent";
  const PORTAL_ORIGIN = "https://merchant.techcombank.com";
  const HET_GIO_MS = 30_000;

  interface NguoiGui {
    id?: string;
    tab?: unknown;
  }
  interface ChromeIso {
    runtime: {
      id: string;
      onMessage: { addListener(fn: (msg: unknown, sender: NguoiGui, traLoi: (r: unknown) => void) => boolean | undefined): void };
      sendMessage(msg: unknown): Promise<unknown>;
    };
  }
  interface TinCuaSo {
    data: unknown;
    origin: string;
    source: unknown;
  }
  interface CuaSoIso {
    location: { origin: string; pathname: string };
    top: unknown;
    chrome?: ChromeIso;
    addEventListener(t: "message", fn: (ev: TinCuaSo) => void): void;
    postMessage(data: unknown, targetOrigin: string): void;
    crypto: { getRandomValues(a: Uint8Array): Uint8Array };
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(h: unknown): void;
  }

  const W = globalThis as unknown as CuaSoIso;
  if (!W.location || W.location.origin !== PORTAL_ORIGIN || W.top !== W) return;
  const c = W.chrome;
  if (!c || !c.runtime) return;

  const laObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  const cho = new Map<string, { traLoi: (r: unknown) => void; hen: unknown }>();

  function taoId(): string {
    const b = W.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  W.addEventListener("message", (ev: TinCuaSo) => {
    if (ev.source !== W || ev.origin !== PORTAL_ORIGIN) return;
    const d = ev.data;
    if (!laObject(d) || d.kenh !== KENH || d.huong !== "ket-qua" || typeof d.id !== "string") return;
    const p = cho.get(d.id);
    if (!p) return; // nonce lạ / đã dùng
    cho.delete(d.id);
    W.clearTimeout(p.hen);
    p.traLoi(d.ketQua);
  });

  c.runtime.onMessage.addListener((msg, sender, traLoi) => {
    if (!sender || sender.id !== c.runtime.id || sender.tab !== undefined) return false;
    if (!laObject(msg) || msg.kenh !== KENH || !laObject(msg.lenh)) return false;
    const id = taoId();
    const hen = W.setTimeout(() => {
      if (cho.delete(id)) traLoi({ loai: "LOI", ma: "MAIN_TIMEOUT" });
    }, HET_GIO_MS);
    cho.set(id, { traLoi, hen });
    W.postMessage({ kenh: KENH, huong: "lenh", id, lenh: msg.lenh }, PORTAL_ORIGIN);
    return true; // trả lời bất đồng bộ
  });

  try {
    c.runtime.sendMessage({ kenh: KENH, suKien: "TRANG_SAN_SANG", duongDan: W.location.pathname }).catch(() => undefined);
  } catch {
    // service worker đang khởi động lại — lần alarm kế tiếp sẽ tự kiểm
  }
})();
