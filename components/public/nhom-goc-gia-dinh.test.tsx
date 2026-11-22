// @vitest-environment jsdom
/**
 * [GOC-HEADER-*] Mục «Góc gia đình» trên thanh trên: MỘT nút thay ba mục riêng (DISC · Tủ sách · Sức khỏe), bấm ra bảng.
 * Ca cuối render ĐÚNG `<Header>` thật để chứng minh ba mục không còn nằm riêng trên hàng menu (chỗ từng bị cắt ở 1181–1360px).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ priority: _p, ...p }: any) => <span data-anh={p.alt} />,
}));
import { NhomGocGiaDinh } from "./nhom-goc-gia-dinh";
import { Header } from "./header";
import { mucGocGiaDinh } from "@/lib/public/goc-gia-dinh";

const NHOM = mucGocGiaDinh(true, { tuSach: true, sucKhoe: true });

beforeEach(() => {
  path = "/";
});
afterEach(() => cleanup());

describe("[GOC-HEADER-01] bảng xổ của thanh trên", () => {
  it("chưa bấm: chỉ có nút (aria-expanded=false), CHƯA có bảng và chưa có liên kết nào", () => {
    render(<NhomGocGiaDinh nhan="Góc gia đình" nhom={NHOM} />);
    const nut = screen.getByRole("button", { name: /Góc gia đình/ });
    expect(nut.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("goc-header-panel")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("bấm: bảng hiện đủ ba lối vào đúng thứ tự và đúng đích; bấm lần nữa thì đóng", () => {
    render(<NhomGocGiaDinh nhan="Góc gia đình" nhom={NHOM} />);
    const nut = screen.getByRole("button", { name: /Góc gia đình/ });
    fireEvent.click(nut);
    expect(nut.getAttribute("aria-expanded")).toBe("true");
    expect(nut.getAttribute("aria-controls")).toBe(screen.getByTestId("goc-header-panel").id);
    expect(within(screen.getByTestId("goc-header-panel")).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Khám phá DISC", "/disc"],
      ["Tủ sách", "/tu-sach"],
      ["Sức khỏe", "/suc-khoe"],
    ]);
    fireEvent.click(nut);
    expect(screen.queryByTestId("goc-header-panel")).toBeNull();
  });
  it("Esc, bấm ra ngoài, và đổi trang đều đóng (bấm TRONG bảng thì không)", () => {
    const { rerender } = render(<NhomGocGiaDinh nhan="Góc gia đình" nhom={NHOM} />);
    const nut = screen.getByRole("button", { name: /Góc gia đình/ });
    fireEvent.click(nut);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("goc-header-panel")).toBeNull();
    fireEvent.click(nut);
    fireEvent.pointerDown(screen.getByTestId("goc-header-panel"));
    expect(screen.getByTestId("goc-header-panel")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("goc-header-panel")).toBeNull();
    fireEvent.click(nut);
    path = "/tu-sach";
    rerender(<NhomGocGiaDinh nhan="Góc gia đình" nhom={NHOM} />);
    expect(screen.queryByTestId("goc-header-panel")).toBeNull();
  });
  it("đang ở một trang của nhóm ⇒ nút được đánh dấu `on` và mục đó aria-current=page; ở trang khác thì không (đối chứng)", () => {
    path = "/suc-khoe";
    const { unmount } = render(<NhomGocGiaDinh nhan="Góc gia đình" nhom={NHOM} />);
    const nut = screen.getByRole("button", { name: /Góc gia đình/ });
    expect(nut.className).toContain("on");
    fireEvent.click(nut);
    expect(screen.getByTestId("goc-header-suc-khoe").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("goc-header-tu-sach").getAttribute("aria-current")).toBeNull();
    unmount();
    path = "/khoa-hoc";
    render(<NhomGocGiaDinh nhan="Góc gia đình" nhom={NHOM} />);
    expect(screen.getByRole("button", { name: /Góc gia đình/ }).className).not.toContain("on");
  });
});

describe("[GOC-HEADER-02] <Header> thật: ba mục gom thành MỘT, đứng trước «Liên hệ»", () => {
  const nhanNav = () => [...document.querySelectorAll(".nav-links > a, .nav-links > .nav-goc > button")].map((e) => e.textContent?.trim());

  it("cả ba cờ BẬT: hàng menu có «Góc gia đình» ngay trước «Liên hệ»; KHÔNG còn Tủ sách / Sức khỏe / Khám phá DISC đứng riêng", () => {
    render(<Header discEnabled congThongTin={{ tuSach: true, sucKhoe: true }} />);
    const nhan = nhanNav();
    expect(nhan).toEqual(["Trang chủ", "Về chúng tôi", "Khoá học", "Tin tức", "Tuyển dụng", "Góc gia đình", "Liên hệ"]);
    // Trong hàng menu (không tính menu điện thoại) không có liên kết tới ba trang này cho tới khi bấm mở.
    for (const href of ["/disc", "/tu-sach", "/suc-khoe"]) expect(document.querySelector(`.nav-links a[href="${href}"]`)).toBeNull();
    fireEvent.click(screen.getByTestId("goc-header"));
    for (const href of ["/disc", "/tu-sach", "/suc-khoe"]) expect(document.querySelector(`.nav-links a[href="${href}"]`)).not.toBeNull();
  });
  it("cả ba cờ TẮT: không có nhóm (đối chứng dương: các mục còn lại vẫn đủ)", () => {
    render(<Header discEnabled={false} congThongTin={{ tuSach: false, sucKhoe: false }} />);
    expect(nhanNav()).toEqual(["Trang chủ", "Về chúng tôi", "Khoá học", "Tin tức", "Tuyển dụng", "Liên hệ"]);
    expect(screen.queryByTestId("goc-header")).toBeNull();
  });
  it("đúng một cờ bật: mục đó hiện thẳng như liên kết thường (không dựng nhóm một con)", () => {
    render(<Header discEnabled={false} congThongTin={{ tuSach: true, sucKhoe: false }} />);
    expect(nhanNav()).toEqual(["Trang chủ", "Về chúng tôi", "Khoá học", "Tin tức", "Tuyển dụng", "Tủ sách", "Liên hệ"]);
    expect(screen.queryByTestId("goc-header")).toBeNull();
  });
});
