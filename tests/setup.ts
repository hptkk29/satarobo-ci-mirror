import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock localStorage / sessionStorage for jsdom env.
// Thay cả khi kho có sẵn nhưng HỎNG: Node 25 tự gắn `localStorage` toàn cục (Web Storage thử nghiệm) mà không có
// `--localstorage-file` thì đối tượng thiếu `clear`/`getItem` ⇒ mọi test gọi `localStorage.clear()` đỏ ở máy dev
// (CI chạy Node 22 nên không thấy). Kho thay thế là bộ nhớ thật trong tiến trình — đọc lại được thứ vừa ghi.
function khoBoNho(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}
function khoDungDuoc(k: unknown): boolean {
  const s = k as Partial<Storage> | null | undefined;
  return !!s && typeof s.clear === "function" && typeof s.getItem === "function" && typeof s.setItem === "function";
}
if (typeof window !== "undefined") {
  for (const ten of ["localStorage", "sessionStorage"] as const) {
    let hienCo: unknown;
    try {
      hienCo = window[ten];
    } catch {
      hienCo = undefined;
    }
    if (!khoDungDuoc(hienCo)) Object.defineProperty(window, ten, { configurable: true, value: khoBoNho() });
  }
}

// `next/font/google` chỉ chạy được trong bản dựng của Next (loader SWC), không chạy trong vitest — gọi `Unbounded(...)`
// ở `components/public/pub-fonts.ts` ném "Unbounded is not a function" ngay lúc import, làm đỏ mọi test chạm tới một trang
// public dùng `FF`. Giả lập phẳng: mỗi họ phông trả đối tượng có `variable`/`className`/`style` như bản thật.
vi.mock("next/font/google", () => {
  const giaLap = (o?: { variable?: string }) => ({ variable: o?.variable ?? "", className: "", style: { fontFamily: "" } });
  return { Unbounded: giaLap, Space_Grotesk: giaLap, Space_Mono: giaLap, Be_Vietnam_Pro: giaLap, Bitter: giaLap };
});
