// @vitest-environment jsdom
/**
 * [PUB-CK-*] Banner cookie theo token `.sr-pub`: nằm trong `.sr-pub` (nhóm public) thì thừa hưởng
 * token, ngoài `.sr-pub` (legacy / auth cũ) thì TỰ mang class `sr-pub` + chủ đề đang dùng để vẫn có màu.
 * Id `cookie-consent-title` GIỮ NGUYÊN — `FloatingCta` tìm banner bằng nó.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { CookieConsent } from "./cookie-consent";

/** localStorage giả trong bộ nhớ: Node mới có `localStorage` thử nghiệm làm hỏng bản của jsdom ("--localstorage-file was not provided"). */
function datLocalStorageGia() {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), clear: () => map.clear() },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  datLocalStorageGia();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hien = () =>
  act(() => {
    vi.advanceTimersByTime(900);
  });

describe("banner cookie — token .sr-pub", () => {
  it("[PUB-CK-01] trong .sr-pub: không tự mang class sr-pub; id tiêu đề giữ nguyên", () => {
    const { container } = render(
      <div className="sr-pub theme-dark">
        <CookieConsent />
      </div>,
    );
    hien();
    const banner = container.querySelector('[data-testid="cookie-consent"]');
    expect(banner).not.toBeNull();
    expect(banner?.className).toBe("pub-ck");
    expect(banner?.getAttribute("aria-labelledby")).toBe("cookie-consent-title");
    expect(container.querySelector("#cookie-consent-title")).not.toBeNull();
  });

  it("[PUB-CK-02] ngoài .sr-pub: tự mang sr-pub + theme-light mặc định", () => {
    const { container } = render(<CookieConsent />);
    hien();
    const banner = container.querySelector('[data-testid="cookie-consent"]');
    expect(banner?.className).toContain("sr-pub");
    expect(banner?.className).toContain("theme-light");
  });

  it("[PUB-CK-03] ngoài .sr-pub và khách đang dùng chủ đề tối ⇒ theme-dark", () => {
    window.localStorage.setItem("sata-theme", "dark");
    const { container } = render(<CookieConsent />);
    hien();
    expect(container.querySelector('[data-testid="cookie-consent"]')?.className).toContain("theme-dark");
  });
});
