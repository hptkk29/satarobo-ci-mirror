// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://hocvien.satarobo.vn/"}
/**
 * [RT-10..12] Host PORTAL (hocvien.satarobo.vn): proxy rewrite `/disc/<id>` → `/portal/disc/<id>` nhưng thanh địa chỉ
 * vẫn là `/disc/<id>`, nên `/disc` ở host này là kết quả của trẻ — KHÔNG được gửi cho Google/Meta.
 * Đối chứng dương: ở host công khai `/disc` là landing marketing (xem analytics-rieng-tu.test.tsx).
 * Dữ liệu BỊA; gtag/fbq giả.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { HOST_PORTAL, laDuongRiengTu } from "@/lib/disc/rieng-tu-duong-dan";

let duongHienTai = "/";
vi.mock("next/navigation", () => ({ usePathname: () => duongHienTai }));
vi.mock("@/lib/cookie-consent", () => ({ hasConsent: () => true }));
vi.mock("next/script", () => ({
  default: (p: { id?: string; src?: string; dangerouslySetInnerHTML?: { __html: string } }) =>
    createElement("script", { "data-id": p.id ?? p.src, dangerouslySetInnerHTML: p.dangerouslySetInnerHTML }),
}));

import { GA4 } from "./ga4";
import { MetaPixel } from "./meta-pixel";

const GA_ID = "G-TEST123";
const PX_ID = "111222333";
const W = window as unknown as Record<string, unknown>;

function datViTri(pathname: string) {
  window.history.pushState({}, "", pathname);
  duongHienTai = pathname;
}
function chayInline(container: HTMLElement, id: string) {
  const el = container.querySelector(`script[data-id="${id}"]`);
  expect(el, `thiếu script ${id}`).not.toBeNull();
  (0, eval)(el!.innerHTML);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GA4_ID", GA_ID);
  vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", PX_ID);
  delete W[`ga-disable-${GA_ID}`];
  delete W.gtag;
  delete W.fbq;
  W.dataLayer = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("[RT-10] laDuongRiengTu theo host", () => {
  it("host portal: /disc và /disc/<id> riêng tư; host công khai/không rõ: /disc là landing", () => {
    expect(laDuongRiengTu("/disc", HOST_PORTAL)).toBe(true);
    expect(laDuongRiengTu("/disc/cmabc123", "HOCVIEN.satarobo.vn")).toBe(true);
    expect(laDuongRiengTu("/disc/cmabc123/bao-cao", HOST_PORTAL)).toBe(true);
    expect(laDuongRiengTu("/discovery", HOST_PORTAL)).toBe(false);
    expect(laDuongRiengTu("/disc", "satarobo.vn")).toBe(false);
    expect(laDuongRiengTu("/disc")).toBe(false);
    expect(laDuongRiengTu("/portal/disc/cmabc123", "satarobo.vn")).toBe(true);
  });
});

describe("[RT-11] trên host portal, /disc/<id> không rò sang GA4 / Pixel", () => {
  it("GA4: bật ga-disable, config send_page_view=false", () => {
    datViTri("/disc/cmabc123");
    const { container } = render(createElement(GA4));
    expect(W[`ga-disable-${GA_ID}`]).toBe(true); // do effect của component
    delete W[`ga-disable-${GA_ID}`];
    chayInline(container, "ga4-init");
    expect(W[`ga-disable-${GA_ID}`]).toBe(true); // do script nội tuyến
    const cfg = (W.dataLayer as unknown[]).map((a) => Array.from(a as ArrayLike<unknown>)).find((a) => a[0] === "config");
    expect((cfg![2] as { send_page_view: boolean }).send_page_view).toBe(false);
  });
  it("GA4: đối chứng dương — /lich-hoc trên cùng host vẫn đo", () => {
    datViTri("/lich-hoc");
    const { container } = render(createElement(GA4));
    chayInline(container, "ga4-init");
    expect(W[`ga-disable-${GA_ID}`]).toBe(false);
  });
  it("Pixel: autoConfig=false + revoke trước init, không PageView", () => {
    const fbq = vi.fn();
    W.fbq = fbq;
    datViTri("/disc/cmabc123");
    const { container } = render(createElement(MetaPixel));
    fbq.mockClear(); // chỉ đo script nội tuyến (ở trình duyệt thật fbq chưa có lúc effect chạy)
    chayInline(container, "meta-pixel-init");
    const ten = fbq.mock.calls.map((c) => c.slice(0, 2).join("|"));
    expect(ten.indexOf("consent|revoke")).toBeGreaterThanOrEqual(0);
    expect(ten.indexOf("consent|revoke")).toBeLessThan(ten.indexOf("init|" + PX_ID));
    expect(fbq).not.toHaveBeenCalledWith("track", "PageView");
  });
  it("Pixel: đối chứng dương — /lich-hoc có PageView", () => {
    const fbq = vi.fn();
    W.fbq = fbq;
    datViTri("/lich-hoc");
    const { container } = render(createElement(MetaPixel));
    chayInline(container, "meta-pixel-init");
    expect(fbq).toHaveBeenCalledWith("track", "PageView");
  });
  it("Pixel SPA: /lich-hoc → /disc/<id> thu hồi đồng ý", () => {
    const fbq = vi.fn();
    W.fbq = fbq;
    datViTri("/lich-hoc");
    const { rerender } = render(createElement(MetaPixel));
    datViTri("/disc/cmabc123");
    rerender(createElement(MetaPixel));
    expect(fbq.mock.calls).toEqual([["consent", "revoke"]]);
  });
});

describe("[RT-12] hằng host khớp proxy.ts", () => {
  it("HOST_PORTAL === PORTAL_HOST của proxy.ts", () => {
    const src = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");
    expect(src).toContain(`const PORTAL_HOST = "${HOST_PORTAL}"`);
  });
});
