// @vitest-environment jsdom
/**
 * [SSL-*] — slideshow ảnh buổi: LƯỚT NGANG thật bằng dải cuộn có bắt điểm dừng (12/11/2026).
 *   [SSL-01] mọi ảnh nằm cạnh nhau trong MỘT dải cuộn ngang snap (không còn đổi ảnh tức thì)
 *   [SSL-02] bấm «Ảnh sau» / ảnh nhỏ ⇒ cuộn MƯỢT tới đúng ảnh (scrollTo smooth, left = k × bề rộng)
 *   [SSL-03] tay vuốt (sự kiện scroll) ⇒ bộ đếm theo ảnh nằm giữa khung
 *   [SSL-04] prefers-reduced-motion ⇒ cuộn «auto», không hoạt ảnh
 *   [SSL-05] vừa ra lệnh cuộn tới ảnh 4 thì các sự kiện scroll đi ngang qua ảnh 2–3 KHÔNG kéo bộ đếm về (không giật)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NutXemAnhBuoi } from "@/components/portal/slideshow-anh-buoi";

const ANH = [1, 2, 3, 4, 5].map((n) => ({ id: `a${n}`, url: `https://cdn.test/${n}.jpg`, caption: n === 1 ? "Chú thích 1" : null }));
const BE_RONG = 300;
let scrollTo: ReturnType<typeof vi.fn>;

function moi(reduced = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: reduced && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
  });
  render(<NutXemAnhBuoi anh={ANH} tieuDe="Buổi 7 · Trở Về Tuổi Thơ" phu="T7, 31/10 · 5 ảnh" />);
  fireEvent.click(screen.getByRole("button", { name: /Xem ảnh chi tiết/ }));
  const dai = screen.getByTestId("dai-anh") as HTMLDivElement;
  Object.defineProperty(dai, "clientWidth", { configurable: true, value: BE_RONG });
  dai.scrollTo = scrollTo as unknown as typeof dai.scrollTo;
  return dai;
}

beforeEach(() => {
  vi.useFakeTimers();
  scrollTo = vi.fn();
  // jsdom không có scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("[SSL-01] dải cuộn ngang", () => {
  it("5 ảnh nằm trong một dải snap-x, mỗi ảnh một khung chiếm hết bề rộng", () => {
    const dai = moi();
    expect(dai.className).toMatch(/snap-x/);
    expect(dai.className).toMatch(/snap-mandatory/);
    expect(dai.className).toMatch(/overflow-x-auto/);
    expect(dai.querySelectorAll("img")).toHaveLength(5);
    for (const khung of Array.from(dai.children)) {
      expect((khung as HTMLElement).className).toMatch(/w-full/);
      expect((khung as HTMLElement).className).toMatch(/snap-center/);
    }
  });
});

describe("[SSL-02] điều khiển ⇒ cuộn mượt", () => {
  it("«Ảnh sau» cuộn tới ảnh thứ 2 (left = 300) bằng smooth", () => {
    moi();
    fireEvent.click(screen.getByRole("button", { name: "Ảnh sau" }));
    expect(scrollTo).toHaveBeenCalledWith({ left: BE_RONG, behavior: "smooth" });
    expect(screen.getByText("2 / 5")).toBeTruthy();
  });
  it("«Ảnh trước» ở ảnh đầu ⇒ quay vòng về ảnh cuối", () => {
    moi();
    fireEvent.click(screen.getByRole("button", { name: "Ảnh trước" }));
    expect(scrollTo).toHaveBeenCalledWith({ left: 4 * BE_RONG, behavior: "smooth" });
    expect(screen.getByText("5 / 5")).toBeTruthy();
  });
  it("bấm ảnh nhỏ số 4 ⇒ cuộn tới left = 900", () => {
    moi();
    fireEvent.click(screen.getByRole("tab", { name: "Ảnh 4" }));
    expect(scrollTo).toHaveBeenCalledWith({ left: 3 * BE_RONG, behavior: "smooth" });
    expect(screen.getByText("4 / 5")).toBeTruthy();
  });
});

describe("[SSL-03] tay vuốt", () => {
  it("scrollLeft = 600 ⇒ bộ đếm «3 / 5»", () => {
    const dai = moi();
    dai.scrollLeft = 2 * BE_RONG;
    fireEvent.scroll(dai);
    expect(screen.getByText("3 / 5")).toBeTruthy();
  });
});

describe("[SSL-04] giảm chuyển động", () => {
  it("prefers-reduced-motion ⇒ behavior auto", () => {
    moi(true);
    fireEvent.click(screen.getByRole("button", { name: "Ảnh sau" }));
    expect(scrollTo).toHaveBeenCalledWith({ left: BE_RONG, behavior: "auto" });
  });
});

describe("[SSL-05] không giật khi cuộn nhiều ảnh một lượt", () => {
  it("ra lệnh tới ảnh 4: scroll ngang qua ảnh 2, 3 không kéo bộ đếm về; tới ảnh 4 thì nhả đích", () => {
    const dai = moi();
    fireEvent.click(screen.getByRole("tab", { name: "Ảnh 4" }));
    expect(screen.getByText("4 / 5")).toBeTruthy();
    for (const x of [1, 2]) {
      dai.scrollLeft = x * BE_RONG;
      fireEvent.scroll(dai);
      expect(screen.getByText("4 / 5")).toBeTruthy();
    }
    dai.scrollLeft = 3 * BE_RONG;
    fireEvent.scroll(dai);
    // đã tới đích ⇒ lần vuốt tay kế tiếp được theo dõi lại
    dai.scrollLeft = 4 * BE_RONG;
    fireEvent.scroll(dai);
    expect(screen.getByText("5 / 5")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1000));
  });
});
