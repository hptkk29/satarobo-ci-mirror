/**
 * `localStorage` / `sessionStorage` GIẢ cho bộ test — Web Push Đợt 6.
 *
 * ⚠️ VÌ SAO CẦN, VÀ VÌ SAO ĐỪNG GỠ (đã ĐO 13/09/2026):
 * Trong môi trường test của repo này, biến toàn cục `localStorage` KHÔNG phải `Storage` của jsdom
 * mà là **một object rỗng với prototype `null`** — Node 25 tự phát ra một `localStorage` toàn cục
 * (kèm cảnh báo `--localstorage-file` không có đường dẫn hợp lệ) và bản đó thắng bản của jsdom.
 * Gọi `localStorage.getItem(...)` trên nó ném `TypeError`.
 *
 * Hệ quả nếu không dựng stub: mọi hàm trong `lib/push/bo-nho-may.ts` đi nhánh `catch`, nên
 * `daTatTayOMayNay()` luôn trả `true` ⇒ đường tự đăng ký lại luôn thoát ở cổng 2, và bộ test
 * XANH mà không kiểm được gì. `sessionStorage` thì vẫn là bản thật của jsdom — càng dễ nhầm, vì
 * một nửa trông như đang chạy.
 *
 * Cắm vào `globalThis`, KHÔNG vào `window`: mã sản xuất đọc biến TRẦN (`localStorage`), tức là
 * qua phạm vi toàn cục.
 */

export interface StorageGia {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
}

/** Bản `Storage` tối giản, đủ cho những lời gọi mà mã sản xuất dùng. */
export function storageTrongBoNho(): StorageGia {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

/** Bản NÉM ở mọi lời gọi — mô phỏng cửa sổ riêng tư / "chặn site data". */
export function storageNem(): StorageGia {
  const nem = (): never => {
    throw new Error("SecurityError: site data bị chặn");
  };
  return { getItem: nem, setItem: nem, removeItem: nem, clear: nem };
}

type TenKho = "localStorage" | "sessionStorage";

/**
 * Cắm/khôi phục storage giả. Gọi `camStorage(...)` trong `beforeEach`, `traStorage()` trong
 * `afterEach` — bỏ vế trả lại là rò trạng thái sang tệp test khác của cùng tiến trình.
 */
const goc = new Map<TenKho, PropertyDescriptor | undefined>();

export function camStorage(ten: TenKho, gt: StorageGia | undefined): void {
  if (!goc.has(ten)) goc.set(ten, Object.getOwnPropertyDescriptor(globalThis, ten));
  Object.defineProperty(globalThis, ten, { value: gt, configurable: true, writable: true });
}

/** Cắm bản dùng được cho CẢ HAI kho — điểm bắt đầu của phần lớn ca test. */
export function camCaHaiKho(): void {
  camStorage("localStorage", storageTrongBoNho());
  camStorage("sessionStorage", storageTrongBoNho());
}

export function traStorage(): void {
  for (const [ten, d] of goc) {
    if (d) Object.defineProperty(globalThis, ten, d);
    else delete (globalThis as unknown as Record<string, unknown>)[ten];
  }
  goc.clear();
}
