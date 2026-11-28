// @vitest-environment jsdom
/**
 * [PUB2-POP-*] Hẹn giờ popup học thử ĐÚNG artifact: 20 giây lần đầu; đóng rồi 60 giây sau hiện lại;
 * đã gửi form thì không hiện nữa (localStorage); Esc đóng cũng tính là đóng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/image", () => ({ default: () => null }));
// Form thật gọi /api/leads — ở đây chỉ cần nút giả lập "gửi xong" qua onSuccess.
vi.mock("@/components/public/lien-he-form", () => ({
  LienHeForm: ({ onSuccess }: { onSuccess?: () => void }) => (
    <button type="button" data-testid="gui-xong" onClick={onSuccess}>
      gửi
    </button>
  ),
}));

import { PopupHocThu11 } from "./popup-hoc-thu-1-1";
import { POPUP_DA_GUI_KEY, doTreKeTiep, docDaGui } from "./popup-hen-gio";

const dang = () => document.querySelector('[aria-labelledby="popup-hoc-thu-title"]');
const tien = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

// Kho giả TRONG BỘ NHỚ, đặt đè `window.localStorage`: trên Node 25+ có `localStorage` gốc (webstorage) thò ra cạnh jsdom và hành vi khác
// nhau theo phiên bản Node / cách gọi (hook chạy bằng node mặc định, tay chạy bằng node 22) — setItem không giữ lại giá trị thì ca "đã gửi" đỏ.
// Test này kiểm LOGIC hẹn giờ + cờ "đã gửi", không kiểm bộ nhớ trình duyệt ⇒ dùng kho tất định.
function taoKhoGia(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  pathname = "/";
  vi.useFakeTimers();
  Object.defineProperty(window, "localStorage", { configurable: true, value: taoKhoGia() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("[PUB2-POP-01] lần đầu hiện sau 20 giây", () => {
  it("19,9s chưa mở; 20s mở", () => {
    render(<PopupHocThu11 />);
    tien(19_900);
    expect(dang()).toBeNull();
    tien(150);
    expect(dang()).not.toBeNull();
  });
});

describe("[PUB2-POP-02] đóng rồi 60 giây sau hiện lại", () => {
  it("đóng bằng nút ×: 59s chưa mở, 60s mở lại", () => {
    render(<PopupHocThu11 />);
    tien(20_100);
    fireEvent.click(document.querySelector(".modal-x")!);
    expect(dang()).toBeNull();
    tien(59_000);
    expect(dang()).toBeNull();
    tien(1_100);
    expect(dang()).not.toBeNull();
  });
  it("Esc cũng tính là đóng (vẫn hẹn lại 60s)", () => {
    render(<PopupHocThu11 />);
    tien(20_100);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dang()).toBeNull();
    tien(59_000);
    expect(dang()).toBeNull();
    tien(1_100);
    expect(dang()).not.toBeNull();
  });
  it("đóng liên tiếp nhiều lần vẫn mỗi lần 60s", () => {
    render(<PopupHocThu11 />);
    tien(20_100);
    fireEvent.click(document.querySelector(".modal-x")!);
    tien(60_100);
    expect(dang()).not.toBeNull();
    fireEvent.click(document.querySelector(".modal-x")!);
    tien(59_000);
    expect(dang()).toBeNull();
    tien(1_100);
    expect(dang()).not.toBeNull();
  });
});

describe("[PUB2-POP-03] đã GỬI form thì không hiện nữa", () => {
  it("gửi xong ⇒ lưu localStorage; đóng lời cảm ơn rồi chờ 5 phút vẫn không mở lại", () => {
    render(<PopupHocThu11 />);
    tien(20_100);
    fireEvent.click(document.querySelector('[data-testid="gui-xong"]')!);
    expect(docDaGui(window.localStorage)).toBe(true);
    expect(dang()).not.toBeNull(); // lời cảm ơn còn hiện tới khi khách đóng
    fireEvent.click(document.querySelector(".modal-x")!);
    tien(5 * 60_000);
    expect(dang()).toBeNull();
  });
  it("đã gửi từ lần trước (localStorage) ⇒ vào trang không bao giờ mở", () => {
    window.localStorage.setItem(POPUP_DA_GUI_KEY, "1");
    render(<PopupHocThu11 />);
    tien(10 * 60_000);
    expect(dang()).toBeNull();
  });
  it("hàm thuần: đã gửi ⇒ không hẹn; chưa gửi ⇒ 20s / 60s", () => {
    expect(doTreKeTiep("vao-trang", true)).toBeNull();
    expect(doTreKeTiep("dong", true)).toBeNull();
    expect(doTreKeTiep("vao-trang", false)).toBe(20_000);
    expect(doTreKeTiep("dong", false)).toBe(60_000);
  });
});

describe("[PUB2-POP-04] trang làm việc không bị chặn", () => {
  it("/lien-he: không mở dù qua 5 phút; rời /lien-he sang trang thường thì tính lại 20s", () => {
    pathname = "/lien-he";
    const { rerender } = render(<PopupHocThu11 />);
    tien(5 * 60_000);
    expect(dang()).toBeNull();
    pathname = "/";
    rerender(<PopupHocThu11 />);
    tien(19_000);
    expect(dang()).toBeNull();
    tien(1_500);
    expect(dang()).not.toBeNull();
  });
});
