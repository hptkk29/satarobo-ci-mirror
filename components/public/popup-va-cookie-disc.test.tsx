// @vitest-environment jsdom
/**
 * [DISC-UI-POP-*] [DISC-UI-CK-*] Popup học thử 1-1 không được chặn các trang làm việc (DISC/portal/kích hoạt),
 * và banner cookie không được che nút cuối trang (đệm đáy <body> = chiều cao banner).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a> }));

import { PopupHocThu11 } from "./popup-hoc-thu-1-1";
import { CookieConsent } from "./cookie-consent";

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.style.paddingBottom = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mo = (p: string) => {
  pathname = p;
  render(<PopupHocThu11 />);
  act(() => {
    vi.advanceTimersByTime(21_000);
  });
  return document.querySelector('[aria-labelledby="popup-hoc-thu-title"]');
};

describe("popup học thử 1-1", () => {
  it("[DISC-UI-POP-01] KHÔNG bật ở /disc, /disc/bat-dau, /portal/x, /kich-hoat", () => {
    for (const p of ["/disc", "/disc/bat-dau", "/portal/ho-so", "/kich-hoat", "/lien-he"]) {
      expect(mo(p), p).toBeNull();
      cleanup();
    }
  });
  it("[DISC-UI-POP-02] đối chứng dương: vẫn bật ở trang chủ và /discovery (không khớp tiền tố nửa chừng)", () => {
    expect(mo("/")).not.toBeNull();
    cleanup();
    window.sessionStorage.clear();
    expect(mo("/discovery")).not.toBeNull();
  });
});

describe("banner cookie", () => {
  it("[DISC-UI-CK-01] đệm đáy body = chiều cao banner khi hiện, gỡ khi đóng", () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 187 });
    try {
      const { getByText } = render(<CookieConsent />);
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(document.body.style.paddingBottom).toBe("187px");
      act(() => {
        getByText("Chấp nhận tất cả").click();
      });
      expect(document.body.style.paddingBottom).toBe("");
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, "offsetHeight", desc);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    }
  });
});
