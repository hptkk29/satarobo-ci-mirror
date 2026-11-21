// @vitest-environment jsdom
/**
 * [HDNAV-N*] Thanh điều hướng cấp 1 của khu Hoá đơn (S5b).
 *
 * Canh bằng HÀNH VI trên phần tử thật (href dựng ra, tab nào ẩn, phím mũi tên), không grep mã nguồn:
 *   · đổi tab KHÔNG mất cơ sở + tháng; dòng chọn / ngăn / trang bị bỏ;
 *   · tab ẩn theo quyền — mỗi ca "KHÔNG thấy X" đi kèm ca "vai kia THẤY X" (luật 11);
 *   · Nhật ký chưa mở (O-6) ⇒ không bao giờ vẽ, kể cả khi cha cố truyền vào.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ pathname: "/payments/hoa-don", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(h.query),
}));

import { HoaDonNav } from "./hoa-don-nav";

const DU = ["hoa-don", "canh-bao", "cau-hinh"] as const;
const nav = () => screen.getByRole("navigation", { name: "Khu vực hoá đơn" });
const tab = (ten: string) => screen.getByRole("link", { name: ten });

beforeEach(() => {
  cleanup();
  h.pathname = "/payments/hoa-don";
  h.query = "";
});

describe("[HDNAV-N1] đổi tab giữ cơ sở + tháng; bỏ dòng chọn / ngăn / trang", () => {
  it("link của MỌI tab mang coSo + thang đang xem", () => {
    h.query = "coSo=cs1&thang=2026-08";
    render(<HoaDonNav hien={DU} />);
    expect(tab("Hoá đơn").getAttribute("href")).toBe("/payments/hoa-don?coSo=cs1&thang=2026-08");
    expect(tab("Cảnh báo & sai sót").getAttribute("href")).toBe("/payments/hoa-don/canh-bao?coSo=cs1&thang=2026-08");
    expect(tab("Cấu hình").getAttribute("href")).toBe("/payments/hoa-don/cau-hinh?coSo=cs1&thang=2026-08");
  });

  it("đang ở ngăn Đã xuất, đã chọn dòng, đang ở trang 3 ⇒ sang tab khác KHÔNG mang theo những thứ đó", () => {
    h.query = "ngan=da-xuat&chon=dot%3Aa&trang=3&hoaDon=hd1&coSo=cs2&thang=2026-07&sapXep=cu-nhat";
    render(<HoaDonNav hien={DU} />);
    const href = tab("Cảnh báo & sai sót").getAttribute("href")!;
    expect(href).toBe("/payments/hoa-don/canh-bao?coSo=cs2&thang=2026-07&sapXep=cu-nhat");
    for (const k of ["ngan=", "chon=", "trang=", "hoaDon="]) expect(href).not.toContain(k);
  });

  it("đối chứng: chưa có phạm vi ⇒ link trần (không dấu ?)", () => {
    render(<HoaDonNav hien={DU} />);
    expect(tab("Cấu hình").getAttribute("href")).toBe("/payments/hoa-don/cau-hinh");
  });

  it("tháng sai dạng trên URL không bị chép sang tab khác", () => {
    h.query = "coSo=cs1&thang=2026-99";
    render(<HoaDonNav hien={DU} />);
    expect(tab("Hoá đơn").getAttribute("href")).toBe("/payments/hoa-don?coSo=cs1");
  });
});

describe("[HDNAV-N2] tab đang mở nói thật (aria-current)", () => {
  it("đúng MỘT tab aria-current=page; các tab khác không có", () => {
    h.pathname = "/payments/hoa-don/canh-bao";
    render(<HoaDonNav hien={DU} />);
    expect(tab("Cảnh báo & sai sót").getAttribute("aria-current")).toBe("page");
    expect(tab("Hoá đơn").getAttribute("aria-current")).toBeNull();
    expect(tab("Cấu hình").getAttribute("aria-current")).toBeNull();
  });

  it("trang phụ của Hoá đơn (Chứng từ ngân hàng) ⇒ tab Hoá đơn sáng nhưng KHÔNG nhận là 'trang hiện tại'", () => {
    h.pathname = "/payments/hoa-don/chung-tu-ngan-hang";
    render(<HoaDonNav hien={DU} />);
    expect(tab("Hoá đơn").getAttribute("aria-current")).toBe("true");
  });

  it("là ĐIỀU HƯỚNG theo URL, không phải tablist giả (không role=tab / aria-selected)", () => {
    render(<HoaDonNav hien={DU} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(nav().querySelector("[aria-selected]")).toBeNull();
  });
});

describe("[HDNAV-N3] tab ẩn theo quyền — có ĐỐI CHỨNG DƯƠNG", () => {
  it("thiếu quyền Cấu hình ⇒ không có tab Cấu hình", () => {
    render(<HoaDonNav hien={["hoa-don", "canh-bao"]} />);
    expect(screen.queryByRole("link", { name: "Cấu hình" })).toBeNull();
  });

  it("đối chứng dương: đủ quyền ⇒ tab Cấu hình CÓ", () => {
    render(<HoaDonNav hien={DU} />);
    expect(screen.getByRole("link", { name: "Cấu hình" })).toBeTruthy();
  });

  it("chỉ có quyền Cấu hình ⇒ hai tab kia không hiện", () => {
    render(<HoaDonNav hien={["cau-hinh"]} />);
    expect(screen.queryByRole("link", { name: "Hoá đơn" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Cảnh báo & sai sót" })).toBeNull();
    expect(screen.getByRole("link", { name: "Cấu hình" })).toBeTruthy();
  });

  it("không tab nào được phép ⇒ không vẽ thanh (không để khung rỗng)", () => {
    const { container } = render(<HoaDonNav hien={[]} />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("Nhật ký (O-6 chưa chốt) KHÔNG bao giờ vẽ, kể cả khi cha truyền vào", () => {
    render(<HoaDonNav hien={[...DU, "nhat-ky"]} />);
    expect(screen.queryByRole("link", { name: "Nhật ký" })).toBeNull();
    expect(nav().querySelectorAll("a")).toHaveLength(3);
  });
});

describe("[HDNAV-N4] bàn phím: mũi tên di chuyển giữa các tab", () => {
  it("→ sang tab kế, ← về tab trước, Home/End về đầu/cuối, vòng tròn ở hai đầu", () => {
    render(<HoaDonNav hien={DU} />);
    tab("Hoá đơn").focus();
    fireEvent.keyDown(tab("Hoá đơn"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Cảnh báo & sai sót"));
    fireEvent.keyDown(tab("Cảnh báo & sai sót"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Cấu hình"));
    fireEvent.keyDown(tab("Cấu hình"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Hoá đơn"));
    fireEvent.keyDown(tab("Hoá đơn"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("Cấu hình"));
    fireEvent.keyDown(tab("Cấu hình"), { key: "Home" });
    expect(document.activeElement).toBe(tab("Hoá đơn"));
    fireEvent.keyDown(tab("Hoá đơn"), { key: "End" });
    expect(document.activeElement).toBe(tab("Cấu hình"));
  });

  it("phím khác không cướp focus (Tab, Enter vẫn chạy mặc định)", () => {
    render(<HoaDonNav hien={DU} />);
    tab("Hoá đơn").focus();
    fireEvent.keyDown(tab("Hoá đơn"), { key: "Enter" });
    fireEvent.keyDown(tab("Hoá đơn"), { key: "a" });
    expect(document.activeElement).toBe(tab("Hoá đơn"));
  });

  it("vùng chạm: mỗi tab đủ cao trên màn cảm ứng (≥ 44px qua pointer-coarse)", () => {
    render(<HoaDonNav hien={DU} />);
    expect(tab("Hoá đơn").className).toMatch(/pointer-coarse:/);
  });
});
