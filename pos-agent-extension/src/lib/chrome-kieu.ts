/**
 * Kiểu TỐI THIỂU của các API `chrome.*` extension dùng (repo không cài `@types/chrome`, và không
 * nên khai `chrome` toàn cục cho cả app Next). Chỉ phần service worker dùng — content script tự
 * khai kiểu tại chỗ (không import được gì).
 */

export interface SuKienChrome<F> {
  addListener(fn: F): void;
}

export interface TabChrome {
  id?: number;
  url?: string;
  pinned?: boolean;
  discarded?: boolean;
  status?: string;
}

export interface NguoiGuiChrome {
  id?: string;
  url?: string;
  tab?: { id?: number };
  frameId?: number;
}

export interface VungKhoChrome {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(o: { accessLevel: "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS" }): Promise<void>;
}

export interface ChromeToiThieu {
  runtime: {
    id: string;
    getURL(path: string): string;
    getManifest(): { version?: string; host_permissions?: string[] };
    onInstalled: SuKienChrome<(d: { reason: string }) => void>;
    onStartup: SuKienChrome<() => void>;
    onMessage: SuKienChrome<(msg: unknown, sender: NguoiGuiChrome, sendResponse: (r: unknown) => void) => boolean | undefined>;
    openOptionsPage(): Promise<void>;
    getPlatformInfo(): Promise<unknown>;
  };
  alarms: {
    create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }): void;
    get(name: string): Promise<unknown>;
    onAlarm: SuKienChrome<(a: { name: string }) => void>;
  };
  tabs: {
    get(tabId: number): Promise<TabChrome>;
    query(q: { url: string }): Promise<TabChrome[]>;
    create(p: { url: string; pinned: boolean; active: boolean }): Promise<TabChrome>;
    update(tabId: number, p: { url?: string; pinned?: boolean; autoDiscardable?: boolean }): Promise<TabChrome | undefined>;
    reload(tabId: number): Promise<void>;
    sendMessage(tabId: number, msg: unknown, o: { frameId: number }): Promise<unknown>;
    onUpdated: SuKienChrome<(tabId: number, info: { url?: string; status?: string }, tab: TabChrome) => void>;
    onRemoved: SuKienChrome<(tabId: number) => void>;
  };
  storage: { local: VungKhoChrome; session: VungKhoChrome };
  action?: {
    setBadgeText(o: { text: string }): Promise<void>;
    setBadgeBackgroundColor(o: { color: string }): Promise<void>;
    setTitle(o: { title: string }): Promise<void>;
    onClicked: SuKienChrome<() => void>;
  };
}
