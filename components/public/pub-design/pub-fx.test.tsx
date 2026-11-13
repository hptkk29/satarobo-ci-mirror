// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/script", () => ({ default: () => null }));

import { PubFx } from "./pub-fx";

type W = Window & { __sataFx?: number };

describe("[PUB2-FX] fx.js toàn cục không được sống sót khi rời khỏi giao diện public (cổng phụ huynh/học viên/admin)", () => {
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    delete (window as W).__sataFx;
    vi.useRealTimers();
  });

  it("[PUB2-FX-01] gỡ PubFx khi fx.js đã chạy và KHÔNG còn `.sr-pub` ⇒ tải lại trang (trang mới không nạp fx.js)", () => {
    (window as W).__sataFx = 1;
    const { unmount } = render(<PubFx />);
    unmount();
    vi.advanceTimersByTime(100);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("[PUB2-FX-02] ĐỐI CHỨNG: còn một `.sr-pub` (chuyển giữa nhóm public ↔ auth, StrictMode gắn lại) ⇒ KHÔNG tải lại", () => {
    (window as W).__sataFx = 1;
    const { unmount } = render(<PubFx />);
    document.body.innerHTML = '<div class="sr-pub page"></div>';
    unmount();
    vi.advanceTimersByTime(100);
    expect(reload).not.toHaveBeenCalled();
  });

  it("[PUB2-FX-03] ĐỐI CHỨNG: fx.js chưa từng chạy (người dùng đã tắt/không nạp) ⇒ không tải lại", () => {
    const { unmount } = render(<PubFx />);
    unmount();
    vi.advanceTimersByTime(100);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("[PUB2-FX-04..06] chặn hiệu ứng «xáo ký tự» của fx.js trên tiêu đề (04/11/2026)", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("[PUB2-FX-04] mọi h1/h2 có sẵn được đánh dấu data-fx-dec=done TRƯỚC khi fx.js chạy; thẻ khác KHÔNG bị đánh dấu (đối chứng)", () => {
    document.body.innerHTML = "<main><h1>Một</h1><h2>Hai</h2><h3>Ba</h3><p>Bốn</p></main>";
    render(<PubFx />);
    expect(document.querySelector("h1")!.dataset.fxDec).toBe("done");
    expect(document.querySelector("h2")!.dataset.fxDec).toBe("done");
    expect(document.querySelector("h3")!.dataset.fxDec).toBeUndefined();
    expect(document.querySelector("p")!.dataset.fxDec).toBeUndefined();
  });

  it("[PUB2-FX-05] tiêu đề thêm SAU (điều hướng mềm) — kể cả nằm sâu trong khối mới — cũng được đánh dấu", async () => {
    render(<PubFx />);
    const khoi = document.createElement("section");
    khoi.innerHTML = "<div><h2>Mới</h2></div>";
    const h1 = document.createElement("h1");
    document.body.append(khoi, h1);
    await new Promise((r) => setTimeout(r, 0));
    expect(khoi.querySelector("h2")!.dataset.fxDec).toBe("done");
    expect(h1.dataset.fxDec).toBe("done");
  });

  it("[PUB2-FX-06] lưới ghim: fx.js vẫn bỏ qua tiêu đề đã có data-fx-dec (nếu bản fx.js mới bỏ dòng này thì hiệu ứng xáo chữ quay lại)", () => {
    const fx = readFileSync(resolve(process.cwd(), "public/pub/fx.js"), "utf8");
    expect(fx).toMatch(/function decrypt\(el\) \{\s*if \(el\.dataset\.fxDec\) return;/);
  });
});
