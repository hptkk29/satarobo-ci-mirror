/**
 * Giả lập các mảnh `chrome.*` mà extension dùng — tách khỏi lõi nên lõi test được không cần
 * trình duyệt. KHÔNG đọc đồng hồ thật ở đâu cả (luật 19): hẹn giờ được GOM lại để test tự chạy.
 */
import type { KhoLuuTru } from "../../src/lib/kho";

/** `chrome.storage.local` / `chrome.storage.session` giả — sao chép sâu như trình duyệt. */
export class KhoGia implements KhoLuuTru {
  readonly duLieu = new Map<string, unknown>();
  async doc<T>(khoa: string): Promise<T | undefined> {
    const v = this.duLieu.get(khoa);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async ghi(gia: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(gia)) {
      if (v === undefined) this.duLieu.delete(k);
      else this.duLieu.set(k, structuredClone(v));
    }
  }
  async xoa(khoa: readonly string[]): Promise<void> {
    for (const k of khoa) this.duLieu.delete(k);
  }
  /** Toàn bộ nội dung dạng JSON — để quét bí mật. */
  json(): string {
    return JSON.stringify(Object.fromEntries(this.duLieu));
  }
}

/** Hẹn giờ GOM LẠI: test quyết định khi nào chạy (không phụ thuộc đồng hồ thật). */
export class HenGioGia {
  readonly cho: Array<{ ms: number; fn: () => void }> = [];
  datHenGio = (fn: () => void, ms: number): void => {
    this.cho.push({ ms, fn });
  };
  /** Chạy và xoá mọi hẹn đang chờ (một lượt — hẹn mới sinh ra trong lượt này để lại). */
  chayMotLuot(): number {
    const ds = this.cho.splice(0, this.cho.length);
    for (const h of ds) h.fn();
    return ds.length;
  }
}

type NgheRuntime = (msg: unknown, sender: unknown, traLoi: (r: unknown) => void) => boolean | undefined;

/** Một sự kiện `chrome.*.onX` giả: giữ danh sách bộ nghe để test bắn tay. */
export class SuKienGia<F extends (...a: never[]) => unknown> {
  readonly nghe: F[] = [];
  addListener = (fn: F): void => {
    this.nghe.push(fn);
  };
}

/** `chrome` của SERVICE WORKER — đủ các mảnh `nen-chrome.ts` dùng. */
export function taoChromeNenGia() {
  const alarms = new Map<string, { periodInMinutes?: number; delayInMinutes?: number }>();
  const badge: Array<{ text?: string; color?: string; title?: string }> = [];
  const local = new KhoGia();
  const session = new KhoGia();
  const mucTruyCap: string[] = [];
  const area = (k: KhoGia) => ({
    get: async (keys: string | string[]) => {
      const ds = Array.isArray(keys) ? keys : [keys];
      const ra: Record<string, unknown> = {};
      for (const key of ds) {
        const v = await k.doc(key);
        if (v !== undefined) ra[key] = v;
      }
      return ra;
    },
    set: async (o: Record<string, unknown>) => k.ghi(o),
    remove: async (keys: string | string[]) => k.xoa(Array.isArray(keys) ? keys : [keys]),
    setAccessLevel: async (o: { accessLevel: string }) => {
      mucTruyCap.push(o.accessLevel);
    },
  });
  const chrome = {
    runtime: {
      id: "idextensionsatarobopos",
      getURL: (p: string) => `chrome-extension://idextensionsatarobopos/${p.replace(/^\//, "")}`,
      getManifest: () => ({ version: "0.1.0", host_permissions: ["https://merchant.techcombank.com/*", "https://admin.satarobo.vn/*"] }),
      onInstalled: new SuKienGia<(d: { reason: string }) => void>(),
      onStartup: new SuKienGia<() => void>(),
      onMessage: new SuKienGia<(m: unknown, s: unknown, r: (x: unknown) => void) => boolean | undefined>(),
      openOptionsPage: async () => undefined,
      getPlatformInfo: async () => ({ os: "win" }),
    },
    alarms: {
      create: (name: string, info: { periodInMinutes?: number; delayInMinutes?: number }) => {
        alarms.set(name, info);
      },
      get: async (name: string) => (alarms.has(name) ? { name, ...alarms.get(name) } : undefined),
      onAlarm: new SuKienGia<(a: { name: string }) => void>(),
    },
    tabs: {
      get: async () => {
        throw new Error("No tab");
      },
      query: async () => [],
      create: async (p: { url: string }) => ({ id: 1, url: p.url, pinned: true, discarded: false, status: "complete" }),
      update: async () => undefined,
      reload: async () => undefined,
      sendMessage: async () => undefined,
      onUpdated: new SuKienGia<(id: number, info: { url?: string; status?: string }, tab: { url?: string }) => void>(),
      onRemoved: new SuKienGia<(id: number) => void>(),
    },
    storage: { local: area(local), session: area(session) },
    action: {
      setBadgeText: async (o: { text: string }) => {
        badge.push({ text: o.text });
      },
      setBadgeBackgroundColor: async (o: { color: string }) => {
        badge.push({ color: o.color });
      },
      setTitle: async (o: { title: string }) => {
        badge.push({ title: o.title });
      },
      onClicked: new SuKienGia<() => void>(),
    },
  };
  return { chrome, alarms, badge, local, session, mucTruyCap };
}

/** `chrome` của thế giới ISOLATED (content script). */
export class ChromeIsolatedGia {
  readonly id = "idextensionsatarobopos";
  readonly tinDaGui: unknown[] = [];
  /** Được gọi khi content script `chrome.runtime.sendMessage(...)` (thay cho background). */
  khiGui: ((msg: unknown) => void) | null = null;
  private nghe: NgheRuntime[] = [];

  readonly chrome = {
    runtime: {
      id: this.id,
      onMessage: {
        addListener: (fn: NgheRuntime) => {
          this.nghe.push(fn);
        },
      },
      sendMessage: (msg: unknown): Promise<unknown> => {
        const banSao = structuredClone(msg);
        this.tinDaGui.push(banSao);
        this.khiGui?.(banSao);
        return Promise.resolve(undefined);
      },
    },
  };

  /** Mô phỏng `chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })` từ service worker. */
  guiTuBackground(msg: unknown, sender: Record<string, unknown> = { id: this.id }): Promise<unknown> {
    return new Promise((resolve) => {
      let giuCong = false;
      for (const fn of this.nghe) {
        const r = fn(structuredClone(msg), sender, (kq) => resolve(structuredClone(kq)));
        if (r === true) giuCong = true;
      }
      if (!giuCong) resolve(undefined);
    });
  }
}
