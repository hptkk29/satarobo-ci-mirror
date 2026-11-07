import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock localStorage / sessionStorage for jsdom env
if (typeof window !== "undefined" && !window.localStorage) {
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    },
  });
}

// `next/font/google` chỉ chạy được trong bản dựng của Next (loader SWC), không chạy trong vitest — gọi `Unbounded(...)`
// ở `components/public/pub-fonts.ts` ném "Unbounded is not a function" ngay lúc import, làm đỏ mọi test chạm tới một trang
// public dùng `FF`. Giả lập phẳng: mỗi họ phông trả đối tượng có `variable`/`className`/`style` như bản thật.
vi.mock("next/font/google", () => {
  const giaLap = (o?: { variable?: string }) => ({ variable: o?.variable ?? "", className: "", style: { fontFamily: "" } });
  return { Unbounded: giaLap, Space_Grotesk: giaLap, Space_Mono: giaLap, Be_Vietnam_Pro: giaLap, Bitter: giaLap };
});
