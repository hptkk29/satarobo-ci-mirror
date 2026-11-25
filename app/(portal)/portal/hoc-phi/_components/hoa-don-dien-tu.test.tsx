// @vitest-environment jsdom
/**
 * Ca [HDP-PH-*] — khối «Hoá đơn điện tử» dưới học phí của con (cổng phụ huynh, Invoice Hub S10).
 * Canh phần tử thật: liên kết tải trỏ đúng route; cờ tắt + rỗng ⇒ không vẽ gì; không mang studentId / tên con / khoá kho / XML.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/finance/hoa-don/phan-phoi-db", () => ({})); // chỉ lấy KIỂU
import { HoaDonDienTuPhuHuynh } from "./hoa-don-dien-tu";

const dong = (o: Partial<{ id: string; tieuDe: string; kyHieu: string | null; ngayLabel: string | null; soTien: number; taiPdf: string }> = {}) => ({
  id: "hd1",
  tieuDe: "Hoá đơn số 127",
  kyHieu: "1C26TSR",
  ngayLabel: "11/10/2026",
  soTien: 5_000_000,
  taiPdf: "/api/hoa-don/hd1/tai-pdf",
  ...o,
});

describe("[HDP-PH-01] cờ tắt và chưa có hoá đơn ⇒ không vẽ gì", () => {
  it("bat=false, dong rỗng ⇒ trống; đối chứng: bat=true ⇒ có khối với lời giải thích", () => {
    const { container, unmount } = render(<HoaDonDienTuPhuHuynh khoi={{ bat: false, dong: [] }} />);
    expect(container.innerHTML).toBe("");
    unmount();
    render(<HoaDonDienTuPhuHuynh khoi={{ bat: true, dong: [] }} />);
    expect(screen.getByRole("heading", { name: /Hoá đơn điện tử/ })).toBeTruthy();
    expect(screen.getByText(/Chưa có hoá đơn điện tử nào/)).toBeTruthy();
  });
  it("có hoá đơn thì vẫn vẽ dù bat=false (hoá đơn đã được lọc theo cờ ở loader)", () => {
    render(<HoaDonDienTuPhuHuynh khoi={{ bat: false, dong: [dong()] }} />);
    expect(screen.getByText("Hoá đơn số 127")).toBeTruthy();
  });
});

describe("[HDP-PH-02] liên kết tải là thẻ <a> THẬT, chỉ PDF", () => {
  it("mỗi hoá đơn một liên kết trỏ đúng route; không có XML / gửi lại", () => {
    render(<HoaDonDienTuPhuHuynh khoi={{ bat: true, dong: [dong(), dong({ id: "hd2", tieuDe: "Hoá đơn số 128", taiPdf: "/api/hoa-don/hd2/tai-pdf" })] }} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/api/hoa-don/hd1/tai-pdf", "/api/hoa-don/hd2/tai-pdf"]);
    expect(screen.getByRole("link", { name: "Tải PDF Hoá đơn số 127" })).toBeTruthy();
    expect(screen.queryByText(/XML/i)).toBeNull();
    expect(screen.queryByText(/gửi lại/i)).toBeNull();
  });
  it("in số, ký hiệu, ngày, tiền", () => {
    render(<HoaDonDienTuPhuHuynh khoi={{ bat: true, dong: [dong()] }} />);
    expect(screen.getByText(/Ký hiệu 1C26TSR/)).toBeTruthy();
    expect(screen.getByText(/Ngày 11\/10\/2026/)).toBeTruthy();
    expect(screen.getByText("5.000.000 đ")).toBeTruthy();
  });
  it("thiếu ký hiệu / ngày ⇒ không in 'null' hay 'Ký hiệu ' trống", () => {
    const { container } = render(<HoaDonDienTuPhuHuynh khoi={{ bat: true, dong: [dong({ kyHieu: null, ngayLabel: null })] }} />);
    expect(container.textContent).not.toMatch(/null|undefined|Ký hiệu\s*(·|$)/);
  });
});

describe("[HDP-PH-03] 320px: không có phần tử ép ngang", () => {
  it("không dùng bảng; thân dòng dùng flex-col → sm:flex-row; vùng bấm ≥ 44px (min-h-11)", () => {
    const { container } = render(<HoaDonDienTuPhuHuynh khoi={{ bat: true, dong: [dong()] }} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.innerHTML).toMatch(/flex-col[^"]*sm:flex-row/);
    expect(screen.getByRole("link").className).toMatch(/min-h-11/);
  });
});

describe("[HDP-PH-04] không rò định danh", () => {
  it("HTML không chứa studentId, khoá kho, tepPdfKey", () => {
    const { container } = render(<HoaDonDienTuPhuHuynh khoi={{ bat: true, dong: [dong()] }} />);
    expect(container.innerHTML).not.toMatch(/studentId|tepPdfKey|hoa-don\/CS|r2\.|\.pdf\?/);
  });
});
