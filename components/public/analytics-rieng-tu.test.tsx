// @vitest-environment jsdom
/**
 * [RT-*] GA4 / Meta Pixel không được gửi page_view/PageView (và không gửi URL kèm query) trên đường DISC riêng tư.
 * Dữ liệu BỊA. Không mạng: next/script được thay bằng thẻ <script> không chạy, ta tự chạy chuỗi khởi tạo trong jsdom
 * với gtag/fbq giả để đo CÁI GÌ sẽ được gửi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { laDuongRiengTu } from "@/lib/disc/rieng-tu-duong-dan";

let duongHienTai = "/";
vi.mock("next/navigation", () => ({ usePathname: () => duongHienTai }));
vi.mock("@/lib/cookie-consent", () => ({ hasConsent: () => true }));
vi.mock("next/script", () => ({
  default: (p: { id?: string; src?: string; dangerouslySetInnerHTML?: { __html: string } }) =>
    createElement("script", {
      "data-id": p.id ?? p.src,
      "data-src": p.src,
      dangerouslySetInnerHTML: p.dangerouslySetInnerHTML,
    }),
}));

import { GA4 } from "./ga4";
import { MetaPixel } from "./meta-pixel";

const GA_ID = "G-TEST123";
const PX_ID = "111222333";
const W = window as unknown as Record<string, unknown>;

function datViTri(pathname: string, search = "") {
  window.history.pushState({}, "", `${pathname}${search}`);
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

const RIENG = ["/disc/bat-dau", "/disc/xac-minh-email", "/kich-hoat", "/kich-hoat/abc", "/portal/disc", "/portal/disc/abc123"];
const THUONG = ["/", "/disc", "/khoa-hoc/laptrinhrobot", "/kich-hoat-abc", "/disc/bat-dau-gia", "/portal/discovery"];

describe("[RT-01] laDuongRiengTu", () => {
  it.each(RIENG)("riêng tư: %s", (p) => expect(laDuongRiengTu(p)).toBe(true));
  it.each(THUONG)("thường: %s", (p) => expect(laDuongRiengTu(p)).toBe(false));
  it("bỏ query, hoa/thường, dấu / cuối; null thì không riêng tư", () => {
    expect(laDuongRiengTu("/disc/xac-minh-email?t=abc")).toBe(true);
    expect(laDuongRiengTu("/DISC/Bat-Dau/")).toBe(true);
    expect(laDuongRiengTu(null)).toBe(false);
  });
});

function gtagDoanDuoc() {
  const lay = () => (W.dataLayer as unknown[]).map((a) => Array.from(a as ArrayLike<unknown>));
  return lay;
}

describe("[RT-02] GA4 khởi tạo", () => {
  it.each(RIENG)("%s: bật ga-disable và config send_page_view=false", (p) => {
    datViTri(p, "?t=bi-mat");
    const { container } = render(createElement(GA4));
    // Cờ do EFFECT của component đặt (trước khi script nội tuyến chạy) cũng phải đúng — ca SPA không chạy lại script.
    expect(W[`ga-disable-${GA_ID}`]).toBe(true);
    delete W[`ga-disable-${GA_ID}`];
    chayInline(container, "ga4-init");
    expect(W[`ga-disable-${GA_ID}`]).toBe(true);
    const cfg = gtagDoanDuoc()().find((a) => a[0] === "config");
    expect((cfg![2] as { send_page_view: boolean }).send_page_view).toBe(false);
  });
  it.each(THUONG)("đối chứng dương %s: không tắt, send_page_view=true", (p) => {
    datViTri(p);
    const { container } = render(createElement(GA4));
    chayInline(container, "ga4-init");
    expect(W[`ga-disable-${GA_ID}`]).toBe(false);
    const cfg = gtagDoanDuoc()().find((a) => a[0] === "config");
    expect((cfg![2] as { send_page_view: boolean }).send_page_view).toBe(true);
  });
});

describe("[RT-03] GA4 đổi route SPA", () => {
  it("thường → riêng tư bật cờ tắt; riêng tư → thường tắt cờ", () => {
    datViTri("/disc");
    const { rerender } = render(createElement(GA4));
    expect(W[`ga-disable-${GA_ID}`]).toBe(false);
    datViTri("/disc/xac-minh-email", "?t=bi-mat");
    rerender(createElement(GA4));
    expect(W[`ga-disable-${GA_ID}`]).toBe(true);
    datViTri("/");
    rerender(createElement(GA4));
    expect(W[`ga-disable-${GA_ID}`]).toBe(false);
  });
  it("bắt đầu ở đường riêng tư rồi sang trang thường: bù ĐÚNG MỘT page_view, không query", () => {
    const gtag = vi.fn();
    W.gtag = gtag;
    datViTri("/disc/xac-minh-email", "?t=bi-mat");
    const { rerender } = render(createElement(GA4));
    expect(gtag).not.toHaveBeenCalled();
    datViTri("/disc", "?utm=1");
    rerender(createElement(GA4));
    expect(gtag).toHaveBeenCalledTimes(1);
    const [, ten, tham] = gtag.mock.calls[0] as [string, string, { page_location: string }];
    expect(ten).toBe("page_view");
    expect(tham.page_location).not.toContain("?");
    expect(tham.page_location).not.toContain("bi-mat");
  });
  it("bắt đầu ở trang thường: không bù page_view (config đã gửi)", () => {
    const gtag = vi.fn();
    W.gtag = gtag;
    datViTri("/disc");
    const { rerender } = render(createElement(GA4));
    datViTri("/khoa-hoc");
    rerender(createElement(GA4));
    expect(gtag).not.toHaveBeenCalled();
  });
});

describe("[RT-04] Meta Pixel khởi tạo", () => {
  function chayVoiFbq(p: string) {
    const fbq = vi.fn() as unknown as ((...a: unknown[]) => void) & Record<string, unknown>;
    W.fbq = fbq;
    datViTri(p, "?t=bi-mat");
    const { container } = render(createElement(MetaPixel));
    // Effect của component chạy lúc mount; ở trình duyệt thật `fbq` chưa tồn tại khi đó ⇒ chỉ đo phần SCRIPT NỘI TUYẾN.
    (fbq as unknown as ReturnType<typeof vi.fn>).mockClear();
    chayInline(container, "meta-pixel-init");
    return fbq as unknown as ReturnType<typeof vi.fn> & Record<string, unknown>;
  }
  it.each(RIENG)("%s: không PageView", (p) => {
    const fbq = chayVoiFbq(p);
    expect(fbq).toHaveBeenCalledWith("init", PX_ID);
    expect(fbq).not.toHaveBeenCalledWith("track", "PageView");
    // N1: trước `init` phải tắt cấu hình tự động và thu hồi đồng ý (không sự kiện tự động / Advanced Matching).
    const ten = (fbq as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.slice(0, 2).join("|"));
    const iInit = ten.indexOf("init|" + PX_ID);
    expect(ten.indexOf("set|autoConfig")).toBeGreaterThanOrEqual(0);
    expect(ten.indexOf("set|autoConfig")).toBeLessThan(iInit);
    expect(ten.indexOf("consent|revoke")).toBeGreaterThanOrEqual(0);
    expect(ten.indexOf("consent|revoke")).toBeLessThan(iInit);
    const cfg = (fbq as unknown as { mock: { calls: unknown[][] } }).mock.calls.find((c) => c[0] === "set");
    expect(cfg).toEqual(["set", "autoConfig", false, PX_ID]);
  });
  it.each(THUONG)("đối chứng dương %s: có PageView", (p) => {
    const fbq = chayVoiFbq(p);
    expect(fbq).toHaveBeenCalledWith("track", "PageView");
    expect(fbq.disablePushState).toBe(true);
    expect(fbq).not.toHaveBeenCalledWith("consent", "revoke");
  });
});

describe("[RT-05] Meta Pixel đổi route SPA", () => {
  it("sang đường riêng tư: không track; sang đường thường: PageView; lần mount đầu: không track từ effect", () => {
    const fbq = vi.fn();
    W.fbq = fbq;
    datViTri("/disc");
    const { rerender } = render(createElement(MetaPixel));
    expect(fbq).not.toHaveBeenCalled();
    datViTri("/disc/bat-dau");
    rerender(createElement(MetaPixel));
    expect(fbq).not.toHaveBeenCalledWith("track", "PageView");
    datViTri("/khoa-hoc");
    rerender(createElement(MetaPixel));
    expect(fbq).toHaveBeenCalledWith("track", "PageView");
    expect(fbq).toHaveBeenCalledTimes(3);
  });
  it("[N1] vào đường riêng tư thu hồi đồng ý; ra đường thường cấp lại rồi mới PageView; portal cũng vậy", () => {
    const fbq = vi.fn();
    W.fbq = fbq;
    datViTri("/disc");
    const { rerender } = render(createElement(MetaPixel));
    datViTri("/portal/disc/abc123");
    rerender(createElement(MetaPixel));
    expect(fbq.mock.calls).toEqual([["consent", "revoke"]]);
    datViTri("/khoa-hoc");
    rerender(createElement(MetaPixel));
    expect(fbq.mock.calls).toEqual([["consent", "revoke"], ["consent", "grant"], ["track", "PageView"]]);
  });
});
